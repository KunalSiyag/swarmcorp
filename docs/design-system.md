# SwarmCorp: product and design direction

## Brief
SwarmCorp is a **local-first mission control for Claude Code agent fleets**. It is for developers who run several Claude Code sessions, subagents, and background agents at once.

| | |
|---|---|
| **Platform** | Web app served from the user's machine, plus a static marketing site |
| **Goal** | See what every agent is doing, what it costs in tokens and context, and prove what happened |
| **Tone** | Technical, exact, a little cinematic, never hype |
| **Main objection** | "Another dashboard that shows fake numbers," and "Will it leak my code?" |
| **Must remember** | *Agent counts are cheap. Run logs aren't.* Every number on screen traces to a real hook event or transcript line, and any run can be exported as a receipt. |
| **Business model** | Modelled on DissectMac: a free local core and a one-time Pro licence. No account, and nothing leaves the machine. |

## Research
**Refero Styles** is the public catalogue at styles.refero.design. It was read through a rendered browser; the paid Refero MCP isn't needed for this. Queries and picks:
- **Raycast**, "Midnight command center, coral neon" (styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8). It contributes:
  - a near-black canvas (`#040506`) with barely-visible elevation steps (`#07080a` and `#111214`)
  - a page that is about 98% achromatic, with one warm accent rationed to identity moments
  - hairline borders, and a "keyboard key" inset-shadow recipe instead of drop shadows
  - Geist Mono for 10–12px uppercase technical labels, and footer metadata separated by pipes
- **Brex**, "White concrete, single ember" (styles.refero.design/style/b58d92f6-68a8-4358-8fc9-6ea58e6d483b). It contributes one orange (`#ff5900`) that marks *every primary action, link and tab indicator*, never as decoration.
- **Vercel**, "Typeset terminal on white paper" (styles.refero.design/style/f24daf3a-d43f-4dec-85a9-8ac1d5148a03). It contributes:
  - disciplined monochrome on `#fafafa`
  - surface steps `#fafafa` → `#ebebeb` → `#171717`
  - mono caps labels
  - depth from tonal shifts instead of shadows
- Also reviewed, not used: Cursor (warm parchment), Caldera (forge fire on limestone), ElevenLabs and Intercom (warm cream editorial). They were rejected as the "calm editorial" pattern that anti-ai-slop warns against for dev tools.

**User-supplied references:**
- **Cutline**, two motion pieces about context windows and night-shift agents. They supply heavy grotesk display type, the data-carrying motion, and the plate/HUD framing.

**Product model:**
- **DissectMac**: a single hero visualization, local and private, freemium, one-time Pro purchase.

## Reference lock

**Primary direction:** Cutline's dark HUD language.

**Preserve these traits:**
1. A near-black canvas (`#0a0a0a`), with off-white ink (`#ece7df`) and grey steps for hierarchy.
2. **One burnt-orange accent (`#ff5a1f`) with a soft glow.** Its role is *signal*: live data in motion, the active word or value, the primary CTA. It is never used for decoration or as a surface fill.
3. Heavy grotesk display type (Archivo, wide and heavy) for headlines and big numerals. Mono (JetBrains Mono) for every HUD label, number, and log line.
4. 1px hairline frames with **corner brackets** and zero radius. Tiny mono HUD metadata sits in frame corners, for example `PLATE 03 · CTX 41,220 / 200K`.
5. Motion that carries data:
   - a typewriter effect where the active word glows
   - tokens raining into a vertical context meter
   - links in a node network drawing in, with pulses travelling along them

**Borrow only:** Cutline's paper-mode inversion (cream `#e9e5dc` with black ink). Its role is a **long-form reading surface** for blog and docs articles only. It is never used for app chrome.

**Role rules:**
- Status colours are semantic and appear only on status dots, rings, and pane borders:
  - Running: blue `#4c8dff`
  - Done or Idle: green `#3ddc84`
  - Paused for input: amber `#ffb020`, pulsing
  - Failed: red `#ff4d4d`
- **Orange is never a status.**
- Model identity is shown with **text tags** (OPUS, SONNET, HAIKU) and node size, never with hue.

**Media strategy:** code-native only. The marketing hero is the real map component running a simulated fleet, not an illustration. Screenshots are real UI.

**Reject:**
- indigo and violet (the old Opus purple goes)
- emoji used as icons (replace them with Lucide icons and mono glyphs)
- rounded cards used as default containers
- gradient blobs
- generic three-column feature grids
- calm editorial serif
- hype words

## Decision ledger

| Decision | Source | Role or rule | Why |
|---|---|---|---|
| Night canvas `#050506`, panels `#08090a`/`#111214`, hairlines `#1c1d20` | Refero: Raycast | Global surfaces | A dark power-tool cockpit. Elevation by tone steps, not shadows. |
| Inset "keyboard key" stroke on frames | Refero: Raycast (DO: inset key shadow, DON'T: drop shadows) | Panel elevation | Tactile depth with no floating cards |
| Ember on every primary action and the active tab | Refero: Brex | Accent role | One orange does all the talking |
| Daylight theme: `#fafafa` → `#ebebeb`, ink `#171717`, ember `#ff5900` | Refero: Vercel surfaces + Brex accent | Pro light theme | A researched light direction instead of a cream default |
| Accent `#ff5a1f` and glow | Cutline | Signal and CTA only | One accent keeps live activity unmistakable |
| Archivo, heavy and expanded | Cutline type | Display and big numerals | Matches the reference's heavy grotesk. Archivo has a width axis. |
| JetBrains Mono | Cutline HUD labels | All metadata, numbers, and logs | Numbers align, and the data reads as data |
| Corner-bracket frames, zero radius | Cutline frames | Panels and plates | Replaces cards. A panel is a viewport, not a container. |
| Status colour quartet | User's original spec (Running blue, Done green, Paused amber) | Status only | User requirement. Kept semantic and away from the accent. |
| Paper inversion for articles | Cutline frame 07 | Long-form reading only | Comfortable reading for blog and docs |
| Lucide icons instead of emoji | anti-ai-slop #5 | Iconography | Emoji read as unfinished |
| Free core plus one-time Pro | DissectMac | Pricing | Local tool, no servers to pay for, honest pricing |
| Run receipts | User's pasted post ("ask for the run log") | Sticky product idea | Proof beats hype |
| Section order on the landing page | Copywriting guide (scene → proof → next step) | Landing page | Avoids the generic hero → grid → pricing template |
