---
title: "Troubleshooting"
description: "Fixes for the problems people hit most: panes stuck on Starting, read-only mirror panes, missing background agents, hooks not firing, a busy port and an empty map."
date: 2026-10-16
tag: Docs
readingTime: "4 min"
---

## A pane says Starting and nothing happens

**Cause:** No hook event has reached the hub from that session yet. The usual reason is Claude Code's folder trust prompt: the first time it opens a project folder, it asks whether you trust the files in it, and the session doesn't start properly until you answer. In our testing, panes stayed on Starting until the prompt was answered and the session restarted.

**Fix:** Click into the pane and answer the prompt. With **▶ Fleet**, each of the six panes asks once. After that the folder is trusted and new panes start without asking.

If you don't answer, the pane switches to Done · Idle after about 20 seconds, because the terminal is up even though no hook has arrived. The trust prompt is still waiting inside it.

## A session I started in my own terminal shows up as read-only

**This is expected.** SwarmCorp finds sessions running in the dashboard's project, including ones it didn't launch, and shows each one as a mirror pane. The mirror is rendered from the session's transcript: your prompts, Claude's replies and each tool call.

You can't type into a mirror or resize it, because the dashboard doesn't own that terminal. Type in your own terminal. To control a session from the dashboard, start it there with **+ Terminal**.

Mirror panes don't get auto-wake. Those sessions see new mail through the hooks on their next prompt.

## A background agent was running before I opened the dashboard

**It will appear within a few seconds.** Claude Code writes each subagent's transcript to `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`, with an `agent-<id>.meta.json` beside it. The hub scans these every two seconds and adds a run node for each agent whose transcript changed since about ten minutes before the hub started.

The parent session is found the same way, from `~/.claude/projects/<project>/<session>.jsonl`, if it or one of its subagents wrote to its transcript in the last five minutes.

If the agent finished while the hub was down, the hub marks it complete from the end of its transcript.

Two things this can't recover:

- **Tokens from before the hub started.** Usage is only counted from hub start, so the Tokens tile won't include work done earlier.
- **Sessions idle for more than five minutes.** They appear on the map with their next hook event, such as the next prompt.

## Hooks aren't firing

Symptoms: a session runs, but its node never appears or never changes.

1. **Restart the session**, or run `/hooks` inside it. Claude Code loads hooks when a session starts, so sessions that were open during `npm run install-claude` don't have them.
2. **Check the install.** Open `~/.claude/settings.json` and look for entries containing `swarmcorp/swarm-hook.mjs`. If they are missing, run `npm run install-claude` again.
3. **Check the port.** `env.SWARMCORP_URL` in `settings.json` must match the hub's port. If you moved the hub, run `npm run install-claude -- --port <port>`.
4. **Check the hub.** Run `swarmcorp status`, then open `<address>/api/health`. It returns `{"ok":true, ...}` with the port and project.
5. **Check the relay by hand:**

   ```bash
   echo '{"session_id":"test","cwd":"'"$PWD"'"}' | node ~/.claude/swarmcorp/swarm-hook.mjs SessionStart
   ```

   A test node should appear on the map. If you ran it outside the dashboard's project, turn "This project" off to see it. Choose **Reset** afterwards to clear it.

The relay exits 0 even when it can't reach the hub, so a failed post never shows as an error in Claude Code.

## The dashboard isn't on 4317

That's expected on some machines. If another program is already using port 4317, the hub moves to the next free port (4318, 4319, and so on) and says so when it starts. It writes the address it chose to `~/.config/swarmcorp/hub.json`, and the hook relay and the opencode plugin read that file, so telemetry follows the hub automatically.

To find or open the dashboard:

```bash
swarmcorp status   # prints the address, project and pid
swarmcorp open     # opens it in your browser
```

If the program on 4317 is an older SwarmCorp hub, the new one says "already running" and exits. Use `swarmcorp open` to reach the running one.

## Nothing shows on the map

1. **Check the "This project" filter.** The **▣ This project** button on the map is on by default. It hides sessions whose working directory resolves to a different project than the dashboard's. If your session runs in another folder, turn the filter off, or restart the hub with `--project` pointing at that folder.
2. **Check the project path.** The hub prints its default project on start. Compare it with the folder your session runs in.
3. **Check the Reset button.** Reset clears the map, feed and counters. Running terminals keep going and reappear on their next event.
4. **Check hooks**, as above.

## The client says it isn't built

```
Client not built. Run `npm run build` (or use `npm run dev` and open http://localhost:5173).
```

You started the server without building the client. Use `npm start`, which builds first.

## Launching a terminal fails with "pane limit reached"

You have `maxPanes` terminals running. Close one, or raise `maxPanes` in `swarmcorp.config.json` and restart the hub. Exited panes don't count toward the limit.

## Tokens look low

The Tokens tile counts usage recorded after the hub started, de-duplicated per API message. It doesn't include a session's earlier history, and it resets when the hub restarts. It counts tokens, not dollars.
