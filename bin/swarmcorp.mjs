#!/usr/bin/env node
// SwarmCorp CLI: one entry point for people who install the package instead of cloning the repo.
//   swarmcorp start [--project <dir>] [--port <n>] [--fleet]   run the dashboard (default port 4317)
//   swarmcorp init [--port <n>]                                install hooks, agents and constitution into ~/.claude
//   swarmcorp uninstall                                        remove the hooks, env var and CLAUDE.md block
//   swarmcorp open                                             open the running dashboard in your browser
//   swarmcorp status                                           print where the dashboard is running
//   swarmcorp doctor                                           check Node, agents, hooks, port and build
//   swarmcorp receipt [--port <n>]                             print the current run's Markdown receipt
//   swarmcorp simulate                                         replay a scripted fleet into a running dashboard
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const [cmd = 'help', ...rest] = process.argv.slice(2);
const flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
/** The running hub's real address (its port may not be 4317), from the file it writes on start. */
function runningHub() {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'swarmcorp', 'hub.json'), 'utf8'));
    process.kill(h.pid, 0);
    return h;
  } catch { return null; }
}
const port = Number(flag('port') ?? process.env.SWARMCORP_PORT ?? runningHub()?.port ?? 4317);

function runTs(file, args, extraEnv = {}) {
  const tsx = pathToFileURL(require.resolve('tsx/esm')).href;
  const child = spawn(process.execPath, ['--import', tsx, path.join(ROOT, file), ...args], {
    stdio: 'inherit', env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

const portFree = (p) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
  s.listen(p, '127.0.0.1');
});

async function doctor() {
  const ok = (b, label, fix) => { console.log(`${b ? '  ✓' : '  ✗'} ${label}${b || !fix ? '' : `\n      → ${fix}`}`); return b; };
  const major = Number(process.versions.node.split('.')[0]);
  const claude = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' }).status === 0;
  let hooks = false;
  try { hooks = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8').includes('swarmcorp/swarm-hook.mjs'); } catch { /* none */ }
  const agents = fs.existsSync(path.join(os.homedir(), '.claude', 'agents', 'ceo-dispatcher.md'));
  const built = fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
  const free = await portFree(port);
  let ours = false;
  if (!free) { try { ours = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).ok === true; } catch { /* not ours */ } }
  console.log('SwarmCorp doctor\n');
  const all = [
    ok(major >= 20, `Node ${process.versions.node} (needs 20+)`, 'Install Node 20 or newer'),
    ok(claude, 'Claude Code on PATH', 'npm i -g @anthropic-ai/claude-code, then run claude once to log in'),
    ok(hooks, 'Hooks installed in ~/.claude/settings.json', 'swarmcorp init'),
    ok(agents, 'Agent profiles in ~/.claude/agents', 'swarmcorp init'),
    ok(built, 'Dashboard client built', 'npm run build (in the SwarmCorp folder)'),
    ok(free || ours, ours ? `SwarmCorp already running on ${port}` : `Port ${port} free`, `Port ${port} is taken by another program. Use --port`),
  ].every(Boolean);
  console.log(all ? '\nAll good. Run: swarmcorp start --project <your-project>' : '\nFix the ✗ items above, then run doctor again.');
  process.exitCode = all ? 0 : 1;
}

switch (cmd) {
  case 'start': {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
      console.error('The dashboard client is not built. Run `npm run build` in the SwarmCorp folder first.');
      process.exit(1);
    }
    runTs('server/server.ts', rest);
    break;
  }
  case 'init': runTs('scripts/install-claude.ts', rest); break;
  case 'uninstall': runTs('scripts/install-claude.ts', ['--uninstall', ...rest]); break;
  case 'simulate': runTs('scripts/simulate.ts', rest, { SWARMCORP_URL: `http://127.0.0.1:${port}` }); break;
  case 'doctor': await doctor(); break;
  case 'status': {
    const h = runningHub();
    if (!h) { console.log('SwarmCorp is not running. Start it with: swarmcorp start --project <dir>'); process.exitCode = 1; break; }
    console.log(`SwarmCorp is running at ${h.url}\n  project  ${h.project}\n  since    ${h.startedAt}\n  pid      ${h.pid}`);
    break;
  }
  case 'open': {
    const h = runningHub();
    if (!h) { console.log('SwarmCorp is not running. Start it with: swarmcorp start --project <dir>'); process.exitCode = 1; break; }
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', h.url] : [h.url];
    spawn(opener, args, { stdio: 'ignore', detached: true }).unref();
    console.log(`Opening ${h.url}`);
    break;
  }
  case 'receipt': {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/receipt`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      process.stdout.write(await res.text());
    } catch (e) {
      console.error(`No dashboard answering on port ${port} (${e.message}). Start it with: swarmcorp start`);
      process.exitCode = 1;
    }
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
