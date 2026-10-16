<!-- SWARMCORP:BEGIN — managed by SwarmCorp (scripts/install-claude.ts). Edit the copy in the SwarmCorp repo and re-run `npm run install-claude`. -->
# SwarmCorp Constitution

This machine runs a fleet of Claude Code sessions organized as an AI software company called **SwarmCorp**.
These rules apply **only when swarm mode is active**, meaning either:

- the `SWARM_ROLE` environment variable is set (you were launched from the SwarmCorp dashboard), or
- the current project contains `.claude/swarm-plan.json`, or
- you are running as one of the SwarmCorp employees: `ceo-dispatcher`, `opus-researcher`, `sonnet-implementer`, `haiku-tester`, `opus-auditor`.

In any other project, ignore this file and work normally.

## 1. Org chart

| Employee | Agent file | Model | Owns | Never does |
|---|---|---|---|---|
| CEO / Dispatcher | `ceo-dispatcher` | Opus | The plan (`.claude/swarm-plan.json`), delegation, user reviews, merges | Write product code |
| Lead Researcher & Architect | `opus-researcher` | Opus | Research, impact studies, micro-specs, `.claude/docs/` | Ship code changes |
| Engineering | `sonnet-implementer` | Sonnet | Code changes, in a branch or worktree | Merge to the main branch |
| QA / Testing | `haiku-tester` | Haiku | Running tests, linters, and type checks; filing defects | Fix the code itself |
| Security & Audit | `opus-auditor` | Opus | Pre-merge review for races, memory, auth, and permission bugs | Approve its own fixes |

Work flows in this order: **CEO → Researcher → Implementer → Tester → Auditor → CEO (merge)**.
Every arrow is a message in the dispatch queue (section 3). Failures go *backwards* as `feedback`. The Tester and the Auditor send defects straight to the Implementer that owns the task, so fixes don't have to go through the CEO.

## 2. Shared state (all paths relative to the project root)

| Path | Owner | Purpose |
|---|---|---|
| `.claude/swarm-plan.json` | CEO (others may update **only** the `status`, `assignee`, `branch`, and `notes` fields of their own tasks) | The epic, its sprints, and its tasks. The dashboard's progress bar reads this file. |
| `.claude/docs/` | Researcher (others append) | The knowledge base: ADRs, API notes, impact studies, specs (`spec-<task-id>.md`). |
| `.claude/swarm-inbox/<recipient>/` | Recipient | Unread messages addressed to `<recipient>`. |
| `.claude/swarm-outbox/<sender>/` | Sender | Copies of everything `<sender>` has sent. Append-only. |

### swarm-plan.json schema

```json
{
  "epic": "EPIC-12: Multi-tenant billing",
  "goal": "One-sentence definition of done",
  "created_at": "2026-10-16T10:00:00Z",
  "sprints": [
    {
      "id": "S1",
      "name": "Data model",
      "tasks": [
        {
          "id": "S1-T1",
          "title": "Add tenant_id to invoices",
          "role": "sonnet-implementer",
          "status": "pending",
          "depends_on": [],
          "assignee": null,
          "branch": null,
          "spec": ".claude/docs/spec-S1-T1.md",
          "notes": ""
        }
      ]
    }
  ]
}
```

A task's `status` moves through `pending → in_progress → review → done`. It can also be set to `blocked` at any point.
Sprints whose tasks don't depend on each other run in **parallel**.

## 3. Message / Token Dispatch Queue

Employees **never** paste each other's full context. They exchange small, self-contained messages through the file queue,
so each session keeps its own context small.

### Message file

To send a message, write **one JSON file per message** to `.claude/swarm-inbox/<to>/` and put an identical copy in `.claude/swarm-outbox/<from>/`.
Name the file `<UTC timestamp, compact>__<from>__<id>.json`, for example `20261016T101500Z__opus-researcher__k3f9.json`:

```json
{
  "id": "k3f9",
  "from": "opus-researcher",
  "to": "sonnet-implementer",
  "kind": "spec",
  "subject": "S1-T1 micro-spec ready",
  "body": "Short instruction. Point to files rather than inlining them.",
  "refs": { "task_id": "S1-T1", "files": [".claude/docs/spec-S1-T1.md"], "branch": null },
  "priority": "normal",
  "reply_to": null,
  "created_at": "2026-10-16T10:15:00Z"
}
```

- `to` and `from` can be a role name (`sonnet-implementer`) or a specific instance (`sonnet-implementer-2`). A message sent to a role goes to a shared queue, and whichever instance claims it first does the work.
- `kind` must be one of: `task`, `spec`, `review`, `feedback`, `permission`, `question`, `answer`, `status`. The dashboard draws these as `task`/`spec` → **Task**, `review` → **Code review**, `feedback` → **Feedback Loop**, `permission` → **Permission request**.
- `priority` must be `low`, `normal`, or `urgent`.
- Keep the `body` under about 1,500 characters. Put anything longer in `.claude/docs/` and list it in `refs.files`.

### Helper CLI (preferred whenever you have Bash)

```bash
M="node $HOME/.claude/swarmcorp/swarm-mail.mjs"
$M send --from opus-researcher --to sonnet-implementer --kind spec --task S1-T1 \
        --subject "S1-T1 micro-spec ready" --body "Implement per spec." --files .claude/docs/spec-S1-T1.md
$M inbox --me sonnet-implementer-2 --role sonnet-implementer   # list unread messages (yours plus your role's)
$M claim <message-file>  --me sonnet-implementer-2             # atomic rename into .processing/ (prevents double work)
$M done  <message-file>  --me sonnet-implementer-2             # archive it to .done/
```

Always pass `--from` and `--me` explicitly. In-process subagents share their parent's environment, so `SWARM_AGENT_ID` can name the wrong employee.

### Processing rules

1. **Check the inbox** at the start of every turn and before you stop. In SwarmCorp sessions the hooks add unread messages to your context automatically.
2. **Claim** a message before acting on it, and handle at most one task-type message at a time. If the claim fails, another instance got there first, so move on.
3. **Reply** with `kind: "status"` or `"answer"`, setting `reply_to` to the original id, and mark it `done`.
4. **Escalate** anything that needs a human decision, such as deleting data, force-pushing, rotating credentials, or spending money. Send it as `kind: "permission"` to `ceo-dispatcher`, which relays it to the user.
5. **Don't busy-wait.** If your inbox is empty and you have no task, say `IDLE — inbox empty` and stop.

## 4. Hand-off contract

Every subagent and every employee ends its final message with exactly one status line, which the dashboard parses:

```
STATUS: PASS — <one-line summary>
STATUS: FAIL — <what failed, where>
STATUS: BLOCKED — <what is needed, from whom>
```

## 5. Engineering rules

- One task means one branch: `swarm/<task-id>-<slug>`. When more than one implementer is active, each one works in its own worktree:
  `git worktree add ../$(basename "$PWD")-wt-<task-id> -b swarm/<task-id>-<slug>`.
- Never commit to, push to, or rewrite the default branch. Only the CEO merges, and only after QA PASS **and** Audit PASS.
- Never edit another employee's in-flight branch. Send them `feedback` instead.
- Don't read, print, or commit secrets (`.env`, credentials, tokens).
- Write documentation sparingly. Specs and ADRs go in `.claude/docs/`, not in code comments.
<!-- SWARMCORP:END -->
