import type { AgentKind } from '../shared/types.ts';
import type { HookEnvelope } from './swarm.ts';

// Each coding agent reports through its own hook system. Adapters translate those events into the
// canonical, Claude-shaped events the state engine understands (SessionStart, UserPromptSubmit,
// PreToolUse, PostToolUse, SubagentStart, SubagentStop, Notification, Stop, SessionEnd, plus Usage).
// Field-level sources for every mapping are in docs/adapters-research.md.

export const AGENTS: AgentKind[] = ['claude', 'codex', 'gemini', 'antigravity', 'opencode'];
const isAgent = (a: unknown): a is AgentKind => AGENTS.includes(a as AgentKind);

type Out = HookEnvelope | null;
const env = (src: HookEnvelope, hook: string, payload: Record<string, any>): HookEnvelope =>
  ({ ...src, hook, payload: { ...payload, hook_event_name: hook } });

/** Codex CLI: hooks are Claude-compatible in name and payload; two events differ. */
function codex(e: HookEnvelope): Out {
  const p = e.payload;
  switch (e.hook) {
    case 'Interrupt': return env(e, 'Stop', { ...p, last_assistant_message: 'Interrupted' });
    case 'PermissionRequest':
      return env(e, 'Notification', { ...p, notification_type: 'permission_prompt', message: `Codex needs permission: ${p.tool_input?.description ?? p.tool_name ?? 'tool'}` });
    case 'PreCompact': case 'PostCompact': return null;
    default: return e;
  }
}

/** Gemini CLI: different event names, the same snake_case payload. No subagent events. */
function gemini(e: HookEnvelope): Out {
  const p = e.payload;
  switch (e.hook) {
    case 'SessionStart': case 'SessionEnd': return e;
    case 'BeforeAgent': return env(e, 'UserPromptSubmit', { ...p, prompt: p.prompt ?? '' });
    case 'AfterAgent': return env(e, 'Stop', { ...p, last_assistant_message: p.prompt_response ?? '' });
    case 'BeforeTool': return env(e, 'PreToolUse', p);
    case 'AfterTool': return env(e, 'PostToolUse', p);
    case 'Notification': return env(e, 'Notification', { ...p, notification_type: 'permission_prompt', message: p.message ?? 'Gemini CLI needs permission' });
    case 'BeforeModel': case 'AfterModel': {
      const model = p.llm_request?.model;
      return typeof model === 'string' ? env(e, 'ModelInfo', { ...p, model }) : null;
    }
    default: return null;
  }
}

/** Antigravity (agy): camelCase protojson payload with no event-name field (the relay passes it in argv). */
function antigravity(e: HookEnvelope): Out {
  const p = e.payload;
  const base: Record<string, any> = {
    session_id: p.conversationId,
    cwd: Array.isArray(p.workspacePaths) ? p.workspacePaths[0] : undefined,
    transcript_path: p.transcriptPath,
    model: p.modelName,
  };
  if (!base.session_id) return null;
  // A conversation started by another one is a subagent of it (field per the hook proto; may be absent).
  const parent = typeof p.parentConversationId === 'string' && p.parentConversationId ? p.parentConversationId : null;
  switch (e.hook) {
    case 'SessionStart':
      return parent
        ? env(e, 'SubagentStart', { ...base, session_id: parent, agent_id: p.conversationId, agent_type: p.agentName || 'subagent' })
        : env(e, 'SessionStart', { ...base, source: 'startup' });
    case 'PreInvocation':
      // First model call of an execution = the user just sent something.
      if (!parent && p.invocationNum === 0) return env(e, 'UserPromptSubmit', { ...base, prompt: p.lastUserInput ?? '' });
      return env(e, 'PreToolUse', { ...base, tool_name: 'model' });
    case 'PostToolUse':
      return env(e, 'PostToolUse', { ...base, tool_name: p.toolCall?.name ?? 'tool', tool_input: p.toolCall?.args ?? {} });
    case 'Stop': {
      const failed = p.terminationReason && p.terminationReason !== 'model_stop';
      const text = failed ? `STATUS: FAIL — ${p.terminationReason}${p.error ? `: ${p.error}` : ''}` : '';
      return parent
        ? env(e, 'SubagentStop', { ...base, session_id: parent, agent_id: p.conversationId, agent_type: p.agentName || 'subagent', last_assistant_message: text })
        : env(e, 'Stop', { ...base, last_assistant_message: text });
    }
    default: return null;
  }
}

/** opencode: the SwarmCorp plugin already emits canonical names; payloads pass through. */
const opencode = (e: HookEnvelope): Out => e;

export function normalize(e: HookEnvelope): Out {
  const agent = isAgent(e.agent) ? e.agent : 'claude';
  const withAgent = { ...e, agent };
  switch (agent) {
    case 'codex': return codex(withAgent);
    case 'gemini': return gemini(withAgent);
    case 'antigravity': return antigravity(withAgent);
    case 'opencode': return opencode(withAgent);
    default: return withAgent;
  }
}
