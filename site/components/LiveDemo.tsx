import { useEffect, useRef, useState } from 'react';

// A scripted, clearly-labelled simulation of the SwarmCorp map for the landing page.
// Code-native on purpose: it shows the product's real visual language, not an illustration.

type Status = 'idle' | 'running' | 'waiting' | 'done' | 'failed';
interface N { id: string; x: number; y: number; r: number; mono: string; label: string; tag: string; sub?: boolean }
const NODES: N[] = [
  { id: 'you', x: 400, y: 48, r: 18, mono: 'YOU', label: 'You', tag: 'FOUNDER' },
  { id: 'ceo', x: 400, y: 160, r: 30, mono: 'CEO', label: 'CEO / Dispatcher', tag: 'OPUS' },
  { id: 'res1', x: 170, y: 270, r: 19, mono: 'RES', label: '↳ Researcher · S0-T1', tag: 'OPUS', sub: true },
  { id: 'res2', x: 300, y: 300, r: 19, mono: 'RES', label: '↳ Researcher · S0-T2', tag: 'OPUS', sub: true },
  { id: 'dev', x: 520, y: 300, r: 22, mono: 'DEV', label: 'Implementer #1', tag: 'SONNET' },
  { id: 'qa', x: 640, y: 230, r: 18, mono: 'QA', label: 'QA Tester', tag: 'HAIKU' },
  { id: 'sec', x: 660, y: 110, r: 22, mono: 'SEC', label: 'Security Auditor', tag: 'OPUS' },
];
const STATUS_COLOR: Record<Status, string> = { idle: '#6f6b65', running: '#4c8dff', waiting: '#ffb020', done: '#3ddc84', failed: '#ff4d4d' };
const EDGE: Record<string, string> = { TASK: '#ff5a1f', SPEC: '#ff5a1f', 'CODE REVIEW': '#ff5a1f', RESULT: '#3ddc84', 'FEEDBACK LOOP': '#ff4d4d', 'PERMISSION REQUEST': '#ffb020' };

interface Beat { t: number; from?: string; to?: string; label?: string; set?: Record<string, Status>; log: string }
const SCRIPT: Beat[] = [
  { t: 0.0, from: 'you', to: 'ceo', label: 'TASK', set: { ceo: 'running' }, log: 'You → CEO: ship multi-tenant billing' },
  { t: 1.6, from: 'ceo', to: 'res1', label: 'TASK', set: { res1: 'running' }, log: 'CEO spawns researcher S0-T1 (background)' },
  { t: 2.1, from: 'ceo', to: 'res2', label: 'TASK', set: { res2: 'running' }, log: 'CEO spawns researcher S0-T2 (background)' },
  { t: 4.6, from: 'res1', to: 'dev', label: 'SPEC', set: { res1: 'done', dev: 'running' }, log: 'Researcher → Implementer: spec S1-T1 ready' },
  { t: 6.4, from: 'dev', to: 'qa', label: 'CODE REVIEW', set: { qa: 'running' }, log: 'Implementer → QA: review swarm/s1-t1' },
  { t: 8.0, from: 'qa', to: 'dev', label: 'FEEDBACK LOOP', set: { qa: 'failed' }, log: 'QA: FAIL, invoice_test.ts:88 expected tenant scope' },
  { t: 9.0, from: 'res2', to: 'you', label: 'PERMISSION REQUEST', set: { res2: 'waiting' }, log: 'Researcher S0-T2 is waiting for your approval' },
  { t: 10.6, from: 'dev', to: 'qa', label: 'CODE REVIEW', set: { qa: 'running', res2: 'running' }, log: 'Implementer fixed it, back to QA' },
  { t: 12.0, from: 'qa', to: 'sec', label: 'CODE REVIEW', set: { qa: 'done', sec: 'running' }, log: 'QA: PASS, 48 checks green' },
  { t: 13.8, from: 'sec', to: 'ceo', label: 'RESULT', set: { sec: 'done', dev: 'done', res2: 'done' }, log: 'Audit: PASS, 0 critical. Merge approved' },
  { t: 15.0, from: 'ceo', to: 'you', label: 'RESULT', set: { ceo: 'done' }, log: 'STATUS: PASS, sprint S1 shipped' },
];
const LOOP = 17.5;

export default function LiveDemo() {
  const [t, setT] = useState(0);
  const start = useRef(performance.now());
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setT(LOOP - 2.2); return; }
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); if (!document.hidden) setT(((performance.now() - start.current) / 1000) % LOOP); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const status: Record<string, Status> = Object.fromEntries(NODES.map((n) => [n.id, 'idle']));
  const past = SCRIPT.filter((b) => b.t <= t);
  for (const b of past) Object.assign(status, b.set ?? {});
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const live = SCRIPT.filter((b) => b.from && t >= b.t && t < b.t + 1.5);
  const tokens = Math.round(2400 + t * 61_000);
  const ctx = Math.min(0.97, 0.12 + t / LOOP * 0.8);
  const lines = past.slice(-5);
  const latest = past[past.length - 1];
  const typed = latest ? latest.log.slice(0, Math.floor((t - latest.t) * 48)) : '';

  return (
    <div className="frame relative overflow-hidden" data-active="true">
      <div className="hud flex items-center justify-between border-b border-line px-3 py-2">
        <span>Plate 01 · Simulated fleet</span>
        <span className="num"><span className="glow">{tokens.toLocaleString()}</span> TOK · T+{t.toFixed(1)}s</span>
      </div>
      <div className="grid md:grid-cols-[1fr_220px]">
        <svg viewBox="0 0 800 380" className="block w-full" role="img" aria-label="Animated example of the SwarmCorp map: a CEO agent delegating to researchers, an implementer, QA and an auditor">
          <defs>
            <filter id="dglow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {SCRIPT.filter((b) => b.from).map((b, i) => {
            const a = byId[b.from!], z = byId[b.to!];
            const hot = live.includes(b);
            return <line key={i} x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={hot ? EDGE[b.label!] : '#262626'} strokeWidth={hot ? 1.4 : 1} strokeDasharray={hot ? '2 6' : undefined} />;
          })}
          {live.map((b, i) => {
            const a = byId[b.from!], z = byId[b.to!];
            const u = Math.min(1, (t - b.t) / 1.2);
            const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
            const x = a.x + (z.x - a.x) * e, y = a.y + (z.y - a.y) * e;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={4} fill={EDGE[b.label!]} filter="url(#dglow)" />
                <text x={x + 9} y={y - 7} fontSize={9.5} fill={EDGE[b.label!]} fontFamily="var(--font-mono)" letterSpacing={0.8}>{b.label}</text>
              </g>
            );
          })}
          {NODES.map((n) => {
            const s = status[n.id];
            const c = STATUS_COLOR[s];
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                {(s === 'running' || s === 'waiting') && <circle r={n.r + 6} fill="none" stroke={c} strokeWidth={1.5} className="ring-pulse" />}
                <circle r={n.r + 6} fill="none" stroke={c} strokeWidth={s === 'running' ? 2 : 1.2} strokeDasharray={s === 'running' ? '2 4' : undefined} className={s === 'running' ? 'ring-spin' : undefined} />
                <circle r={n.r} fill="#111" stroke={n.sub ? '#6f6b65' : '#ece7df'} strokeOpacity={0.5} strokeDasharray={n.sub ? '3 2' : undefined} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(9, n.r * 0.42)} fontWeight={800} fill="#ece7df" fontFamily="var(--font-mono)">{n.mono}</text>
                <text textAnchor="middle" y={n.r + 20} fontSize={11.5} fontWeight={650} fill="#ece7df">{n.label}</text>
                <text textAnchor="middle" y={n.r + 33} fontSize={8.5} fill="#6f6b65" fontFamily="var(--font-mono)" letterSpacing={1}>
                  {n.tag} · <tspan fill={c}>{s.toUpperCase()}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
        <div className="flex flex-col border-t border-line md:border-t-0 md:border-l">
          <div className="flex-1 space-y-1.5 p-3 font-mono text-[11px] leading-snug">
            {lines.map((b, i) => {
              const isLast = i === lines.length - 1;
              return (
                <div key={b.t} className={isLast ? 'text-ink' : 'text-ink-3'}>
                  <span className="text-ink-3">T+{b.t.toFixed(1).padStart(4, '0')}s </span>
                  {isLast ? <>{typed}<span className="glow">▍</span></> : b.log}
                </div>
              );
            })}
          </div>
          <div className="border-t border-line p-3">
            <div className="hud mb-1.5 flex justify-between"><span>CEO context</span><span className={ctx > 0.9 ? 'glow' : ''}>{ctx > 0.9 ? 'FULL' : `${Math.round(ctx * 100)}%`}</span></div>
            <div className="flex h-2 gap-[2px]">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="flex-1" style={{ background: i / 24 < ctx ? (ctx > 0.9 ? '#ff5a1f' : '#d8d2c8') : '#1f1f1f' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
