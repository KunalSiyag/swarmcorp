// SwarmCorp telemetry plugin for opencode. Installed to ~/.config/opencode/plugins/swarmcorp.js by `swarmcorp init`.
// It translates opencode's plugin events into SwarmCorp's canonical events and posts them to the local hub.
// Best-effort and fire-and-forget: it never blocks or changes opencode's behaviour.
// Event shapes: docs/adapters-research.md (opencode 1.18.x).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The hub's port can change between machines and runs: read the address it wrote, then SWARMCORP_URL.
function hub() {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'swarmcorp', 'hub.json'), 'utf8'));
    if (h.ingest && h.pid) { process.kill(h.pid, 0); return h.ingest; }
  } catch { /* fall through */ }
  return (process.env.SWARMCORP_URL ?? 'http://127.0.0.1:4317').replace(/\/+$/, '');
}

export const SwarmCorp = async ({ directory }) => {
  const parents = new Map(); // child session id → parent session id (subagents via the task tool)
  const titles = new Map();
  const finished = new Set();
  const swarm = { role: process.env.SWARM_ROLE || null, agentId: process.env.SWARM_AGENT_ID || null, paneId: process.env.SWARM_PANE_ID || null };

  const post = (hook, payload) => {
    fetch(`${hub()}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-swarmcorp-hook': '1' },
      body: JSON.stringify({ hook, agent: 'opencode', at: Date.now(), swarm, payload: { cwd: directory, ...payload } }),
      signal: AbortSignal.timeout(800),
    }).catch(() => {});
  };
  const top = (sid) => parents.get(sid) ?? sid;

  return {
    event: async ({ event }) => {
      const p = event?.properties ?? {};
      switch (event?.type) {
        case 'session.created': {
          const info = p.info ?? {};
          if (!info.id) break;
          if (info.parentID) {
            parents.set(info.id, info.parentID);
            const title = info.title || 'Subagent';
            titles.set(info.id, title);
            post('PreToolUse', { session_id: info.parentID, tool_name: 'Agent', tool_use_id: info.id, tool_input: { subagent_type: info.agent ?? 'subagent', description: title } });
            post('SubagentStart', { session_id: info.parentID, agent_id: info.id, agent_type: info.agent ?? 'subagent', description: title });
          } else {
            post('SessionStart', { session_id: info.id, cwd: info.directory ?? directory, source: 'startup' });
          }
          break;
        }
        case 'session.idle': {
          const sid = p.sessionID;
          if (!sid) break;
          if (parents.has(sid)) {
            if (finished.has(sid)) break;
            finished.add(sid);
            post('SubagentStop', { session_id: parents.get(sid), agent_id: sid, agent_type: 'subagent', last_assistant_message: '' });
          } else {
            post('Stop', { session_id: sid, last_assistant_message: '' });
          }
          break;
        }
        case 'message.updated': {
          const m = p.info ?? {};
          if (m.role !== 'assistant' || !m.time?.completed || !m.tokens) break;
          post('Usage', {
            session_id: top(m.sessionID), agent_id: parents.has(m.sessionID) ? m.sessionID : undefined,
            message_id: m.id, model: m.modelID, tokens: m.tokens, cwd: m.path?.cwd ?? directory,
          });
          break;
        }
        // 1.18 emits permission.asked; older SDK types call it permission.updated.
        case 'permission.asked':
        case 'permission.updated':
        case 'question.asked':
          post('Notification', {
            session_id: top(p.sessionID), notification_type: 'permission_prompt',
            message: event.type === 'question.asked' ? 'opencode is asking a question' : `opencode needs permission: ${p.permission ?? p.title ?? 'tool'}`,
          });
          break;
        case 'session.error':
          if (p.sessionID && !parents.has(p.sessionID)) post('Stop', { session_id: p.sessionID, last_assistant_message: `STATUS: FAIL — ${p.error?.name ?? 'error'}` });
          break;
        case 'session.deleted':
          if (p.info?.id && !p.info.parentID) post('SessionEnd', { session_id: p.info.id, reason: 'deleted' });
          break;
      }
    },
    'chat.message': async (input, output) => {
      const sid = input?.sessionID;
      if (!sid || parents.has(sid)) return;
      const text = (output?.parts ?? []).filter((x) => x?.type === 'text').map((x) => x.text).join(' ');
      post('UserPromptSubmit', { session_id: sid, prompt: text, model: input?.model?.modelID });
    },
    'tool.execute.before': async (input) => {
      if (input?.sessionID && !parents.has(input.sessionID)) post('PreToolUse', { session_id: input.sessionID, tool_name: input.tool ?? 'tool', tool_use_id: input.callID });
    },
  };
};
