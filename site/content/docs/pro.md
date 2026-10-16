---
title: "Pro and licences"
description: "What SwarmCorp Pro adds, how the licence key works offline, where Pro keeps its data, and how to move or remove a licence."
date: 2026-10-16
tag: Docs
readingTime: "3 min"
---

SwarmCorp is free to run. Pro is a one-time licence that adds memory to the dashboard: it keeps what happened after the hub stops, so you can come back to it and compare runs.

## What Pro adds

| Feature | What you get |
|---|---|
| Run history | Every finished agent run and session turn is written to disk. After a restart, earlier runs appear as dimmed **HISTORY** lanes in the timeline. Pick **6H** or **24H** to see them. |
| Receipt archive | **Settings → Receipt archive → Save this run** stores a receipt of the current run. A receipt is also saved automatically when the hub stops, if any agent ran. You can download any saved receipt as Markdown. |
| Compare | Tick two saved receipts and press **Compare 2**. The table shows tokens, agent runs, failed runs, average run duration, tasks done, and tokens per agent role, with the difference. |
| Project switching | **Settings → Projects** lists the projects the hub has seen. Switch the dashboard to another one, or open a new path, without restarting. |
| Daylight theme | A white theme with hairline borders and a single ember accent, for bright rooms and screenshots. |

Everything in Free stays free: the map, the timeline for the current run, context meters, terminals and mirrors, the dispatch queue, and the receipt for the current run.

## Activate a licence

You buy Pro through Dodo Payments. The key appears on the receipt page right after checkout, and Dodo emails you a copy.

1. Open the dashboard and click the **Free** button in the top bar to open **Settings**.
2. Paste the key under **Licence** and press **Activate Pro**.

The button in the top bar changes to **Pro**. Nothing restarts.

If you run SwarmCorp somewhere without the UI, a seller-issued signed key can also be set in the environment:

```bash
SWARMCORP_LICENCE="<your key>" swarmcorp start --project ~/code/app
```

## How the key is checked

There are two kinds of key.

**Keys bought through Dodo Payments** are activated once against Dodo's public licence API:
- Activation sends the key and a label with your machine's hostname (`SwarmCorp on <hostname>`). Nothing about your projects, prompts or code is sent.
- After that, SwarmCorp re-validates the key in the background about once a day.
- If the check can't reach Dodo, Pro keeps working for 30 days after the last successful check.
- Each key has an activation limit, set on the product. **Deactivate** frees a slot so you can move it to another machine.

**Keys issued directly by the seller** (for comps, press and manual sales) are Ed25519-signed and verified fully offline. They are never checked against a server.

Either kind is stored with owner-only permissions in `~/.config/swarmcorp/licence.key` (mode `600`).

## Where Pro keeps data

| Data | Location |
|---|---|
| Run history | `~/.local/share/swarmcorp/history/<project-id>/lanes.jsonl` |
| Saved receipts | `~/.local/share/swarmcorp/receipts/<project-id>/*.json` |

`<project-id>` is a short hash of the project path. `XDG_DATA_HOME` moves the whole folder if it's set. These are plain JSON files, so you can back them up, delete them, or read them with any tool.

## Move or remove a licence

- **Deactivate:** **Settings → Licence → Deactivate**. For a Dodo key this also frees its activation slot with Dodo. The key file is deleted and the dashboard returns to Free. Your history and receipts stay on disk.
- **Lost the key:** reply to your purchase email with the address you bought with.

On the Free plan, the Pro API routes (`/api/receipts`, `/api/project`) answer `402 Payment Required` with a short message.
