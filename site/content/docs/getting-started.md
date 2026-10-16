---
title: "Getting started"
description: "Install SwarmCorp, start the dashboard against a project, open your first agent session and check that the map is receiving events."
date: 2026-10-16
tag: Docs
readingTime: "4 min"
---

SwarmCorp runs on your machine. The dashboard is served at `http://localhost:4317`, there is no account, and nothing is sent anywhere else. Setup takes about five minutes.

## Prerequisites

- **Node.js 20 or newer.** Check with `node --version`.
- **Claude Code**, installed and logged in. Run `claude` once in any folder and make sure it reaches a prompt.
- **A C/C++ build toolchain**, if your platform doesn't have a prebuilt binary for `node-pty`. On Linux that is `build-essential` and Python 3. On macOS, the Xcode command line tools.
- **A project to point it at.** Any folder works. A git repository is better, because agents work on branches.

## Install

Clone the repository and install dependencies:

```bash
git clone https://github.com/KunalSiyag/swarmcorp.git swarmcorp
cd swarmcorp
npm install
```

Then install the Claude Code side:

```bash
npm run install-claude
```

This changes four things under `~/.claude`, and backs up any file it changes to `~/.claude/backups/swarmcorp-<timestamp>/` first:

| Path | What it gets |
|---|---|
| `settings.json` | Hook entries that run the SwarmCorp relay, and `env.SWARMCORP_URL`. Your other hooks and settings are left in place. |
| `agents/` | Five agent profiles: `ceo-dispatcher` (Opus), `opus-researcher` (Opus), `sonnet-implementer` (Sonnet), `haiku-tester` (Haiku), `opus-auditor` (Opus). |
| `CLAUDE.md` | The SwarmCorp constitution, inside a marked block. The rest of the file is untouched. |
| `swarmcorp/` | `swarm-hook.mjs` (the hook relay) and `swarm-mail.mjs` (the dispatch queue CLI). |

The installer is safe to run again. Files that haven't changed are reported as `unchanged`.

The constitution only applies in swarm mode: in sessions started from the dashboard, in projects that contain `.claude/swarm-plan.json`, or when running as one of the five agents. Your other projects work as before.

**Restart any Claude Code sessions that are already running**, or run `/hooks` in each one. Sessions load hooks when they start.

## Start the dashboard

```bash
npm start -- --project ~/code/my-app
```

This builds the client and starts the hub. You should see:

```
──────────────────────────────────────────────────────────
  SwarmCorp mission control   http://localhost:4317
  Hook ingest                 POST http://127.0.0.1:4317/api/events
  Default project             /home/you/code/my-app
──────────────────────────────────────────────────────────
```

Open `http://localhost:4317`.

## Your first session

You have two ways to begin.

**One terminal.** Choose **+ Terminal**, pick an employee role, optionally give it an instance id such as `sonnet-implementer-3`, and choose **Launch**. The pane runs `claude --agent <role>` in your project. The role list also has `claude` (a plain session) and `shell`.

**The whole fleet.** Choose **▶ Fleet**. This opens six panes: a CEO, a researcher, two implementers, a tester and an auditor. Three of them run on Opus, so read the cost note below first.

The first time Claude Code opens a folder, it asks whether you trust it. Each pane shows that prompt. Answer it inside the pane.

Then give the CEO pane a goal, for example:

> Add rate limiting to the public API. Plan it, staff it, gate it.

## What you should see

Within a few seconds of your first prompt:

- **The pane status** changes from Starting to Running (blue). When the agent finishes its turn, it changes to Done · Idle (green). If it is waiting on a permission prompt, it shows Paused for input and pulses amber.
- **A node on the map** for the session, with a model tag. A Task pulse travels from You to the session.
- **The Tokens tile** starts counting. It counts usage since the hub started.
- **The live feed** logs the session coming online, your prompt, and the end of the turn with its STATUS result.

When the CEO writes `.claude/swarm-plan.json`, the sub-task progress bar fills in. When it delegates, new nodes appear for each subagent run, and messages in the dispatch queue show up as Task, Spec, Code review and Feedback Loop pulses.

Sessions you start in your own terminal, outside the dashboard, appear too. They show up as read-only mirror panes and as nodes on the map, as long as they run in the same project.

## Cost note

Every pane is a real Claude Code session that uses your plan or API quota. Once the CEO has an epic, the dispatch queue and auto-wake keep the other agents working without further input from you. Watch the Token burn card. Turn off auto-wake (the clock button) on any pane you want to stay idle, and close panes you aren't using.

To see the dashboard without spending tokens, start the hub and run:

```bash
npm run simulate
```

It replays a scripted three-sprint epic against the running hub.

## Uninstall

```bash
npm run install-claude -- --uninstall
```

This removes the SwarmCorp hook entries and `SWARMCORP_URL` from `settings.json`, and the SwarmCorp block from `CLAUDE.md`. Everything else in those files stays. The five agent files in `~/.claude/agents/` and the scripts in `~/.claude/swarmcorp/` are kept, in case you use them on their own. Delete them by hand if you don't.

Backups from every install are in `~/.claude/backups/`. If you want a file back exactly as it was before SwarmCorp, copy it from there.

Next: [Hooks](./hooks.md) · [Configuration](./configuration.md) · [Troubleshooting](./troubleshooting.md)
