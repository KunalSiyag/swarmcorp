import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Menu, X } from 'lucide-react';
import { Link, usePath } from '../lib/router.tsx';
import { SITE } from '../config.ts';

const NAV = [
  { to: '/#instruments', label: 'Product' },
  { to: '/tips', label: 'Tips' },
  { to: '/blog', label: 'Blog' },
  { to: '/docs/getting-started', label: 'Docs' },
  { to: '/#pricing', label: 'Pricing' },
];

export function Nav() {
  const path = usePath();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="display text-[20px] tracking-tight">SWARMCORP</Link>
        <nav className="hidden items-center gap-5 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={!n.to.includes('#') && path.startsWith(`/${n.to.split('/')[1]}`) ? 'page' : undefined}
              className={`font-mono text-[11px] tracking-[0.14em] uppercase hover:text-ink ${!n.to.includes('#') && path.startsWith(`/${n.to.split('/')[1]}`) ? 'text-ink' : 'text-ink-3'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/#install" className="bg-signal px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-void uppercase hover:brightness-110">Install free</Link>
          <button type="button" className="p-1.5 text-ink-2 md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 md:hidden" aria-label="Mobile">
          {NAV.map((n) => <Link key={n.to} to={n.to} className="block py-2 font-mono text-[12px] tracking-[0.14em] text-ink-2 uppercase">{n.label}</Link>)}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="display text-[28px]">SWARMCORP</div>
          <p className="mt-3 max-w-xs font-mono text-[11px] leading-relaxed text-ink-3">
            Mission control for Claude Code. Runs on your machine. Agent counts are cheap. Run logs aren't.
          </p>
        </div>
        <FooterCol title="Product" links={[['/#instruments', 'Instruments'], ['/#pricing', 'Pricing'], ['/changelog', 'Changelog']]} />
        <FooterCol title="Learn" links={[['/tips', 'Workflow tips'], ['/blog', 'Blog'], ['/docs/getting-started', 'Getting started']]} />
        <FooterCol title="Docs" links={[['/docs/hooks', 'Hooks'], ['/docs/dispatch-queue', 'Dispatch queue'], ['/docs/troubleshooting', 'Troubleshooting']]} />
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-2 border-t border-line px-4 py-4 sm:px-6">
        <span className="hud">v{SITE.version} · local-first · no account · source-available (FSL-1.1)</span>
        <span className="hud normal-case tracking-normal">Not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="hud mb-3">{title}</div>
      <ul className="space-y-2">
        {links.map(([to, label]) => <li key={to}><Link to={to} className="text-[14px] text-ink-2 hover:text-ink">{label}</Link></li>)}
      </ul>
    </div>
  );
}

/** A shell command with a copy button; the command is the CTA. */
export function Cmd({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch border border-line-2 bg-void">
      {label && <span className="hud flex items-center border-r border-line-2 px-3">{label}</span>}
      <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-ink"><span className="text-ink-3">$ </span>{cmd}</code>
      <button type="button" aria-label="Copy command" title="Copy" className="border-l border-line-2 px-3 text-ink-3 hover:text-ink"
        onClick={() => navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/** Section heading in the Cutline plate style: mono plate number, heavy display title. */
export function PlateHead({ n, kicker, title, children }: { n: string; kicker: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-10 grid gap-4 md:grid-cols-[180px_1fr]">
      <div className="hud pt-2">Plate {n}<br /><span className="text-ink-2">{kicker}</span></div>
      <div>
        <h2 className="display balance text-[clamp(34px,5vw,64px)]">{title}</h2>
        {children && <div className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

/** Adds .in when an element scrolls into view (the scene lines). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.querySelectorAll('.reveal').forEach((r, i) => setTimeout(() => r.classList.add('in'), i * 420)); io.disconnect(); } }), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
