import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Minus } from 'lucide-react';
import type { PaneInfo, SetupStatus } from '../../shared/types.ts';
import TerminalPane from './TerminalPane.tsx';
import { swarm } from '../lib/swarmClient.ts';

interface Props {
  panes: PaneInfo[];
  defaultProject: string;
  sessionsSeen: number;
  projectOnly: boolean;
  maximizedId: string | null;
  highlightPaneId: string | null;
  onMaximize: (id: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
}

type Scope = 'all' | 'session' | 'agent';
const PAGE = 9;
const STATUS_RANK: Record<PaneInfo['status'], number> = { waiting: 0, running: 1, starting: 2, idle: 3, exited: 4 };

function columns(n: number) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}

/** Hub-owned terminals first, then each session followed by the subagents it spawned. */
function order(panes: PaneInfo[]) {
  const sessions = panes.filter((p) => p.scope === 'session')
    .sort((a, b) => Number(b.kind === 'pty') - Number(a.kind === 'pty') || STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.createdAt - a.createdAt);
  const agents = panes.filter((p) => p.scope === 'agent').sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.createdAt - a.createdAt);
  const out: PaneInfo[] = [];
  for (const s of sessions) out.push(s, ...agents.filter((a) => a.sessionId === s.sessionId));
  out.push(...agents.filter((a) => !sessions.some((s) => s.sessionId === a.sessionId)));
  return out;
}

export default function TerminalGrid({ panes, defaultProject, sessionsSeen, projectOnly, maximizedId, highlightPaneId, onMaximize, onSelectNode }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [liveOnly, setLiveOnly] = useState(false);
  const [page, setPage] = useState(0);

  const pool = useMemo(() => panes.filter((p) => !projectOnly || p.inProject), [panes, projectOnly]);
  const counts = { all: pool.length, session: pool.filter((p) => p.scope === 'session').length, agent: pool.filter((p) => p.scope === 'agent').length };
  const shown = useMemo(() => order(pool.filter((p) => (scope === 'all' || p.scope === scope) && (!liveOnly || p.status === 'running' || p.status === 'waiting' || p.status === 'starting'))),
    [pool, scope, liveOnly]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);
  // Jump to the page holding the pane highlighted from the map.
  useEffect(() => {
    const i = shown.findIndex((p) => p.id === highlightPaneId);
    if (i >= 0) setPage(Math.floor(i / PAGE));
  }, [highlightPaneId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!panes.length) return <FirstRun defaultProject={defaultProject} sessionsSeen={sessionsSeen} />;
  const max = panes.find((p) => p.id === maximizedId) ?? null;
  const visible = max ? [max] : shown.slice(page * PAGE, page * PAGE + PAGE);
  const cols = columns(visible.length);
  const rows = Math.max(1, Math.ceil(visible.length / cols));
  const live = pool.filter((p) => p.status === 'running' || p.status === 'waiting').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="hud mr-2 text-ink-2">Terminals</span>
        {(['all', 'session', 'agent'] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setScope(s); setPage(0); }} aria-pressed={scope === s}
            className={`border px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase ${scope === s ? 'border-signal/70 bg-signal/10 text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {s === 'all' ? 'All' : s === 'session' ? 'Sessions' : 'Agents'} <span className="text-ink-3">{counts[s]}</span>
          </button>
        ))}
        <button type="button" onClick={() => { setLiveOnly((x) => !x); setPage(0); }} aria-pressed={liveOnly}
          className={`ml-1 flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase ${liveOnly ? 'border-signal/70 bg-signal/10 text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
          <span className="status-dot" data-status={live ? 'running' : 'offline'} /> Live only <span className="text-ink-3">{live}</span>
        </button>
        {pages > 1 && !max && (
          <div className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-3">
            <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-0.5 hover:text-ink disabled:opacity-30"><ChevronLeft size={13} /></button>
            <span className="num">{page + 1} / {pages}</span>
            <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="p-0.5 hover:text-ink disabled:opacity-30"><ChevronRight size={13} /></button>
          </div>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div><div className="display text-xl text-ink-2">Nothing matches.</div><div className="hud mt-2">Clear Live only, or switch the scope</div></div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-1.5 p-1.5"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {visible.map((p) => (
            <div key={p.id} className="flex min-h-0 min-w-0 flex-col">
              <TerminalPane pane={p} maximized={max?.id === p.id} highlighted={highlightPaneId === p.id}
                onToggleMax={() => onMaximize(max?.id === p.id ? null : p.id)} onSelectNode={onSelectNode} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** First-run checklist: what's installed, and the one command that gets agents on the map. */
function FirstRun({ defaultProject, sessionsSeen }: { defaultProject: string; sessionsSeen: number }) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [cwd, setCwd] = useState(defaultProject);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { swarm.api<SetupStatus>('GET', '/api/setup').then(setSetup).catch(() => setSetup(null)); }, []);
  const launch = async (path: string, body: unknown) => {
    setBusy(true); setErr(null);
    try { await swarm.api('POST', path, body); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const steps = [
    { done: !!setup?.claude, title: 'Claude Code on your PATH', detail: 'SwarmCorp drives the `claude` you already use.', cmd: 'npm i -g @anthropic-ai/claude-code' },
    { done: !!setup?.hooks && !!setup?.agents, title: 'Hooks and agent profiles installed', detail: 'Merged into ~/.claude with a backup. Undo with --uninstall.', cmd: 'npm run install-claude' },
    { done: sessionsSeen > 0, title: 'A session reports in', detail: 'Start Claude Code in your project, or launch a terminal here.', cmd: `cd ${defaultProject} && claude` },
  ];
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-xl">
        <div className="hud mb-3">Plate 00 · First run</div>
        <h2 className="display balance mb-3 text-4xl">Put your agents<br />on the floor.</h2>
        <p className="mb-6 max-w-md font-mono text-[12px] leading-relaxed text-ink-2">
          Three steps. Everything stays on this machine: SwarmCorp reads Claude Code hooks and transcripts, nothing else.
        </p>
        <ol className="mb-6 border-t border-line">
          {steps.map((s, i) => <Step key={i} n={i + 1} {...s} loading={!setup && i < 2} />)}
        </ol>
        <div className="frame p-4">
          <label className="hud mb-2 block" htmlFor="fleet-cwd">Project directory</label>
          <input id="fleet-cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false}
            className="mb-3 w-full border border-line-2 bg-void px-3 py-2 font-mono text-xs outline-none focus:border-signal" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => launch('/api/terminals', { role: 'ceo-dispatcher', cwd })}
              className="bg-signal px-4 py-2 font-mono text-[11px] font-semibold tracking-widest text-void uppercase hover:brightness-110 disabled:opacity-50">
              Start a CEO terminal
            </button>
            <button type="button" disabled={busy} onClick={() => launch('/api/fleet', { cwd })}
              className="border border-line-2 px-4 py-2 font-mono text-[11px] tracking-widest text-ink-2 uppercase hover:border-ink-3 hover:text-ink disabled:opacity-50">
              Launch full fleet (6)
            </button>
          </div>
          <p className="mt-3 font-mono text-[10px] text-ink-3">The fleet runs six Claude Code sessions, three on Opus. One CEO with in-process subagents uses far less RAM.</p>
          {err && <p className="mt-2 font-mono text-[11px] text-bad">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function Step({ n, done, title, detail, cmd, loading }: { n: number; done: boolean; title: string; detail: string; cmd: string; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 border-b border-line py-3">
      <span className={`grid h-6 w-6 place-items-center border font-mono text-[10px] ${done ? 'border-ok text-ok' : 'border-line-2 text-ink-3'}`}>
        {loading ? <Minus size={11} /> : done ? <Check size={12} /> : n}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="font-mono text-[11px] text-ink-3">{detail}</div>
        {!done && <code className="mt-1.5 block truncate font-mono text-[11px] text-ink-2">$ {cmd}</code>}
      </div>
      {!done && (
        <button type="button" aria-label="Copy command" title="Copy command" className="p-1 text-ink-3 hover:text-ink"
          onClick={() => { navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </li>
  );
}
