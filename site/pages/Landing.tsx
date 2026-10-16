import { ArrowRight } from 'lucide-react';
import LiveDemo from '../components/LiveDemo.tsx';
import { Cmd, PlateHead, useReveal } from '../components/Chrome.tsx';
import { Link, useTitle } from '../lib/router.tsx';
import { posts } from '../lib/content.ts';
import { SITE, checkoutUrl } from '../config.ts';

const REPO = SITE.repoUrl || '<repo-url>';
const shot = (f: string) => `${import.meta.env.BASE_URL}screenshots/${f}`;

/** A real capture of the dashboard. Sizes are CSS pixels; the files are 2x. */
function Shot({ src, w, h, alt, caption, eager }: { src: string; w: number; h: number; alt: string; caption: string; eager?: boolean }) {
  return (
    <figure>
      <a href={shot(src)} target="_blank" rel="noreferrer" className="block border border-line-2 bg-void transition-colors hover:border-ink-3">
        <img src={shot(src)} width={w} height={h} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full" />
      </a>
      <figcaption className="hud mt-3">{caption}</figcaption>
    </figure>
  );
}

const INSTRUMENTS = [
  { n: '01', title: 'Swarm map', body: 'Every session and every subagent run is a node. Delegations, code reviews, failures and permission requests travel the links as they happen.', meta: 'SubagentStart · SubagentStop · Notification' },
  { n: '02', title: 'Timeline', body: 'One lane per turn and per agent run. Orange ticks are tool calls. Find the researcher that sat on one Bash call for nine minutes.', meta: 'Turns · runs · tool calls' },
  { n: '03', title: 'Context meters', body: 'How full each agent\'s context window is, read from its own transcript. The meter says FULL before your agent starts forgetting.', meta: 'Input + cache tokens per request' },
  { n: '04', title: 'Terminals and mirrors', body: 'Launch claude --agent panes from the dashboard, or keep working in your own terminal. Your session shows up as a read-only live mirror.', meta: 'xterm.js · node-pty' },
  { n: '05', title: 'Dispatch queue', body: 'Agents message each other through small JSON files with atomic claims, instead of sharing one giant context. Idle panes wake when mail arrives.', meta: '.claude/swarm-inbox/' },
  { n: '06', title: 'Run receipts', body: 'One click exports a Markdown receipt of the run: every agent, task, start time, duration, token count and result. Paste it into the pull request.', meta: 'GET /api/receipt' },
];

export const FAQ = [
  { q: 'Does SwarmCorp send my code or prompts anywhere?', a: 'No. The hub binds to 127.0.0.1 and has no account, no analytics and no cloud. It reads the hook events of your agents and the transcript files already on your disk.' },
  { q: 'Does it cost tokens?', a: 'No. SwarmCorp never calls a model. It watches the sessions you run; the token numbers it shows are the ones your agents already recorded.' },
  { q: 'Which agents does it support?', a: 'Claude Code, OpenAI Codex CLI, Gemini CLI, Google Antigravity (agy) and opencode. `swarmcorp init` connects every one it finds on your machine. Claude Code gets the most: launching role terminals and the dispatch queue are Claude-only for now.' },
  { q: 'Does it work with my subscription?', a: 'Yes. SwarmCorp never touches authentication. It observes the CLIs you already use, logged in however you like.' },
  { q: 'What happens when the dashboard is off?', a: 'Nothing you would notice. The hook relay gives up after about 0.8 seconds and always exits 0, so Claude Code never waits on it.' },
  { q: 'How does the Pro licence work?', a: 'You buy once through Dodo Payments and get a licence key by email and on the receipt page. Paste it into Settings and Pro unlocks immediately. Lost the email? The billing portal on the Your licence page lists your key again. The key is activated once with Dodo (it sends the key and your machine name, nothing else), re-checked about once a day, and keeps working offline for 30 days.' },
  { q: 'Which platforms?', a: 'macOS and Linux with Node 20 or newer. Windows is untested.' },
  { q: 'Is this an Anthropic product?', a: 'No. SwarmCorp is independent and is not affiliated with or endorsed by Anthropic.' },
];

export default function Landing() {
  useTitle('SwarmCorp: mission control for coding agents');
  const sceneRef = useReveal<HTMLDivElement>();
  const latest = posts().slice(0, 3);

  return (
    <main>
      {/* ── Hero ── */}
      <section className="scan-grid border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 pt-12 pb-16 sm:px-6 md:pt-16">
          <div className="hud mb-6 flex flex-wrap gap-x-4 gap-y-1">
            <span>For coding agents</span><span>·</span><span>Local-first</span><span>·</span><span className="text-ink-2">v{SITE.version}</span>
          </div>
          <h1 className="display text-[clamp(40px,6.6vw,104px)]">Mission control<br />for coding agents.</h1>
          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div className="max-w-xl text-[19px] leading-relaxed text-ink-2">
              <p>Every session, subagent and background agent on one live map, on your machine.</p>
              <p className="mt-2 font-mono text-[13px] text-ink-3">Claude Code · Codex · Gemini CLI · Antigravity · opencode</p>
              <p className="mt-2 text-ink">Every run ends in a receipt.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/#install" className="flex items-center gap-2 bg-signal px-5 py-3 font-mono text-[12px] font-semibold tracking-[0.14em] text-void uppercase hover:brightness-110">Install free <ArrowRight size={14} /></Link>
              <Link to="/docs/getting-started" className="border border-line-2 px-5 py-3 font-mono text-[12px] tracking-[0.14em] text-ink-2 uppercase hover:border-ink-3 hover:text-ink">Read the docs</Link>
            </div>
          </div>
          <div className="mt-10"><LiveDemo /></div>
          <div className="hud mt-4 flex flex-wrap gap-x-6 gap-y-1">
            <span>No account</span><span>Binds 127.0.0.1</span><span>Hooks give up in 0.8 s</span><span>Uninstall in one command</span><span>Never calls a model</span>
          </div>
        </div>
      </section>

      {/* ── Scene ── */}
      <section className="border-b border-line">
        <div ref={sceneRef} className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="02" kicker="The night shift" title="Agents work while you sleep. Most of the time." />
          <div className="ml-0 space-y-5 md:ml-[196px]">
            {[
              ['02:14', 'Your CEO agent splits the epic and spawns three researchers.'],
              ['02:16', 'One of them stops at a permission prompt.'],
              ['07:40', 'You find it. Five hours, zero progress, one question unanswered.'],
            ].map(([t, line]) => (
              <p key={t} className="reveal display text-[clamp(22px,3vw,40px)] leading-[1.15] text-ink-3">
                <span className="num mr-4 text-[0.55em] align-middle text-ink-3">{t}</span>
                {line}
              </p>
            ))}
            <p className="reveal display text-[clamp(22px,3vw,40px)] leading-[1.15]">
              <span className="num mr-4 text-[0.55em] align-middle text-ink-3">02:16</span>
              With SwarmCorp, that pane turns <span className="text-wait">amber</span>. The log says <span className="glow">who is waiting, and for what.</span>
            </p>
          </div>
        </div>
      </section>

      {/* ── Instruments ── */}
      <section id="instruments" className="scroll-mt-14 border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="03" kicker="Instruments" title="Six instruments. One floor.">
            Each one reads a real signal: a hook event, a transcript line, a file in the queue. None of them guesses.
          </PlateHead>
          <div className="mb-14 space-y-8 md:ml-[196px]">
            <Shot src="dashboard-night.webp" w={1440} h={900}
              alt="SwarmCorp dashboard: nine agent terminals on the left, the swarm map, context meters, token burn, concurrency, sub-task progress and the event log on the right"
              caption="All terminals · swarm map · meters · event log" />
            <div className="grid gap-8 lg:grid-cols-2">
              <Shot src="map.webp" w={1600} h={1000}
                alt="Swarm map in split view: CEO, researchers, implementers, testers and auditors as nodes, with task, review and permission pulses on the links"
                caption="Swarm map · a permission request waiting on the CEO" />
              <Shot src="timeline.webp" w={1600} h={1000}
                alt="Timeline view: one lane per session and subagent run, with tool-call ticks and a failed QA run marked red"
                caption="Timeline · 14 lanes, ticks are tool calls" />
            </div>
            <p className="font-mono text-[12px] text-ink-3">Real captures of v{SITE.version}, running the built-in demo (<span className="text-ink-2">swarmcorp simulate</span>). No mockups. Click to open full size.</p>
          </div>
          <ol className="border-t border-line md:ml-[196px]">
            {INSTRUMENTS.map((x) => (
              <li key={x.n} className="group grid gap-2 border-b border-line py-6 md:grid-cols-[90px_220px_1fr_auto] md:gap-6">
                <span className="display num text-[34px] leading-none text-ink-3 transition-colors group-hover:text-signal">{x.n}</span>
                <h3 className="text-[20px] font-bold">{x.title}</h3>
                <p className="max-w-xl text-[15px] leading-relaxed text-ink-2">{x.body}</p>
                <span className="hud self-start md:text-right">{x.meta}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Proof ── */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <div className="hud mb-6">Plate 04 · Proof</div>
            <h2 className="display balance text-[clamp(40px,6vw,84px)]">Agent counts are cheap. <span className="glow">Run logs aren't.</span></h2>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2">
              Posts about 400-agent swarms rarely show the log behind the number. SwarmCorp writes the log down. Every figure on screen traces back to a hook event or a transcript line on your disk, and the receipt shows all of it.
            </p>
            <Link to="/blog/agent-counts-are-cheap" className="mt-6 inline-flex items-center gap-2 font-mono text-[12px] tracking-[0.14em] uppercase text-ink hover:text-signal">Read the essay <ArrowRight size={14} /></Link>
          </div>
          <Receipt />
        </div>
      </section>

      {/* ── Local by design ── */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="05" kicker="Local by design" title="It can open shells. So it's strict." />
          <div className="grid border-t border-line md:ml-[196px] md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Stays on your machine', 'The hub binds 127.0.0.1. No account, no analytics, no cloud component.'],
              ['Never blocks your agent', 'The hook relay gives up after 0.8 s and always exits 0. Dashboard off? Your agent carries on.'],
              ['Locked to localhost', 'Host and Origin checks stop DNS rebinding, cross-site WebSocket hijacking and CSRF.'],
              ['Reversible', 'The installer backs up ~/.claude first. --uninstall removes every hook it added.'],
            ].map(([t, b]) => (
              <div key={t} className="border-b border-line py-6 pr-6 xl:border-b-0 xl:border-r xl:pl-6 xl:first:pl-0 xl:last:border-r-0">
                <h3 className="mb-2 text-[17px] font-bold">{t}</h3>
                <p className="text-[14px] leading-relaxed text-ink-2">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Install ── */}
      <section id="install" className="scroll-mt-14 border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="06" kicker="Install" title="Three commands. Then watch.">
            Needs Node 20+ and at least one supported agent: Claude Code, Codex, Gemini CLI, Antigravity or opencode. macOS or Linux.
          </PlateHead>
          <div className="max-w-3xl space-y-3 md:ml-[196px]">
            <Cmd label="01" cmd={`git clone ${REPO} swarmcorp && cd swarmcorp && npm install && npm run build && npm link`} />
            <Cmd label="02" cmd="swarmcorp init" />
            <Cmd label="03" cmd="swarmcorp start --project ~/code/your-app" />
            <p className="pt-2 font-mono text-[12px] text-ink-3">Then run <span className="text-ink-2">swarmcorp open</span> (the dashboard picks a free port, 4317 by default) and start your coding agent in that project. Undo everything with <span className="text-ink-2">swarmcorp uninstall</span>.</p>
          </div>
        </div>
      </section>

      <PricingSection />

      {/* ── Reading ── */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="08" kicker="From the log" title="Field notes on running agent fleets." />
          <ol className="border-t border-line md:ml-[196px]">
            {latest.map((p) => (
              <li key={p.slug} className="border-b border-line">
                <Link to={`/blog/${p.slug}`} className="group grid gap-1 py-5 md:grid-cols-[1fr_auto] md:items-baseline md:gap-6">
                  <span className="text-[20px] font-bold group-hover:text-signal">{p.title}</span>
                  <span className="hud">{p.tag} · {p.readingTime}</span>
                  <span className="text-[14px] text-ink-3 md:col-span-2">{p.description}</span>
                </Link>
              </li>
            ))}
            <li className="py-5"><Link to="/tips" className="inline-flex items-center gap-2 font-mono text-[12px] tracking-[0.14em] uppercase hover:text-signal">12 workflow tips for Claude Code fleets <ArrowRight size={14} /></Link></li>
          </ol>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
          <PlateHead n="09" kicker="Questions" title="Before you install." />
          <div className="border-t border-line md:ml-[196px]">
            {FAQ.map((f) => (
              <details key={f.q} className="group border-b border-line py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-semibold">
                  {f.q}<span className="font-mono text-ink-3 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

/** A real receipt excerpt, printed on paper: the one cream surface on the page. */
function Receipt() {
  const rows = [
    ['Deep-Researcher · S0-T1', '6m 12s', '181,587', 'PASS'],
    ['Deep-Researcher · S0-T2', '9m 40s', '226,014', 'PASS'],
    ['Implementer #1 · S1-T1', '4m 03s', '98,420', 'FAIL'],
    ['Implementer #1 · S1-T1', '2m 51s', '61,305', 'PASS'],
    ['QA Tester · S1-T1', '0m 48s', '19,882', 'PASS'],
    ['Security Auditor · S1-T1', '3m 30s', '74,118', 'PASS'],
  ];
  return (
    <figure className="paper relative mx-auto w-full max-w-md rotate-[-1.2deg] p-6 font-mono text-[12px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
      <div className="mb-1 text-[10px] tracking-[0.2em] uppercase">SwarmCorp run receipt</div>
      <div className="mb-4 text-[10px] opacity-60">EPIC-42 · multi-tenant billing · 2026-10-16 02:14 UTC</div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-paper-ink text-left text-[9px] tracking-[0.15em] uppercase"><th className="py-1">Agent</th><th>Time</th><th className="text-right">Tokens</th><th className="text-right">Result</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-dashed border-[#bfb8ab]">
              <td className="py-1.5 pr-2">{r[0]}</td><td>{r[1]}</td><td className="text-right">{r[2]}</td>
              <td className={`text-right font-bold ${r[3] === 'FAIL' ? 'text-[#c0392b]' : ''}`}>{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-between border-t-2 border-paper-ink pt-2 font-bold"><span>Total</span><span>661,326 tokens</span></div>
      <figcaption className="mt-4 text-[10px] leading-snug opacity-60">Sample receipt. Every figure comes from hook events and transcripts on the machine that ran the agents.</figcaption>
    </figure>
  );
}

export function PricingSection({ page = false }: { page?: boolean }) {
  const free = ['Live swarm map and timeline', 'Context meters per agent', 'Up to 12 terminals, plus live mirrors', 'File-based dispatch queue', 'Run receipts for the current run'];
  const pro = ['Everything in Free', 'Run history that survives restarts', 'Receipt archive, with run-to-run compare', 'Switch projects without restarting the hub', 'Daylight theme', 'A receipt saved automatically when the hub stops'];
  return (
    <section id="pricing" className="scroll-mt-14 border-b border-line">
      <div className="mx-auto max-w-[1280px] px-4 py-24 sm:px-6">
        <PlateHead as={page ? 'h1' : 'h2'} n="07" kicker="Pricing" title="Free to run. Pay once for Pro.">
          No subscription. The core stays free and runs on your machine. Pro adds history and comparison, and pays for the work.
        </PlateHead>
        <div className="grid gap-px bg-line md:ml-[196px] md:grid-cols-2">
          <div className="bg-void p-8">
            <div className="hud mb-3">Free</div>
            <div className="display num text-[56px]">$0</div>
            <div className="mb-6 font-mono text-[12px] text-ink-3">forever, local</div>
            <ul className="mb-8 space-y-2.5 text-[15px] text-ink-2">{free.map((f) => <li key={f} className="flex gap-2"><span className="text-ok">✓</span>{f}</li>)}</ul>
            <Link to="/#install" className="inline-flex items-center gap-2 border border-line-2 px-5 py-3 font-mono text-[12px] tracking-[0.14em] uppercase hover:border-ink-3">Install free <ArrowRight size={14} /></Link>
          </div>
          <div className="frame bg-panel p-8" data-active="true">
            <div className="hud mb-3 flex items-center justify-between"><span className="text-signal">Pro</span><span>Shipping · v{SITE.version}</span></div>
            <div className="display num text-[56px]">{SITE.proPrice}</div>
            <div className="mb-6 font-mono text-[12px] text-ink-3">one-time licence, one person, up to 3 machines</div>
            <ul className="mb-8 space-y-2.5 text-[15px] text-ink-2">{pro.map((f) => <li key={f} className="flex gap-2"><span className="text-signal">◆</span>{f}</li>)}</ul>
            {checkoutUrl() ? (
              <a href={checkoutUrl()} className="inline-flex items-center gap-2 bg-signal px-5 py-3 font-mono text-[12px] font-semibold tracking-[0.14em] text-void uppercase hover:brightness-110">Buy Pro <ArrowRight size={14} /></a>
            ) : (
              <span className="inline-flex cursor-not-allowed items-center gap-2 border border-line-2 px-5 py-3 font-mono text-[12px] tracking-[0.14em] text-ink-3 uppercase" title="The checkout link is not live yet">Checkout opens soon</span>
            )}
          </div>
        </div>
        <div className="mt-12 grid gap-8 md:ml-[196px] lg:grid-cols-[1.6fr_1fr] lg:items-start">
          <Shot src="daylight.webp" w={1600} h={1000}
            alt="The Daylight theme: the same dashboard on a light background, with the timeline and all sub-tasks complete"
            caption="Pro · Daylight theme" />
          <Shot src="receipts.webp" w={460} h={394}
            alt="Receipt archive comparing two runs: tokens, agent runs, failed runs, average duration, tasks done and tokens per agent, with deltas"
            caption="Pro · Receipt archive, run-to-run compare" />
        </div>
        <p className="mt-6 font-mono text-[12px] text-ink-3 md:ml-[196px]">Pay with Dodo Payments. Your licence key arrives by email and on the receipt page: paste it into Settings. It's activated once with Dodo, then re-checked about once a day, and keeps working offline for 30 days. No account. <Link to="/docs/pro" className="underline decoration-signal underline-offset-4">How Pro works</Link>.</p>
      </div>
    </section>
  );
}
