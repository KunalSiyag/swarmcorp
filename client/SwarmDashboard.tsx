import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Plus, ReceiptText, RotateCcw, Settings2 } from 'lucide-react';
import Settings from './components/Settings.tsx';
import { applyTheme, type ThemeName } from './lib/theme.ts';
import type { Snapshot } from '../shared/types.ts';
import { swarm, useConnected, useSnapshot } from './lib/swarmClient.ts';
import TerminalGrid from './components/TerminalGrid.tsx';
import SwarmGraph from './components/SwarmGraph.tsx';
import Timeline from './components/Timeline.tsx';
import { EventFeed, NodeInspector, Scoreboard, TelemetryStrip } from './components/Telemetry.tsx';

const SPLIT_KEY = 'swarmcorp.split';
const VIEW_KEY = 'swarmcorp.view';
const THEME_KEY = 'swarmcorp.theme';
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export default function SwarmDashboard() {
  const snap = useSnapshot();
  const connected = useConnected();
  const [split, setSplit] = useState(() => { const v = Number(read(SPLIT_KEY, '52')); return v >= 25 && v <= 75 ? v : 52; });
  const [view, setView] = useState<'map' | 'timeline'>(() => (read(VIEW_KEY, 'map') === 'timeline' ? 'timeline' : 'map'));
  const [expanded, setExpanded] = useState(false);
  const [maximizedPane, setMaximizedPane] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [projectOnly, setProjectOnly] = useState(true);
  const [feedFiltered, setFeedFiltered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => (read(THEME_KEY, 'night') === 'daylight' ? 'daylight' : 'night'));
  const pro = snap?.licence.plan === 'pro';
  // Daylight is a Pro theme: without a licence the dashboard always renders Night.
  const effectiveTheme: ThemeName = pro ? theme : 'night';
  applyTheme(effectiveTheme);
  useEffect(() => write(THEME_KEY, theme), [theme]);

  useEffect(() => write(SPLIT_KEY, String(split)), [split]);
  useEffect(() => write(VIEW_KEY, view), [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.xterm, input, select, textarea')) return;
      if (e.key === 'Escape') { setSelected(null); setMaximizedPane(null); }
      if (e.key === 'm') setView('map');
      if (e.key === 't') setView('timeline');
      if (e.key === 'e') setExpanded((x) => !x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedNode = snap?.nodes.find((n) => n.id === selected) ?? null;
  useEffect(() => { if (selected && snap && !selectedNode) setSelected(null); }, [snap, selected, selectedNode]);
  const openPane = useCallback((paneId: string) => { setExpanded(false); setMaximizedPane(paneId); }, []);

  if (!snap) return <Boot connected={connected} />;
  const sessionsSeen = snap.nodes.filter((n) => n.kind === 'session' && n.inProject).length;

  return (
    <div className="flex h-full flex-col">
      <TopBar snap={snap} connected={connected} onSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <Settings snap={snap} theme={effectiveTheme} onTheme={setTheme} onClose={() => setSettingsOpen(false)} />}
      <main className="flex min-h-0 flex-1">
        {!expanded && (
          <>
            <section className="flex min-h-0 min-w-0 flex-col" style={{ width: `${split}%` }} aria-label="Terminals">
              <TerminalGrid panes={snap.panes} defaultProject={snap.defaultProject} sessionsSeen={sessionsSeen} projectOnly={projectOnly}
                maximizedId={maximizedPane} highlightPaneId={selectedNode?.paneId ?? null}
                onMaximize={setMaximizedPane} onSelectNode={(id) => { if (id) setSelected(id); }} />
            </section>
            <Splitter onDrag={setSplit} />
          </>
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 pl-1" aria-label="Visualizer">
          <div className="frame relative flex min-h-0 flex-1 flex-col" data-active={view === 'map' ? undefined : 'true'}>
            <div className="flex shrink-0 items-center border-b border-line">
              {(['map', 'timeline'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                  className={`border-r border-line px-4 py-2 font-mono text-[10px] tracking-[0.18em] uppercase ${view === v ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:text-ink'}`}>
                  {v === 'map' ? 'Swarm map' : 'Timeline'} <span className="ml-1 text-ink-3">{v === 'map' ? 'M' : 'T'}</span>
                </button>
              ))}
              <span className="hud ml-auto pr-3 truncate">{snap.plans[0]?.epic ?? snap.defaultProject}</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {view === 'map' ? (
                <SwarmGraph nodes={snap.nodes} edges={snap.edges} selectedId={selected} focusMode={focusMode} expanded={expanded}
                  projectOnly={projectOnly} onSelect={setSelected} onToggleFocus={() => setFocusMode((f) => !f)}
                  onToggleExpand={() => setExpanded((x) => !x)} onToggleProject={() => setProjectOnly((x) => !x)} />
              ) : (
                <Timeline lanes={snap.timeline} nodes={snap.nodes} projectOnly={projectOnly} selectedId={selected} onSelect={setSelected} />
              )}
              {selectedNode && <NodeInspector node={selectedNode} onClose={() => setSelected(null)} onOpenPane={openPane} />}
            </div>
          </div>
          <TelemetryStrip m={snap.metrics} plans={snap.plans} nodes={snap.nodes} />
          <div className="flex h-[24%] min-h-[130px] flex-col">
            {selectedNode && (
              <label className="hud mb-1 flex items-center gap-1.5 self-end">
                <input type="checkbox" checked={feedFiltered} onChange={(e) => setFeedFiltered(e.target.checked)} className="accent-[#ff5a1f]" />
                Only {selectedNode.label}
              </label>
            )}
            <EventFeed feed={snap.feed} nodes={snap.nodes} onSelect={setSelected} filterNode={feedFiltered ? selected : null} projectOnly={projectOnly} />
          </div>
        </section>
      </main>
    </div>
  );
}

function Splitter({ onDrag }: { onDrag: (pct: number) => void }) {
  const dragging = useRef(false);
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize panels" className="group w-1.5 shrink-0 cursor-col-resize py-2"
      onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (dragging.current) onDrag(Math.min(75, Math.max(25, (e.clientX / window.innerWidth) * 100))); }}
      onPointerUp={() => { dragging.current = false; }}>
      <div className="mx-auto h-full w-px bg-line transition-colors group-hover:bg-signal" />
    </div>
  );
}

function TopBar({ snap, connected, onSettings }: { snap: Snapshot; connected: boolean; onSettings: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-void px-4">
      <div className="flex shrink-0 items-baseline gap-3">
        <span className="display text-[22px] tracking-tight">SWARMCORP</span>
        <span className="hud hidden lg:inline">Mission control · Claude Code</span>
      </div>
      <div className="min-w-0 flex-1"><Scoreboard m={snap.metrics} /></div>
      <LaunchControls snap={snap} />
      <button type="button" onClick={onSettings} title="Licence, theme, projects and receipt archive"
        className={`flex shrink-0 items-center gap-1.5 border px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase ${snap.licence.plan === 'pro' ? 'border-signal/60 text-signal' : 'border-line-2 text-ink-3 hover:text-ink'}`}>
        <Settings2 size={13} /> {snap.licence.plan === 'pro' ? 'Pro' : 'Free'}
      </button>
      <span className={`hud flex shrink-0 items-center gap-1.5 ${connected ? 'text-ok' : 'text-wait'}`}>
        <span className="status-dot" data-status={connected ? 'idle' : 'waiting'} />{connected ? 'Live' : 'Reconnecting'}
      </span>
    </header>
  );
}

function LaunchControls({ snap }: { snap: Snapshot }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('ceo-dispatcher');
  const [agentId, setAgentId] = useState('');
  const [cwd, setCwd] = useState(snap.defaultProject);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); setOpen(false); } catch (e) { setErr((e as Error).message); }
  };
  const roles = [...snap.roles.map((r) => r.name), 'claude', 'shell'];
  const btn = 'flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase';
  return (
    <div className="relative flex shrink-0 items-center gap-1.5">
      <a href="/api/receipt" className={`${btn} border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink`} title="Download a Markdown receipt of this run: every agent, duration, token count and result">
        <ReceiptText size={13} /> Receipt
      </a>
      <button type="button" className={`${btn} border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink`}
        onClick={() => run(() => swarm.api('POST', '/api/fleet', { cwd: snap.defaultProject }))} title="Start every fleet employee that isn't already running">
        <Play size={12} /> Fleet
      </button>
      <button type="button" className={`${btn} border-signal bg-signal font-semibold text-void hover:brightness-110`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus size={13} /> Terminal
      </button>
      <button type="button" className="p-1.5 text-ink-3 hover:text-ink" title="Clear map, feed and counters (terminals keep running)" aria-label="Reset telemetry"
        onClick={() => run(() => swarm.api('POST', '/api/reset'))}>
        <RotateCcw size={14} />
      </button>
      {open && (
        <form className="frame absolute top-full right-0 z-20 mt-2 w-80 space-y-3 p-4" data-active="true"
          onSubmit={(e) => { e.preventDefault(); run(() => swarm.api('POST', '/api/terminals', { role, agentId: agentId || undefined, cwd })); }}>
          <div className="hud text-ink-2">New terminal</div>
          <label className="block">
            <span className="hud mb-1 block">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-line-2 bg-void px-2 py-1.5 font-mono text-xs">
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="hud mb-1 block">Instance id (optional)</span>
            <input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder={`${role}-2`} spellCheck={false} className="w-full border border-line-2 bg-void px-2 py-1.5 font-mono text-xs" />
          </label>
          <label className="block">
            <span className="hud mb-1 block">Working directory</span>
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} className="w-full border border-line-2 bg-void px-2 py-1.5 font-mono text-xs" />
          </label>
          {err && <p className="font-mono text-[11px] text-bad">{err}</p>}
          <button type="submit" className="w-full bg-signal py-2 font-mono text-[11px] font-semibold tracking-widest text-void uppercase">Launch terminal</button>
        </form>
      )}
      {err && !open && <span className="max-w-[200px] truncate font-mono text-[11px] text-bad" title={err}>{err}</span>}
    </div>
  );
}

function Boot({ connected }: { connected: boolean }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <div className="display text-3xl">SWARMCORP</div>
        <div className="hud mt-3">{connected ? 'Loading state' : 'Connecting to the hub'}<span className="glow"> ▍</span></div>
      </div>
    </div>
  );
}
