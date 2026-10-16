---
title: "Hooks"
description: "Which Claude Code hooks SwarmCorp installs, what each one puts on the map, what happens when the dashboard isn't running, and how to change the port."
date: 2026-10-16
tag: Docs
readingTime: "4 min"
---

SwarmCorp learns what your agents are doing from Claude Code hooks. `npm run install-claude` adds a hook entry for nine events to `~/.claude/settings.json`. Each one runs the same relay:

```bash
node ~/.claude/swarmcorp/swarm-hook.mjs <Event>
```

The relay reads the hook payload from stdin, trims long fields, adds the pane's `SWARM_ROLE`, `SWARM_AGENT_ID` and `SWARM_PANE_ID` if they are set, and POSTs it to `$SWARMCORP_URL/api/events` on the local hub.

## What each hook shows

| Hook | Matcher | What the map shows |
|---|---|---|
| `SessionStart` | all | The session node comes online with its model tag. A pane launched by the dashboard links to its node through `SWARM_PANE_ID`. |
| `UserPromptSubmit` | all | A Task pulse from You to the session. The node turns Running and takes the first line of the prompt as its title. |
| `PreToolUse` | `Agent\|Task` | A new run node for the subagent, titled with the delegation's description, linked to the session that spawned it. |
| `SubagentStart` | all | Binds the run node to the subagent's `agent_id`, so later events and its transcript land on the right node. |
| `SubagentStop` | all | Counts the subagent's tokens from its transcript and parses its STATUS line. The node shows `TASK COMPLETE (PASS)`, `(FAIL)` or `(BLOCKED)`, and a Result or Feedback Loop pulse goes back to the parent. |
| `PostToolUse` | `Agent\|Task` | Records the resolved model. If `SubagentStop` didn't arrive, it completes the run instead. |
| `Notification` | all | A permission prompt or input request turns the node amber (Paused for input) and sends a Permission request pulse to You. |
| `Stop` | all | The node turns Done · Idle, or failed if the STATUS line says FAIL. The STATUS line becomes its title. |
| `SessionEnd` | all | The node goes offline. Any runs it still had open are closed. |

Each subagent run is its own node. Delegate to the tester three times and you see three runs.

Two things on the map don't come from hooks:

- **Dispatch queue messages** come from watching `.claude/swarm-inbox/` once a second. They produce Task, Spec, Code review, Feedback Loop, Permission request and Result pulses.
- **Plan progress** comes from watching `.claude/swarm-plan.json` every two seconds. Task status changes appear in the live feed.

## Tokens

Hook payloads include `transcript_path`, and `SubagentStop` includes `agent_transcript_path`. The hub reads new lines from those JSONL files and sums `message.usage`. Claude Code writes one line per content block, and the lines of one API response repeat the same usage, so the hub counts each API message once.

Only usage recorded after the hub started is counted. Restart the hub and the Tokens tile starts from zero.

## Mail in context

For SwarmCorp employees, the relay does one more thing. It checks the agent's inbox and, if mail is waiting:

- on `SessionStart` and `UserPromptSubmit`, adds a summary of the unread messages to the agent's context;
- on `Stop`, asks the agent once to process or defer the mail before it stops.

This applies to the main session only, not to subagents, and only when a SwarmCorp role is set. It reads the mailbox files directly, so it works whether or not the dashboard is running.

## When the dashboard is off

The relay never holds up Claude Code.

- The POST gives up after about 0.8 seconds.
- Every error is caught, and the process always exits with code 0.
- The hook entry has a 5-second timeout as a backstop.

With the hub stopped, your sessions run as usual and the events are dropped. Nothing is queued for later. When you start the hub again, it finds sessions in the project that were active in the last five minutes, and background subagents active since shortly before it started, by reading Claude Code's transcript folders. See [Troubleshooting](./troubleshooting.md).

## Hooks don't fire in a running session

Claude Code loads hooks when a session starts. After `npm run install-claude`, restart sessions that were already open, or open `/hooks` inside each one.

## Changing the port

The hub listens on `4317` by default. To move it, change it in two places.

**1. Point the hooks at the new port:**

```bash
npm run install-claude -- --port 4400
```

This sets `env.SWARMCORP_URL` in `~/.claude/settings.json` to `http://127.0.0.1:4400`. Restart open sessions afterwards.

**2. Start the hub on that port**, with any one of:

```bash
npm start -- --port 4400 --project ~/code/my-app
SWARMCORP_PORT=4400 npm start -- --project ~/code/my-app
```

or `"port": 4400` in `swarmcorp.config.json`. If more than one is set, `SWARMCORP_PORT` wins, then `--port`, then the config file.

Panes launched from the dashboard get the hub's URL in their environment, so they follow the hub's port even if step 1 is skipped. Sessions you start in your own terminal read `SWARMCORP_URL` from `settings.json`, so they need step 1.

## Removing the hooks

```bash
npm run install-claude -- --uninstall
```

This removes every hook entry whose command contains `swarmcorp/swarm-hook.mjs`, and the `SWARMCORP_URL` variable. Hooks you added yourself are left alone.
