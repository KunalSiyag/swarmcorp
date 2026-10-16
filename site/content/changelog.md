---
title: "Changelog"
description: "What changed in each SwarmCorp release."
date: 2026-10-16
tag: Changelog
readingTime: "1 min"
---

## v0.3 — 2026-10-16

**Added (Pro)**

- **Licence keys.** Signed with Ed25519 and verified offline. Paste a key in **Settings**, or set `SWARMCORP_LICENCE`. No account, no licence server.
- **Run history.** Finished agent runs and session turns are written to `~/.local/share/swarmcorp/history/` and appear as HISTORY lanes in the timeline after a restart.
- **Receipt archive.** Save a receipt of the current run, download any saved receipt, and compare two side by side (tokens, runs, failures, average run time, tokens per role). A receipt is saved automatically when the hub stops.
- **Project switching.** Point the dashboard at another project from Settings without restarting the hub.
- **Daylight theme.** White surfaces, hairline borders and a single ember accent.

**Changed**

- Night theme surfaces and the elevation of panels, revised from Refero style research.
- Pro endpoints answer `402` with a clear message on the Free plan.

## v0.2 — 2026-10-16

**Added**

- **Mirror panes.** Claude Code sessions you start in your own terminal, in the dashboard's project, appear as read-only panes rendered from their transcripts.
- **Session discovery from disk.** The hub reads `~/.claude/projects/<project>/` and finds sessions active in the last five minutes, including ones that started before the dashboard.
- **Subagent discovery from disk.** Background agents are found from `<session>/subagents/agent-<id>.jsonl` and `.meta.json`, with their latest tool call as the node title. Agents that finished while the hub was down are marked complete from their transcripts.
- **One node per run.** Every subagent run gets its own node on the map, linked to the session that spawned it.
- **"This project" filter** on the map, on by default.
- **Timeline view.** One lane per session turn and per agent run, with tool-call ticks and an AUTO range.
- **Context meters.** Each session and agent shows how full its context window is, read from the last request's input and cache tokens.
- **Run receipts.** `GET /api/receipt` (the Receipt button) downloads a Markdown record of the run: agents, tasks, start times, durations, tokens and results.
- **First-run checklist** in the empty dashboard: Claude Code on PATH, hooks installed, first session seen.
- **Marketing site, blog, workflow tips and docs** in `site/`.

**Changed**

- New visual design for the dashboard, map and terminal grid: dark HUD, one signal colour, Archivo and JetBrains Mono, no emoji. Model identity is shown by text tag and node size, never by colour.

## v0.1 — 2026-10-09

**Added**

- Swarm map: one node per session, with Task, Spec, Code review, Feedback Loop, Permission request and Result pulses.
- Terminal grid: `claude --agent <role>` panes over node-pty, with Running, Done · Idle and Paused for input states.
- Hook telemetry for nine Claude Code events, relayed to a local hub on `127.0.0.1:4317`.
- Token burn from transcripts, de-duplicated per API message. Concurrency gauge with peak marker. Sub-task progress from `.claude/swarm-plan.json`. Live feed.
- Dispatch queue: `swarm-mail` send, inbox, claim and done, with atomic claims. Auto-wake for idle panes.
- STATUS line parsing for PASS, FAIL and BLOCKED.
- Installer for five agent profiles, the constitution and the hooks, with backups and `--uninstall`.
- `npm run simulate`, a scripted demo that spends no tokens.
