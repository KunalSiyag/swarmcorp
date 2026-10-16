# SwarmCorp

**Mission control for coding agents:** Claude Code, Codex, Gemini CLI, Antigravity and opencode. It shows every session, subagent and background agent on one live map, on your machine. Every run ends in a receipt.

**Website:** https://kunalsiyag.github.io/swarmcorp/ · [Docs](https://kunalsiyag.github.io/swarmcorp/docs/getting-started/) · [Blog](https://kunalsiyag.github.io/swarmcorp/blog/) · [Workflow tips](https://kunalsiyag.github.io/swarmcorp/tips/)

> Agent counts are cheap. Run logs aren't. Every number SwarmCorp shows traces back to an agent's hook event or a transcript line on your disk.

SwarmCorp has six instruments:
- **Swarm map.** Each session and each subagent run is a node. Delegations, code reviews, failures and permission requests travel along the links as they happen.
- **Timeline.** One lane per turn and per agent run. Tool calls are ticks. A default AUTO range fits the whole run on screen.
- **Context meters.** How full each agent's context window is, read from its transcript. Tokens rain into the meter, and it reads FULL above 90%.
- **Terminals and mirrors.** You can launch `claude --agent <role>` panes from the dashboard. Sessions running in your own terminal show up as read-only live mirrors.
- **Dispatch queue.** Agents message each other through small JSON files, and claims are atomic. Idle panes wake when mail arrives for them.
- **Run receipts.** The **Receipt** button downloads a Markdown record of the run, covering every agent, task, start time, duration, token count and result.

It is local-first. The hub binds to `127.0.0.1` and checks Host and Origin headers. There's no account, it never calls a model, and its hooks give up after 0.8 s and always exit 0.

## Install

You need Node 20+ and at least one supported agent, on macOS or Linux. Windows is untested. `swarmcorp init` connects every agent it finds; see [supported agents](site/content/docs/agents.md).

```bash
git clone https://github.com/KunalSiyag/swarmcorp.git swarmcorp && cd swarmcorp && npm install && npm run build
node bin/swarmcorp.mjs init                                  # hooks, agents and constitution go into ~/.claude (backed up first)
node bin/swarmcorp.mjs start --project ~/code/your-app       # http://localhost:4317
node bin/swarmcorp.mjs doctor                                # checks Node, Claude Code, hooks, port and build
```

Then start `claude` in your project. Once the package is published, run `npx swarmcorp <command>` instead.

| Command | What it does |
|---|---|
| `swarmcorp start [--project dir] [--port n] [--fleet]` | Runs the dashboard. `--fleet` also launches the six-role fleet. |
| `swarmcorp init [--port n]` / `swarmcorp uninstall` | Installs or removes the hooks, the five agent profiles and the CLAUDE.md block |
| `swarmcorp doctor` | Diagnoses your setup |
| `swarmcorp receipt` | Prints the current run's Markdown receipt |
| `swarmcorp simulate` | Replays a scripted three-sprint epic, spending no tokens |

To develop on SwarmCorp itself, run `npm run dev` (hub plus app with hot reload on :5173) or `npm run dev:site` (marketing site on :5174).

Configuration comes from `swarmcorp.config.json`. Keys in `~/.config/swarmcorp/config.json` override it. See [site/content/docs/configuration.md](site/content/docs/configuration.md).

## Repository layout

```
server/          hub: hook ingest (/api/events), PTY terminals, WebSocket, disk discovery, receipts
  swarm.ts       state engine: hooks + transcripts → nodes, edges, pulses, timeline, context, metrics
  transcript.ts  transcript tail/mirror rendering, subagent activity
client/          the dashboard (React, xterm.js, d3-force)
site/            marketing site, blog, workflow tips and docs (static, any host)
  content/       Markdown: blog/, docs/, tips.md, changelog.md
  config.ts      repo URL, Pro price, checkout link
shared/          wire types + design tokens shared by app and site
claude-home/     what `init` installs into ~/.claude: agents, constitution, hook relay, swarm-mail CLI
bin/swarmcorp.mjs  CLI
docs/design-system.md  reference lock + decision ledger for the visual design
```

## Shipping the site

Run `npm run build:site`. It writes `dist-site/`, a static single-page app, with the `_redirects` file for Netlify and `vercel.json` for Vercel already included. Before you deploy, fill in `site/config.ts`:
- `repoUrl`, which is used by the install commands
- `proPrice`
- `proCheckoutUrl`. Until it's set, the Pro button reads "Checkout opens with v1.0".

## Free and Pro

The core is free. **Pro** is a one-time licence that adds:
- run history that survives restarts
- a receipt archive with run-to-run compare
- project switching
- the Daylight theme

See [site/content/docs/pro.md](site/content/docs/pro.md).

**Selling Pro with Dodo Payments.** Dodo generates and emails a licence key for each purchase. SwarmCorp activates and validates those keys through Dodo's public licence API, so no fulfilment server is needed.

1. In the Dodo dashboard, create a one-time product called "SwarmCorp Pro" and turn on **License keys**. An activation limit of 3 machines is a sensible start.
2. Put the product ID (`pdt_…`) in `site/config.ts` as `dodoProductId`, and the site's public URL as `siteUrl`. After payment, Dodo redirects buyers to `/thanks`, which shows their key.
3. Rebuild and redeploy the site with `npm run build:site`. For GitHub Pages, run `SITE_BASE=/swarmcorp/ npm run build:site`.

To test end to end without real money, use a Dodo test-mode product and run the hub with `SWARMCORP_DODO_ENV=test`.

**Issuing licence keys by hand (seller only).** `npx tsx scripts/issue-licence.ts --email buyer@example.com` prints a key. Keys are signed with the Ed25519 private key in `~/.config/swarmcorp-seller/private.pem`, which was created once with `--init`. **Back that file up, and never commit or ship it.** The app only contains the public key, in `server/licence.ts`. Keys are verified offline.

**Licence.** SwarmCorp is source-available under the [Functional Source License 1.1, ALv2 future](LICENSE.md). You can use, modify and redistribute it for anything except a competing commercial product. Each version becomes Apache-2.0 two years after its release.

SwarmCorp is not affiliated with Anthropic, OpenAI, Google or SST. Product names are trademarks of their owners.
