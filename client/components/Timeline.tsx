import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SwarmNode, TimelineLane, TimelineSegment } from '../../shared/types.ts';
import { INK, INK_3, LINE, MODEL_TAG, SEG_IDLE, SIGNAL, STATUS_COLOR, fmtDur, fmtNum } from '../lib/theme.ts';

interface Props {
  lanes: TimelineLane[];
  nodes: SwarmNode[];
  projectOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const RANGES = [{ label: 'AUTO', ms: 0 }, { label: '5M', ms: 5 * 60_000 }, { label: '15M', ms: 15 * 60_000 }, { label: '1H', ms: 60 * 60_000 }, { label: '6H', ms: 6 * 3600_000 }, { label: '24H', ms: 24 * 3600_000 }];
const LABEL_W = 220;
const ROW = 30;

function capColor(seg: TimelineSegment) {
  if (seg.end === null) return STATUS_COLOR.running;
  if (seg.result === 'FAIL') return STATUS_COLOR.failed;
  if (seg.result === 'BLOCKED') return STATUS_COLOR.waiting;
  return STATUS_COLOR.done;
}

export default function Timeline({ lanes, nodes, projectOnly, selectedId, onSelect }: Props) {
  const [range, setRange] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ lane: TimelineLane; seg: TimelineSegment; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ordered = useMemo(() => {
    const visible = lanes.filter((l) => !l.archived && byId.has(l.nodeId) && (!projectOnly || byId.get(l.nodeId)!.inProject));
    const history = lanes.filter((l) => l.archived).sort((a, b) => a.segments[0].start - b.segments[0].start);
    const sessions = visible.filter((l) => l.kind === 'session').sort((a, b) => a.segments[0].start - b.segments[0].start);
    const agents = visible.filter((l) => l.kind === 'agent').sort((a, b) => a.segments[0].start - b.segments[0].start);
    const out: TimelineLane[] = [];
    for (const s of sessions) {
      out.push(s);
      out.push(...agents.filter((a) => a.parentNodeId === s.nodeId));
    }
    out.push(...agents.filter((a) => !sessions.some((s) => s.nodeId === a.parentNodeId)));
    return [...history, ...out];
  }, [lanes, byId, projectOnly]);

  // AUTO: from the first visible activity to now (+10% lead-in), at least two minutes.
  const first = ordered.filter((l) => !l.archived).reduce((m, l) => Math.min(m, ...l.segments.map((s) => s.start)), now);
  const span = RANGES[range].ms || Math.max(120_000, (now - first) * 1.1);
  const t0 = now - span;
  const trackW = Math.max(100, width - LABEL_W - 16);
  const x = (t: number) => LABEL_W + ((Math.max(t, t0) - t0) / span) * trackW;
  const step = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000].find((s) => span / s <= 8) ?? 3_600_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= now; t += step) if (now - t > span * 0.06) ticks.push(t);
  const height = Math.max(ordered.length * ROW + 34, 120);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2">
        <div className="hud">Timeline · {ordered.length} lanes · ticks = tool calls</div>
        <div className="flex gap-1">
          {RANGES.map((r, i) => (
            <button key={r.label} type="button" onClick={() => setRange(i)} aria-pressed={range === i}
              className={`border px-2 py-0.5 font-mono text-[10px] tracking-widest ${range === i ? 'border-signal/70 bg-signal/10 text-ink' : 'border-line text-ink-3 hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div><div className="display text-xl text-ink-2">Nothing on the clock yet.</div><div className="hud mt-2">Lanes appear when a session takes a prompt or spawns an agent</div></div>
          </div>
        )}
        {ordered.length > 0 && (
          <svg width={width} height={height} className="block select-none" role="img" aria-label="Timeline of sessions and agent runs">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={18} y2={height} stroke={LINE} />
                <text x={x(t) + 3} y={12} fontSize={9} fill={INK_3} fontFamily="var(--font-mono)">
                  {new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: step < 60_000 ? '2-digit' : undefined })}
                </text>
              </g>
            ))}
            {ordered.map((lane, i) => {
              const y = 26 + i * ROW;
              const node = byId.get(lane.nodeId);
              const sel = lane.nodeId === selectedId;
              return (
                <g key={lane.id} className={lane.archived ? undefined : 'cursor-pointer'} opacity={lane.archived ? 0.55 : 1}
                  onClick={() => { if (!lane.archived) onSelect(sel ? null : lane.nodeId); }}>
                  <rect x={0} y={y - 4} width={width} height={ROW - 2} fill={sel ? 'color-mix(in oklab, var(--color-signal) 8%, transparent)' : 'transparent'} />
                  <text x={lane.kind === 'agent' ? 22 : 8} y={y + 9} fontSize={11.5} fill={INK} fontWeight={600}>
                    {lane.kind === 'agent' ? '↳ ' : ''}{lane.label.length > 24 ? `${lane.label.slice(0, 23)}…` : lane.label}
                  </text>
                  <text x={lane.kind === 'agent' ? 22 : 8} y={y + 20} fontSize={8.5} fill={INK_3} fontFamily="var(--font-mono)" letterSpacing={0.8}>
                    {MODEL_TAG[lane.model]} · {fmtNum(lane.tokens)} TOK{lane.ticks.length ? ` · ${lane.ticks.length} CALLS` : ''}
                  </text>
                  <line x1={LABEL_W} x2={LABEL_W + trackW} y1={y + 8} y2={y + 8} stroke={LINE} />
                  {lane.segments.map((seg, j) => {
                    const end = seg.end ?? now;
                    if (end < t0) return null;
                    const x1 = x(seg.start), x2 = Math.max(x(end), x1 + 2);
                    const cap = capColor(seg);
                    const live = seg.end === null;
                    return (
                      <g key={j}
                        onPointerEnter={(e) => setHover({ lane, seg, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                        onPointerMove={(e) => setHover({ lane, seg, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                        onPointerLeave={() => setHover(null)}>
                        <rect x={x1} y={y + 3} width={x2 - x1} height={10} fill={live ? cap : SEG_IDLE} fillOpacity={live ? 0.75 : 1} />
                        <rect x={x2 - 2} y={y + 1} width={2} height={14} fill={cap} />
                        {live && <rect x={x2 - 1} y={y} width={2} height={16} fill={cap} style={{ filter: `drop-shadow(0 0 4px ${cap})` }} />}
                      </g>
                    );
                  })}
                  {lane.ticks.filter((t) => t >= t0).map((t, k) => (
                    <line key={k} x1={x(t)} x2={x(t)} y1={y - 1} y2={y + 2} stroke={SIGNAL} strokeWidth={1.5} />
                  ))}
                  {lane.archived && <text x={LABEL_W - 8} y={y + 9} textAnchor="end" fontSize={8} fill={INK_3} fontFamily="var(--font-mono)" letterSpacing={1}>HISTORY</text>}
                  {node?.status === 'waiting' && <text x={LABEL_W + trackW - 4} y={y + 2} textAnchor="end" fontSize={8.5} fill={STATUS_COLOR.waiting} fontFamily="var(--font-mono)">⏸ NEEDS INPUT</text>}
                </g>
              );
            })}
            <line x1={x(now)} x2={x(now)} y1={14} y2={height} stroke={SIGNAL} strokeWidth={1} />
            <text x={x(now) - 4} y={12} textAnchor="end" fontSize={9} fill={SIGNAL} fontFamily="var(--font-mono)" letterSpacing={1}>NOW</text>
          </svg>
        )}
        {hover && (
          <div className="pointer-events-none absolute z-10 max-w-[320px] border border-line-2 bg-void px-2.5 py-2 font-mono text-[11px]"
            style={{ left: Math.min(hover.x + 12, width - 330), top: hover.y + 14 }}>
            <div className="mb-1 font-sans text-xs font-semibold text-ink">{hover.lane.label}</div>
            <div className="text-ink-2">{hover.seg.title || '—'}</div>
            <div className="mt-1 text-ink-3">
              {fmtDur((hover.seg.end ?? now) - hover.seg.start)}{hover.seg.end === null ? ' · running' : ` · ${hover.seg.result ?? 'done'}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
