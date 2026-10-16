#!/usr/bin/env node
// SwarmCorp hook relay. Invoked by each agent's hook config as:
//   node swarm-hook.mjs <HookEventName>                 (Claude Code)
//   node swarm-hook.mjs --agent <agent> <EventName>     (codex | gemini | antigravity)
//  1. Forwards the hook payload (trimmed) to the SwarmCorp dashboard: POST $SWARMCORP_URL/api/events
//  2. For swarm employees: injects unread inbox mail into context (SessionStart / UserPromptSubmit)
//     and asks the agent to process mail once before it stops (Stop).
// It must never break Claude: every failure path exits 0 quickly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inbox, resolveProjectRoot } from './swarm-mail.mjs';

const argv = process.argv.slice(2);
const AGENT = argv[0] === '--agent' ? argv[1] : 'claude';
const HOOK = (argv[0] === '--agent' ? argv[2] : argv[0]) ?? 'Unknown';
// Prefer the address the running hub wrote (its port can change); fall back to SWARMCORP_URL, then the default.
function hubBase() {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'swarmcorp', 'hub.json'), 'utf8'));
    if (h.ingest && h.pid) { process.kill(h.pid, 0); return h.ingest; }
  } catch { /* no hub file, or that hub is gone */ }
  return process.env.SWARMCORP_URL ?? 'http://127.0.0.1:4317';
}
const BASE = hubBase().replace(/\/+$/, '');
const ROLES = new Set(['ceo-dispatcher', 'opus-researcher', 'sonnet-implementer', 'haiku-tester', 'opus-auditor']);

const cut = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : s);

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    const t = setTimeout(() => resolve(buf), 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(buf); });
  });
}

function trim(p) {
  const out = { ...p };
  if (out.prompt) out.prompt = cut(out.prompt, 2000);
  if (out.last_assistant_message) out.last_assistant_message = cut(out.last_assistant_message, 2000);
  if (out.message) out.message = cut(out.message, 1000);
  if (out.tool_input && typeof out.tool_input === 'object') {
    out.tool_input = { ...out.tool_input };
    if (out.tool_input.prompt) out.tool_input.prompt = cut(out.tool_input.prompt, 2000);
  }
  if (out.tool_response !== undefined) {
    const r = out.tool_response;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const { status, agentId, totalTokens, usage, totalDurationMs, totalToolUseCount, resolvedModel, content } = r;
      const text = Array.isArray(content)
        ? content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
        : typeof content === 'string' ? content : '';
      out.tool_response = { status, agentId, totalTokens, usage, totalDurationMs, totalToolUseCount, resolvedModel, content: cut(text, 2000) };
    } else {
      out.tool_response = cut(typeof r === 'string' ? r : JSON.stringify(r ?? null), 2000);
    }
  }
  delete out.background_tasks;
  delete out.session_crons;
  return out;
}

async function forward(payload, swarm) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 800);
  try {
    await fetch(`${BASE}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-swarmcorp-hook': '1' },
      body: JSON.stringify({ hook: HOOK, agent: AGENT, at: Date.now(), swarm, payload: trim(payload) }),
      signal: ctrl.signal,
    });
  } catch { /* dashboard not running: telemetry is best-effort */ }
  finally { clearTimeout(t); }
}

function mailSummary(msgs, root) {
  const lines = msgs.slice(0, 10).map((m) =>
    `- [${m.priority}] ${m.kind} from ${m.from} — "${m.subject}"${m.refs?.task_id ? ` (task ${m.refs.task_id})` : ''}\n  file: ${m.file}\n  ${cut(String(m.body ?? '').replace(/\s+/g, ' '), 300)}`);
  const more = msgs.length > 10 ? `\n…and ${msgs.length - 10} more (run swarm-mail inbox).` : '';
  return `SwarmCorp dispatch queue — ${msgs.length} unread message(s) in ${root}/.claude/swarm-inbox:\n${lines.join('\n')}${more}\n` +
    `Claim before acting: node ~/.claude/swarmcorp/swarm-mail.mjs claim <file> --me <your-id>; archive with "done" when finished.`;
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: cut(raw, 500) }; }

  const mainThread = !payload.agent_id; // tool events inside subagents carry agent_id
  const role = process.env.SWARM_ROLE || (ROLES.has(payload.agent_type) ? payload.agent_type : '');
  const me = process.env.SWARM_AGENT_ID || role;
  const swarm = { role: role || null, agentId: me || null, paneId: process.env.SWARM_PANE_ID || null };

  await forward(payload, swarm);

  // Mail injection speaks Claude Code's hook-output format; other agents only get telemetry.
  if (!role || !mainThread || AGENT !== 'claude') return;
  let msgs = [];
  let root = '';
  try {
    root = resolveProjectRoot(payload.cwd || process.cwd());
    msgs = inbox(root, me, role);
  } catch { return; }
  if (!msgs.length) return;

  if (HOOK === 'SessionStart' || HOOK === 'UserPromptSubmit') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: HOOK, additionalContext: mailSummary(msgs, root) },
    }));
  } else if (HOOK === 'Stop' && !payload.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `${mailSummary(msgs, root)}\nProcess (or explicitly defer) this mail before stopping.`,
    }));
  }
}

main().catch(() => {}).finally(() => process.exit(0));
