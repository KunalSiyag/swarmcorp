// SwarmCorp hub: hook telemetry ingest (/api/events), PTY terminals, WebSocket fan-out, static client.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import type { ClientMsg, PaneInfo, ServerMsg, SetupStatus } from '../shared/types.ts';
import { SwarmState, resolveProjectRoot, type HookEnvelope } from './swarm.ts';
import { TranscriptTail } from './transcript.ts';
import { activateLicence, currentLicence, deactivateLicence, isPro } from './licence.ts';
import { compareReceipts, getReceipt, listReceipts, saveReceipt } from './archive.ts';

// ───────────────────────────── config ─────────────────────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
interface FleetMember { role: string; agentId?: string; cwd?: string }
interface Config {
  port: number;
  host: string;
  project: string | null;
  capacity: number;
  autoWake: boolean;
  maxPanes: number;
  claudeCommand: string;
  claudeArgs: string[];
  devOrigins: string[];
  fleet: FleetMember[];
}

function loadConfig(): Config {
  const defaults: Config = {
    port: 4317, host: '127.0.0.1', project: null, capacity: 12, autoWake: true, maxPanes: 12,
    claudeCommand: 'claude', claudeArgs: [], devOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    fleet: [
      { role: 'ceo-dispatcher', agentId: 'ceo-dispatcher' },
      { role: 'opus-researcher', agentId: 'opus-researcher' },
      { role: 'sonnet-implementer', agentId: 'sonnet-implementer-1' },
      { role: 'sonnet-implementer', agentId: 'sonnet-implementer-2' },
      { role: 'haiku-tester', agentId: 'haiku-tester' },
      { role: 'opus-auditor', agentId: 'opus-auditor' },
    ],
  };
  let file: Partial<Config> = {};
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'swarmcorp.config.json'), 'utf8')); } catch { /* optional */ }
  // ~/.config/swarmcorp/config.json overrides the bundled defaults (for installed copies).
  try { file = { ...file, ...JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'swarmcorp', 'config.json'), 'utf8')) }; } catch { /* optional */ }
  const cfg = { ...defaults, ...file };
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (arg('port')) cfg.port = Number(arg('port'));
  if (process.env.SWARMCORP_PORT) cfg.port = Number(process.env.SWARMCORP_PORT);
  cfg.project = arg('project') ?? process.env.SWARM_PROJECT ?? cfg.project;
  cfg.project = path.resolve(cfg.project ? cfg.project.replace(/^~(?=$|\/)/, os.homedir()) : process.cwd());
  return cfg;
}

const cfg = loadConfig();
const LAUNCH_FLEET = process.argv.includes('--fleet');
const HUB_URL = `http://127.0.0.1:${cfg.port}`;
const allowedOrigins = new Set([
  `http://localhost:${cfg.port}`, `http://127.0.0.1:${cfg.port}`, ...cfg.devOrigins,
]);
const allowedHosts = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`, `[::1]:${cfg.port}`]);

const state = new SwarmState({ capacity: cfg.capacity, defaultProject: cfg.project! });

// ───────────────────────────── PTY hub ────────────────────────────────────────

interface Pane {
  info: PaneInfo;
  proc: pty.IPty | null;
  scrollback: string[];
  scrollbackBytes: number;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  spec: { role: string; agentId: string; cwd: string };
}
const panes = new Map<string, Pane>();
const SCROLLBACK_MAX = 512 * 1024;

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // Don't let panes think they are nested inside the session that launched this server.
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', SWARMCORP_URL: HUB_URL, ...extra };
}

function spawnPane(spec: { role: string; agentId?: string; cwd?: string }, reuseId?: string): Pane {
  const role = spec.role || 'claude';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(role)) throw new Error('invalid role');
  const agentId = spec.agentId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(spec.agentId) ? spec.agentId : role;
  const cwd = path.resolve((spec.cwd || cfg.project!).replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`not a directory: ${cwd}`);
  const live = [...panes.values()].filter((p) => p.info.status !== 'exited').length;
  if (!reuseId && live >= cfg.maxPanes) throw new Error(`pane limit reached (${cfg.maxPanes})`);

  const id = reuseId ?? `pane-${crypto.randomBytes(3).toString('hex')}`;
  const info = state.roles.get(role);
  const isShell = role === 'shell';
  const file = isShell ? (process.env.SHELL || '/bin/bash') : cfg.claudeCommand;
  const args = isShell ? [] : role === 'claude' ? [...cfg.claudeArgs] : ['--agent', role, ...cfg.claudeArgs];
  const projectRoot = resolveProjectRoot(cwd);
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color', cols: 100, rows: 30, cwd,
    env: childEnv({ SWARM_ROLE: isShell ? '' : role, SWARM_AGENT_ID: agentId, SWARM_PANE_ID: id, SWARM_PROJECT: projectRoot }),
  });
  const inst = /-(\d+)$/.exec(agentId)?.[1];
  const pane: Pane = {
    info: {
      id, kind: 'pty', scope: 'session', inProject: true, parentLabel: null, role, agentId, label: inst && agentId !== role ? `${info.label} #${inst}` : info.label,
      avatar: info.avatar, model: info.model, cwd, command: [path.basename(file), ...args].join(' '),
      status: isShell ? 'idle' : 'starting', sessionId: null, nodeId: null, title: isShell ? cwd : 'Booting Claude…',
      autoWake: cfg.autoWake && !isShell, exitCode: null, createdAt: Date.now(),
    },
    proc, scrollback: [], scrollbackBytes: 0, pending: '', flushTimer: null, spec: { role, agentId, cwd },
  };
  panes.set(id, pane);
  proc.onData((d) => {
    pane.scrollback.push(d);
    pane.scrollbackBytes += d.length;
    while (pane.scrollbackBytes > SCROLLBACK_MAX && pane.scrollback.length > 1) pane.scrollbackBytes -= pane.scrollback.shift()!.length;
    pane.pending += d;
    if (!pane.flushTimer) {
      pane.flushTimer = setTimeout(() => {
        pane.flushTimer = null;
        const data = pane.pending;
        pane.pending = '';
        broadcast({ t: 'pty', id, d: data });
      }, 16);
    }
  });
  proc.onExit(({ exitCode }) => {
    if (pane.proc !== proc) return; // replaced by a restart
    pane.proc = null;
    state.paneExited(id, exitCode);
  });
  state.upsertPane(pane.info);
  return pane;
}

function killPane(id: string, remove: boolean) {
  const p = panes.get(id);
  if (!p) return false;
  const proc = p.proc;
  p.proc = null;
  try { proc?.kill(); } catch { /* already dead */ }
  if (remove) { panes.delete(id); state.removePane(id); }
  return true;
}

state.on('wake', (paneId: string, text: string) => {
  const p = panes.get(paneId);
  if (!p?.proc) return;
  p.proc.write(text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '));
  setTimeout(() => p.proc?.write('\r'), 150); // separate Enter so the TUI doesn't treat it as pasted newline
});

function launchFleet(cwd?: string) {
  const started: string[] = [];
  for (const m of cfg.fleet) {
    const taken = [...panes.values()].some((p) => p.info.agentId === (m.agentId ?? m.role) && p.info.status !== 'exited');
    if (taken) continue;
    started.push(spawnPane({ ...m, cwd: m.cwd ?? cwd }).info.id);
  }
  return started;
}

// ───────────────────────────── WebSocket fan-out ──────────────────────────────

const clients = new Set<WebSocket>();
function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (msg.t === 'snapshot' && ws.bufferedAmount > 4 * 1024 * 1024) continue; // slow client: skip a frame
    ws.send(data);
  }
}

// ───────────────────────────── read-only mirrors of external sessions ─────────

const mirrors = new Map<string, { tail: TranscriptTail; file: string; scrollback: string[]; bytes: number }>();
setInterval(async () => {
  const targets = state.transcriptTargets();
  const live = new Set(targets.map((t) => t.id));
  for (const id of mirrors.keys()) if (!live.has(id)) mirrors.delete(id);
  for (const t of targets) {
    let m = mirrors.get(t.id);
    if (!m || m.file !== t.file) {
      m = { tail: new TranscriptTail(t.file, t.cwd), file: t.file, scrollback: [], bytes: 0 };
      mirrors.set(t.id, m);
    }
    const d = await m.tail.read();
    if (!d) continue;
    m.scrollback.push(d);
    m.bytes += d.length;
    while (m.bytes > SCROLLBACK_MAX && m.scrollback.length > 1) m.bytes -= m.scrollback.shift()!.length;
    broadcast({ t: 'pty', id: t.id, d });
  }
}, 700);

let snapTimer: NodeJS.Timeout | null = null;
state.on('change', () => {
  if (snapTimer) return;
  snapTimer = setTimeout(() => { snapTimer = null; broadcast({ t: 'snapshot', s: state.snapshot() }); }, 120);
});
state.on('pulse', (p) => broadcast({ t: 'pulse', p }));

// ───────────────────────────── setup check (first-run checklist) ──────────────

function setupStatus(): SetupStatus {
  const home = path.join(os.homedir(), '.claude');
  let hooks = false;
  try { hooks = fs.readFileSync(path.join(home, 'settings.json'), 'utf8').includes('swarmcorp/swarm-hook.mjs'); } catch { /* no settings */ }
  const agents = fs.existsSync(path.join(home, 'agents', 'ceo-dispatcher.md'));
  const claude = (process.env.PATH ?? '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, cfg.claudeCommand)));
  return { hooks, agents, claude, project: cfg.project! };
}

// ───────────────────────────── HTTP ───────────────────────────────────────────

const DIST = path.join(ROOT, 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** Blocks DNS rebinding (Host) and cross-site requests (Origin). This server hands out shells. */
function guard(req: http.IncomingMessage, { needOrigin }: { needOrigin: boolean }): string | null {
  const host = String(req.headers.host ?? '');
  if (!allowedHosts.has(host)) return `forbidden host ${host}`;
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return `forbidden origin ${origin}`;
  if (needOrigin && !origin && req.headers['x-swarmcorp-hook'] !== '1') return 'missing origin';
  return null;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run build` (or use `npm run dev` and open http://localhost:5173).\n');
    return;
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST + path.sep) && file !== DIST) { res.writeHead(403).end(); return; }
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) file = path.join(DIST, 'index.html');
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';
  try {
    if (!pathname.startsWith('/api/')) {
      const bad = guard(req, { needOrigin: false });
      if (bad) return json(res, 403, { error: bad });
      return serveStatic(req, res, pathname);
    }
    const mutating = method !== 'GET' && method !== 'HEAD';
    const bad = guard(req, { needOrigin: mutating });
    if (bad) return json(res, 403, { error: bad });
    if (mutating && !String(req.headers['content-type'] ?? '').includes('application/json')) {
      return json(res, 415, { error: 'content-type must be application/json' });
    }

    if (method === 'POST' && pathname === '/api/events') {
      const body = await readBody(req, 2 * 1024 * 1024);
      const env: HookEnvelope = body?.payload ? body : { hook: String(body?.hook_event_name ?? url.searchParams.get('hook') ?? 'Unknown'), payload: body };
      if (!env.hook) env.hook = String(env.payload?.hook_event_name ?? 'Unknown');
      await state.ingest(env);
      res.writeHead(204).end();
      return;
    }
    if (method === 'GET' && pathname === '/api/state') return json(res, 200, state.snapshot());
    if (method === 'GET' && pathname === '/api/setup') return json(res, 200, setupStatus());
    if (pathname === '/api/licence') {
      if (method === 'GET') return json(res, 200, currentLicence());
      if (method === 'POST') { const b = await readBody(req); const info = await activateLicence(String(b.key ?? '')); state.emit('change'); return json(res, 200, info); }
      if (method === 'DELETE') { const info = await deactivateLicence(); state.emit('change'); return json(res, 200, info); }
    }
    // ── Pro ──
    if (pathname === '/api/project' || pathname.startsWith('/api/receipts')) {
      if (!isPro()) return json(res, 402, { error: 'This is a Pro feature. Activate a licence key in Settings.' });
      const root = cfg.project!;
      if (method === 'POST' && pathname === '/api/project') {
        const b = await readBody(req);
        const dir = path.resolve(String(b.path ?? '').replace(/^~(?=$|\/)/, os.homedir()));
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return json(res, 400, { error: `Not a directory: ${dir}` });
        cfg.project = dir;
        state.setProject(dir);
        return json(res, 200, { project: state.snapshot().defaultProject });
      }
      const proj = state.snapshot().defaultProject || root;
      if (method === 'GET' && pathname === '/api/receipts') return json(res, 200, listReceipts(proj));
      if (method === 'POST' && pathname === '/api/receipts') return json(res, 201, saveReceipt(proj, state.receiptRecord()));
      if (method === 'GET' && pathname === '/api/receipts/compare') {
        const a = getReceipt(proj, url.searchParams.get('a') ?? ''), b = getReceipt(proj, url.searchParams.get('b') ?? '');
        if (!a || !b) return json(res, 404, { error: 'Pick two saved receipts to compare.' });
        return json(res, 200, compareReceipts(a, b));
      }
      const rm = /^\/api\/receipts\/([0-9TZ]{15}-[0-9a-f]{4})$/.exec(pathname);
      if (method === 'GET' && rm) {
        const r = getReceipt(proj, rm[1]);
        if (!r) return json(res, 404, { error: 'No such receipt' });
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="swarmcorp-receipt-${r.id}.md"` });
        res.end(r.markdown);
        return;
      }
    }
    if (method === 'GET' && pathname === '/api/receipt') {
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="swarmcorp-receipt-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md"`,
        'cache-control': 'no-store',
      });
      res.end(state.receipt());
      return;
    }
    if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, port: cfg.port, project: cfg.project, panes: panes.size });
    if (method === 'POST' && pathname === '/api/terminals') {
      const b = await readBody(req);
      const p = spawnPane({ role: String(b.role ?? 'claude'), agentId: b.agentId, cwd: b.cwd });
      return json(res, 201, p.info);
    }
    if (method === 'POST' && pathname === '/api/fleet') {
      const b = await readBody(req);
      return json(res, 201, { started: launchFleet(typeof b.cwd === 'string' && b.cwd ? b.cwd : undefined) });
    }
    if (method === 'POST' && pathname === '/api/reset') { state.reset(); return json(res, 200, { ok: true }); }

    const m = /^\/api\/terminals\/([\w-]+)(?:\/(restart|autowake|kill))?$/.exec(pathname);
    if (m) {
      const [, id, action] = m;
      const p = panes.get(id);
      if (!p) return json(res, 404, { error: 'no such pane' });
      if (method === 'DELETE' && !action) { killPane(id, true); return json(res, 200, { ok: true }); }
      if (method === 'POST' && action === 'kill') { killPane(id, false); return json(res, 200, { ok: true }); }
      if (method === 'POST' && action === 'restart') {
        killPane(id, false);
        state.removePane(id); // detach the old session node from this pane
        p.scrollback = [];
        p.scrollbackBytes = 0;
        panes.delete(id);
        const np = spawnPane(p.spec, id);
        broadcast({ t: 'pty-replay', id, d: '\x1bc' });
        return json(res, 200, np.info);
      }
      if (method === 'POST' && action === 'autowake') {
        const b = await readBody(req);
        p.info.autoWake = Boolean(b.on);
        state.upsertPane(p.info);
        return json(res, 200, p.info);
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e: any) {
    json(res, e?.status ?? 400, { error: e?.message ?? String(e) });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const host = String(req.headers.host ?? '');
  const origin = req.headers.origin;
  // Browsers always send Origin on WebSocket handshakes; reject foreign pages (cross-site WS hijacking).
  if (url.pathname !== '/ws' || !allowedHosts.has(host) || (origin && !allowedOrigins.has(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  send(ws, { t: 'snapshot', s: state.snapshot() });
  for (const [id, p] of panes) if (p.scrollback.length) send(ws, { t: 'pty-replay', id, d: p.scrollback.join('') });
  for (const [id, m] of mirrors) if (m.scrollback.length) send(ws, { t: 'pty-replay', id, d: m.scrollback.join('') });
  const alive = { v: true };
  ws.on('pong', () => { alive.v = true; });
  const ping = setInterval(() => {
    if (!alive.v) { ws.terminate(); return; }
    alive.v = false;
    ws.ping();
  }, 20_000);
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const p = panes.get((msg as any).id);
    if (!p?.proc) return;
    if (msg.t === 'in' && typeof msg.d === 'string') p.proc.write(msg.d);
    else if (msg.t === 'resize') {
      const cols = Math.max(20, Math.min(500, Math.floor(msg.cols)));
      const rows = Math.max(5, Math.min(200, Math.floor(msg.rows)));
      if (cols !== p.proc.cols || rows !== p.proc.rows) p.proc.resize(cols, rows);
    } else if (msg.t === 'redraw') {
      // Nudge the TUI to repaint for a freshly attached viewer.
      const { cols, rows } = p.proc;
      p.proc.resize(cols, Math.max(5, rows - 1));
      setTimeout(() => p.proc?.resize(cols, rows), 60);
    }
  });
  ws.on('close', () => { clients.delete(ws); clearInterval(ping); });
});

server.listen(cfg.port, cfg.host, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  SwarmCorp mission control   http://localhost:${cfg.port}\n  Hook ingest                 POST ${HUB_URL}/api/events\n  Default project             ${cfg.project}\n${line}\n`);
  if (LAUNCH_FLEET) {
    try { console.log(`Fleet launched: ${launchFleet().length} terminals`); }
    catch (e) { console.error(`Fleet launch failed: ${(e as Error).message}`); }
  }
});

function shutdown() {
  // Pro: keep a receipt of the run that is ending, if anything ran.
  try { if (isPro()) { const r = state.receiptRecord(); if (r.runs > 0) saveReceipt(state.snapshot().defaultProject, r); } } catch { /* best-effort */ }
  for (const id of panes.keys()) killPane(id, false);
  state.dispose();
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
