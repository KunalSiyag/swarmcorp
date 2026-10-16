import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { Crosshair, Focus, Maximize2, Minimize2, FolderGit2 } from 'lucide-react';
import type { EdgeLabel, Pulse, SwarmEdge, SwarmNode } from '../../shared/types.ts';
import { swarm } from '../lib/swarmClient.ts';
import {
  CANVAS, EDGE_COLOR, GRID_DOT, INK, INK_2, INK_3, LINE_2, MODEL_TAG, NODE_FILL, MODEL_WEIGHT, SIGNAL, STATUS_COLOR, STATUS_ICON, STATUS_WORD, fmtNum,
} from '../lib/theme.ts';

interface SimNode extends SimulationNodeDatum { id: string; r: number; level: number }
interface SimLink extends SimulationLinkDatum<SimNode> { id: string }
interface LivePulse extends Pulse { start: number; dur: number }

interface Props {
  nodes: SwarmNode[];
  edges: SwarmEdge[];
  selectedId: string | null;
  focusMode: boolean;
  expanded: boolean;
  projectOnly: boolean;
  onSelect: (id: string | null) => void;
  onToggleFocus: () => void;
  onToggleExpand: () => void;
  onToggleProject: () => void;
}

const PULSE_MS = 1600;
const LEGEND_EDGES: EdgeLabel[] = ['Task', 'Result', 'Feedback Loop', 'Permission request'];

function radius(n: SwarmNode) {
  const base = n.kind === 'user' ? 20 : n.role === 'ceo-dispatcher' && n.kind === 'session' ? 30 : n.kind === 'session' ? 24 : 19;
  return Math.round(base * MODEL_WEIGHT[n.model]);
}

function level(n: SwarmNode, byId: Map<string, SwarmNode>): number {
  if (n.kind === 'user') return -1;
  if (n.role === 'ceo-dispatcher' && n.kind !== 'agent') return 0;
  if (n.kind === 'agent') {
    const p = n.parent ? byId.get(n.parent) : null;
    return (p ? level(p, byId) : 1.8) + 0.9;
  }
  return 1.8;
}

/** Quadratic curve; the reverse edge bends the other way so both stay visible. */
function curve(s: SimNode, t: SimNode) {
  const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0;
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(50, len * 0.16);
  const cx = (sx + tx) / 2 - (dy / len) * bend;
  const cy = (sy + ty) / 2 + (dx / len) * bend;
  const toward = (px: number, py: number, qx: number, qy: number, d: number) => {
    const l = Math.hypot(qx - px, qy - py) || 1;
    return [px + ((qx - px) / l) * d, py + ((qy - py) / l) * d];
  };
  const [ax, ay] = toward(sx, sy, cx, cy, s.r + 9);
  const [bx, by] = toward(tx, ty, cx, cy, t.r + 11);
  return { ax, ay, cx, cy, bx, by };
}
const bez = (u: number, a: number, c: number, b: number) => (1 - u) ** 2 * a + 2 * (1 - u) * u * c + u ** 2 * b;
const ctxLabel = (n: SwarmNode) => (n.context ? ` · CTX ${Math.round((n.context / n.contextMax) * 100)}%` : '');

export default function SwarmGraph({
  nodes: allNodes, edges: allEdges, selectedId, focusMode, expanded, projectOnly, onSelect, onToggleFocus, onToggleExpand, onToggleProject,
}: Props) {
  const nodes = useMemo(() => (projectOnly ? allNodes.filter((n) => n.inProject) : allNodes), [allNodes, projectOnly]);
  const edges = useMemo(() => {
    const keep = new Set(nodes.map((n) => n.id));
    return allEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }, [allEdges, nodes]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const autoFit = useRef(true);
  const [, setFrame] = useState(0);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const pulses = useRef<LivePulse[]>([]);
  const born = useRef(new Set<string>());
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>()
      .force('charge', forceManyBody<SimNode>().strength(-900).distanceMax(900))
      .force('link', forceLink<SimNode, SimLink>().id((d) => d.id).distance(160).strength(0.3))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 62).strength(0.9).iterations(3))
      .force('x', forceX<SimNode>(0).strength(0.03))
      .force('y', forceY<SimNode>((d) => d.level * 160 - 110).strength(0.22))
      .alphaDecay(0.025)
      .stop();
    simRef.current = sim;
    return () => { sim.stop(); };
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  useEffect(() => {
    const sim = simRef.current!;
    const map = simNodes.current;
    let structural = false;
    for (const n of nodes) {
      let s = map.get(n.id);
      if (!s) {
        const parent = (n.parent && map.get(n.parent)) || (n.kind !== 'user' ? map.get('user') : null);
        s = { id: n.id, r: radius(n), level: level(n, byId), x: (parent?.x ?? 0) + (Math.random() - 0.5) * 90, y: (parent?.y ?? 0) + 70 + Math.random() * 40 };
        map.set(n.id, s);
        structural = true;
      } else {
        s.r = radius(n);
        s.level = level(n, byId);
      }
    }
    for (const id of [...map.keys()]) if (!byId.has(id)) { map.delete(id); structural = true; }
    const linkIds = new Set<string>();
    const links: SimLink[] = [];
    const add = (a: string, b: string) => {
      const key = [a, b].sort().join('|');
      if (linkIds.has(key) || !map.has(a) || !map.has(b)) return;
      linkIds.add(key);
      links.push({ id: key, source: a, target: b });
    };
    for (const e of edges) add(e.source, e.target);
    for (const n of nodes) if (n.parent) add(n.parent, n.id);
    const prev = (sim.force('link') as any).links() as SimLink[];
    if (prev.length !== links.length) structural = true;
    sim.nodes([...map.values()]);
    (sim.force('link') as any).links(links);
    if (structural) sim.alpha(Math.max(sim.alpha(), 0.6));
  }, [nodes, edges, byId]);

  useEffect(() => swarm.onPulse((p) => {
    pulses.current.push({ ...p, start: performance.now(), dur: PULSE_MS });
    if (pulses.current.length > 120) pulses.current.splice(0, pulses.current.length - 120);
  }), []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const sim = simRef.current!;
      const now = performance.now();
      let dirty = false;
      if (sim.alpha() > sim.alphaMin()) { sim.tick(); dirty = true; }
      if (pulses.current.length) {
        pulses.current = pulses.current.filter((p) => now - p.start < p.dur + 250);
        dirty = true;
      }
      if (autoFit.current && simNodes.current.size) {
        const t = fitView(simNodes.current, size);
        const v = viewRef.current;
        const nx = v.x + (t.x - v.x) * 0.08, ny = v.y + (t.y - v.y) * 0.08, nk = v.k + (t.k - v.k) * 0.08;
        if (Math.abs(nk - v.k) > 0.001 || Math.abs(nx - v.x) > 0.3 || Math.abs(ny - v.y) > 0.3) setView({ k: nk, x: nx, y: ny });
      }
      if (dirty) setFrame((f) => (f + 1) % 1e9);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const focusSet = useMemo(() => {
    if (!selectedId || !focusMode) return null;
    const s = new Set([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    for (const n of nodes) {
      if (n.parent === selectedId) s.add(n.id);
      if (n.id === selectedId && n.parent) s.add(n.parent);
    }
    return s;
  }, [selectedId, focusMode, edges, nodes]);

  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const toSim = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - size.w / 2 - v.x) / v.k, y: (clientY - rect.top - size.h / 2 - v.y) / v.k };
  };
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoFit.current = false;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - size.w / 2, py = e.clientY - rect.top - size.h / 2;
      setView((v) => {
        const k = Math.min(3, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  const onPointerDown = (e: React.PointerEvent, nodeId?: string) => {
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* released */ }
    if (nodeId) {
      const s = simNodes.current.get(nodeId);
      drag.current = { kind: 'node', id: nodeId, sx: e.clientX, sy: e.clientY, ox: s?.x ?? 0, oy: s?.y ?? 0, moved: false };
    } else {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    autoFit.current = false;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }));
    else {
      const s = simNodes.current.get(d.id!);
      if (!s) return;
      const p = toSim(e.clientX, e.clientY);
      s.fx = p.x; s.fy = p.y;
      simRef.current!.alpha(Math.max(simRef.current!.alpha(), 0.25));
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'node') {
      const s = simNodes.current.get(d.id!);
      if (s) { s.fx = null; s.fy = null; }
      if (!d.moved) onSelect(d.id === selectedId ? null : d.id!);
    } else if (!d.moved) onSelect(null);
  };

  const now = performance.now();
  const sim = simNodes.current;
  const wall = Date.now();
  const dim = (id: string) => (focusSet && !focusSet.has(id) ? 0.1 : 1);
  const running = nodes.filter((n) => n.status === 'running').length;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden" ref={wrapRef}>
      <div className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, ${GRID_DOT} 1px, transparent 0)`,
          backgroundSize: `${28 * view.k}px ${28 * view.k}px`,
          backgroundPosition: `${size.w / 2 + view.x}px ${size.h / 2 + view.y}px`,
        }} />
      <svg
        className="absolute inset-0 h-full w-full touch-none select-none"
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`Swarm map: ${nodes.length} nodes, ${edges.length} links, ${running} running`}
      >
        <defs>
          <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill={INK_3} />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill={SIGNAL} />
          </marker>
        </defs>

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((e) => {
            const s = sim.get(e.source), t = sim.get(e.target);
            if (!s || !t) return null;
            const c = curve(s, t);
            const age = wall - e.lastAt;
            const hot = age < 6000;
            const color = hot ? EDGE_COLOR[e.label] : LINE_2;
            const op = Math.min(dim(e.source), dim(e.target));
            const showLabel = age < 2500 || hoverEdge === e.id || (selectedId && (e.source === selectedId || e.target === selectedId));
            const mx = bez(0.5, c.ax, c.cx, c.bx), my = bez(0.5, c.ay, c.cy, c.by);
            const d = `M${c.ax},${c.ay} Q${c.cx},${c.cy} ${c.bx},${c.by}`;
            return (
              <g key={e.id} opacity={op} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
                <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                <path d={d} stroke={color} strokeOpacity={hot ? 0.85 : 1} strokeWidth={hot ? 1.5 : 1} fill="none"
                  className={hot ? 'edge-flow' : undefined} markerEnd={hot ? 'url(#arrow-hot)' : 'url(#arrow)'}>
                  <title>{`${byId.get(e.source)?.label} → ${byId.get(e.target)?.label}\n${e.label} · ${e.count} message${e.count === 1 ? '' : 's'}`}</title>
                </path>
                {showLabel && (
                  <g transform={`translate(${mx},${my})`} pointerEvents="none">
                    <rect x={-(e.label.length * 3.1 + 14)} y={-8} width={e.label.length * 6.2 + 28} height={16} fill={CANVAS} stroke={hot ? EDGE_COLOR[e.label] : LINE_2} strokeOpacity={0.7} />
                    <text textAnchor="middle" y={3.5} fontSize={9} fill={INK} fontFamily="var(--font-mono)" letterSpacing={0.8}>
                      {e.label.toUpperCase()}{e.count > 1 ? ` ×${e.count}` : ''}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {pulses.current.map((p) => {
            const s = sim.get(p.source), t = sim.get(p.target);
            if (!s || !t) return null;
            const u = Math.min(1, (now - p.start) / p.dur);
            const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
            const c = curve(s, t);
            const color = EDGE_COLOR[p.label];
            const pts = [0, 0.04, 0.08, 0.12, 0.16].map((lag) => {
              const v = Math.max(0, eased - lag);
              return [bez(v, c.ax, c.cx, c.bx), bez(v, c.ay, c.cy, c.by)];
            });
            const fade = u >= 1 ? Math.max(0, 1 - (now - p.start - p.dur) / 250) : 1;
            return (
              <g key={p.id} opacity={Math.min(dim(p.source), dim(p.target)) * fade} pointerEvents="none">
                {pts.slice(1).reverse().map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.2 + i * 0.6} fill={color} opacity={0.15 + i * 0.12} />)}
                <circle cx={pts[0][0]} cy={pts[0][1]} r={4} fill={color} filter="url(#glow)" />
                <text x={pts[0][0] + 9} y={pts[0][1] - 7} fontSize={9} fill={color} fontFamily="var(--font-mono)" letterSpacing={0.8}>{p.label.toUpperCase()}</text>
              </g>
            );
          })}

          {nodes.map((n) => {
            const s = sim.get(n.id);
            if (!s) return null;
            const r = s.r;
            const sc = STATUS_COLOR[n.status];
            const selected = n.id === selectedId;
            const first = !born.current.has(n.id);
            if (first) born.current.add(n.id);
            const title = n.title.length > 42 ? `${n.title.slice(0, 41)}…` : n.title;
            const tag = n.kind === 'user' ? 'FOUNDER' : MODEL_TAG[n.model];
            const b = r + 13; // selection bracket half-size
            return (
              <g key={n.id} transform={`translate(${s.x ?? 0},${s.y ?? 0})`} opacity={dim(n.id) * (n.status === 'offline' ? 0.4 : 1)}
                onPointerDown={(e) => onPointerDown(e, n.id)} className="cursor-pointer">
                <g className={first ? 'node-enter' : undefined}>
                  {(n.status === 'running' || n.status === 'waiting') && (
                    <circle r={r + 6} fill="none" stroke={sc} strokeWidth={1.5} className="ring-pulse" />
                  )}
                  <circle r={r + 6} fill="none" stroke={sc} strokeWidth={n.status === 'running' ? 2 : 1.25}
                    strokeDasharray={n.status === 'running' ? '2 4' : n.status === 'offline' ? '1 5' : undefined}
                    className={n.status === 'running' ? 'ring-spin' : undefined} opacity={n.status === 'idle' ? 0.6 : 1} />
                  <circle r={r} fill={NODE_FILL} stroke={n.kind === 'agent' ? INK_3 : INK} strokeOpacity={n.kind === 'agent' ? 0.8 : 0.45}
                    strokeDasharray={n.kind === 'agent' ? '3 2' : undefined} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(9, r * 0.42)} fontWeight={800}
                    fill={INK} fontFamily="var(--font-mono)" letterSpacing={0.5}>{n.avatar}</text>
                  {selected && (
                    <path d={`M${-b},${-b + 8} V${-b} H${-b + 8} M${b - 8},${-b} H${b} V${-b + 8} M${b},${b - 8} V${b} H${b - 8} M${-b + 8},${b} H${-b} V${b - 8}`}
                      fill="none" stroke={SIGNAL} strokeWidth={1.5} filter="url(#glow)" />
                  )}
                  {n.unread > 0 && (
                    <g transform={`translate(${r * 0.8},${-r * 0.95})`}>
                      <rect x={-1} y={-8} width={String(n.unread).length * 6 + 30} height={14} fill={CANVAS} stroke={SIGNAL} />
                      <text x={4} y={2.5} fontSize={8.5} fontFamily="var(--font-mono)" fill={SIGNAL}>{n.unread} MAIL</text>
                    </g>
                  )}
                </g>
                <text textAnchor="middle" y={r + 23} fontSize={12} fontWeight={650} fill={INK} style={{ fontStretch: '105%' }}>
                  {n.kind === 'agent' ? `↳ ${n.label}` : n.kind === 'virtual' ? `${n.label} (queued)` : n.label}
                </text>
                <text textAnchor="middle" y={r + 37} fontSize={8.5} fill={INK_3} fontFamily="var(--font-mono)" letterSpacing={1}>
                  {tag} · <tspan fill={sc}>{STATUS_ICON[n.status]} {STATUS_WORD[n.status].toUpperCase()}</tspan>{ctxLabel(n)}
                </text>
                {title && <text textAnchor="middle" y={r + 51} fontSize={9.5} fill={INK_2} fontFamily="var(--font-mono)">{title}</text>}
                <title>{`${n.label} (${n.role})\n${STATUS_WORD[n.status]} — ${n.title}\nRuns ${n.runs} · ✓${n.passes} ✕${n.fails} · ${fmtNum(n.tokens)} tokens${n.context ? ` · context ${fmtNum(n.context)}/${fmtNum(n.contextMax)}` : ''}${n.unread ? ` · ${n.unread} unread` : ''}`}</title>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute top-3 left-3 flex items-center gap-1">
        <ToolBtn onClick={() => { autoFit.current = true; }} label="Fit everything in view"><Crosshair size={13} /> Fit</ToolBtn>
        <ToolBtn onClick={onToggleProject} active={projectOnly} label="Only sessions working in the dashboard's project"><FolderGit2 size={13} /> This project</ToolBtn>
        <ToolBtn onClick={onToggleFocus} active={focusMode} label="Dim everything except the selected node's collaborators"><Focus size={13} /> Focus</ToolBtn>
        <ToolBtn onClick={onToggleExpand} active={expanded} label={expanded ? 'Show terminals again' : 'Give the map the whole screen'}>
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {expanded ? 'Split' : 'Expand'}
        </ToolBtn>
      </div>

      <div className="hud pointer-events-none absolute top-3 right-3 space-y-1 text-right">
        <div className="flex justify-end gap-3">
          {(['running', 'waiting', 'done', 'failed'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5"><span className="status-dot" data-status={s} />{STATUS_WORD[s]}</span>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          {LEGEND_EDGES.map((l) => (
            <span key={l} className="flex items-center gap-1.5"><span className="inline-block h-px w-3" style={{ background: EDGE_COLOR[l] }} />{l}</span>
          ))}
        </div>
      </div>
      <div className="hud pointer-events-none absolute bottom-2 left-3">
        Map · {nodes.length} nodes · {edges.length} links · <span className="text-ink-2">{running} running</span>
      </div>
      <div className="hud pointer-events-none absolute right-3 bottom-2">Zoom {Math.round(view.k * 100)}%</div>

      {nodes.length <= 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
          <div className="display text-2xl text-ink-2">No agents on the floor.</div>
          <div className="hud mt-2">Start Claude Code in your project, or run <span className="text-ink-2">npm run simulate</span></div>
        </div>
      )}
    </div>
  );
}

function fitView(map: Map<string, SimNode>, size: { w: number; h: number }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of map.values()) {
    x0 = Math.min(x0, (s.x ?? 0) - s.r - 80); x1 = Math.max(x1, (s.x ?? 0) + s.r + 80);
    y0 = Math.min(y0, (s.y ?? 0) - s.r - 30); y1 = Math.max(y1, (s.y ?? 0) + s.r + 70);
  }
  const k = Math.max(0.3, Math.min(1.35, (size.w - 60) / (x1 - x0), (size.h - 110) / (y1 - y0)));
  return { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k + 18 };
}

function ToolBtn({ children, onClick, active, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string }) {
  return (
    <button type="button" title={label} aria-pressed={active} onClick={onClick}
      className={`flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors ${
        active ? 'border-signal/70 bg-signal/10 text-ink' : 'border-line bg-void/80 text-ink-3 hover:border-line-2 hover:text-ink'}`}>
      {children}
    </button>
  );
}
