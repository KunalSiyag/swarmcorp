---
title: "A file queue, not a giant context"
description: "Why SwarmCorp agents talk through small JSON files instead of sharing one prompt: smaller contexts, atomic claims, a STATUS line on every turn, and feedback that goes straight back to the owner."
date: 2026-10-16
tag: Engineering
readingTime: "5 min"
---

The first version of most multi-agent setups is one long conversation. The planner writes a plan, the implementer reads the plan and the planner's reasoning, the tester reads all of that plus the diff. By the third hand-off, every agent is carrying every other agent's context.

That costs you twice. You pay for the tokens every turn. And the agent doing the work is reading a transcript of someone else's thinking when it needs a two-paragraph brief.

SwarmCorp agents don't share context. They send each other small files.

## One message, one file

A message is a JSON file. It goes into the recipient's inbox, and an identical copy goes into the sender's outbox:

```
.claude/swarm-inbox/sonnet-implementer/20261016T101500123Z__opus-researcher__a3f9c1.json
.claude/swarm-outbox/opus-researcher/20261016T101500123Z__opus-researcher__a3f9c1.json
```

The file is short on purpose:

```json
{
  "id": "a3f9c1",
  "from": "opus-researcher",
  "to": "sonnet-implementer",
  "kind": "spec",
  "subject": "S1-T1 micro-spec ready",
  "body": "Add tenant_id to invoices. Spec has the migration and the three call sites.",
  "refs": { "task_id": "S1-T1", "files": [".claude/docs/spec-S1-T1.md"], "branch": null },
  "priority": "normal",
  "reply_to": null,
  "created_at": "2026-10-16T10:15:00.123Z"
}
```

The body stays under about 1,500 characters. Anything longer goes into `.claude/docs/` and the message points to it. The implementer reads the spec, not the researcher's afternoon.

Nobody writes these files by hand. A small CLI ships with SwarmCorp:

```bash
M="node $HOME/.claude/swarmcorp/swarm-mail.mjs"
$M send --from opus-researcher --to sonnet-implementer --kind spec --task S1-T1 \
        --subject "S1-T1 micro-spec ready" --body "Implement per spec." \
        --files .claude/docs/spec-S1-T1.md
```

`send` writes each copy to a temporary file and renames it into place, so a reader never sees half a message.

## Claiming is a rename

Two implementers can listen on the same role queue. A message addressed to `sonnet-implementer` goes to the shared box, and whichever instance gets there first does the work. That needs a lock.

The lock is `rename(2)`:

```js
const dest = path.join(box, '.processing', `${me}__${base}`);
fs.renameSync(abs, dest); // atomic: exactly one claimant wins
```

On one filesystem, rename is atomic. If two instances try to claim the same file at the same moment, one rename succeeds and the other gets `ENOENT`. The loser is told the message was already claimed and moves on. No lock server, no database, no retry loop.

```bash
$M claim .claude/swarm-inbox/sonnet-implementer/20261016T101500123Z__opus-researcher__a3f9c1.json \
     --me sonnet-implementer-2
$M done  <same file> --me sonnet-implementer-2   # moves it to .done/
```

The folder layout tells you the state of every message at a glance: unread in the box, claimed in `.processing/` with the claimant's name in front, finished in `.done/`.

## Every turn ends with a STATUS line

A queue only works if you can tell when work is finished and whether it worked. Every SwarmCorp agent ends its final message with exactly one line:

```
STATUS: PASS — S1-T1 migration and call sites done, tests green
STATUS: FAIL — invoices.test.ts: 2 failures in tenant scoping
STATUS: BLOCKED — needs a decision on backfilling old invoices, from the CEO
```

The dashboard parses the last `STATUS:` line in an agent's reply and badges the node with the result. PASS draws a Result edge back to whoever asked. FAIL draws a Feedback Loop edge. The rule is in the constitution that `npm run install-claude` adds to `~/.claude/CLAUDE.md`, and each agent profile repeats it.

Three words is enough for a person scanning the map. The summary after the dash is enough for the next agent to decide what to do.

## Feedback goes straight back

The usual flow is CEO, researcher, implementer, tester, auditor, then back to the CEO to merge. Failures don't go back up that chain. The tester sends a `feedback` message straight to the implementer that owns the task:

```bash
$M send --from haiku-tester --to sonnet-implementer-2 --kind feedback --task S1-T1 \
        --subject "S1-T1: 2 failing tests" \
        --body "npm test -- invoices: tenant filter missing in listInvoices(). Repro in refs." \
        --priority urgent
```

The implementer fixes it and sends a new `review`. The loop runs until the tester passes it, and the CEO's context never sees the back-and-forth. On the map, each round shows up as a Feedback Loop pulse between two nodes.

## Waking an idle agent

Files don't ring a bell. Two things make sure mail gets read.

First, the hooks. On `SessionStart` and `UserPromptSubmit`, the hook relay adds a summary of unread mail to the agent's context. On `Stop`, if mail is waiting, it asks the agent once to process it before stopping.

Second, auto-wake. When mail arrives for a pane that is idle, the hub types a one-line "check your inbox" prompt into that terminal. Control characters are stripped from the text first, so a message subject can't inject keystrokes. You can turn auto-wake off per pane.

## What you give up

A file queue is not free.

Messages are only as good as the brief. If the researcher writes "see above", there is no above. The constitution asks for self-contained bodies. Nothing enforces it.

The queue is local. It lives in the project's `.claude/` folder on one machine. Git worktrees share it, because the CLI resolves the main checkout, but two laptops don't.

And there is no delivery guarantee beyond the filesystem. If an agent claims a message and its session dies, the message sits in `.processing/` until someone moves it back.

In exchange, every conversation between agents is a folder you can `ls`, and every context stays small enough to be worth paying for.
