# Adapter research: observing non-Claude coding agents

Researched 2026-10-16. Sources: official docs first; "LOCAL" means evidence from this machine (binary strings, bundled type definitions, on-disk files). No agent was run against a model, and no config was modified. Anything marked **UNVERIFIED** was not confirmed against a primary source.

---

## 1. OpenAI Codex CLI

Sources: https://developers.openai.com/codex/hooks (now 308-redirects to https://learn.chatgpt.com/docs/hooks; a `.md` variant is at https://learn.chatgpt.com/docs/hooks.md). LOCAL: `~/.codex/hooks.json`, `~/.codex/config.toml` (only the `[hooks.state]` and `[features]` tables were read), and 116 rollout files under `~/.codex/sessions/`. Codex is not on PATH here. The rollouts were written by `cli_version` `0.151.0-alpha.7.2` with originator `codex_vscode`.

### Install target
Codex reads hooks from `hooks.json`, or from inline `[hooks]` tables in `config.toml`, in any of these locations:
- `~/.codex/hooks.json`
- `~/.codex/config.toml`
- `<repo>/.codex/hooks.json`
- `<repo>/.codex/config.toml`

Plugins can bundle `hooks/hooks.json`, or a `hooks` entry in `.codex-plugin/plugin.json`. Project-local hooks load only when the project `.codex/` layer is trusted.

The JSON shape is the same as Claude Code's. LOCAL `~/.codex/hooks.json` already uses it, for hivemind hooks.

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/codex.mjs", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/codex.mjs", "timeout": 10 }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/codex.mjs", "timeout": 10, "async": true }] }]
  }
}
```

The TOML equivalent:

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 ~/.codex/hooks/pre_tool_use.py"
timeout = 30
```

Handler fields:
- `type`: `"command"`.
- `command`.
- `timeout`: in **seconds**. Default `600`. `SessionEnd` and `Interrupt` default to `1`, with a maximum of `3`.
- `statusMessage`: optional.
- `async`: `true` runs the hook in the background.

**Matcher:** a regex. `"*"`, `""`, or omitting it matches everything. It filters on:
- the tool name, for `PreToolUse`, `PostToolUse` and `PermissionRequest`
- `source`, for `SessionStart`
- `trigger`, for the compact events
- `reason`, for `SessionEnd`
- `agent_type`, for the subagent events

`UserPromptSubmit`, `Stop` and `Interrupt` ignore the matcher.

**Feature flag:** `[features] hooks = false` turns hooks off. `codex_hooks` is a deprecated alias. LOCAL config has `hooks = true`.

**Trust:** non-managed hooks must be reviewed and trusted with `/hooks`. Trust is recorded against the hook's hash, so new or changed hooks are **skipped until trusted**. `--dangerously-bypass-hook-trust` bypasses this for one run. LOCAL shows trust is persisted in `config.toml` as:

```toml
[hooks.state."/home/kunalsiyag/.codex/hooks.json:pre_tool_use:0:0"]
enabled = true
trusted_hash = "sha256:…"
```

The key format is `<file>:<event_snake_case>:<group_idx>:<handler_idx>`.

**Adapter consequence:** any edit to the installed command changes the hash and silently disables the hook until the user re-trusts it in `/hooks`.

### Events
All events receive these common stdin fields:
- `session_id`
- `transcript_path`: `string|null`
- `cwd`
- `hook_event_name`
- `model`: the active model slug
- `turn_id`: on turn-scoped events
- `permission_mode`: on several events

| Event | Meaning | Extra payload fields |
|---|---|---|
| `SessionStart` | Session begins | `source`: `startup`, `resume`, `clear`, `compact` or `fork` |
| `SessionEnd` | Session ends | `reason`: currently always `other`. Not fired for subagents |
| `UserPromptSubmit` | Prompt submitted | `prompt` |
| `PreToolUse` | Before a tool runs | `tool_name`, `tool_use_id`, `tool_input` |
| `PermissionRequest` | About to ask for approval | `tool_name`, `tool_input`, `tool_input.description` (nullable). Not fired when no approval is needed |
| `PostToolUse` | After a tool runs | `tool_name`, `tool_use_id`, `tool_input`, `tool_response` |
| `PreCompact` / `PostCompact` | Around compaction | `trigger`: `manual` or `auto` |
| `SubagentStart` | Subagent spawned | `turn_id`, `agent_id`, `agent_type`, `permission_mode` |
| `SubagentStop` | Subagent finished | `agent_id`, `agent_type`, `agent_transcript_path` (nullable), `stop_hook_active`, `last_assistant_message` (nullable) |
| `Stop` | Turn ends | `turn_id`, `stop_hook_active`, `last_assistant_message` (nullable) |
| `Interrupt` | User interrupt | `turn_id`, `permission_mode`. Not fired for subagents |

The docs list no `Notification` event.

### Session identity
- **Hook payloads:** `session_id`. The docs say: "Subagent hooks use the parent session id." Subagents are distinguished by `agent_id`.
- **Rollouts:** `session_meta.payload.session_id` (also `id`), which is the UUID in the rollout file name.
- **Subagent rollouts:** have `session_meta.payload.source = {"subagent": …}`, `thread_source: "subagent"` and `parent_thread_id` (LOCAL).

### Transcript and tokens
- **Location:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<YYYY-MM-DDTHH-MM-SS>-<uuid>.jsonl`. `CODEX_HOME` defaults to `~/.codex`. All 116 files here are plain `.jsonl` (LOCAL).
- **Index:** `~/.codex/session_index.jsonl` holds `{id, thread_name, updated_at}`.
- **Line envelope:** `{timestamp, ordinal, type, payload}`. `type` is one of `session_meta`, `turn_context`, `world_state`, `response_item`, `event_msg` or `compacted`. The docs warn that the transcript format "isn't a stable interface for hooks".

Token usage comes from `type: "event_msg"` lines with `payload.type: "token_count"`:

```json
{"type":"event_msg","payload":{"type":"token_count","info":{
  "total_token_usage":{"input_tokens":15818,"cached_input_tokens":15104,"cache_write_input_tokens":0,"output_tokens":264,"reasoning_output_tokens":51,"total_tokens":16082},
  "last_token_usage":{ "…same keys…" },
  "model_context_window":258400},
 "rate_limits":{"primary":{"used_percent":72.0,"window_minutes":43200,"resets_at":…},"plan_type":"go"}}}
```

`total_token_usage` is cumulative for the session, so take the last value. `last_token_usage` is the per-request delta.

Other useful `event_msg` payloads:
- `task_started`: `turn_id`, `started_at`, `model_context_window`
- `task_complete`: `turn_id`, `last_agent_message`
- `turn_aborted`: `turn_id`, `reason`, for example `"interrupted"`
- `item_completed`: `item.type` is one of `UserMessage`, `AgentMessage`, `CommandExecution`, `FileChange` or `Reasoning`

### Model name source
- **Hooks:** the `model` field, on every event.
- **Rollout:** `turn_context.payload.model`, and `thread_settings_applied.thread_settings.model` (with `model_provider_id`).
- **Session start:** `session_meta.payload.base_instructions.provenance.model`, on newer versions.

### Caveats / UNVERIFIED
- Whether hooks fire for `codex exec` and the VS Code or ACP front-ends is **UNVERIFIED**, because the docs are silent. LOCAL rollouts show `source: "exec"` sessions exist, but hook firing can't be confirmed without running Codex.
- The rollout schema is version-dependent. Fields such as `world_state`, `ordinal` and `cache_write_input_tokens` appear only in newer files.
- Codex's legacy `notify = [...]` program in `config.toml` (an `agent-turn-complete` JSON argument) is an alternative Stop signal. It was not re-verified this session: **UNVERIFIED**.

---

## 2. Gemini CLI

Sources:
- https://geminicli.com/docs/hooks/
- https://geminicli.com/docs/hooks/reference/
- https://geminicli.com/docs/hooks/best-practices
- https://geminicli.com/docs/reference/configuration/
- https://geminicli.com/docs/cli/session-management/
- Source: https://github.com/google-gemini/gemini-cli `packages/core/src/services/chatRecording{Service,Types}.ts`

Gemini CLI is not installed here. Note the docs banner: "Gemini CLI was replaced by Antigravity CLI for unpaid tier and Google One users on June 18, 2026."

### Install target
`settings.json` locations, highest precedence first:
1. Project: `.gemini/settings.json`
2. User: `~/.gemini/settings.json`
3. System: `/etc/gemini-cli/settings.json`
4. Extensions

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "name": "swarmcorp", "type": "command", "command": "node ~/.claude/swarmcorp/adapters/gemini.mjs", "timeout": 5000 }] }],
    "BeforeTool":   [{ "matcher": ".*", "hooks": [{ "name": "swarmcorp-tool", "type": "command", "command": "node ~/.claude/swarmcorp/adapters/gemini.mjs", "timeout": 5000 }] }]
  }
}
```

Group fields:
- `matcher`: a regex for tool events, an exact string for lifecycle events. `"*"` or `""` matches all.
- `sequential`: bool.
- `hooks`: the handler array.

Handler fields:
- `type`: `"command"` only.
- `command`.
- `name`.
- `timeout`: in **milliseconds**, default `60000`.
- `description`.

**Opt-in:** none in current docs. `hooksConfig.enabled` defaults to `true` ("Canonical toggle for the hooks system"). The other related settings are:
- `hooksConfig.disabled`: a list of hook names
- `hooksConfig.notifications`
- `/hooks enable-all` and `/hooks disable-all`

Older releases reportedly needed `tools.enableHooks: true`. That is not documented now: **UNVERIFIED**.

**Trust:** project hooks are "Untrusted by default". Each hook gets an identity "based on its `name` and `command`", and a warning is shown when that identity is new or changed. This is a warning, not a blocking prompt.

**Env vars given to hooks:** `GEMINI_PROJECT_DIR`, `GEMINI_PLANS_DIR`, `GEMINI_SESSION_ID`, `GEMINI_CWD`, `CLAUDE_PROJECT_DIR` (an alias).

**Exit codes:** `0` means stdout is parsed as JSON. `2` blocks the action. Any other code is a non-fatal warning.

### Events
Base stdin fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`.

| Event | Meaning | Extra payload fields |
|---|---|---|
| `SessionStart` | Session begins | `source`: `startup`, `resume` or `clear` |
| `SessionEnd` | Session ends | `reason`: `exit`, `clear`, `logout`, `prompt_input_exit` or `other` |
| `BeforeAgent` | User prompt about to run (turn start) | `prompt` |
| `AfterAgent` | Agent turn finished | `prompt`, `prompt_response`, `stop_hook_active` |
| `BeforeModel` | Before an LLM request | `llm_request` (`model`, `messages`, `config`) |
| `BeforeToolSelection` | Before tool selection | `llm_request` |
| `AfterModel` | After an LLM response | `llm_request`, `llm_response` (`candidates`, `usageMetadata.totalTokenCount`) |
| `BeforeTool` | Before a tool runs | `tool_name`, `tool_input`, `mcp_context`, `original_request_name` |
| `AfterTool` | After a tool runs | `tool_name`, `tool_input`, `tool_response` (`llmContent`, `returnDisplay`, `error?`), `mcp_context`, `original_request_name` |
| `PreCompress` | Before compression | `trigger`: `auto` or `manual` |
| `Notification` | Needs attention | `notification_type` (`"ToolPermission"`), `message`, `details` |

There are no subagent events.

### Session identity
`session_id` in the payload, and the env var `GEMINI_SESSION_ID`. It is a UUID that `gemini --resume <uuid>` accepts.

### Transcript and tokens
- **Location:** `~/.gemini/tmp/<project_hash>/chats/`. `<project_hash>` is derived from the project root.
- **Main session file:** `session-<ISO yyyy-mm-ddThh-mm>-<first8ofSessionId>.jsonl`. Legacy versions (≤0.38) wrote whole-file `.json`.
- **Subagent files:** nested at `chats/<parentSessionId>/<sessionId>.jsonl`.
- **Retention:** sessions are deleted after 30 days by default (`general.sessionRetention.maxAge: "30d"`).

`ConversationRecord` fields:
- `sessionId`, `projectHash`, `startTime`, `lastUpdated`, `messages[]`
- `summary?`, `directories?`
- `kind?`: `'main'` or `'subagent'`

The JSONL form also carries `$set`, `$patch` and `$rewindTo` line records.

Messages of `type: 'gemini'` carry:
- `model?: string`
- `tokens?: { input, output, cached, thoughts?, tool?, total }`. These map to `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` and `totalTokenCount`.
- `toolCalls?: [{ id, name, args, status, timestamp, agentId?, … }]`

The other message types are `user`, `info`, `error` and `warning`. In hooks, `AfterModel` gives `llm_response.usageMetadata`.

### Model name source
- **Hooks:** `llm_request.model`, on `BeforeModel` and `AfterModel`.
- **Transcript:** `messages[].model`, on `gemini` messages.

### Caveats / UNVERIFIED
- The `$set`/`$patch` JSONL semantics mean the transcript needs replay to reconstruct, not simple line-by-line reading.
- How Gemini subagents surface in `BeforeTool` (as tool calls named after the agent?) is **UNVERIFIED**. `ToolCallRecord.agentId` and subagent chat files exist.

---

## 3. Google Antigravity CLI (`agy` 1.3.1)

Sources:
- Official: https://antigravity.google/docs/hooks
- LOCAL: the hooks reference doc embedded in `/home/kunalsiyag/.local/bin/agy`, a Go binary. Its strings include the heading "Lifecycle Hooks (`hooks.json`)", hook proto getters and changelog lines.
- LOCAL: files under `~/.gemini/antigravity-cli/`.
- Cross-check: https://signoz.io/docs/antigravity-cli-monitoring/
- The Medium guide (https://medium.com/google-cloud/a-developers-guide-to-agent-hooks-in-antigravity-cli-4c1440febd11) returned **HTTP 403** and was not read.

`agy --help` has no `hooks` or `config` subcommand. The subcommands are `agent(s)`, `changelog`, `install`, `mcp`, `mic-serve`, `models`, `plugin(s)`, `remote-control` and `update`. `/hooks` is a TUI slash command that inspects loaded hooks.

### Install target
- **Global:** `~/.gemini/config/hooks.json`. The changelog says: "the shared `~/.gemini/config/hooks.json`". Not present on this machine yet.
- **Workspace:** `<workspace>/.agents/hooks.json`.
- **Plugin-bundled:** `hooks.json`, CLI only.
- **CLI only:** hooks may also live inside `~/.gemini/antigravity-cli/settings.json`.

SigNoz says hooks load only for folders in `trustedWorkspaces`, which is in `~/.gemini/antigravity-cli/settings.json`.

The shape is different from Claude's: top-level keys are **hook names**, and each holds event arrays.

```json
{
  "swarmcorp": {
    "enabled": true,
    "SessionStart":   [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs SessionStart", "timeout": 10 }],
    "PreToolUse":     [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs PreToolUse", "timeout": 10 }] }],
    "PostToolUse":    [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs PostToolUse", "timeout": 10 }] }],
    "PreInvocation":  [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs PreInvocation" }],
    "PostInvocation": [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs PostInvocation" }],
    "Stop":           [{ "type": "command", "command": "node ~/.claude/swarmcorp/adapters/agy.mjs Stop" }]
  }
}
```

The two event types use different structures:
- **Tool events** are grouped as `{matcher, hooks:[…]}`. The matcher is a regex on the tool name, which is the step type lowercased with the `CORTEX_STEP_TYPE_` prefix removed, for example `run_command` or `invoke_subagent`.
- **Lifecycle events** are flat lists of handlers.

Handler fields:
- `type`: optional, `"command"`.
- `command`: run with `sh -c`, with cwd set to the directory containing `hooks.json`.
- `timeout`: in **seconds**, default `30`.

Hooks run synchronously, and multiple named hooks for one event run in sequence.

**The payload has no event-name field.** Pass the event name in argv, as SigNoz does.

### Events
All JSON keys are **camelCase** (protojson). Common fields: `conversationId`, `workspacePaths[]`, `transcriptPath`, `artifactDirectoryPath`, `modelName`.

The proto `HookArgsCommon` also defines `agentName`, `parentConversationId`, `executionId`, `lastUserInput` and `isBattleMode` (LOCAL getters). Whether those are serialized to stdin is **UNVERIFIED**.

| Event | Meaning | Payload / required output |
|---|---|---|
| `SessionStart` | Session start | Common fields only. Official doc and LOCAL `SessionStartHookArgs` |
| `PreToolUse` | Before a tool step | `toolCall {name, args}`, `stepIdx`. Output `decision`: `allow`, `deny`, `ask` or `force_ask`; plus `reason`, `permissionOverrides`, `overwrite` |
| `PostToolUse` | After a tool step | `toolCall`, `stepIdx`, `error?`. Output `{}` |
| `PreInvocation` | Before each model call | `invocationNum`, `initialNumSteps`. Output may contain `injectSteps` |
| `PostInvocation` | After a model call and its tool calls | Same as PreInvocation. Proto also has `modelOutput` and `modelThinking`. Output may contain `terminationBehavior` |
| `Stop` | Execution loop terminates | `executionNum`, `terminationReason` (for example `model_stop`, `max_steps_exceeded`, `error`), `error?`, `fullyIdle`. Output `decision: "continue"` blocks the stop |

There are no SessionEnd, UserPromptSubmit, Notification, permission or subagent events.

### Session identity
- `conversationId`, a UUID.
- `agy --conversation <id>` resumes a conversation.
- `~/.gemini/antigravity-cli/conversations/<id>.db` and `brain/<id>/` are keyed by the same id (LOCAL).

### Transcript and tokens
**Location (LOCAL):** `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl`. This sits alongside `transcript_full.jsonl`, which has no truncation. The hook payload gives the exact path in `transcriptPath`.

Each line is one step:
- `step_index`
- `source`: `USER_EXPLICIT`, `MODEL` or `SYSTEM`
- `type`: for example `USER_INPUT`, `PLANNER_RESPONSE`, `RUN_COMMAND`, `VIEW_FILE`, `CODE_ACTION`, `INVOKE_SUBAGENT`, `ASK_QUESTION`, `CHECKPOINT` or `ERROR_MESSAGE`
- `status`
- `created_at`
- `content`
- `tool_calls[{name,args}]`
- `thinking`, `error`, `exit_code`, `truncated_fields`

**Tokens are present** on `PLANNER_RESPONSE` steps as `input_tokens`, `cache_read_tokens` and `output_tokens` (LOCAL: present on 755 of 15,048 planner steps). SigNoz says agy exposes no per-token counts in its telemetry. The transcript contradicts that, though coverage is partial.

### Model name source
`modelName` in every hook payload. It can be `"auto"`, and per SigNoz the resolved name may be an internal alias such as `gemini-pro-agent`. The transcript has no model field (LOCAL).

### Caveats / UNVERIFIED
- SigNoz says `PreToolUse` must return a `decision`, so it is not a neutral observer. The 1.3.x changelog says empty decision strings are now "safely handled". Whether returning `{}` is fully neutral is **UNVERIFIED**, so prefer `PostToolUse` for observation.
- **UPS:** detect a user prompt as `PreInvocation` with `invocationNum` = first in execution, or read the last `USER_INPUT` step from the transcript. Heuristic.
- Hooks fire in the CLI. Forum reports say IDE and 2.0 hook firing is unreliable.

---

## 4. opencode (v1.18.35)

Sources:
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/server/
- LOCAL: `~/.config/opencode/node_modules/@opencode-ai/plugin@1.14.43/dist/index.d.ts`
- LOCAL: `@opencode-ai/sdk@1.14.43` `dist/gen/types.gen.d.ts` (v1) and `dist/v2/gen/types.gen.d.ts` (v2)
- LOCAL: strings in `~/.opencode/bin/opencode`
- LOCAL: the schema of `~/.local/share/opencode/opencode.db`

### Install target
- **Global plugin file:** `~/.config/opencode/plugins/swarmcorp.ts` (or `.js`). The binary globs `{plugin,plugins}/*.{ts,js}`, so singular `plugin/` also works (LOCAL). Files are auto-loaded at startup.
- **Project plugins:** `.opencode/plugins/`.
- **npm packages:** the `"plugin": ["pkg"]` array in `opencode.json`.
- **Plugin dependencies:** `package.json` in the config dir, which is installed with `bun install`.
- **Env:** `OPENCODE_CONFIG_DIR` overrides the config dir.

```ts
import type { Plugin } from "@opencode-ai/plugin"
export const SwarmCorp: Plugin = async ({ project, client, $, directory, worktree, serverUrl }) => ({
  event: async ({ event }) => { /* event.type, event.properties */ },
  "chat.message": async (input, output) => { /* input.sessionID, input.model?.{providerID,modelID}, output.message */ },
  "tool.execute.before": async (input, output) => { /* input.tool, input.sessionID, input.callID; output.args */ },
  "tool.execute.after":  async (input, output) => { /* input.tool, sessionID, callID, args; output.title/output/metadata */ },
  "permission.ask": async (input, output) => { /* Permission; output.status = "ask"|"deny"|"allow" (don't change) */ },
})
```

The signature is `type Plugin = (input: PluginInput, options?) => Promise<Hooks>`. `PluginInput` contains `client`, `project`, `directory`, `worktree`, `experimental_workspace`, `serverUrl` and `$`.

### Events
Events arrive at the `event` hook, and at SSE, as `{type, properties}`. In v2 they also carry `id`.

| Event | Meaning | Key properties |
|---|---|---|
| `session.created` | New session; a subagent session if `info.parentID` is set | `info: Session` (`id`, `projectID`, `directory`, `parentID?`, `title`, `time`). v2 adds `sessionID`, `agent?` and `model?{id,providerID}` |
| `session.updated` / `session.deleted` | Session metadata changed or deleted | `info: Session` |
| `session.status` | Busy, idle or retry | `sessionID`, `status: {type:"idle"} \| {type:"busy"} \| {type:"retry",attempt,message,next}` |
| `session.idle` | Turn finished (Stop) | `sessionID` |
| `session.error` | Error | `sessionID?`, `error?` |
| `session.compacted` | Compaction done | `sessionID` |
| `message.updated` | Message created or updated | `info: Message`. A user message has `model{providerID,modelID}` and `agent`. An assistant message has `modelID`, `providerID`, `agent`, `path{cwd,root}`, `cost`, `tokens{total?,input,output,reasoning,cache{read,write}}` and `finish?` |
| `message.part.updated` | Part changed | `part: Part`. For a tool part: `type:"tool"`, `tool`, `callID`, `state{status:pending\|running\|completed\|error, input, output?, time}`. Other part types include `step-finish` (with `tokens` and `cost`), `subtask` (`prompt`, `description`, `agent`) and `agent` |
| `message.part.delta` | Streaming delta (v2) | |
| `permission.asked` | Permission needed (v2; this binary emits it) | `id`, `sessionID`, `permission`, `patterns[]`, `metadata`, `always[]`, `tool?{messageID,callID}` |
| `permission.replied` | Permission answered | v2: `sessionID`, `requestID`, `reply` (`once`, `always` or `reject`) |
| `question.asked` / `question.replied` / `question.rejected` | Agent asks the user | `id`, `sessionID`, `questions[]` |
| `command.executed` | Slash command run | `name`, `sessionID`, `arguments`, `messageID` |
| `session.next.*` | Fine-grained v2 stream, for example `session.next.tool.called` and `session.next.step.ended` (`tokens`, `cost`, `finish`) | |
| `server.connected` | First SSE event | |

Hook signatures, from `index.d.ts`:
- `tool.execute.before(input:{tool,sessionID,callID}, output:{args})`
- `tool.execute.after(input:{tool,sessionID,callID,args}, output:{title,output,metadata})`

Subagents run through the `task` tool, which creates a child session with `parentID` set.

### Session identity
- `sessionID` on almost all events and hooks, or `info.id` on `session.created` and `session.updated`.
- **cwd:** the plugin's `directory` or `worktree`, `Session.directory`, or `AssistantMessage.path.cwd`.

### Transcript and tokens
- **Storage (LOCAL):** SQLite at `~/.local/share/opencode/opencode.db`, with tables `session` (`parent_id`, `directory`), `message` (`session_id`, `data` JSON), `part`, `event`, and others.
- **Example `message.data`** for an assistant message: `{modelID:"google/gemini-4-argon", providerID:"gmicloud", tokens:{total,input,output,reasoning,cache:{read,write}}, cost, agent, path, finish, parentID}`.
- **Live tokens:** `message.updated`, when `info.role === "assistant"`, or `step-finish` parts. Tokens are per message, so sum them per session.

### Model name source
- `AssistantMessage.modelID` with `providerID`.
- The user message `model{providerID,modelID}`.
- `chat.message` `input.model`.
- v2 `Session.model`.

### HTTP server (`opencode serve`)
- **Flags:** `--port` (default `4096`), `--hostname` (default `127.0.0.1`), `--cors`.
- **Auth:** HTTP basic auth via `OPENCODE_SERVER_PASSWORD`. The username is `opencode`, overridable with `OPENCODE_SERVER_USERNAME`.
- **SSE:** `GET /event` sends `server.connected` first, then bus events shaped `{type, properties}`. `GET /global/event` sends `{directory, project?, workspace?, payload: Event}`.
- **OpenAPI:** `GET /doc`.
- **Sessions:** `GET /session` and `GET /session/:id/message`.
- **TUI:** binds a **random** port unless `--port` is given, so the plugin's `serverUrl` is the reliable way to learn it.

### Caveats / UNVERIFIED
- The bundled plugin types are **1.14.43** but the binary is **1.18.35**. The v1 `Event` union still lists `permission.updated`, but the binary only contains `permission.asked` (LOCAL: 0 vs 12 string hits). Handle both names.
- There is no SessionEnd event. Options are `server.instance.disposed` or process exit; the semantics of the former are **UNVERIFIED**.
- `session.idle` and `session.status{idle}` both exist. Which one is canonical going forward is **UNVERIFIED**.

---

## 5. Zed (v1.22.0)

Sources: https://zed.dev/docs/ai/external-agents, plus LOCAL `~/.local/share/zed/external_agents/registry/registry.json`, `~/.config/zed/settings.json`, and the npm tarball `@agentclientprotocol/claude-agent-acp@0.84.0`, downloaded to scratch and read only.

### Install target
Nothing is needed for Claude: hooks come from `~/.claude/settings.json`. The registry entry is:

```json
{"id":"claude-acp","name":"Claude Agent","version":"0.84.0","distribution":{"npx":{"package":"@agentclientprotocol/claude-agent-acp@0.84.0"}}}
```

The adapter depends on `@anthropic-ai/claude-agent-sdk@0.3.284`. In `dist/acp-agent.js` it builds query options with:

```js
settingSources: ["user", "project", "local"],
...userProvidedOptions,
hooks: { ...userProvidedOptions?.hooks, PostToolUse: [ … ], PostModelSwitch: [ … ] },
pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath()),
env: { …, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" }
```

So **user, project and local settings, including `~/.claude/settings.json` hooks, are loaded**. The adapter's programmatic hooks are added alongside them.

Other registry agents:

| Registry id | Package / binary |
|---|---|
| `codex-acp` | `@agentclientprotocol/codex-acp@2.0.1` |
| `gemini` | `@google/gemini-cli@0.62.0 --acp` |
| `opencode` | `opencode acp`, v1.18.33 binary |
| `antigravity-acp` | `agy_acp_server.par` 1.2.1 |

LOCAL Zed settings enable `agent_servers` `cursor` and `codex-acp` with `"type":"registry"`. A custom agent is added with `{"agent_servers":{"id":{"type":"custom","command":"…","args":[…],"env":{}}}}`.

### Events / identity / tokens
These are the same as Claude Code's own hook events and payload (`session_id`, `transcript_path`, `cwd`), because the SDK spawns the real Claude Code CLI.

### Zed native agent
- No hooks or agent telemetry API was found in the docs or by web search. **UNVERIFIED negative.**
- Threads are stored in SQLite at `~/.local/share/zed/threads/threads.db`, table `threads(id, summary, updated_at, data_type, data BLOB, parent_id, folder_paths, …)`. The blob format is **UNVERIFIED**.
- `dev: open acp logs`, in the command palette, shows ACP traffic for external agents.

### Caveats / UNVERIFIED
- `...userProvidedOptions` is spread after `settingSources`, so a client could override it through `_meta`. Zed does not appear to, but that is **UNVERIFIED**.
- The environment passed to hooks is Zed's, so `SWARM_ROLE` is absent.
- Whether the Codex, Gemini, opencode and agy ACP modes honor their own hooks and plugins is **UNVERIFIED**. They run the same engines, so it is likely.

---

## Mapping to SwarmCorp canonical events

| Canonical | Codex | Gemini CLI | Antigravity `agy` | opencode | Zed (Claude via ACP) |
|---|---|---|---|---|---|
| SessionStart | `SessionStart` | `SessionStart` | `SessionStart` | `event` `session.created` where `!info.parentID` | Claude `SessionStart` |
| UserPromptSubmit | `UserPromptSubmit` (`prompt`) | `BeforeAgent` (`prompt`) | none. Heuristic: first `PreInvocation` of an execution, or a transcript `USER_INPUT` step | `chat.message` hook, or `message.updated` with `role:"user"` | Claude `UserPromptSubmit` |
| ToolStart (agent/subagent spawn) | `PreToolUse` (spawn tool name UNVERIFIED) | `BeforeTool` (subagent tool naming UNVERIFIED) | `PreToolUse` or `PostToolUse` with matcher `invoke_subagent` | `tool.execute.before` with `tool === "task"` | Claude `PreToolUse` (`Task`/`Agent`) |
| SubagentStart | `SubagentStart` (`agent_id`, `agent_type`) | none | none. `parentConversationId` in proto, UNVERIFIED | `session.created` where `info.parentID` is set | Claude `SubagentStart` |
| SubagentStop | `SubagentStop` | none | none | `session.idle` for a child session, or `tool.execute.after` with `tool === "task"` | Claude `SubagentStop` |
| NeedsInput (permission/notification) | `PermissionRequest` | `Notification` (`ToolPermission`) | none. `PreToolUse` with `decision:"ask"` is owned by agy; `ask_question` tool steps | `permission.asked` (v1 types: `permission.updated`), `question.asked` | Claude `Notification` / `PermissionRequest` |
| Stop (turn end) | `Stop` | `AfterAgent` | `Stop` | `session.idle`, or `session.status` `{type:"idle"}` | Claude `Stop` |
| SessionEnd | `SessionEnd` (timeout ≤3s) | `SessionEnd` | none | none (`session.deleted` only on delete) | Claude `SessionEnd` |

Token and model sources at a glance:

| Tool | Tokens | Model |
|---|---|---|
| Codex | Rollout `event_msg/token_count.info.total_token_usage` | Hook `model` |
| Gemini | `AfterModel.llm_response.usageMetadata`, or transcript `messages[].tokens` | `llm_request.model` |
| agy | Transcript `PLANNER_RESPONSE` `input_tokens`, `output_tokens`, `cache_read_tokens` | Hook `modelName` |
| opencode | `message.updated` assistant `tokens` and `cost` | `modelID`/`providerID` |
| Zed | Claude transcript | Claude transcript |
