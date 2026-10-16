---
title: "Supported agents"
description: "Which coding agents SwarmCorp can watch, what each one shows on the map, how to connect it, and how well each integration has been tested."
date: 2026-10-16
tag: Docs
readingTime: "4 min"
---

SwarmCorp observes each agent through that agent's own hook or plugin system, plus the transcript files it already writes to disk. `swarmcorp init` connects every agent it finds on your machine. To pick agents by hand, use `--agents codex,opencode`. `--agents none` connects Claude Code only.

## What each agent shows

| | Claude Code | Codex CLI | Gemini CLI | Antigravity (`agy`) | opencode |
|---|---|---|---|---|---|
| Sessions on the map | ✓ | ✓ | ✓ | ✓ | ✓ |
| Prompts and turn ends | ✓ | ✓ | ✓ | ✓ (prompt inferred from the first model call) | ✓ |
| Subagents as their own nodes | ✓ | ✓ | — (no subagent events) | ✓ (child conversations) | ✓ (task-tool child sessions) |
| Needs-input (amber) | ✓ | ✓ (PermissionRequest) | ✓ (tool permission) | — (no permission event) | ✓ (permission and question) |
| Tokens and context meter | ✓ | ✓ (rollout `token_count`) | ✓ (chat `tokens`) | Partial (only some planner steps carry tokens) | ✓ (reported per message) |
| Model tag | ✓ | ✓ (GPT) | ✓ (Gemini) | ✓ (Gemini) | ✓ (whatever provider you use) |
| Live terminal mirror | ✓ | ✓ | ✓ | ✓ | — (opencode stores sessions in SQLite) |
| Launch from the dashboard | ✓ | ✓ (`codex`) | ✓ (`gemini`) | ✓ (`agy`) | ✓ (`opencode`) |
| SwarmCorp roles and dispatch queue | ✓ | — | — | — | — |

**Roles** (CEO, researcher, implementer, QA and auditor) and **mail injection** depend on Claude Code's agent files and hook-output format, so they're Claude-only for now. Any agent can still read and write the file queue with `swarm-mail.mjs`.

## How each agent is connected

| Agent | What `init` changes | Notes |
|---|---|---|
| Claude Code | Hook groups in `~/.claude/settings.json`, five agent profiles, and a CLAUDE.md block | Restart sessions, or run `/hooks`, to pick them up |
| Codex CLI | Merges async hook handlers into `~/.codex/hooks.json`, keeping any hooks you already have | **Run `/hooks` in Codex once to trust them.** Codex skips new hooks until they're trusted |
| Gemini CLI | Merges a `hooks` block into `~/.gemini/settings.json` | Timeouts are in milliseconds (5000) |
| Antigravity | Adds a `swarmcorp` entry to `~/.gemini/config/hooks.json` | Hooks load only for trusted workspaces. It uses PostToolUse, not PreToolUse, so telemetry never affects permissions |
| opencode | Drops a plugin at `~/.config/opencode/plugins/swarmcorp.js` | It's loaded the next time opencode starts |
| Zed | Nothing extra | Claude Code started from Zed's agent panel already reports through your `~/.claude` hooks. Zed's built-in agent has no hook API |

Every file is backed up before it changes. `swarmcorp uninstall` removes only SwarmCorp's entries, and restores each config to how it was.

## How well each integration is tested

| Agent | Status |
|---|---|
| Claude Code | **Tested live** on real sessions, subagents and background agents |
| Codex, Gemini CLI, Antigravity, opencode | **Beta.** Built from each tool's official hook documentation, plus the hook reference built into the installed binary (Antigravity) and the bundled type definitions (opencode). Tested end to end with the documented payload shapes and sample transcripts. Not yet tested against a live paid session |

If something on the map looks wrong for one of the beta agents, run the hub with `npm run dev:server` to watch the incoming events, and [open an issue](https://github.com/KunalSiyag/swarmcorp/issues) with the event names you see.

## Known gaps

- **Gemini CLI** has no subagent hook events, so subagents run inside its main session's node.
- **Antigravity** has no prompt-submit event. SwarmCorp treats the first model call of each execution as the prompt.
- **opencode** has no transcript file to mirror. Its session still shows on the map, with tokens, subagents and permission prompts.
- **Codex** hooks may not fire for every front end (for example `codex exec` versus IDE extensions). This hasn't been confirmed yet.
