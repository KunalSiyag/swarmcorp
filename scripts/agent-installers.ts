// Installs SwarmCorp's telemetry into coding agents other than Claude Code. Every change merges into the
// agent's existing config (backed up first) and only touches entries SwarmCorp owns. Uninstall removes them.
// Formats and file locations: docs/adapters-research.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type OtherAgent = 'codex' | 'gemini' | 'antigravity' | 'opencode';
export const OTHER_AGENTS: OtherAgent[] = ['codex', 'gemini', 'antigravity', 'opencode'];
const HOME = os.homedir();
const TAG = 'swarmcorp/swarm-hook.mjs';

const onPath = (bin: string) => {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
};

export function detect(agent: OtherAgent): boolean {
  switch (agent) {
    case 'codex': return onPath('codex') || fs.existsSync(path.join(HOME, '.codex'));
    case 'gemini': return onPath('gemini');
    case 'antigravity': return onPath('agy') || fs.existsSync(path.join(HOME, '.gemini', 'antigravity-cli'));
    case 'opencode': return onPath('opencode') || fs.existsSync(path.join(HOME, '.config', 'opencode'));
  }
}

interface Ctx { relay: string; pluginSrc: string; backupDir: string; uninstall: boolean; url: string }

function backup(ctx: Ctx, file: string) {
  if (!fs.existsSync(file)) return;
  const dest = path.join(ctx.backupDir, path.relative(HOME, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function readJson(file: string): any {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) {
    throw new Error(`${file} is not plain JSON (${(e as Error).message}); add SwarmCorp's hooks by hand or fix the file — refusing to overwrite`);
  }
}

function writeJson(ctx: Ctx, file: string, data: unknown) {
  const next = JSON.stringify(data, null, 2) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return 'unchanged';
  backup(ctx, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return 'updated';
}

const cmd = (ctx: Ctx, agent: OtherAgent, event: string) => `node ${JSON.stringify(ctx.relay)} --agent ${agent} ${event}`;
const ours = (h: any) => typeof h?.command === 'string' && h.command.includes(TAG);

/** Claude-style `hooks: { Event: [{ matcher?, hooks: [handler] }] }`, used by Codex and Gemini CLI. */
function mergeGroups(hooks: Record<string, any[]>, add: Record<string, any> | null) {
  for (const [ev, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !ours(h)) })).filter((g) => g.hooks.length);
    if (kept.length) hooks[ev] = kept; else delete hooks[ev];
  }
  if (add) for (const [ev, group] of Object.entries(add)) hooks[ev] = [...(hooks[ev] ?? []), group];
}

function codex(ctx: Ctx): string {
  const file = path.join(HOME, '.codex', 'hooks.json');
  const data = readJson(file);
  data.hooks ??= {};
  const h = (event: string, extra: Record<string, unknown> = {}) => ({ hooks: [{ type: 'command', command: cmd(ctx, 'codex', event), timeout: 5, async: true, ...extra }] });
  const tool = (event: string) => ({ matcher: '*', ...h(event) });
  mergeGroups(data.hooks, ctx.uninstall ? null : {
    SessionStart: h('SessionStart'), UserPromptSubmit: h('UserPromptSubmit'),
    PreToolUse: tool('PreToolUse'), PostToolUse: tool('PostToolUse'), PermissionRequest: tool('PermissionRequest'),
    SubagentStart: h('SubagentStart'), SubagentStop: h('SubagentStop'), Stop: h('Stop'),
    SessionEnd: h('SessionEnd', { timeout: 3 }), Interrupt: h('Interrupt', { timeout: 3 }),
  });
  if (!Object.keys(data.hooks).length) delete data.hooks;
  const r = writeJson(ctx, file, data);
  return ctx.uninstall ? r : `${r} — run /hooks in Codex once to trust the new SwarmCorp hooks`;
}

function gemini(ctx: Ctx): string {
  const file = path.join(HOME, '.gemini', 'settings.json');
  const data = readJson(file);
  data.hooks ??= {};
  const h = (event: string, matcher?: string) => ({ ...(matcher ? { matcher } : {}), hooks: [{ name: `swarmcorp-${event}`, type: 'command', command: cmd(ctx, 'gemini', event), timeout: 5000 }] });
  mergeGroups(data.hooks, ctx.uninstall ? null : {
    SessionStart: h('SessionStart'), SessionEnd: h('SessionEnd'), BeforeAgent: h('BeforeAgent'), AfterAgent: h('AfterAgent'),
    BeforeTool: h('BeforeTool', '.*'), AfterTool: h('AfterTool', '.*'), Notification: h('Notification'),
  });
  if (!Object.keys(data.hooks).length) delete data.hooks;
  return writeJson(ctx, file, data);
}

function antigravity(ctx: Ctx): string {
  // agy's hooks.json is keyed by hook name; SwarmCorp owns the "swarmcorp" entry and nothing else.
  const file = path.join(HOME, '.gemini', 'config', 'hooks.json');
  const data = readJson(file);
  if (ctx.uninstall) delete data.swarmcorp;
  else {
    const life = (event: string) => [{ type: 'command', command: cmd(ctx, 'antigravity', event), timeout: 5 }];
    data.swarmcorp = {
      enabled: true,
      SessionStart: life('SessionStart'),
      // PostToolUse (not PreToolUse): PreToolUse expects a permission decision, and telemetry must stay neutral.
      PostToolUse: [{ matcher: '.*', hooks: life('PostToolUse') }],
      PreInvocation: life('PreInvocation'),
      Stop: life('Stop'),
    };
  }
  if (!Object.keys(data).length && !fs.existsSync(file)) return 'absent';
  return writeJson(ctx, file, data);
}

function opencode(ctx: Ctx): string {
  const file = path.join(HOME, '.config', 'opencode', 'plugins', 'swarmcorp.js');
  if (ctx.uninstall) {
    if (!fs.existsSync(file)) return 'absent';
    backup(ctx, file);
    fs.unlinkSync(file);
    return 'removed';
  }
  const src = fs.readFileSync(ctx.pluginSrc, 'utf8');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === src) return 'unchanged';
  backup(ctx, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src);
  return 'installed';
}

export function installAgent(agent: OtherAgent, ctx: Ctx): string {
  switch (agent) {
    case 'codex': return codex(ctx);
    case 'gemini': return gemini(ctx);
    case 'antigravity': return antigravity(ctx);
    case 'opencode': return opencode(ctx);
  }
}
