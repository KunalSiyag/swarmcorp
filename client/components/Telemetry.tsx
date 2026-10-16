import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { FeedItem, Metrics, PlanSummary, SwarmNode } from '../../shared/types.ts';
import { INK, INK_3, LINE, LINE_2, METER, MODEL_TAG, SIGNAL, STATUS_COLOR, STATUS_ICON, STATUS_WORD, fmtAgo, fmtNum } from '../lib/theme.ts';

// ───────────────────────────── scoreboard ─────────────────────────────────────

export function Scoreboard({ m }: { m: Metrics }) {
  const tiles: { k: string; v: string; sub: string; live?: boolean }[] = [
    { k: 'CEO', v: String(m.ceo), sub: m.ceo ? 'dispatching' : 'not running' },
    { k: 'Specialists', v: String(m.specialists), sub: `${m.sessions} sessions` },
    { k: 'Sprints', v: String(m.parallelSprints), sub: `parallel · ${m.sprints} planned` },
    { k: 'Active', v: String(m.activeAgents), sub: `peak ${m.peakConcurrency}`, live: m.activeAgents > 0 },
    { k: 'Tokens', v: fmtNum(m.tokens.total), sub: `${fmtNum(m.tokensPerMin)}/min`, live: m.tokensPerMin > 0 },
    { k: 'Mail', v: String(m.unreadMail), sub: 'queued' },
  ];
  return (
    <div className="flex min-w-0 items-stretch overflow-x-auto">
      {tiles.map((t) => (
        <div key={t.k} className="min-w-[92px] border-l border-line px-3 py-0.5">
          <div className="hud">{t.k}</div>
          <div className="flex items-baseline gap-1.5">
            <span className={`num text-xl leading-none font-semibold ${t.live ? 'glow' : 'text-ink'}`}>{t.v}</span>
            <span className="truncate font-mono text-[10px] text-ink-3">{t.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── shared frame ───────────────────────────────────

export function Plate({ title, meta, children, className = '' }: { title: string; meta?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`frame min-w-0 p-3 ${className}`}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="hud truncate text-ink-2">{title}</h3>
        {meta && <span className="hud truncate">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

// ───────────────────────────── context window (token rain) ───────────────────

const GLYPHS = ['the', 'ing', '{', '}', '=>', 'fn', '()', 'tok', 'ctx', '#', '0x', 'git', 'ts', ';', 'λ', 'def', 'if', '..'];

export function ContextCard({ nodes }: { nodes: SwarmNode[] }) {
  const cols = useMemo(() => nodes
    .filter((n) => n.inProject && n.context > 0 && n.status !== 'offline')
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.context - a.context)
    .slice(0, 6), [nodes]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ cols, last: new Map<string, number>(), drops: [] as { col: number; y: number; v: number; g: string; hot: boolean }[] });
  state.current.cols = cols;

  // New tokens become falling glyphs for that column.
  useEffect(() => {
    const st = state.current;
    cols.forEach((n, i) => {
      const prev = st.last.get(n.id);
      st.last.set(n.id, n.tokens);
      if (prev === undefined || n.tokens <= prev) return;
      const count = Math.min(14, Math.ceil((n.tokens - prev) / 4000));
      for (let k = 0; k < count; k++) {
        st.drops.push({ col: i, y: -Math.random() * 60, v: 0.6 + Math.random() * 1.2, g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], hot: k < 2 });
      }
    });
  }, [cols]);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const st = state.current;
      const n = Math.max(1, st.cols.length);
      const colW = W / n;
      const meterH = H - 34;
      ctx.font = '9px "JetBrains Mono Variable", monospace';
      st.cols.forEach((node, i) => {
        const cx = i * colW + colW / 2;
        const mw = Math.min(16, colW * 0.18);
        const frac = Math.min(1, node.context / node.contextMax);
        const top = 6 + meterH * (1 - frac);
        // meter outline + segments
        ctx.strokeStyle = LINE_2;
        ctx.strokeRect(cx - mw / 2 + 0.5, 6.5, mw, meterH);
        const seg = 4;
        for (let y = 6 + meterH - seg; y >= top; y -= seg) {
          const hot = frac > 0.9;
          ctx.fillStyle = hot ? SIGNAL : METER;
          ctx.globalAlpha = hot ? 0.95 : 0.75;
          ctx.fillRect(cx - mw / 2 + 2, y + 1, mw - 3, seg - 2);
        }
        ctx.globalAlpha = 1;
        // labels
        ctx.fillStyle = frac > 0.9 ? SIGNAL : INK;
        ctx.textAlign = 'center';
        ctx.fillText(frac > 0.9 ? 'FULL' : `${Math.round(frac * 100)}%`, cx, H - 18);
        ctx.fillStyle = INK_3;
        ctx.fillText(node.avatar + (node.kind === 'agent' ? '↳' : ''), cx, H - 6);
      });
      // falling glyphs
      st.drops = st.drops.filter((d) => {
        const node = st.cols[d.col];
        if (!node) return false;
        const cx = d.col * colW + colW / 2 + ((d.g.length * 7) % 23) - 11;
        const frac = Math.min(1, node.context / node.contextMax);
        const floor = 6 + meterH * (1 - frac);
        if (!reduce) d.y += d.v;
        if (d.y >= floor || reduce) return false;
        ctx.fillStyle = d.hot ? SIGNAL : INK_3;
        ctx.globalAlpha = Math.max(0.2, 1 - d.y / Math.max(floor, 1));
        ctx.fillText(d.g, cx, d.y);
        ctx.globalAlpha = 1;
        return true;
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const top = cols[0];
  return (
    <Plate title="Context window" meta={top ? `${fmtNum(top.context)} / ${fmtNum(top.contextMax)}` : 'no live context'}>
      <div className="relative h-[100px]">
        <canvas ref={canvasRef} className="h-full w-full" aria-label={cols.map((c) => `${c.label} ${Math.round((c.context / c.contextMax) * 100)}% of context`).join(', ') || 'No sessions reporting context'} />
        {!cols.length && <div className="hud absolute inset-0 grid place-items-center">Waiting for a transcript</div>}
      </div>
    </Plate>
  );
}

// ───────────────────────────── token burn ─────────────────────────────────────

function TokenCard({ m }: { m: Metrics }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const h = m.history;
    const out: { t: number; rate: number }[] = [];
    for (let i = 1; i < h.length; i++) {
      const dt = Math.max(1, h[i].t - h[i - 1].t);
      out.push({ t: h[i].t, rate: Math.max(0, ((h[i].tokens - h[i - 1].tokens) / dt) * 60_000) });
    }
    return out;
  }, [m.history]);
  const W = 220, H = 44;
  const max = Math.max(1, ...series.map((s) => s.rate));
  const x = (i: number) => (series.length <= 1 ? W : (i / (series.length - 1)) * W);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.rate).toFixed(1)}`).join(' ');
  const hv = hover !== null ? series[hover] : null;
  const t = m.tokens;
  return (
    <Plate title="Token burn" meta={`${fmtNum(m.tokensPerMin)} / min`}>
      <div className="display num mb-1 text-3xl">{fmtNum(t.total)}</div>
      <div className="mb-2 grid grid-cols-4 gap-1 font-mono text-[10px] text-ink-3">
        <span>IN <b className="font-normal text-ink-2">{fmtNum(t.input)}</b></span>
        <span>OUT <b className="font-normal text-ink-2">{fmtNum(t.output)}</b></span>
        <span>C-RD <b className="font-normal text-ink-2">{fmtNum(t.cacheRead)}</b></span>
        <span>C-WR <b className="font-normal text-ink-2">{fmtNum(t.cacheWrite)}</b></span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[44px] w-full overflow-visible" preserveAspectRatio="none"
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
            setHover(series.length ? Math.max(0, Math.min(series.length - 1, i)) : null);
          }}
          onPointerLeave={() => setHover(null)} role="img" aria-label={`Token rate, currently ${fmtNum(m.tokensPerMin)} per minute`}>
          <line x1={0} x2={W} y1={H - 2} y2={H - 2} stroke={LINE} />
          {series.length > 1 && <path d={line} fill="none" stroke={SIGNAL} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {hv && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke={INK_3} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              <circle cx={x(hover)} cy={y(hv.rate)} r={3} fill={SIGNAL} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hv && <div className="pointer-events-none absolute -top-6 right-0 border border-line-2 bg-void px-1.5 py-0.5 font-mono text-[10px]">{fmtNum(Math.round(hv.rate))}/min · {fmtAgo(hv.t)} ago</div>}
      </div>
    </Plate>
  );
}

// ───────────────────────────── concurrency gauge ──────────────────────────────

function ConcurrencyCard({ m }: { m: Metrics }) {
  const cap = Math.max(1, m.capacity);
  const frac = Math.min(1, m.activeAgents / cap);
  const peak = Math.min(1, m.peakConcurrency / cap);
  const R = 46, cx = 60, cy = 56;
  const ticks = Array.from({ length: 31 }, (_, i) => i / 30);
  const pt = (f: number, r: number) => [cx + r * Math.cos(Math.PI * (1 - f)), cy - r * Math.sin(Math.PI * (1 - f))];
  return (
    <Plate title="Concurrency" meta={`cap ${cap}`}>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 120 64" className="h-[62px] w-[112px] shrink-0" role="img" aria-label={`${m.activeAgents} of ${cap} agents active, peak ${m.peakConcurrency}`}>
          {ticks.map((f) => {
            const [x1, y1] = pt(f, R - 6), [x2, y2] = pt(f, R + (f <= frac && frac > 0 ? 4 : 0));
            return <line key={f} x1={x1} y1={y1} x2={x2} y2={y2} stroke={f <= frac && frac > 0 ? SIGNAL : LINE_2} strokeWidth={1.4} />;
          })}
          {(() => { const [a, b] = pt(peak, R - 10), [c, d] = pt(peak, R + 8); return <line x1={a} y1={b} x2={c} y2={d} stroke={INK} strokeWidth={1.5} />; })()}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight={800} fill={INK} fontFamily="var(--font-mono)">{m.activeAgents}</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={7.5} letterSpacing={1.5} fill={INK_3} fontFamily="var(--font-mono)">ACTIVE</text>
        </svg>
        <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
          <dt className="text-ink-3">SESSIONS</dt><dd>{m.sessions}</dd>
          <dt className="text-ink-3">PEAK</dt><dd>{m.peakConcurrency}</dd>
          <dt className="text-ink-3">LOAD</dt><dd>{Math.round(frac * 100)}%</dd>
        </dl>
      </div>
    </Plate>
  );
}

// ───────────────────────────── plan progress ──────────────────────────────────

const SEGMENTS = [
  { key: 'done', label: 'Done', color: STATUS_COLOR.done },
  { key: 'review', label: 'Review', color: 'var(--color-ink-2)' },
  { key: 'active', label: 'Active', color: STATUS_COLOR.running },
  { key: 'blocked', label: 'Blocked', color: STATUS_COLOR.failed },
  { key: 'pending', label: 'Pending', color: 'var(--color-line-2)' },
] as const;

function AlignmentCard({ m, plans }: { m: Metrics; plans: PlanSummary[] }) {
  const p = m.progress;
  const pending = Math.max(0, p.total - p.done - p.review - p.active - p.blocked);
  const counts: Record<string, number> = { done: p.done, review: p.review, active: p.active, blocked: p.blocked, pending };
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const plan = plans[0];
  return (
    <Plate title="Sub-task graph" meta={p.source === 'plan' ? plan?.epic ?? 'plan' : 'from agent runs'}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="display num text-3xl">{pct}%</span>
        <span className="font-mono text-[11px] text-ink-3">{p.done}/{p.total} {p.source === 'plan' ? 'tasks' : 'runs'}</span>
      </div>
      <div className="mb-2 flex h-2.5 w-full gap-[2px]" role="img" aria-label={SEGMENTS.map((s) => `${s.label} ${counts[s.key]}`).join(', ')}>
        {p.total === 0 && <div className="h-full w-full bg-line" />}
        {SEGMENTS.map((s) => counts[s.key] > 0 && <div key={s.key} className="h-full" style={{ flex: counts[s.key], background: s.color }} title={`${s.label}: ${counts[s.key]}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-3">
        {SEGMENTS.map((s) => <span key={s.key} className="flex items-center gap-1"><span className="h-2 w-2" style={{ background: s.color }} />{s.label.toUpperCase()} <b className="font-normal text-ink-2">{counts[s.key]}</b></span>)}
      </div>
      {plan && plan.sprints.length > 0 && (
        <div className="mt-2 space-y-1">
          {plan.sprints.slice(0, 3).map((s) => (
            <div key={s.id} className="flex items-center gap-2 font-mono text-[10px]">
              <span className="w-24 truncate text-ink-2" title={s.name}>{s.id} {s.name}</span>
              <div className="h-1 flex-1 bg-line"><div className="h-full bg-ok" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} /></div>
              <span className="w-9 text-right text-ink-3">{s.done}/{s.total}</span>
            </div>
          ))}
        </div>
      )}
      {plan?.error && <p className="mt-1 font-mono text-[10px] text-bad">{plan.error}</p>}
    </Plate>
  );
}

export function TelemetryStrip({ m, plans, nodes }: { m: Metrics; plans: PlanSummary[]; nodes: SwarmNode[] }) {
  return (
    <div className="@container shrink-0">
    <div className="grid grid-cols-2 gap-2 @[860px]:grid-cols-4">
      <ContextCard nodes={nodes} />
      <TokenCard m={m} />
      <ConcurrencyCard m={m} />
      <AlignmentCard m={m} plans={plans} />
    </div>
    </div>
  );
}

// ───────────────────────────── live feed ──────────────────────────────────────

const LEVEL_TEXT: Record<FeedItem['level'], string> = { info: 'text-ink-2', ok: 'text-ink', warn: 'text-wait', err: 'text-bad' };
const TAG_TONE: Record<string, string> = { SPAWN: 'text-signal', DONE: 'text-ok', SHIP: 'text-ok', FAIL: 'text-bad', BLOCK: 'text-wait', INPUT: 'text-wait', LOOP: 'text-bad', MAIL: 'text-signal', WAKE: 'text-signal' };

export function EventFeed({ feed, nodes, onSelect, filterNode, projectOnly }: { feed: FeedItem[]; nodes: SwarmNode[]; onSelect: (id: string) => void; filterNode: string | null; projectOnly: boolean }) {
  const inProject = useMemo(() => new Set(nodes.filter((n) => n.inProject).map((n) => n.id)), [nodes]);
  const items = feed
    .filter((f) => (filterNode ? f.nodeId === filterNode : !projectOnly || !f.nodeId || inProject.has(f.nodeId)))
    .slice(-90).reverse();
  return (
    <section className="frame flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <h3 className="hud text-ink-2">Event log</h3>
        <span className="hud">{filterNode ? 'filtered to selection' : `${items.length} shown`}</span>
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11px]" aria-live="polite">
        {items.length === 0 && <li className="px-3 py-3 text-ink-3">No events yet.</li>}
        {items.map((f) => (
          <li key={f.id} className="feed-enter grid grid-cols-[2.5rem_4.5rem_1fr] gap-2 px-3 py-[3px] hover:bg-white/[0.03]">
            <span className="text-right text-ink-3 tabular-nums">{fmtAgo(f.at)}</span>
            <span className={`tracking-wider ${TAG_TONE[f.icon] ?? 'text-ink-3'}`}>{f.icon}</span>
            <button type="button" className={`min-w-0 text-left break-words ${LEVEL_TEXT[f.level]} ${f.nodeId ? 'hover:underline' : 'cursor-default'}`} onClick={() => f.nodeId && onSelect(f.nodeId)}>
              {f.text}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────────────────────────── inspector ──────────────────────────────────────

export function NodeInspector({ node, onClose, onOpenPane }: { node: SwarmNode; onClose: () => void; onOpenPane: (paneId: string) => void }) {
  const frac = node.contextMax ? Math.min(1, node.context / node.contextMax) : 0;
  return (
    <aside className="frame absolute top-12 left-3 max-h-[calc(100%-3.75rem)] w-[300px] overflow-x-hidden overflow-y-auto p-3 text-xs" data-active="true">
      <div className="mb-2 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center border font-mono text-[11px] font-bold" style={{ borderColor: STATUS_COLOR[node.status] }}>{node.avatar}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{node.label}</div>
          <div className="hud truncate">{node.role} · {node.kind} · {MODEL_TAG[node.model]}</div>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-ink-3 hover:text-ink" aria-label="Close inspector"><X size={14} /></button>
      </div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px]">
        <span className="status-dot" data-status={node.status} />
        <span style={{ color: STATUS_COLOR[node.status] }}>{STATUS_ICON[node.status]} {STATUS_WORD[node.status].toUpperCase()}</span>
        {node.result && <span className="text-ink-3">· LAST {node.result}</span>}
      </div>
      <p className="mb-3 line-clamp-3 font-mono text-[11px] text-ink-2">{node.title || '—'}</p>
      {node.context > 0 && (
        <div className="mb-3">
          <div className="hud mb-1 flex justify-between"><span>Context</span><span className={frac > 0.9 ? 'glow' : ''}>{fmtNum(node.context)} / {fmtNum(node.contextMax)}</span></div>
          <div className="h-1.5 bg-line"><div className="h-full" style={{ width: `${frac * 100}%`, background: frac > 0.9 ? SIGNAL : INK }} /></div>
        </div>
      )}
      <dl className="grid grid-cols-4 border-t border-line pt-2 text-center">
        {[['Runs', node.runs], ['Pass', node.passes], ['Fail', node.fails], ['Mail', node.unread]].map(([k, v]) => (
          <div key={k}><dt className="hud">{k}</dt><dd className="num text-base">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-ink-3">
        <span>{fmtNum(node.tokens)} TOKENS</span><span>UPDATED {fmtAgo(node.updatedAt)} AGO</span>
      </div>
      {node.paneId && (
        <button type="button" onClick={() => onOpenPane(node.paneId!)} className="mt-3 flex w-full items-center justify-center gap-2 bg-signal py-1.5 font-mono text-[11px] font-semibold tracking-widest text-void uppercase hover:brightness-110">
          Open terminal <ExternalLink size={12} />
        </button>
      )}
    </aside>
  );
}
