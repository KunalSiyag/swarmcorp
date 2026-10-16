import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  EdgeLabel, FeedItem, FeedLevel, Metrics, NodeStatus, PaneInfo, PlanSummary, PlanTask, Pulse,
  RunResult, Snapshot, SwarmEdge, SwarmNode, TokenTotals,
} from '../shared/types.ts';
import { RoleRegistry, modelTier } from './roles.ts';
import { TokenMeter, addTotals, emptyTotals } from './tokens.ts';
import { lastActivity } from './transcript.ts';
import { appendHistory, loadHistory, type StoredReceipt } from './archive.ts';
import { currentLicence, isPro } from './licence.ts';

export interface HookEnvelope {
  hook: string;
  at?: number;
  swarm?: { role?: string | null; agentId?: string | null; paneId?: string | null };
  payload: Record<string, any>;
}

interface SessionMeta {
  sid: string;
  nodeId: string;
  transcript: string | null;
  paneId: string | null;
  role: string;
  agentId: string | null;
  root: string | null;
  turns: { start: number; end: number | null; result: RunResult; title: string }[];
}

interface Run {
  id: string;
  nodeId: string;
  parentId: string;
  sessionId: string;
  type: string;
  agentId: string | null;
  toolUseId: string | null;
  title: string;
  startedAt: number;
  finished: boolean;
  tokens: number;
  /** The subagent's own transcript (<session>/subagents/agent-<id>.jsonl), once known. */
  file: string | null;
  endedAt: number | null;
  /** Moments the agent started a new tool call, read from its transcript. */
  ticks: number[];
}

interface RootWatch {
  root: string;
  primed: boolean;
  unread: Map<string, string[]>;      // box -> unread file names
  processing: Map<string, string[]>;  // box -> claimed file names
  retries: Map<string, number>;
  planMtime: number;
  plan: PlanSummary | null;
  lastSeen: number;
}

const MAIL_FILE_RE = /^[0-9TZ]+__[A-Za-z0-9._-]+__[a-z0-9]+\.json$/;
const BOX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FEED_MAX = 400;
const KIND_LABEL: Record<string, EdgeLabel> = {
  task: 'Task', spec: 'Spec', review: 'Code review', feedback: 'Feedback Loop', permission: 'Permission request',
  question: 'Message', answer: 'Message', status: 'Result',
};

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const firstLine = (s: unknown, n = 90) => {
  const line = String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

export function parseStatusLine(text: unknown): { result: RunResult; summary: string } | null {
  const re = /STATUS:\s*\**\s*(PASS|FAIL|BLOCKED)\b\**\s*[—–:-]*\s*(.*)/gi;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  const s = String(text ?? '');
  while ((m = re.exec(s))) last = m;
  if (!last) return null;
  return { result: last[1].toUpperCase() as RunResult, summary: firstLine(last[2], 120) };
}

/** Claude Code's "You've hit your session limit · resets 11:50am" ending: the agent stopped on quota, not success. */
export function usageLimit(text: unknown): string | null {
  const m = /hit your (?:\w+ )?limit[^\n]*/i.exec(String(text ?? ''));
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

export function resolveProjectRoot(cwd: string): string {
  if (process.env.SWARM_PROJECT_FORCE) return path.resolve(process.env.SWARM_PROJECT_FORCE);
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const c = path.join(dir, '.claude');
    if (fs.existsSync(path.join(c, 'swarm-plan.json')) || fs.existsSync(path.join(c, 'swarm-inbox'))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500,
    }).toString().trim();
    if (common) return path.dirname(common);
  } catch { /* not a repo */ }
  return path.resolve(cwd);
}

export class SwarmState extends EventEmitter {
  readonly startedAt = Date.now();
  private nodes = new Map<string, SwarmNode>();
  private edges = new Map<string, SwarmEdge>();
  private feed: FeedItem[] = [];
  private sessions = new Map<string, SessionMeta>();
  private runs = new Map<string, Run>();
  private runByAgent = new Map<string, string>();
  private runByToolUse = new Map<string, string>();
  private panes = new Map<string, PaneInfo>();
  private roots = new Map<string, RootWatch>();
  private rootCache = new Map<string, string>();
  private lastWake = new Map<string, number>();
  private meter = new TokenMeter();
  private tokens: TokenTotals = emptyTotals();
  private history: Metrics['history'] = [];
  private peak = 0;
  private tokenSince = Date.now();
  private events = 0;
  private timers: NodeJS.Timeout[] = [];
  private projectRoot: string;
  private retiredAgentFiles = new Set<string>();
  /** Subagents of project sessions that finished before the hub saw them (last 24 h): terminal-only, no map node. */
  private earlierAgents = new Map<string, { agentId: string; sid: string; type: string; title: string; mtime: number; file: string; limit: string | null }>();
  readonly roles: RoleRegistry;

  constructor(private opts: { capacity: number; defaultProject: string }) {
    super();
    this.roles = new RoleRegistry(() => [...this.roots.keys()]);
    this.ensureUser();
    this.projectRoot = resolveProjectRoot(opts.defaultProject);
    this.watchRoot(opts.defaultProject);
    this.timers.push(setInterval(() => this.scanMail(), 1000));
    this.timers.push(setInterval(() => this.scanPlans(), 2000));
    this.timers.push(setInterval(() => void this.sweepTokens(), 2500));
    this.timers.push(setInterval(() => this.sample(), 5000));
    this.timers.push(setInterval(() => this.gc(), 60_000));
    this.timers.push(setInterval(() => void this.scanSubagents(), 2000));
    this.timers.push(setInterval(() => void this.discoverSessions(), 5000));
    void this.discoverSessions();
  }

  dispose() { this.timers.forEach(clearInterval); }

  // ───────────────────────────── graph primitives ─────────────────────────────

  private changed() { this.emit('change'); }

  private ensureUser() {
    if (!this.nodes.has('user')) {
      const r = this.roles.get('user');
      this.nodes.set('user', this.blank('user', 'user', 'user', r.label, r.avatar, 'unknown', 'idle'));
      this.nodes.get('user')!.title = 'Mission owner';
    }
  }

  private blank(id: string, kind: SwarmNode['kind'], role: string, label: string, avatar: string,
    model: SwarmNode['model'], status: NodeStatus): SwarmNode {
    const now = Date.now();
    return {
      id, kind, role, label, avatar, model, title: '', status, result: null, parent: null, sessionId: null,
      paneId: null, cwd: null, tokens: 0, activeRuns: 0, runs: 0, passes: 0, fails: 0, unread: 0,
      context: 0, contextMax: 200_000, inProject: true, createdAt: now, updatedAt: now,
    };
  }

  private touch(n: SwarmNode, patch: Partial<SwarmNode>) {
    Object.assign(n, patch, { updatedAt: Date.now() });
  }

  private link(source: string, target: string, label: EdgeLabel) {
    if (!this.nodes.has(source) || !this.nodes.has(target) || source === target) return;
    const id = `${source}→${target}`;
    const now = Date.now();
    const e = this.edges.get(id);
    if (e) Object.assign(e, { label, count: e.count + 1, lastAt: now });
    else this.edges.set(id, { id, source, target, label, count: 1, lastAt: now });
    const p: Pulse = { id: uid('p'), edgeId: id, source, target, label, at: now };
    this.emit('pulse', p);
  }

  private log(icon: string, text: string, level: FeedLevel = 'info', nodeId: string | null = null) {
    this.feed.push({ id: uid('f'), at: Date.now(), icon, text, level, nodeId });
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);
  }

  private dropNode(id: string) {
    this.nodes.delete(id);
    for (const [k, e] of this.edges) if (e.source === id || e.target === id) this.edges.delete(k);
  }

  // ───────────────────────────── panes (owned by the PTY hub) ─────────────────

  upsertPane(p: PaneInfo) {
    this.panes.set(p.id, p);
    this.watchRoot(resolveProjectRoot(p.cwd));
    this.changed();
  }

  removePane(id: string) {
    const p = this.panes.get(id);
    this.panes.delete(id);
    if (p?.sessionId) {
      const meta = this.sessions.get(p.sessionId);
      if (meta) {
        meta.paneId = null;
        const n = this.nodes.get(meta.nodeId);
        if (n) this.touch(n, { paneId: null, status: 'offline' });
      }
    }
    this.changed();
  }

  paneExited(id: string, code: number) {
    const p = this.panes.get(id);
    if (!p) return;
    p.exitCode = code;
    p.status = 'exited';
    if (p.nodeId) {
      const n = this.nodes.get(p.nodeId);
      if (n) this.touch(n, { status: 'offline', title: `Exited (${code})` });
    }
    this.log('EXIT', `${p.label} terminal exited (code ${code})`, code === 0 ? 'info' : 'warn', p.nodeId);
    this.changed();
  }

  // ───────────────────────────── hook ingestion ───────────────────────────────

  async ingest(env: HookEnvelope) {
    const p = env.payload ?? {};
    const sid: string | undefined = p.session_id;
    this.events++;
    if (!sid || typeof sid !== 'string') return;
    const meta = this.ensureSession(sid, env);
    const sNode = this.nodes.get(meta.nodeId)!;
    if (p.transcript_path && typeof p.transcript_path === 'string') meta.transcript = p.transcript_path;
    const inSub = typeof p.agent_id === 'string' && p.agent_id.length > 0;
    const actorId = inSub ? (this.runs.get(this.runByAgent.get(p.agent_id) ?? '')?.nodeId ?? meta.nodeId) : meta.nodeId;

    switch (env.hook) {
      case 'SessionStart': {
        const m = typeof p.model === 'string' ? p.model : p.model?.id ?? p.model?.display_name;
        const tier = modelTier(m);
        this.touch(sNode, {
          status: 'idle', title: `Session ${p.source ?? 'started'}`,
          model: tier !== 'unknown' ? tier : sNode.model,
        });
        this.log('ONLINE', `${sNode.label} online (${p.source ?? 'startup'})`, 'info', sNode.id);
        break;
      }
      case 'UserPromptSubmit': {
        const prompt = String(p.prompt ?? '');
        this.touch(sNode, { status: 'running', title: firstLine(prompt) || 'Working…', result: null });
        this.link('user', sNode.id, 'Task');
        this.openTurn(meta, firstLine(prompt, 80));
        this.log('PROMPT', `${sNode.label} ← "${firstLine(prompt, 120)}"`, 'info', sNode.id);
        break;
      }
      case 'PreToolUse': {
        if (!this.isAgentTool(p.tool_name)) { this.touch(sNode, { status: 'running' }); break; }
        const ti = p.tool_input ?? {};
        const type = String(ti.subagent_type || 'general-purpose');
        const title = firstLine(ti.description || ti.prompt || 'Delegated task');
        const toolUseId = typeof p.tool_use_id === 'string' ? p.tool_use_id : null;
        // Tolerate out-of-order delivery: SubagentStart may already have created the run.
        const orphan = [...this.runs.values()].find((r) => r.sessionId === sid && r.type === type && !r.toolUseId
          && !r.finished && Date.now() - r.startedAt < 15_000);
        const run = orphan ?? this.startRun(sid, type, actorId, title);
        run.toolUseId = toolUseId;
        run.title = title;
        if (toolUseId) this.runByToolUse.set(toolUseId, run.id);
        const n = this.nodes.get(run.nodeId);
        if (n) {
          this.touch(n, { title });
          const tier = modelTier(ti.model);
          if (tier !== 'unknown') n.model = tier;
        }
        this.touch(sNode, { status: 'running' });
        break;
      }
      case 'SubagentStart': {
        const agentId = String(p.agent_id ?? '');
        const type = String(p.agent_type || 'general-purpose');
        if (!agentId || this.runByAgent.has(agentId)) break;
        const pending = [...this.runs.values()]
          .filter((r) => r.sessionId === sid && r.type === type && !r.agentId && !r.finished)
          .sort((a, b) => a.startedAt - b.startedAt)[0];
        const run = pending ?? this.startRun(sid, type, meta.nodeId, 'Starting…');
        run.agentId = agentId;
        this.runByAgent.set(agentId, run.id);
        break;
      }
      case 'SubagentStop': {
        const run = this.runs.get(this.runByAgent.get(String(p.agent_id ?? '')) ?? '');
        if (!run || run.finished) break;
        const delta = await this.meter.update(p.agent_transcript_path, this.tokenSince);
        this.addTokens(delta, this.nodes.get(run.nodeId));
        run.tokens += delta.total;
        const an = this.nodes.get(run.nodeId);
        const at = modelTier(this.meter.model(p.agent_transcript_path));
        if (an && an.model === 'unknown' && at !== 'unknown') an.model = at;
        this.finishRun(run, p.last_assistant_message);
        break;
      }
      case 'PostToolUse': {
        if (!this.isAgentTool(p.tool_name)) break;
        const run = this.runs.get(this.runByToolUse.get(String(p.tool_use_id ?? '')) ?? '');
        const r = p.tool_response ?? {};
        if (!run) break;
        const n = this.nodes.get(run.nodeId);
        const tier = modelTier(r.resolvedModel);
        if (n && tier !== 'unknown') n.model = tier;
        if (typeof r.agentId === 'string' && !run.agentId) { run.agentId = r.agentId; this.runByAgent.set(r.agentId, run.id); }
        const status = String(r.status ?? '').toLowerCase();
        if (!run.finished && (status === 'completed' || status === 'failed' || status === 'error')) {
          // SubagentStop normally finishes the run first; this covers builds without it.
          if (!run.tokens && typeof r.totalTokens === 'number') { run.tokens = r.totalTokens; this.addTokens({ ...emptyTotals(), total: r.totalTokens }, n); }
          this.finishRun(run, r.content, status !== 'completed');
        }
        break;
      }
      case 'Notification': {
        const type = String(p.notification_type ?? '');
        const msg = firstLine(p.message ?? p.title ?? type, 110);
        if (['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(type)
          || /permission|approve|needs your/i.test(msg)) {
          this.touch(sNode, { status: 'waiting', title: `⏸ ${msg}` });
          this.link(sNode.id, 'user', 'Permission request');
          this.log('INPUT', `${sNode.label}: ${msg}`, 'warn', sNode.id);
        } else if (type === 'idle_prompt') {
          if (sNode.status !== 'running') this.touch(sNode, { status: 'idle' });
        } else if (msg) {
          this.log('NOTE', `${sNode.label}: ${msg}`, 'info', sNode.id);
        }
        break;
      }
      case 'Stop': {
        const parsed = parseStatusLine(p.last_assistant_message);
        const limit = usageLimit(p.last_assistant_message);
        const title = limit ? `Usage limit: ${limit.replace(/^hit your /i, '')}` : parsed ? `${parsed.result} — ${parsed.summary}` : firstLine(p.last_assistant_message) || 'Turn complete';
        this.touch(sNode, {
          status: limit ? 'waiting' : parsed?.result === 'FAIL' ? 'failed' : 'idle',
          title, result: parsed?.result ?? sNode.result,
        });
        if (parsed) this.link(sNode.id, 'user', parsed.result === 'FAIL' ? 'Feedback Loop' : 'Result');
        this.closeTurn(meta, parsed?.result ?? null);
        this.log(parsed?.result === 'FAIL' ? 'FAIL' : 'DONE', `${sNode.label} turn done${parsed ? ` · STATUS ${parsed.result}` : ''}: ${firstLine(title, 110)}`,
          parsed?.result === 'FAIL' ? 'err' : 'ok', sNode.id);
        break;
      }
      case 'SessionEnd': {
        this.touch(sNode, { status: 'offline', title: `Session ended (${p.reason ?? 'exit'})` });
        for (const r of this.runs.values()) if (r.sessionId === sid && !r.finished) this.finishRun(r, null, false, true);
        this.closeTurn(meta, null);
        this.log('OFFLINE', `${sNode.label} offline`, 'info', sNode.id);
        break;
      }
      default:
        break;
    }
    if (meta.transcript) {
      this.addTokens(await this.meter.update(meta.transcript, this.tokenSince), sNode);
      const t = modelTier(this.meter.model(meta.transcript));
      if (t !== 'unknown' && sNode.model === 'unknown') sNode.model = t;
    }
    this.recount();
    this.changed();
  }

  private openTurn(meta: SessionMeta, title: string, start = Date.now()) {
    this.closeTurn(meta, null);
    meta.turns.push({ start, end: null, result: null, title });
    if (meta.turns.length > 80) meta.turns.splice(0, meta.turns.length - 80);
  }

  private closeTurn(meta: SessionMeta, result: RunResult) {
    const t = meta.turns[meta.turns.length - 1];
    if (t && t.end === null) {
      t.end = Date.now();
      t.result = result;
      const n = this.nodes.get(meta.nodeId);
      if (n) appendHistory(meta.root ?? this.projectRoot, { laneId: meta.sid, kind: 'session', label: n.label, model: n.model, parentLabel: null, start: t.start, end: t.end, result, title: t.title, ticks: [], tokens: 0 });
    }
  }

  private isAgentTool(name: unknown) { return name === 'Agent' || name === 'Task'; }

  private ensureSession(sid: string, env: HookEnvelope): SessionMeta {
    const p = env.payload;
    const sw = env.swarm ?? {};
    let meta = this.sessions.get(sid);
    const topLevelRole = !p.agent_id && env.hook === 'SessionStart' && typeof p.agent_type === 'string' ? p.agent_type : null;
    if (!meta) {
      const role = sw.role || topLevelRole || 'claude';
      const agentId = sw.agentId || (sw.role ? sw.role : null);
      meta = { sid, nodeId: `s:${sid}`, transcript: null, paneId: null, role, agentId, root: null, turns: [] };
      this.sessions.set(sid, meta);
      const info = this.roles.get(role);
      const inst = agentId && agentId !== role ? /-(\d+)$/.exec(agentId)?.[1] : null;
      const label = role === 'claude'
        ? `Claude · ${path.basename(String(p.cwd ?? '')) || 'session'}`
        : inst ? `${info.label} #${inst}` : info.label;
      const n = this.blank(meta.nodeId, 'session', this.roles.baseRole(role), label, info.avatar, info.model, 'idle');
      n.sessionId = sid;
      n.cwd = typeof p.cwd === 'string' ? p.cwd : null;
      this.nodes.set(n.id, n);
      for (const alias of new Set([agentId, role])) if (alias) this.absorbVirtual(alias, n.id);
      this.log('JOIN', `${label} joined the swarm`, 'info', n.id);
    }
    if (typeof p.cwd === 'string' && !meta.root) {
      meta.root = this.rootFor(p.cwd);
      this.watchRoot(meta.root);
    }
    // Link the session to the dashboard terminal it is running in.
    const paneId = sw.paneId ?? null;
    if (paneId && meta.paneId !== paneId) {
      const pane = this.panes.get(paneId);
      if (pane) {
        if (pane.sessionId && pane.sessionId !== sid) this.retireSession(pane.sessionId);
        pane.sessionId = sid;
        pane.nodeId = meta.nodeId;
        meta.paneId = paneId;
        const n = this.nodes.get(meta.nodeId);
        if (n) n.paneId = paneId;
      }
    }
    return meta;
  }

  /** Mail addressed to an employee before its session registered created a placeholder; fold it in. */
  private absorbVirtual(name: string, intoId: string) {
    const vid = `v:${name}`;
    if (!this.nodes.has(vid)) return;
    for (const e of [...this.edges.values()]) {
      if (e.source !== vid && e.target !== vid) continue;
      this.edges.delete(e.id);
      const source = e.source === vid ? intoId : e.source;
      const target = e.target === vid ? intoId : e.target;
      if (source === target) continue;
      const id = `${source}→${target}`;
      const prev = this.edges.get(id);
      this.edges.set(id, prev ? { ...prev, count: prev.count + e.count, lastAt: Math.max(prev.lastAt, e.lastAt) } : { ...e, id, source, target });
    }
    this.nodes.delete(vid);
  }

  /** A pane started a new session (/clear, /resume): drop the old session's subtree. */
  private retireSession(sid: string) {
    const meta = this.sessions.get(sid);
    if (!meta) return;
    this.sessions.delete(sid);
    for (const [k, r] of this.runs) if (r.sessionId === sid) this.runs.delete(k);
    for (const n of [...this.nodes.values()]) if (n.sessionId === sid) this.dropNode(n.id);
    if (meta.transcript) this.meter.forget(meta.transcript);
  }

  /** One node per subagent run, so parallel/background agents are visible individually. */
  private agentNode(sid: string, type: string, parentId: string, runId: string, title: string): SwarmNode {
    const id = `a:${sid}:${runId}`;
    let n = this.nodes.get(id);
    if (!n) {
      const info = this.roles.get(type);
      const tag = /^\s*([A-Z][A-Z0-9]*-[A-Z0-9]+)\b/.exec(title)?.[1];
      n = this.blank(id, 'agent', this.roles.baseRole(type), tag ? `${info.label} · ${tag}` : info.label, info.avatar, info.model, 'idle');
      n.sessionId = sid;
      n.parent = parentId;
      this.nodes.set(id, n);
    }
    return n;
  }

  private startRun(sid: string, type: string, parentId: string, title: string): Run {
    const runId = uid('r');
    const n = this.agentNode(sid, type, parentId, runId, title);
    const run: Run = {
      id: runId, nodeId: n.id, parentId, sessionId: sid, type, agentId: null, toolUseId: null,
      title, startedAt: Date.now(), finished: false, tokens: 0, file: null, endedAt: null, ticks: [],
    };
    this.runs.set(run.id, run);
    this.touch(n, { status: 'running', title, activeRuns: n.activeRuns + 1, result: null });
    const label: EdgeLabel = n.role === 'opus-auditor' ? 'Code review' : n.role === 'haiku-tester' ? 'Code review' : 'Task';
    this.link(parentId, n.id, label);
    const parent = this.nodes.get(parentId);
    this.log('SPAWN', `${parent?.label ?? 'Session'} → ${n.label}: ${title}`, 'info', n.id);
    return run;
  }

  /** Pro: switch the project the dashboard is focused on, without restarting the hub. */
  setProject(dir: string) {
    const root = resolveProjectRoot(dir);
    this.projectRoot = root;
    this.opts.defaultProject = root;
    this.archive = { root: '', at: 0, lanes: [] };
    this.watchRoot(root);
    void this.discoverSessions();
    this.log('PLAN', `Dashboard project switched to ${root}`, 'info');
    this.changed();
  }

  private archive: { root: string; at: number; lanes: Snapshot['timeline'] } = { root: '', at: 0, lanes: [] };
  private archivedLanes(): Snapshot['timeline'] {
    if (!isPro()) return [];
    if (this.archive.root !== this.projectRoot || Date.now() - this.archive.at > 60_000) {
      this.archive = { root: this.projectRoot, at: Date.now(), lanes: loadHistory(this.projectRoot, this.startedAt) };
    }
    return this.archive.lanes;
  }

  private finishRun(run: Run, text: unknown, failed = false, aborted = false) {
    run.finished = true;
    run.endedAt = Date.now();
    const n = this.nodes.get(run.nodeId);
    if (!n) return;
    const parsed = parseStatusLine(text);
    const limit = usageLimit(text);
    const result: RunResult = aborted ? null : limit ? 'BLOCKED' : parsed?.result ?? (failed ? 'FAIL' : 'PASS');
    const active = Math.max(0, n.activeRuns - 1);
    this.touch(n, {
      activeRuns: active,
      runs: n.runs + 1,
      passes: n.passes + (result === 'PASS' ? 1 : 0),
      fails: n.fails + (result === 'FAIL' ? 1 : 0),
      result,
      status: active > 0 ? 'running' : aborted ? 'offline' : result === 'FAIL' ? 'failed' : 'done',
      title: aborted ? 'Aborted' : limit ? `Usage limit: ${limit.replace(/^hit your /i, '')}` : `TASK COMPLETE (${result}) — ${parsed?.summary || run.title}`,
    });
    if (aborted) return;
    const parent = this.nodes.get(run.parentId);
    appendHistory(this.sessions.get(run.sessionId)?.root ?? this.projectRoot, {
      laneId: run.agentId ?? run.id, kind: 'agent', label: n.label, model: n.model, parentLabel: parent?.label ?? null,
      start: run.startedAt, end: run.endedAt ?? Date.now(), result, title: run.title, ticks: run.ticks.slice(-200), tokens: run.tokens,
    });
    this.link(n.id, run.parentId, result === 'PASS' ? 'Result' : 'Feedback Loop');
    this.log(result === 'PASS' ? 'DONE' : result === 'BLOCKED' ? 'BLOCK' : 'FAIL',
      `${n.label} TASK COMPLETE (${result}): ${parsed?.summary || run.title}`,
      result === 'PASS' ? 'ok' : result === 'BLOCKED' ? 'warn' : 'err', n.id);
  }

  /**
   * Discovers subagents from disk (<session>/subagents/agent-<id>.meta.json + .jsonl). This catches
   * background agents started before the hub (re)started, and feeds live activity + tokens per agent.
   */
  /**
   * Finds sessions of the dashboard's project from Claude Code's own transcript folder, so a session
   * that started before the hub (or is quietly waiting on background agents) shows up without a hook.
   */
  private async discoverSessions() {
    const dir = path.join(os.homedir(), '.claude', 'projects', this.projectRoot.replace(/[^A-Za-z0-9]/g, '-'));
    let files: string[];
    try { files = await fs.promises.readdir(dir); } catch { return; }
    let dirty = false;
    for (const f of files) {
      const m = /^([0-9a-f-]{36})\.jsonl$/.exec(f);
      if (!m || this.sessions.has(m[1])) continue;
      const file = path.join(dir, f);
      let mtime = 0;
      try { mtime = (await fs.promises.stat(file)).mtimeMs; } catch { continue; }
      let sub = 0; // a session waiting on background agents is quiet; its subagents aren't
      try {
        const sdir = path.join(dir, m[1], 'subagents');
        for (const sf of await fs.promises.readdir(sdir)) {
          if (sf.endsWith('.jsonl')) sub = Math.max(sub, (await fs.promises.stat(path.join(sdir, sf))).mtimeMs);
        }
      } catch { /* no subagents */ }
      const last = Math.max(mtime, sub);
      if (Date.now() - last > 5 * 60_000) continue;
      // `claude --agent X` records "agentSetting":"X" on transcript rows; use it as the session's role.
      let role: string | null = null;
      try {
        const fh = await fs.promises.open(file, 'r');
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        role = /"agentSetting":"([A-Za-z0-9._-]{1,64})"/.exec(buf.subarray(0, bytesRead).toString('utf8'))?.[1] ?? null;
      } catch { /* unreadable */ }
      const meta = this.ensureSession(m[1], { hook: 'Discovered', swarm: { role }, payload: { session_id: m[1], cwd: this.projectRoot } });
      meta.transcript = file;
      const n = this.nodes.get(meta.nodeId);
      if (n) this.touch(n, { status: Date.now() - last < 60_000 ? 'running' : 'idle', title: n.title || 'Discovered from transcript' });
      if (Date.now() - last < 60_000) this.openTurn(meta, 'In progress when the hub started', last);
      this.addTokens(await this.meter.update(file, this.tokenSince), n);
      const t = modelTier(this.meter.model(file));
      if (n && t !== 'unknown') n.model = t;
      dirty = true;
    }
    if (dirty) this.changed();
  }

  private async scanSubagents() {
    let dirty = false;
    const now = Date.now();
    for (const meta of [...this.sessions.values()]) {
      if (!meta.transcript) continue;
      const sNode = this.nodes.get(meta.nodeId);
      if (!sNode || sNode.status === 'offline') continue;
      const dir = path.join(path.dirname(meta.transcript), path.basename(meta.transcript, '.jsonl'), 'subagents');
      let files: string[];
      try { files = await fs.promises.readdir(dir); } catch { continue; }
      for (const f of files) {
        const m = /^agent-([A-Za-z0-9_-]+)\.meta\.json$/.exec(f);
        if (!m) continue;
        const agentId = m[1];
        const file = path.join(dir, `agent-${agentId}.jsonl`);
        if (this.retiredAgentFiles.has(file)) continue;
        let run = this.runs.get(this.runByAgent.get(agentId) ?? '');
        if (!run) {
          let st: fs.Stats;
          try { st = await fs.promises.stat(file); } catch { continue; }
          // Older agents don't go on the map, but recent ones still get a read-only terminal.
          if (st.mtimeMs < this.startedAt - 10 * 60_000) {
            this.retiredAgentFiles.add(file);
            if (Date.now() - st.mtimeMs < 24 * 3600_000 && meta.root === this.projectRoot) {
              try {
                const info = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'));
                const act = await lastActivity(file, this.projectRoot);
                this.earlierAgents.set(file, { agentId, sid: meta.sid, type: String(info.agentType || 'general-purpose'), title: firstLine(info.description || 'Subagent'), mtime: st.mtimeMs, file, limit: usageLimit(act?.text) });
                if (this.earlierAgents.size > 16) {
                  const oldest = [...this.earlierAgents.values()].sort((a, b) => a.mtime - b.mtime)[0];
                  this.earlierAgents.delete(oldest.file);
                }
                dirty = true;
              } catch { /* unreadable meta */ }
            }
            continue;
          }
          let info: any;
          try { info = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8')); } catch { continue; }
          const toolUseId = typeof info.toolUseId === 'string' ? info.toolUseId : null;
          const known = (toolUseId ? this.runs.get(this.runByToolUse.get(toolUseId) ?? '') : undefined)
            ?? [...this.runs.values()].find((r) => r.sessionId === meta.sid && !r.agentId && !r.finished && r.type === info.agentType);
          run = known ?? this.startRun(meta.sid, String(info.agentType || 'general-purpose'), meta.nodeId, firstLine(info.description || 'Subagent'));
          if (!known) {
            try {
              const fh = await fs.promises.open(file, 'r');
              const buf = Buffer.alloc(8192);
              const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
              await fh.close();
              const ts = Date.parse(JSON.parse(buf.subarray(0, bytesRead).toString('utf8').split('\n')[0])?.timestamp ?? '');
              if (Number.isFinite(ts)) run.startedAt = ts;
            } catch { /* keep discovery time */ }
          }
          run.agentId = agentId;
          this.runByAgent.set(agentId, run.id);
          if (toolUseId && !run.toolUseId) { run.toolUseId = toolUseId; this.runByToolUse.set(toolUseId, run.id); }
          dirty = true;
        }
        run.file = file;
        if (run.finished) continue;
        const n = this.nodes.get(run.nodeId);
        const d = await this.meter.update(file, this.tokenSince);
        if (d.total && n) { this.addTokens(d, n); run.tokens += d.total; dirty = true; }
        const t = modelTier(this.meter.model(file));
        if (n && t !== 'unknown' && n.model !== t) { n.model = t; dirty = true; }
        const act = await lastActivity(file, sNode.cwd ?? this.projectRoot);
        if (!act || !n) continue;
        if (act.done && now - act.mtime > 20_000) {
          this.finishRun(run, act.text); // SubagentStop missed (e.g. hub restarted): infer from the transcript
          dirty = true;
        } else if (act.title && n.title !== act.title && !act.done) {
          n.title = act.title;
          n.updatedAt = now;
          if (act.title.startsWith('⏺')) { run.ticks.push(act.mtime); if (run.ticks.length > 300) run.ticks.shift(); }
          dirty = true;
        }
      }
    }
    if (dirty) { this.recount(); this.changed(); }
  }

  private addTokens(d: TokenTotals, node?: SwarmNode) {
    if (!d.total) return;
    this.tokens = addTotals(this.tokens, d);
    if (node) node.tokens += d.total;
  }

  private async sweepTokens() {
    let any = false;
    for (const meta of this.sessions.values()) {
      const n = this.nodes.get(meta.nodeId);
      if (!meta.transcript || !n || n.status === 'offline') continue;
      const d = await this.meter.update(meta.transcript, this.tokenSince);
      if (d.total) { this.addTokens(d, n); any = true; }
    }
    if (any) this.changed();
  }

  private recount() {
    let active = 0;
    for (const n of this.nodes.values()) {
      if (n.kind === 'agent') active += n.activeRuns;
      else if (n.kind === 'session' && n.status === 'running') active++;
    }
    this.peak = Math.max(this.peak, active);
    return active;
  }

  private sample() {
    this.history.push({ t: Date.now(), tokens: this.tokens.total, active: this.recount() });
    if (this.history.length > 120) this.history.shift();
    this.changed();
  }

  private gc() {
    const now = Date.now();
    let dirty = false;
    for (const n of [...this.nodes.values()]) {
      const stale = (n.kind === 'virtual' && now - n.updatedAt > 15 * 60_000)
        || (n.kind === 'agent' && n.activeRuns === 0 && (n.status === 'done' || n.status === 'failed' || n.status === 'offline') && now - n.updatedAt > 20 * 60_000)
        || (n.kind === 'session' && n.status === 'offline' && !n.paneId && now - n.updatedAt > 30 * 60_000);
      if (!stale) continue;
      if (n.kind === 'session' && n.sessionId) this.retireSession(n.sessionId);
      else this.dropNode(n.id);
      dirty = true;
    }
    for (const [k, r] of this.runs) {
      if (r.finished && (now - r.startedAt > 60 * 60_000 || !this.nodes.has(r.nodeId))) {
        if (r.file) this.retiredAgentFiles.add(r.file);
        this.runs.delete(k);
        if (r.agentId) this.runByAgent.delete(r.agentId);
        if (r.toolUseId) this.runByToolUse.delete(r.toolUseId);
      }
    }
    if (dirty) this.changed();
  }

  // ───────────────────────────── mailbox + plan watchers ──────────────────────

  private rootFor(cwd: string) {
    let r = this.rootCache.get(cwd);
    if (!r) { r = resolveProjectRoot(cwd); this.rootCache.set(cwd, r); }
    return r;
  }

  watchRoot(root: string) {
    if (!root || this.roots.has(root)) return;
    this.roots.set(root, {
      root, primed: false, unread: new Map(), processing: new Map(), retries: new Map(),
      planMtime: 0, plan: null, lastSeen: Date.now(),
    });
  }

  private listJson(dir: string): string[] {
    try { return fs.readdirSync(dir).filter((f) => MAIL_FILE_RE.test(f)).sort(); } catch { return []; }
  }

  private scanMail() {
    let dirty = false;
    for (const w of this.roots.values()) {
      const inboxRoot = path.join(w.root, '.claude', 'swarm-inbox');
      let boxes: string[] = [];
      try {
        boxes = fs.readdirSync(inboxRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && BOX_RE.test(d.name)).map((d) => d.name);
      } catch { /* no queue in this project yet */ }
      for (const box of boxes) {
        const prev = new Set(w.unread.get(box) ?? []);
        const cur = this.listJson(path.join(inboxRoot, box));
        const prevProc = new Set(w.processing.get(box) ?? []);
        let proc: string[] = [];
        try { proc = fs.readdirSync(path.join(inboxRoot, box, '.processing')).filter((f) => /__[0-9TZ]+__[A-Za-z0-9._-]+__[a-z0-9]+\.json$/.test(f)); } catch { /* none claimed */ }
        const fresh = w.primed ? cur.filter((f) => !prev.has(f)) : [];
        const accepted: string[] = [];
        for (const f of fresh) {
          let msg: any;
          try {
            msg = JSON.parse(fs.readFileSync(path.join(inboxRoot, box, f), 'utf8'));
          } catch {
            const tries = (w.retries.get(f) ?? 0) + 1;
            w.retries.set(f, tries);
            if (tries < 5) continue; // likely mid-write; retry next tick
            msg = { from: f.split('__')[1], kind: 'status', subject: '(unreadable message)' };
          }
          w.retries.delete(f);
          accepted.push(f);
          this.onMail(w.root, box, msg);
          dirty = true;
        }
        // Keep not-yet-parsable files out of "prev" so they are retried.
        w.unread.set(box, cur.filter((f) => !fresh.includes(f) || accepted.includes(f)));
        if (w.primed) {
          for (const f of proc) {
            if (prevProc.has(f)) continue;
            const base = f.replace(/^.+?__(?=[0-9TZ]+__)/, '');
            if (!prev.has(base)) {
              // Claimed before we ever saw it in the inbox (fast agent): still draw the message.
              try { this.onMail(w.root, box, JSON.parse(fs.readFileSync(path.join(inboxRoot, box, '.processing', f), 'utf8')), false); }
              catch { /* moved again already */ }
            }
            const [who, , from] = f.split('__');
            const n = this.resolveActor(who, w.root);
            this.log('CLAIM', `${n.label} claimed mail from ${from} (${box})`, 'info', n.id);
            dirty = true;
          }
        }
        w.processing.set(box, proc);
      }
      w.primed = true;
    }
    if (dirty) this.changed();
  }

  private onMail(root: string, box: string, msg: any, wake = true) {
    const from = BOX_RE.test(String(msg.from ?? '')) ? String(msg.from) : 'unknown';
    const kind = String(msg.kind ?? 'status');
    const label = KIND_LABEL[kind] ?? 'Message';
    const src = this.resolveActor(from, root);
    const dst = this.resolveActor(box, root);
    this.link(src.id, dst.id, label);
    // Subjects are typed into other agents' TTYs on auto-wake: strip control/escape characters.
    const subject = firstLine(String(msg.subject || msg.body || kind).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '), 100);
    const task = msg.refs?.task_id ? ` [${msg.refs.task_id}]` : '';
    this.log(kind === 'feedback' ? 'LOOP' : kind === 'permission' ? 'INPUT' : kind === 'review' ? 'REVIEW' : 'MAIL',
      `${src.label} → ${dst.label} · ${kind}${task}: ${subject}`,
      kind === 'feedback' ? 'warn' : kind === 'permission' ? 'warn' : 'info', dst.id);
    if (wake) this.wake(box, `${kind} from ${from}: "${subject}"`);
  }

  /** Map a queue address (instance id or role) to a graph node. */
  private resolveActor(name: string, root: string): SwarmNode {
    for (const pane of this.panes.values()) {
      if (pane.agentId === name && pane.nodeId && this.nodes.has(pane.nodeId)) return this.nodes.get(pane.nodeId)!;
    }
    for (const meta of this.sessions.values()) {
      if (meta.agentId === name && this.nodes.has(meta.nodeId)) return this.nodes.get(meta.nodeId)!;
    }
    const byRole = [...this.nodes.values()]
      .filter((n) => (n.kind === 'session' || n.kind === 'agent') && n.role === name && n.status !== 'offline')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (byRole) return byRole;
    const id = `v:${name}`;
    let v = this.nodes.get(id);
    if (!v) {
      const info = this.roles.get(name);
      const inst = /-(\d+)$/.exec(name)?.[1];
      const label = inst && this.roles.baseRole(name) !== name ? `${info.label} #${inst}` : info.label;
      v = this.blank(id, 'virtual', this.roles.baseRole(name), label, info.avatar, info.model, 'idle');
      v.title = 'Queued employee (no live session)';
      v.cwd = root;
      this.nodes.set(id, v);
    }
    v.updatedAt = Date.now();
    return v;
  }

  private wake(box: string, what: string) {
    const now = Date.now();
    const candidates = [...this.panes.values()]
      .filter((p) => p.autoWake && p.status === 'idle' && p.sessionId
        && (p.agentId === box || p.role === box))
      .sort((a, b) => Number(b.agentId === box) - Number(a.agentId === box));
    const pane = candidates.find((p) => now - (this.lastWake.get(p.id) ?? 0) > 8000);
    if (!pane) return;
    this.lastWake.set(pane.id, now);
    pane.status = 'running';
    this.emit('wake', pane.id, `You have new SwarmCorp mail (${what}). Check your inbox, claim it, and process it per the constitution.`);
    this.log('WAKE', `Auto-woke ${pane.label} for new mail`, 'info', pane.nodeId);
  }

  private scanPlans() {
    let dirty = false;
    for (const w of this.roots.values()) {
      const file = path.join(w.root, '.claude', 'swarm-plan.json');
      let st: fs.Stats;
      try { st = fs.statSync(file); } catch { if (w.plan) { w.plan = null; dirty = true; } continue; }
      if (st.mtimeMs === w.planMtime) continue;
      w.planMtime = st.mtimeMs;
      const prev = new Map((w.plan?.tasks ?? []).map((t) => [t.id, t.status]));
      w.plan = this.readPlan(w.root, file);
      for (const t of w.plan.tasks) {
        const before = prev.get(t.id);
        if (before && before !== t.status) {
          this.log(t.status === 'done' ? 'SHIP' : t.status === 'blocked' ? 'BLOCK' : 'PLAN',
            `Plan ${t.id} ${before} → ${t.status}: ${t.title}`, t.status === 'blocked' ? 'warn' : t.status === 'done' ? 'ok' : 'info');
        }
      }
      if (!prev.size && w.plan.tasks.length) this.log('PLAN', `Plan loaded: ${w.plan.epic} (${w.plan.tasks.length} tasks)`, 'info');
      dirty = true;
    }
    if (dirty) this.changed();
  }

  private readPlan(root: string, file: string): PlanSummary {
    const empty: PlanSummary = { root, epic: path.basename(root), goal: '', sprints: [], tasks: [], error: null };
    let raw: any;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ...empty, error: `swarm-plan.json: ${(e as Error).message}` }; }
    const statuses = new Set(['pending', 'in_progress', 'review', 'done', 'blocked']);
    const tasks: PlanTask[] = [];
    const sprints = (Array.isArray(raw?.sprints) ? raw.sprints : []).map((s: any, i: number) => {
      const sid = String(s?.id ?? `S${i + 1}`);
      const ts: PlanTask[] = (Array.isArray(s?.tasks) ? s.tasks : []).map((t: any, j: number) => ({
        id: String(t?.id ?? `${sid}-T${j + 1}`),
        title: String(t?.title ?? ''),
        role: String(t?.role ?? ''),
        status: statuses.has(t?.status) ? t.status : 'pending',
        assignee: t?.assignee ? String(t.assignee) : null,
        sprint: sid,
      }));
      tasks.push(...ts);
      return {
        id: sid,
        name: String(s?.name ?? sid),
        total: ts.length,
        done: ts.filter((t) => t.status === 'done').length,
        active: ts.filter((t) => t.status === 'in_progress' || t.status === 'review').length,
        blocked: ts.filter((t) => t.status === 'blocked').length,
      };
    });
    return { root, epic: String(raw?.epic ?? empty.epic), goal: String(raw?.goal ?? ''), sprints, tasks, error: null };
  }

  // ───────────────────────────── snapshot ─────────────────────────────────────

  private paneStatus(p: PaneInfo): PaneInfo['status'] {
    if (p.status === 'exited') return 'exited';
    if (p.role === 'shell') return 'idle';
    const n = p.nodeId ? this.nodes.get(p.nodeId) : null;
    // No hook has arrived yet (e.g. SessionStart ran before the folder was trusted); a booted TUI is ready.
    if (!n) return p.sessionId || Date.now() - p.createdAt > 20_000 ? 'idle' : 'starting';
    if (n.status === 'running') return 'running';
    if (n.status === 'waiting') return 'waiting';
    return 'idle';
  }

  /** Live sessions of the dashboard's project running in a terminal the hub doesn't own. */
  /**
   * Every Claude Code operation the hub can see gets a live read-only terminal: each session running in a
   * terminal the hub doesn't own, and each subagent run (its own transcript under <session>/subagents/).
   * Finished runs stay for 10 minutes so you can read how they ended.
   */
  transcriptTargets(): { id: string; sid: string; nodeId: string; file: string; cwd: string; scope: 'session' | 'agent'; runId?: string; earlier?: { type: string; title: string; mtime: number; limit: string | null } }[] {
    const out: ReturnType<SwarmState['transcriptTargets']> = [];
    for (const meta of this.sessions.values()) {
      if (meta.paneId || !meta.transcript) continue;
      const n = this.nodes.get(meta.nodeId);
      if (!n || n.status === 'offline') continue;
      out.push({ id: `tx:${meta.sid}`, sid: meta.sid, nodeId: n.id, file: meta.transcript, cwd: n.cwd ?? meta.root ?? this.projectRoot, scope: 'session' });
    }
    const now = Date.now();
    for (const r of this.runs.values()) {
      if (!r.file || !this.nodes.has(r.nodeId)) continue;
      if (r.finished && now - (r.endedAt ?? r.startedAt) > 10 * 60_000) continue;
      const meta = this.sessions.get(r.sessionId);
      out.push({ id: `tx:a:${r.id}`, sid: r.sessionId, nodeId: r.nodeId, file: r.file, cwd: meta?.root ?? this.projectRoot, scope: 'agent', runId: r.id });
    }
    for (const e of this.earlierAgents.values()) {
      if (!this.sessions.has(e.sid)) continue;
      out.push({ id: `tx:e:${e.agentId}`, sid: e.sid, nodeId: '', file: e.file, cwd: this.projectRoot, scope: 'agent', earlier: { type: e.type, title: e.title, mtime: e.mtime, limit: e.limit } });
    }
    return out;
  }

  snapshot(): Snapshot {
    // Mail counters on nodes.
    const unreadByBox = new Map<string, number>();
    for (const w of this.roots.values()) for (const [box, files] of w.unread) unreadByBox.set(box, (unreadByBox.get(box) ?? 0) + files.length);
    for (const n of this.nodes.values()) {
      const meta = n.sessionId ? this.sessions.get(n.sessionId) : null;
      const ids = new Set([n.role, n.kind === 'virtual' ? n.id.slice(2) : null, n.kind === 'session' ? meta?.agentId : null].filter(Boolean) as string[]);
      n.unread = [...ids].reduce((s, id) => s + (unreadByBox.get(id) ?? 0), 0);
    }
    const panes = [...this.panes.values()].map((p) => {
      const n = p.nodeId ? this.nodes.get(p.nodeId) : null;
      return { ...p, status: this.paneStatus(p), title: n?.title || p.title, model: n && n.model !== 'unknown' ? n.model : p.model };
    });
    for (const p of panes) { const live = this.panes.get(p.id); if (live && live.status !== 'exited') live.status = p.status; }

    for (const p of panes) {
      const meta = p.sessionId ? this.sessions.get(p.sessionId) : null;
      p.inProject = !meta?.root || meta.root === this.projectRoot;
    }
    for (const t of this.transcriptTargets()) {
      const meta = this.sessions.get(t.sid);
      const parent = meta ? this.nodes.get(meta.nodeId) : null;
      if (t.earlier) {
        const info = this.roles.get(t.earlier.type);
        const tag = /^\s*([A-Z][A-Z0-9]*-[A-Z0-9]+)\b/.exec(t.earlier.title)?.[1];
        panes.push({
          id: t.id, kind: 'transcript', scope: 'agent', role: this.roles.baseRole(t.earlier.type), agentId: t.earlier.type,
          label: tag ? `${info.label} · ${tag}` : info.label, avatar: info.avatar, model: info.model, cwd: t.cwd,
          command: 'earlier subagent · read-only', status: t.earlier.limit ? 'waiting' : 'idle', sessionId: t.sid, nodeId: null,
          title: t.earlier.limit
            ? `Stopped on usage limit (${t.earlier.limit.replace(/^hit your /i, '')}) — ${t.earlier.title}`
            : `Finished ${new Date(t.earlier.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${t.earlier.title}`,
          autoWake: false, exitCode: null, createdAt: t.earlier.mtime, inProject: true, parentLabel: parent?.label ?? null,
        });
        continue;
      }
      const n = this.nodes.get(t.nodeId)!;
      panes.push({
        id: t.id, kind: 'transcript', scope: t.scope, role: n.role, agentId: meta?.agentId ?? n.role, label: n.label,
        avatar: n.avatar, model: n.model, cwd: t.cwd,
        command: t.scope === 'agent' ? 'subagent transcript · read-only' : 'your terminal · read-only mirror',
        status: n.status === 'running' ? 'running' : n.status === 'waiting' ? 'waiting' : 'idle',
        sessionId: t.sid, nodeId: n.id, title: n.title, autoWake: false, exitCode: null, createdAt: n.createdAt,
        inProject: !meta?.root || meta.root === this.projectRoot,
        parentLabel: t.scope === 'agent' ? parent?.label ?? null : null,
      });
    }
    for (const n of this.nodes.values()) {
      n.inProject = n.kind === 'user'
        || (n.sessionId ? this.sessions.get(n.sessionId)?.root === this.projectRoot : n.cwd === this.projectRoot);
    }
    const ctxMax = (file: string | null, used: number) =>
      /\[1m\]/i.test(this.meter.model(file) ?? '') || used > 200_000 ? 1_000_000 : 200_000;
    for (const meta of this.sessions.values()) {
      const n = this.nodes.get(meta.nodeId);
      if (!n || !meta.transcript) continue;
      n.context = this.meter.context(meta.transcript);
      n.contextMax = ctxMax(meta.transcript, n.context);
    }
    for (const r of this.runs.values()) {
      const n = this.nodes.get(r.nodeId);
      if (!n || !r.file) continue;
      n.context = this.meter.context(r.file);
      n.contextMax = ctxMax(r.file, n.context);
    }
    const timeline: Snapshot['timeline'] = [];
    for (const meta of this.sessions.values()) {
      const n = this.nodes.get(meta.nodeId);
      if (!n || !meta.turns.length) continue;
      timeline.push({ id: `tl:${meta.sid}`, nodeId: n.id, parentNodeId: null, kind: 'session', label: n.label, model: n.model,
        segments: meta.turns.map((t) => ({ ...t })), ticks: [], tokens: n.tokens });
    }
    for (const r of this.runs.values()) {
      const n = this.nodes.get(r.nodeId);
      if (!n) continue;
      timeline.push({ id: `tl:${r.id}`, nodeId: n.id, parentNodeId: this.sessions.get(r.sessionId)?.nodeId ?? null, kind: 'agent',
        label: n.label, model: n.model, segments: [{ start: r.startedAt, end: r.endedAt, result: r.finished ? n.result : null, title: r.title }],
        ticks: r.ticks.slice(-200), tokens: r.tokens });
    }
    const nodes = [...this.nodes.values()];
    const plans = [...this.roots.values()].map((w) => w.plan).filter((p): p is PlanSummary => !!p);
    const planTasks = plans.flatMap((p) => p.tasks);
    const runs = [...this.runs.values()];
    const progress: Metrics['progress'] = planTasks.length
      ? {
        source: 'plan',
        total: planTasks.length,
        done: planTasks.filter((t) => t.status === 'done').length,
        active: planTasks.filter((t) => t.status === 'in_progress').length,
        review: planTasks.filter((t) => t.status === 'review').length,
        blocked: planTasks.filter((t) => t.status === 'blocked').length,
      }
      : {
        source: 'runs',
        total: runs.length,
        done: runs.filter((r) => r.finished).length,
        active: runs.filter((r) => !r.finished).length,
        review: 0,
        blocked: 0,
      };
    const recent = this.history.filter((h) => Date.now() - h.t <= 60_000);
    const tokensPerMin = recent.length >= 2
      ? Math.round(((this.tokens.total - recent[0].tokens) / Math.max(1, Date.now() - recent[0].t)) * 60_000)
      : 0;
    const active = this.recount();
    const metrics: Metrics = {
      ceo: nodes.filter((n) => n.role === 'ceo-dispatcher' && n.status !== 'offline').length,
      specialists: nodes.filter((n) => (n.kind === 'agent' || n.kind === 'virtual' || n.kind === 'session') && n.role !== 'ceo-dispatcher' && n.status !== 'offline').length,
      sessions: nodes.filter((n) => n.kind === 'session' && n.status !== 'offline').length,
      activeAgents: active,
      peakConcurrency: this.peak,
      capacity: Math.max(this.opts.capacity, this.peak),
      sprints: plans.reduce((s, p) => s + p.sprints.length, 0),
      parallelSprints: plans.reduce((s, p) => s + p.sprints.filter((sp) => sp.active > 0).length, 0),
      tokens: this.tokens,
      tokensPerMin,
      history: this.history.slice(-72),
      progress,
      unreadMail: [...unreadByBox.values()].reduce((a, b) => a + b, 0),
      events: this.events,
    };
    return {
      nodes, edges: [...this.edges.values()], panes, plans, metrics,
      feed: this.feed.slice(-150), roles: this.roles.list(), timeline: [...this.archivedLanes(), ...timeline], defaultProject: this.projectRoot,
      projects: this.projectList(), licence: currentLicence(),
      serverStartedAt: this.startedAt,
    };
  }

  /** A plain-Markdown record of the mission so far: every figure comes from hook events or transcripts. */
  private projectList(): Snapshot['projects'] {
    const counts = new Map<string, number>();
    for (const m of this.sessions.values()) if (m.root) counts.set(m.root, (counts.get(m.root) ?? 0) + (this.nodes.get(m.nodeId)?.status === 'offline' ? 0 : 1));
    for (const r of this.roots.keys()) if (!counts.has(r)) counts.set(r, 0);
    return [...counts.entries()]
      .filter(([root]) => !root.startsWith('/tmp/') || root === this.projectRoot)
      .map(([root, sessions]) => ({ root, sessions, current: root === this.projectRoot }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.sessions - a.sessions);
  }

  /** Everything the receipt archive stores for one run (Pro). */
  receiptRecord(): Omit<StoredReceipt, 'id'> {
    const s = this.snapshot();
    const inProj = new Set(s.nodes.filter((n) => n.inProject).map((n) => n.id));
    const runs = s.timeline.filter((l) => l.kind === 'agent' && !l.archived && inProj.has(l.nodeId));
    const done = runs.filter((l) => l.segments[0].end);
    const agents: StoredReceipt['agents'] = {};
    for (const l of runs) {
      const role = s.nodes.find((n) => n.id === l.nodeId)?.role ?? l.label;
      const a = (agents[role] ??= { runs: 0, tokens: 0, fails: 0 });
      a.runs++; a.tokens += l.tokens; if (l.segments[0].result === 'FAIL') a.fails++;
    }
    const plan = s.plans.find((p) => p.root === this.projectRoot) ?? s.plans[0];
    return {
      createdAt: Date.now(), project: this.projectRoot, epic: plan?.epic ?? path.basename(this.projectRoot),
      tokens: s.metrics.tokens.total, runs: runs.length, fails: runs.filter((l) => l.segments[0].result === 'FAIL').length,
      avgRunMs: done.length ? done.reduce((t, l) => t + (l.segments[0].end! - l.segments[0].start), 0) / done.length : 0,
      tasksDone: plan?.tasks.filter((t) => t.status === 'done').length ?? 0, tasksTotal: plan?.tasks.length ?? 0,
      markdown: this.receipt(), agents,
    };
  }

  receipt(): string {
    const s = this.snapshot();
    const inProj = new Set(s.nodes.filter((n) => n.inProject).map((n) => n.id));
    const fmt = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
    const dur = (a: number, b: number | null) => {
      const sec = Math.max(0, Math.round(((b ?? Date.now()) - a) / 1000));
      return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    };
    const runs = s.timeline.filter((l) => l.kind === 'agent' && !l.archived && inProj.has(l.nodeId));
    const sessions = s.nodes.filter((n) => n.kind === 'session' && n.inProject);
    const plan = s.plans[0];
    const t = s.metrics.tokens;
    const lines = [
      '# SwarmCorp run receipt', '',
      `- Project: \`${this.projectRoot}\``,
      `- Generated: ${fmt(Date.now())} UTC`,
      `- Recording since: ${fmt(this.startedAt)} UTC (hub start)`,
      plan ? `- Epic: ${plan.epic}: ${plan.tasks.filter((x) => x.status === 'done').length}/${plan.tasks.length} tasks done` : '- Epic: no .claude/swarm-plan.json',
      '', '## Totals', '',
      '| Tokens | Input | Output | Cache read | Cache write | Sessions | Agent runs | Peak concurrency |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|',
      `| ${t.total.toLocaleString()} | ${t.input.toLocaleString()} | ${t.output.toLocaleString()} | ${t.cacheRead.toLocaleString()} | ${t.cacheWrite.toLocaleString()} | ${sessions.length} | ${runs.length} | ${s.metrics.peakConcurrency} |`,
      '', '## Agent runs', '',
      '| Agent | Task | Started (UTC) | Duration | Tokens | Tool calls seen | Result |',
      '|---|---|---|---:|---:|---:|---|',
      ...runs.sort((a, b) => a.segments[0].start - b.segments[0].start).map((l) => {
        const g = l.segments[0];
        return `| ${l.label} | ${g.title.replace(/\|/g, '/')} | ${fmt(g.start)} | ${dur(g.start, g.end)}${g.end ? '' : ' (running)'} | ${l.tokens.toLocaleString()} | ${l.ticks.length} | ${g.result ?? (g.end ? 'n/a' : 'running')} |`;
      }),
      '', '## Sessions', '',
      '| Session | Model | Status | Tokens | Context |',
      '|---|---|---|---:|---:|',
      ...sessions.map((n) => `| ${n.label} | ${n.model} | ${n.status} | ${n.tokens.toLocaleString()} | ${n.context.toLocaleString()} / ${n.contextMax.toLocaleString()} |`),
      '', '---',
      '_Every figure comes from Claude Code hook events and transcript files on this machine. Token counts cover usage since the hub started. "Tool calls seen" is sampled from agent transcripts, so it is a lower bound._', '',
    ];
    return lines.join('\n');
  }

  reset() {
    this.nodes.clear(); this.edges.clear(); this.feed = []; this.sessions.clear(); this.runs.clear();
    this.runByAgent.clear(); this.runByToolUse.clear(); this.tokens = emptyTotals(); this.history = [];
    this.tokenSince = Date.now();
    this.peak = 0; this.events = 0;
    for (const p of this.panes.values()) { p.sessionId = null; p.nodeId = null; }
    this.ensureUser();
    this.log('RESET', 'Telemetry reset', 'info');
    this.changed();
  }
}
