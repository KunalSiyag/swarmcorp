---
title: "Dispatch queue"
description: "The file-based mailbox SwarmCorp agents use to hand work to each other: message format, the swarm-mail CLI, claiming, auto-wake and the STATUS contract."
date: 2026-10-16
tag: Docs
readingTime: "5 min"
---

SwarmCorp agents don't share a context. They hand work to each other as small JSON files in the project's `.claude/` folder. Each session keeps only what it needs, and every hand-off is a file you can open.

## Layout

All paths are relative to the project root.

```
.claude/swarm-inbox/<recipient>/<timestamp>__<from>__<id>.json           unread
.claude/swarm-inbox/<recipient>/.processing/<claimant>__<file>.json      claimed
.claude/swarm-inbox/<recipient>/.done/<file>.json                        finished
.claude/swarm-outbox/<sender>/<file>.json                                sent copies
```

A recipient can be a role (`sonnet-implementer`) or one instance (`sonnet-implementer-2`). Mail sent to a role goes to a shared box, and the first instance to claim a message does the work.

Addresses may only contain letters, digits, `.`, `_` and `-`, so a name can't point outside the queue folder.

Inside a git worktree, the CLI finds the queue in the main checkout, so every worktree shares one queue. You can also set `SWARM_PROJECT` to the project root. Panes launched from the dashboard have it set.

## Message format

```json
{
  "id": "a3f9c1",
  "from": "opus-researcher",
  "to": "sonnet-implementer",
  "kind": "spec",
  "subject": "S1-T1 micro-spec ready",
  "body": "Implement per spec. Migration first, then the three call sites.",
  "refs": {
    "task_id": "S1-T1",
    "files": [".claude/docs/spec-S1-T1.md"],
    "branch": null
  },
  "priority": "normal",
  "reply_to": null,
  "created_at": "2026-10-16T10:15:00.123Z"
}
```

| Field | Values |
|---|---|
| `kind` | `task`, `spec`, `review`, `feedback`, `permission`, `question`, `answer`, `status` |
| `priority` | `low`, `normal`, `urgent`. The inbox lists urgent mail first. |
| `subject` | Up to 200 characters. |
| `body` | Keep it under about 1,500 characters. Put longer material in `.claude/docs/` and list it in `refs.files`. |
| `reply_to` | The `id` of the message this answers, or `null`. |

On the map, each kind becomes a pulse between the sender and recipient:

| Kind | Pulse label |
|---|---|
| `task` | Task |
| `spec` | Spec |
| `review` | Code review |
| `feedback` | Feedback Loop |
| `permission` | Permission request |
| `status` | Result |
| `question`, `answer` | Message |

## CLI

The installer puts the CLI at `~/.claude/swarmcorp/swarm-mail.mjs`.

```bash
M="node $HOME/.claude/swarmcorp/swarm-mail.mjs"
```

**Send**

```bash
$M send --from opus-researcher --to sonnet-implementer --kind spec --task S1-T1 \
        --subject "S1-T1 micro-spec ready" --body "Implement per spec." \
        --files .claude/docs/spec-S1-T1.md
```

Other options: `--body-file <path>`, `--branch <name>`, `--priority low|normal|urgent`, `--reply-to <id>`, `--project <dir>`.

`send` writes the inbox file and the outbox copy. Each is written to a temporary file first and renamed into place, so a reader never sees a partial message.

**List unread mail**

```bash
$M inbox --me sonnet-implementer-2 --role sonnet-implementer
$M inbox --me sonnet-implementer-2 --role sonnet-implementer --json
```

This lists mail addressed to the instance and to its role, urgent first.

**Claim**

```bash
$M claim .claude/swarm-inbox/sonnet-implementer/20261016T101500123Z__opus-researcher__a3f9c1.json \
     --me sonnet-implementer-2
```

Claiming renames the file into `.processing/`, prefixed with your id. Rename is atomic on one filesystem. If two instances claim the same message at the same moment, exactly one succeeds. The other gets `already claimed by another employee (or done)` and should move on.

**Finish**

```bash
$M done <file> --me sonnet-implementer-2
```

This moves the message to `.done/`. It accepts either the original inbox path or the `.processing/` path that `claim` printed.

Always pass `--from` and `--me`. Subagents inherit their parent session's environment, so `SWARM_AGENT_ID` can name the wrong agent.

## Processing rules

These are in the constitution that `npm run install-claude` adds to `~/.claude/CLAUDE.md`.

1. **Check the inbox** at the start of every turn and before stopping. The hooks add unread mail to the agent's context on its own.
2. **Claim before acting**, and work on one task-type message at a time. If the claim fails, someone else has it.
3. **Reply** with `kind: status` or `kind: answer`, set `reply_to` to the original id, and mark the original `done`.
4. **Escalate** anything that needs a human decision, such as deleting data, force-pushing, rotating credentials or spending money, as a `permission` message to `ceo-dispatcher`. The CEO relays it to you.
5. **Don't busy-wait.** With nothing in the inbox and no task, say `IDLE — inbox empty` and stop.

## The STATUS contract

Every agent ends its final message with exactly one line:

```
STATUS: PASS — <one-line summary>
STATUS: FAIL — <what failed, where>
STATUS: BLOCKED — <what is needed, from whom>
```

The dashboard reads the last `STATUS:` line in the reply. The node shows the result, and the run's title becomes the summary. PASS sends a Result pulse back to the requester. FAIL sends a Feedback Loop pulse.

## The loop

Work normally moves CEO → researcher → implementer → tester → auditor → CEO, who merges.

Failures go backwards as `feedback`, straight to the implementer that owns the task. The tester and auditor don't route defects through the CEO. The implementer fixes the work and sends a new `review`, and the loop runs until QA and audit both pass.

## Auto-wake

A file doesn't notify anyone. When the hub sees new mail for a box, it looks for an idle dashboard pane for that instance or role with auto-wake on. It prefers the exact instance. It types one line into that terminal:

```
You have new SwarmCorp mail (spec from opus-researcher: "S1-T1 micro-spec ready"). Check your inbox, claim it, and process it per the constitution.
```

Control characters are stripped from the text first, so a subject line can't send keystrokes. Each pane is woken at most once every 8 seconds. Turn auto-wake off per pane with the clock button, or for all new panes with `"autoWake": false` in `swarmcorp.config.json`.

Sessions in your own terminal are never typed into. They see unread mail through the hooks on their next prompt.

## Limits

- The queue is local to one machine and one project folder.
- A message claimed by a session that then dies stays in `.processing/`. Move it back to the inbox by hand, removing the `<claimant>__` prefix from the file name.
- Nothing checks that a body is self-contained. A message that says "see above" has no above.
