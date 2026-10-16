import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AlarmClock, Eye, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import type { PaneInfo } from '../../shared/types.ts';
import { swarm } from '../lib/swarmClient.ts';
import { AGENT_TAG, MODEL_TAG, PANE_ICON, PANE_WORD } from '../lib/theme.ts';

interface Props {
  pane: PaneInfo;
  maximized: boolean;
  highlighted: boolean;
  onToggleMax: () => void;
  onSelectNode: (nodeId: string | null) => void;
}

const XTERM_THEME = {
  background: '#0a0a0a',
  foreground: '#e6e1d8',
  cursor: '#ff5a1f',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#3a2418',
  black: '#141414', brightBlack: '#5c5853',
  red: '#ff5f56', brightRed: '#ff8a80',
  green: '#3ddc84', brightGreen: '#7ef0ad',
  yellow: '#ffb020', brightYellow: '#ffd27a',
  blue: '#6ea4ff', brightBlue: '#9cc0ff',
  magenta: '#d79bff', brightMagenta: '#e8c4ff',
  cyan: '#5fd4e6', brightCyan: '#9ae8f3',
  white: '#d8d2c8', brightWhite: '#ffffff',
};

export default function TerminalPane({ pane, maximized, highlighted, onToggleMax, onSelectNode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const readOnly = pane.kind === 'transcript';

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      convertEol: readOnly,
      allowProposedApi: true,
      scrollback: 5000,
      theme: XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;

    const { history, detach } = swarm.attachPty(pane.id, (d) => term.write(d));
    if (history) term.write(history);
    // Mirrors of sessions in your own terminal are read-only: no input, no resizing their TTY.
    const input = term.onData((d) => { if (!readOnly) swarm.send({ t: 'in', id: pane.id, d }); });

    let raf = 0;
    let last = '';
    const refit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!host.offsetWidth || !host.offsetHeight) return;
        try { fit.fit(); } catch { return; }
        const key = `${term.cols}x${term.rows}`;
        if (key !== last && !readOnly) {
          last = key;
          swarm.send({ t: 'resize', id: pane.id, cols: term.cols, rows: term.rows });
        }
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    refit();
    const redraw = setTimeout(() => { if (!readOnly) swarm.send({ t: 'redraw', id: pane.id }); }, 400);

    return () => {
      clearTimeout(redraw);
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      detach();
      term.dispose();
      termRef.current = null;
    };
  }, [pane.id, readOnly]);

  useEffect(() => { if (maximized) termRef.current?.focus(); }, [maximized]);

  const act = (path: string, body?: unknown) => () =>
    swarm.api('POST', `/api/terminals/${pane.id}/${path}`, body).catch((e) => console.error(e));
  const close = () => swarm.api('DELETE', `/api/terminals/${pane.id}`).catch((e) => console.error(e));

  return (
    <section
      className={`pane @container flex min-h-0 min-w-0 flex-col overflow-hidden border bg-void ${highlighted ? 'outline outline-1 outline-signal' : ''}`}
      data-status={pane.status}
      onMouseDown={() => termRef.current?.focus()}
    >
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-2">
        <span className="status-dot shrink-0" data-status={pane.status} aria-hidden />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 hover:text-white" title="Show on the map"
          onClick={(e) => { e.stopPropagation(); onSelectNode(pane.nodeId); }}>
          <span className="shrink-0 font-mono text-[10px] font-bold text-ink-3">{pane.avatar}</span>
          <span className="truncate text-[12px] font-semibold text-ink">{pane.scope === 'agent' ? `↳ ${pane.label}` : pane.label}</span>
        </button>
        <span className="hud shrink-0">{pane.role === 'shell' ? 'SHELL' : pane.agent !== 'claude' ? `${AGENT_TAG[pane.agent]}${pane.model !== 'unknown' ? ` · ${MODEL_TAG[pane.model]}` : ''}` : MODEL_TAG[pane.model]}</span>
        <span className="hud shrink-0 text-ink-2" title={PANE_WORD[pane.status]}>{PANE_ICON[pane.status]}<span className="ml-1 hidden @[520px]:inline">{PANE_WORD[pane.status]}</span></span>
        {readOnly && (
          <span className="hud flex shrink-0 items-center gap-1 border border-line-2 px-1 text-ink-2" title="Live mirror of a session running in your own terminal. Type in that terminal.">
            <Eye size={11} /><span className="hidden @[620px]:inline">Read-only</span>
          </span>
        )}
        <div className="flex shrink-0 items-center text-ink-3">
          {pane.role !== 'shell' && !readOnly && (
            <IconBtn label={pane.autoWake ? 'Auto-wake on new mail: on' : 'Auto-wake on new mail: off'} onClick={act('autowake', { on: !pane.autoWake })} active={pane.autoWake}>
              <AlarmClock size={13} />
            </IconBtn>
          )}
          {!readOnly && <IconBtn label="Restart" onClick={act('restart')}><RotateCcw size={13} /></IconBtn>}
          <IconBtn label={maximized ? 'Back to grid' : 'Maximize'} onClick={onToggleMax}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</IconBtn>
          {!readOnly && <IconBtn label="Close terminal" onClick={close}><X size={13} /></IconBtn>}
        </div>
      </header>
      <div className="flex min-w-0 items-center gap-2 border-b border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-3">
        {pane.parentLabel && <span className="shrink-0 text-ink-2" title="Spawned by">↳ {pane.parentLabel}</span>}
        <span className="min-w-0 flex-1 truncate" title={pane.title}>{pane.title || '—'}</span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1" />
    </section>
  );
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`grid h-6 w-6 place-items-center hover:bg-white/10 hover:text-ink ${active === false ? 'opacity-40' : ''} ${active ? 'text-signal' : ''}`}>
      {children}
    </button>
  );
}
