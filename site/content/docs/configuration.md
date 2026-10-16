---
title: "Configuration"
description: "Every key in swarmcorp.config.json, its default, and the command-line flags and environment variables that override it."
date: 2026-10-16
tag: Docs
readingTime: "3 min"
---

SwarmCorp reads `swarmcorp.config.json` from the root of the SwarmCorp folder when the hub starts. The file is optional. Any key you leave out uses its default. Restart the hub after editing it.

## Example

```json
{
  "port": 4317,
  "host": "127.0.0.1",
  "project": null,
  "capacity": 12,
  "maxPanes": 12,
  "autoWake": true,
  "claudeCommand": "claude",
  "claudeArgs": [],
  "fleet": [
    { "role": "ceo-dispatcher", "agentId": "ceo-dispatcher" },
    { "role": "opus-researcher", "agentId": "opus-researcher" },
    { "role": "sonnet-implementer", "agentId": "sonnet-implementer-1" },
    { "role": "sonnet-implementer", "agentId": "sonnet-implementer-2" },
    { "role": "haiku-tester", "agentId": "haiku-tester" },
    { "role": "opus-auditor", "agentId": "opus-auditor" }
  ]
}
```

## Keys

| Key | Default | What it does |
|---|---|---|
| `port` | `4317` | Port the hub listens on. If you change it, run `npm run install-claude -- --port <port>` so the hooks follow. |
| `host` | `"127.0.0.1"` | Address the hub binds to. Leave it on loopback. The hub can start shells, and requests are only accepted with a localhost `Host` header in any case. |
| `project` | `null` | The default project directory. `null` means the folder you ran `npm start` from. `~` is expanded. |
| `capacity` | `12` | The scale of the concurrency gauge. It is not a limit: it sets what counts as full on the dial. |
| `maxPanes` | `12` | The most terminals the dashboard will run at once. Past this, launching a pane fails with `pane limit reached`. Exited panes don't count. |
| `autoWake` | `true` | Whether new panes start with auto-wake on. Auto-wake types a short "check your inbox" prompt into an idle pane when mail arrives for it. Each pane can still be toggled from the dashboard. |
| `claudeCommand` | `"claude"` | The command panes run. Set a full path if `claude` isn't on the hub's `PATH`. |
| `claudeArgs` | `[]` | Extra arguments added to every Claude pane, after `--agent <role>`. For example `["--permission-mode", "acceptEdits"]`. |
| `devOrigins` | `["http://localhost:5173", "http://127.0.0.1:5173"]` | Extra browser origins allowed to call the hub. Used by `npm run dev`, where the client is served by Vite. |
| `fleet` | six members, as above | Who starts when you choose **▶ Fleet** or run `npm run fleet`. |

### `fleet` entries

| Field | Required | What it does |
|---|---|---|
| `role` | yes | The agent profile to run, as in `claude --agent <role>`. Use `claude` for a plain session or `shell` for your login shell. |
| `agentId` | no | The instance id, used as the queue address and in the pane label. Defaults to the role. Give each instance of the same role a different id, such as `sonnet-implementer-1` and `sonnet-implementer-2`. |
| `cwd` | no | Working directory for this member. Defaults to the project. |

**▶ Fleet** skips any member whose `agentId` already has a running pane, so pressing it twice doesn't double your fleet.

The `fleet` array replaces the default list. It isn't merged with it. To add a third implementer, copy the whole list and add the entry.

## Overrides

Command-line flags and environment variables take precedence over the file.

| Setting | Flag | Environment variable | Order, highest first |
|---|---|---|---|
| Port | `--port <n>` | `SWARMCORP_PORT` | variable, flag, file |
| Project | `--project <dir>` | `SWARM_PROJECT` | flag, variable, file |

```bash
npm start -- --project ~/code/my-app --port 4400
npm run fleet -- --project ~/code/my-app        # start the hub and launch the fleet
```

## Environment set on each pane

Panes launched from the dashboard get these variables. The hook relay and the queue CLI read them.

| Variable | Value |
|---|---|
| `SWARM_ROLE` | The pane's role. Empty for `shell`. |
| `SWARM_AGENT_ID` | The pane's instance id. |
| `SWARM_PANE_ID` | The pane's id, used to link the pane to its node on the map. |
| `SWARM_PROJECT` | The project root, so the queue resolves to the right folder. |
| `SWARMCORP_URL` | The hub's address. |

## Related settings outside this file

- `env.SWARMCORP_URL` in `~/.claude/settings.json` tells hooks in sessions started outside the dashboard where to post. `npm run install-claude -- --port <port>` sets it.
- MCP servers, permission rules and models are Claude Code settings. Configure them in Claude Code, or in each agent's front matter in `~/.claude/agents/`.
