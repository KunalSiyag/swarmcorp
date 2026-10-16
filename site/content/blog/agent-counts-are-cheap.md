---
title: "Agent counts are cheap. Run logs aren't."
description: "A post says 400 agents shipped a product overnight. Here is how to check a claim like that, and what SwarmCorp writes down so your own numbers hold up."
date: 2026-10-14
tag: Essay
readingTime: "5 min"
---

A screenshot goes around on a Tuesday. A terminal, a dark theme, a counter in the corner that reads **650 agents**. The caption says the swarm rebuilt a SaaS product overnight. A reply says they run 400 agents around the clock and spend $17,000 a month doing it. Both posts get thousands of reposts.

Neither post links a run log.

That is the whole problem. A number of agents is a number anyone can type. A run log is a record that something happened, in an order, at a cost. One of these is cheap.

## Why the count tells you nothing

"Agent" has no fixed unit. A subagent that reads three files and returns a summary is an agent. So is a session that runs for six hours, writes a migration, and gets it reviewed. Count the first kind and you can reach 650 before lunch. Most of them will have done close to nothing.

The monthly bill doesn't settle it either. $17,000 tells you tokens were spent. It doesn't tell you on what. A loop that re-reads the same repository forty times costs real money and ships nothing.

So when you see a big number, don't argue with it. Ask for the three things that would back it up.

## Three things to ask for

**1. The run log.** Which agent started, when, on whose instruction, and what it returned. A real swarm leaves a trail: a task goes out, work comes back, a review fails, a fix goes out again. If the trail is missing, the work may still have happened. You have no way to tell.

**2. The token bill, broken down.** Not the total. Tokens per session, per subagent run, split into input, output, cache read and cache write. A swarm that does useful work has an uneven bill: a few expensive planning and review runs, many cheap ones. A flat, enormous number usually means something looped.

**3. One transcript, end to end.** Pick any single agent and read what it did. Claude Code writes every session to a JSONL transcript under `~/.claude/projects/`. If someone ran 400 agents, they have 400 transcripts. Ask to see one.

Anyone with a real result can produce all three in a few minutes. Anyone without one will tell you the screenshot speaks for itself.

## What SwarmCorp records

We built SwarmCorp because we wanted to apply the same test to our own runs. It is a dashboard that runs on your machine at `http://localhost:4317`. It has no account, and nothing leaves the machine. Every number it shows traces back to an event you can find on disk or in a hook payload.

Here is where each number comes from.

**Sessions and subagents** come from Claude Code hooks. `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop` and the rest run a small relay that posts the event to the local hub. Each subagent run becomes its own node on the map. If you delegate to the tester twice, you see two runs, not one node with a vague status.

**Background agents** that started before the dashboard was open are found on disk. Claude Code writes `<session>/subagents/agent-<id>.jsonl` and a `.meta.json` next to it. SwarmCorp reads those, so an agent doesn't go missing because you opened the browser late.

**Tokens** come from the transcripts, not from a guess. Claude Code writes one transcript line per content block, and the lines of one API response repeat the same usage figures. SwarmCorp counts each API message once, keyed by message id. It counts only usage recorded after the hub started, so a long session's history doesn't inflate today's number.

**Results** come from a line every agent writes at the end of its turn:

```
STATUS: PASS — S2-T3 webhook retries merged behind a flag
```

The dashboard parses `PASS`, `FAIL` or `BLOCKED` and draws a Result or Feedback Loop edge back to whoever asked. A failure is a visible edge on the map, not a sentence buried in a terminal.

**Messages between agents** are files. Each one is a JSON file in `.claude/swarm-inbox/<recipient>/`, with a copy in `.claude/swarm-outbox/<sender>/`. You can `ls` the conversation. You can `git diff` the plan in `.claude/swarm-plan.json`.

## What it doesn't do

Some limits, stated plainly.

SwarmCorp counts tokens. It does not convert them to dollars, because the price depends on your plan and model mix, and we would rather show a number we can trace than one we estimated.

The feed lives in memory. Restart the hub and the history starts fresh. It rediscovers sessions and background agents that are still active from their transcripts on disk, but finished runs from before the restart are gone from the map. You can export a Markdown receipt of the current run and attach it to a pull request. SwarmCorp Pro keeps a run history and a receipt archive that survive restarts, so you can compare this week's run with last week's.

And it only sees what Claude Code reports. If an agent runs somewhere without the hooks installed, it isn't on the map.

## The test, applied to us

Our own default fleet is six sessions: a CEO, a researcher, two implementers, a tester and an auditor. That is a small number. It isn't meant to impress anyone.

What a run of it can show is the trail. If the CEO writes a plan with nine tasks, there are nine tasks in `.claude/swarm-plan.json`, and the progress bar counts the same nine. If an implementer's work fails QA twice, there are two `feedback` files in its inbox, each saying why. If the auditor stops a merge, there is a `STATUS: BLOCKED` line in its transcript, and its node on the map reads Last: BLOCKED. Every step is a file or a transcript line, and the token count on each run node comes from that run's own transcript.

That is the standard we would ask of anyone posting a big number, including us.

Agent counts are cheap. Run logs aren't.
