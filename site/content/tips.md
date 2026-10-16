---
title: "Workflow tips"
description: "Twelve habits for running a fleet of Claude Code agents: parallel delegation, short briefs, one branch per task, STATUS lines, scoped MCP servers and more."
date: 2026-10-16
tag: Tips
readingTime: "6 min"
---

Twelve habits for working with more than one Claude Code agent at a time. Each one works without SwarmCorp. Where SwarmCorp shows you something extra, we say so.

## 1. Delegate independent tasks in one message

**Ask for parallel work in a single turn.** When Claude Code makes several Agent tool calls in one response, the subagents run at the same time. Ask for them one after another and they run one after another. Say it outright: "Research these three libraries in parallel, one subagent each."

## 2. Give subagents a brief, not your context

**A subagent starts with an empty context and the prompt it was given.** It doesn't see your conversation. Write the prompt like a ticket for someone who joined the team today: the goal, the files that matter, what done looks like, and what to return. A subagent that has to guess will read half the repository to find out.

## 3. One task, one branch, one worktree

**Never let two agents edit the same checkout.** Give each task its own branch, and give each parallel implementer its own worktree:

```bash
git worktree add ../my-app-wt-S1-T2 -b swarm/S1-T2-tenant-filter
```

Two agents in one working tree will overwrite each other's edits and run each other's half-finished tests. SwarmCorp's dispatch queue resolves the main checkout from inside a worktree, so mail still reaches every agent.

## 4. End every agent turn with a STATUS line

**Make the result machine-readable.** Put this in your agent instructions and ask for it on every final message:

```
STATUS: PASS — <one-line summary>
STATUS: FAIL — <what failed, where>
STATUS: BLOCKED — <what is needed, from whom>
```

You can scan a dozen of these in seconds. SwarmCorp parses them and draws a Result or Feedback Loop edge on the map.

## 5. Pin a model to each role

**Use the agent file's front matter to choose the model.** A tester running lint and tests doesn't need the model you use for architecture review:

```yaml
---
name: haiku-tester
model: haiku
tools: Read, Glob, Grep, Bash
---
```

SwarmCorp's five profiles use Opus for the CEO, researcher and auditor, Sonnet for implementers and Haiku for QA.

## 6. Give each role only the tools it needs

**List tools in the `tools:` field.** A tester without `Edit` or `Write` can't quietly fix the code it is meant to report on. An auditor without `Write` can't approve its own patch. The restriction does more than a sentence in the prompt asking the agent not to.

## 7. Start role sessions with `--agent`

**Launch a long-running role as its own session:**

```bash
claude --agent ceo-dispatcher
```

The session runs with that agent's prompt, model and tools from the first turn. Agent files live in `~/.claude/agents/` for every project or `.claude/agents/` for one. To check which agents a session found, ask Claude to list them, or look in those two folders. In recent versions, `/agents` prints a reminder rather than opening a manager.

## 8. Keep MCP servers project-scoped

**Add servers to the project that uses them:**

```bash
claude mcp add --scope project <name> -- <command>
```

A server at user scope starts in every session on your machine. Six sessions means six copies. Project scope writes `.mcp.json` in the repository, so the server only starts where it is needed. Run `/mcp` to see what a session loaded.

## 9. Watch the context meter, compact before it fills

**Check `/context` on long sessions.** It shows how much of the window is in use and what is taking it. When a long-running role gets past the halfway mark, run `/compact` with a focus, such as `/compact keep the S2 plan and open defects`. A compaction you steer keeps what matters. One that happens automatically at the limit decides for you.

## 10. Pick up where you left off with `--resume`

**Closing a session doesn't lose the conversation.**

```bash
claude --continue          # most recent session in this directory
claude --resume            # choose from a list
claude --resume <id>       # a specific session
```

Close idle panes without worrying. The transcript is on disk under `~/.claude/projects/`, and you can resume it tomorrow.

## 11. Reload hooks after changing them

**Running sessions don't pick up new hook settings on their own.** After you edit hooks in `~/.claude/settings.json`, or run `npm run install-claude`, restart the sessions or open `/hooks` in each one. If a session never appears on the SwarmCorp map, this is the first thing to check.

## 12. Read the run log before you merge

**Check what happened, not only the final diff.** Before merging an agent's branch, open the tester's and auditor's STATUS lines, any `feedback` messages in the implementer's inbox, and the transcript of the run that wrote the code. A green test run tells you the tests pass. The log tells you whether a test was deleted to get there. In SwarmCorp, click a node to see its last result, its pass and fail counts and its token total, and read the live feed for every `TASK COMPLETE` line. Then click **Receipt** and paste the Markdown into the pull request, so the reviewer sees every agent, duration, token count and result.
