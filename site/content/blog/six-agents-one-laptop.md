---
title: "Six agents, one laptop"
description: "How to run a CEO, a researcher and two implementers on a 16 GB laptop without the fan taking off: in-process subagents, background runs, idle sessions and MCP servers."
date: 2026-10-15
tag: Guide
readingTime: "5 min"
---

It is 10:40. You have six Claude Code sessions open: a CEO, a researcher, two implementers, a tester and an auditor. The fan is loud. Your editor takes two seconds to open a file. Activity Monitor lists forty-odd processes you don't remember starting.

None of the agents are thinking hard. Model calls run on Anthropic's servers, not on your laptop. What fills your RAM is everything around those calls: the CLI processes, the tool servers, the shells. Most of it is under your control.

## Know what a session costs

Each Claude Code session you open in a terminal is its own process. Each stdio MCP server configured for that session is another process, started by that session. Six sessions with four MCP servers each is thirty processes before any of them runs a test.

Measure before you change anything:

```bash
ps -axo rss,command | grep -E 'claude|mcp' | grep -v grep | sort -rn | head -20
```

The first column is resident memory in kilobytes. Run it once with your fleet idle, once mid-task. The gap is your working cost.

## Subagents run inside the session that spawned them

You have two ways to get a second agent working.

**A separate terminal.** `claude --agent sonnet-implementer` in a new pane. It is a full session: its own process, its own MCP servers, its own context. It stays alive until you close it.

**An in-process subagent.** The session you already have calls the Agent tool, and Claude Code runs the subagent inside the same process. It gets its own context window and returns a result to the parent. It doesn't start a second CLI, and it doesn't start its own set of MCP servers.

The second is lighter. Use separate terminals for roles that hold state across many turns and need to be addressable by name: the CEO, and the implementers that own branches. Use subagents for bounded jobs: research a library, review a diff, run the test suite and report back.

In SwarmCorp, subagent runs show up on the map as their own nodes, linked to the session that spawned them. You can see a CEO session with three research runs fanned out beneath it without opening three terminals.

## Background agents keep the parent free

A subagent can run in the background, so the parent keeps working while it runs. That is useful for long test runs and wide searches. It also means work is happening that no terminal is showing you.

Claude Code writes each subagent's transcript to `<session>/subagents/agent-<id>.jsonl`. SwarmCorp reads that folder every few seconds, so background runs appear on the map with their latest tool call as the title, even if they started before the dashboard was open. If your laptop is busy and no pane looks busy, check the map.

## Close what is idle

An idle session still holds its process and its MCP servers. A tester that finished an hour ago and is waiting for mail is still running.

Two habits help:

- **Close panes for roles you don't need today.** If the epic has no security surface, you may not need a standing auditor. Launch one as a subagent when a review is due.
- **Turn off auto-wake on panes you want to stay quiet.** SwarmCorp types a short "check your inbox" prompt into an idle pane when mail arrives for it. That keeps work moving. It also means an idle pane can start burning tokens again. The clock button on each pane turns it off.

Closing a pane loses little. The work is in the branch, the plan file and the mailbox, and `claude --resume` brings back the conversation if you need it.

## Keep MCP servers project-scoped

A server you add at user scope starts in every session on the machine, in every project. If you added a browser automation server for one project last month, all six of today's sessions are running a copy.

Add servers where they are used:

```bash
claude mcp add --scope project playwright -- npx @playwright/mcp@latest
```

Project scope writes the server to `.mcp.json` in the repository, so it starts only for sessions in that project, and teammates get the same config. Run `/mcp` inside a session to see what it loaded. If the list surprises you, that is your memory leak.

## Cap concurrency on purpose

SwarmCorp has two settings in `swarmcorp.config.json` that matter here:

```json
{
  "maxPanes": 12,
  "capacity": 12
}
```

`maxPanes` is a hard limit. The hub refuses to open a terminal past it. Set it to the number of sessions your machine handles well, and you can't open one more by accident.

`capacity` is not a limit. It sets the scale of the concurrency gauge, so you can see how close you are to the number you decided on. The gauge also marks your peak, which is the number worth watching. If the peak is 9 and the work still finished at the same pace on days it was 4, you have your answer.

## A layout that fits

A starting point for a 16 GB laptop:

- One CEO pane and two implementer panes, each on its own branch and worktree.
- Researcher, tester and auditor as subagents, spawned when there is work for them.
- MCP servers at project scope only.
- `maxPanes` set to 4, so there is room for one scratch terminal.

Three long-lived processes instead of six. The same roles, the same queue, the same STATUS lines on the map.

The model does the thinking somewhere else. Your laptop only has to keep the lights on.
