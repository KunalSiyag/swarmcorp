import { useEffect, useState } from 'react';
import { Download, FolderGit2, KeyRound, Lock, Moon, ReceiptText, Sun, X } from 'lucide-react';
import type { ReceiptCompare, ReceiptSummary, Snapshot } from '../../shared/types.ts';
import { swarm } from '../lib/swarmClient.ts';
import { fmtAgo, fmtNum, type ThemeName } from '../lib/theme.ts';

interface Props {
  snap: Snapshot;
  theme: ThemeName;
  onTheme: (t: ThemeName) => void;
  onClose: () => void;
}

export default function Settings({ snap, theme, onTheme, onClose }: Props) {
  const pro = snap.licence.plan === 'pro';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={onClose}>
      <aside className="frame flex h-full w-full max-w-[460px] flex-col overflow-x-hidden overflow-y-auto" data-active="true" onMouseDown={(e) => e.stopPropagation()}
        role="dialog" aria-label="Settings">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="hud">Settings</div>
            <div className="display mt-1 text-2xl">{pro ? 'SwarmCorp Pro' : 'SwarmCorp Free'}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings" className="p-1 text-ink-3 hover:text-ink"><X size={16} /></button>
        </header>
        <LicenceSection snap={snap} />
        <Section icon={theme === 'daylight' ? <Sun size={14} /> : <Moon size={14} />} title="Theme" locked={!pro}>
          <div className="grid grid-cols-2 gap-2">
            {(['night', 'daylight'] as const).map((t) => (
              <button key={t} type="button" disabled={!pro && t !== 'night'} onClick={() => onTheme(t)} aria-pressed={theme === t}
                className={`border p-3 text-left disabled:opacity-40 ${theme === t ? 'border-signal' : 'border-line-2 hover:border-ink-3'}`}>
                <div className="mb-2 flex h-10 items-end gap-1 border border-line-2 p-1.5" style={{ background: t === 'night' ? '#050506' : '#fafafa' }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: t === 'night' ? '#ff5a1f' : '#ff5900' }} />
                  <span className="h-1 flex-1" style={{ background: t === 'night' ? '#2f3031' : '#d4d4d4' }} />
                </div>
                <div className="font-mono text-[11px] tracking-widest uppercase">{t}</div>
                <div className="font-mono text-[10px] text-ink-3">{t === 'night' ? 'Midnight HUD' : 'White paper, one ember'}</div>
              </button>
            ))}
          </div>
        </Section>
        <ProjectSection snap={snap} pro={pro} />
        <ReceiptsSection pro={pro} />
        <p className="mt-auto px-5 py-4 font-mono text-[10px] leading-relaxed text-ink-3">
          Licence keys are checked offline on this machine. Pro data (history, receipts) lives in ~/.local/share/swarmcorp.
        </p>
      </aside>
    </div>
  );
}

function Section({ icon, title, locked, children }: { icon: React.ReactNode; title: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-5">
      <h3 className="hud mb-3 flex items-center gap-2 text-ink-2">{icon}{title}{locked && <span className="ml-auto flex items-center gap-1 text-signal"><Lock size={11} /> Pro</span>}</h3>
      <div className={locked ? 'pointer-events-none opacity-50 select-none' : ''} aria-disabled={locked}>{children}</div>
    </section>
  );
}

function LicenceSection({ snap }: { snap: Snapshot }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lic = snap.licence;
  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); setKey(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section icon={<KeyRound size={14} />} title="Licence">
      {lic.plan === 'pro' ? (
        <div className="flex items-start justify-between gap-3">
          <div className="font-mono text-[12px]">
            <div className="text-ok">✓ Pro active</div>
            <div className="text-ink-2">{lic.email ?? (lic.source === 'dodo' ? 'Bought through Dodo Payments' : 'Licence key')} <span className="text-ink-3">{lic.keyHint}</span></div>
            {lic.issuedAt && <div className="text-ink-3">issued {lic.issuedAt.slice(0, 10)}</div>}
            {lic.source === 'dodo' && <div className="text-ink-3">Re-checked with Dodo about once a day. Works offline for 30 days.</div>}
          </div>
          <button type="button" disabled={busy} onClick={() => call(() => swarm.api('DELETE', '/api/licence'))}
            className="border border-line-2 px-3 py-1.5 font-mono text-[10px] tracking-widest text-ink-3 uppercase hover:text-ink">Deactivate</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void call(() => swarm.api('POST', '/api/licence', { key })); }}>
          <p className="mb-3 text-[13px] text-ink-2">Pro adds run history, a receipt archive with compare, project switching and the Daylight theme. Paste the key from your purchase email. Deactivate frees the slot so you can move it to another machine.</p>
          <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={3} spellCheck={false} placeholder="eyJ2Ijox…"
            aria-label="Licence key" className="mb-2 w-full resize-none border border-line-2 bg-void p-2 font-mono text-[11px] outline-none focus:border-signal" />
          <button type="submit" disabled={busy || !key.trim()} className="bg-signal px-4 py-2 font-mono text-[11px] font-semibold tracking-widest text-void uppercase disabled:opacity-40">Activate Pro</button>
          {err && <p className="mt-2 font-mono text-[11px] text-bad">{err}</p>}
        </form>
      )}
    </Section>
  );
}

function ProjectSection({ snap, pro }: { snap: Snapshot; pro: boolean }) {
  const [dir, setDir] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = async (path: string) => {
    setErr(null);
    try { await swarm.api('POST', '/api/project', { path }); setDir(''); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Section icon={<FolderGit2 size={14} />} title="Projects" locked={!pro}>
      <ul className="mb-3 border-t border-line">
        {snap.projects.map((p) => (
          <li key={p.root} className="flex items-center gap-2 border-b border-line py-2">
            <span className={`status-dot ${p.current ? '' : 'opacity-30'}`} data-status={p.sessions ? 'idle' : 'offline'} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={p.root}>{p.root.replace(/^\/home\/[^/]+/, '~')}</span>
            <span className="font-mono text-[10px] text-ink-3">{p.sessions} live</span>
            {p.current ? <span className="hud text-signal">Current</span> : (
              <button type="button" onClick={() => go(p.root)} className="font-mono text-[10px] tracking-widest text-ink-3 uppercase hover:text-ink">Switch</button>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (dir.trim()) void go(dir.trim()); }}>
        <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="~/code/another-project" spellCheck={false} aria-label="Project directory"
          className="min-w-0 flex-1 border border-line-2 bg-void px-2 py-1.5 font-mono text-[11px] outline-none focus:border-signal" />
        <button type="submit" className="border border-line-2 px-3 font-mono text-[10px] tracking-widest uppercase hover:border-ink-3">Open</button>
      </form>
      {err && <p className="mt-2 font-mono text-[11px] text-bad">{err}</p>}
    </Section>
  );
}

function ReceiptsSection({ pro }: { pro: boolean }) {
  const [list, setList] = useState<ReceiptSummary[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [cmp, setCmp] = useState<ReceiptCompare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => swarm.api<ReceiptSummary[]>('GET', '/api/receipts').then(setList).catch(() => setList([]));
  useEffect(() => { if (pro) void load(); }, [pro]);
  const toggle = (id: string) => { setCmp(null); setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id])); };
  const compare = async () => {
    setErr(null);
    try { setCmp(await swarm.api<ReceiptCompare>('GET', `/api/receipts/compare?a=${pick[0]}&b=${pick[1]}`)); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Section icon={<ReceiptText size={14} />} title="Receipt archive" locked={!pro}>
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => swarm.api('POST', '/api/receipts').then(load).catch((e) => setErr((e as Error).message))}
          className="bg-signal px-3 py-1.5 font-mono text-[10px] font-semibold tracking-widest text-void uppercase">Save this run</button>
        <button type="button" disabled={pick.length !== 2} onClick={compare}
          className="border border-line-2 px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40">Compare 2</button>
      </div>
      {list.length === 0 && <p className="font-mono text-[11px] text-ink-3">No saved receipts yet. Pro also saves one automatically when the hub stops.</p>}
      <ul className="border-t border-line">
        {list.slice(0, 12).map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-b border-line py-2 font-mono text-[11px]">
            <input type="checkbox" checked={pick.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select receipt ${r.id}`} className="accent-[var(--color-signal)]" />
            <span className="min-w-0 flex-1 truncate" title={r.epic}>{r.epic}</span>
            <span className="text-ink-3">{fmtNum(r.tokens)} · {r.runs} runs{r.fails ? ` · ${r.fails} fail` : ''} · {fmtAgo(r.createdAt)}</span>
            <a href={`/api/receipts/${r.id}`} className="p-1 text-ink-3 hover:text-ink" aria-label="Download receipt"><Download size={12} /></a>
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 font-mono text-[11px] text-bad">{err}</p>}
      {cmp && (
        <table className="mt-3 w-full font-mono text-[11px]">
          <thead><tr className="text-left text-ink-3"><th className="py-1 font-normal">Metric</th><th className="text-right font-normal">A</th><th className="text-right font-normal">B</th><th className="text-right font-normal">Δ</th></tr></thead>
          <tbody>
            {cmp.rows.map((row) => {
              const d = row.b - row.a;
              return (
                <tr key={row.metric} className="border-t border-line">
                  <td className="py-1 pr-2">{row.metric}</td>
                  <td className="text-right">{fmtNum(row.a)}</td>
                  <td className="text-right">{fmtNum(row.b)}</td>
                  <td className={`text-right ${d === 0 ? 'text-ink-3' : d > 0 ? 'text-ink' : 'text-ink'}`}>{d > 0 ? '+' : ''}{fmtNum(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
