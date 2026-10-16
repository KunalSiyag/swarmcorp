import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Link, usePath, useTitle } from '../lib/router.tsx';
import { docs, find, page, posts, type Doc } from '../lib/content.ts';

/** Long-form reading: the one place the site switches to Cutline's paper inversion. */
function Paper({ doc, back, aside }: { doc: Doc; back?: { to: string; label: string }; aside?: React.ReactNode }) {
  useTitle(`${doc.title} · SwarmCorp`);
  return (
    <main className="paper min-h-[70vh]">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {back && <Link to={back.to} className="mb-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase opacity-70 hover:opacity-100"><ArrowLeft size={13} /> {back.label}</Link>}
          {aside ?? (doc.headings.length > 1 && (
            <nav aria-label="On this page" className="hidden lg:block">
              <div className="mb-3 font-mono text-[10px] tracking-[0.18em] uppercase opacity-60">On this page</div>
              <ul className="space-y-2 text-[13px]">
                {doc.headings.map((h) => <li key={h.id}><a href={`#${h.id}`} className="opacity-75 hover:opacity-100">{h.text}</a></li>)}
              </ul>
            </nav>
          ))}
        </aside>
        <article>
          <div className="mb-4 font-mono text-[11px] tracking-[0.18em] uppercase opacity-60">
            {[doc.tag, doc.date, doc.readingTime && `${doc.readingTime} read`].filter(Boolean).join(' · ')}
          </div>
          <h1 className="display balance mb-5 max-w-3xl text-[clamp(36px,5.2vw,68px)]">{doc.title}</h1>
          {doc.description && <p className="mb-10 max-w-2xl text-[19px] leading-relaxed opacity-75">{doc.description}</p>}
          <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </article>
      </div>
    </main>
  );
}

export function BlogIndex() {
  useTitle('Blog · SwarmCorp');
  const list = posts();
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
      <div className="hud mb-4">Plate · The log</div>
      <h1 className="display mb-4 text-[clamp(44px,7vw,96px)]">Blog</h1>
      <p className="mb-12 max-w-xl text-[17px] text-ink-2">Field notes on running Claude Code agent fleets: what to measure, what breaks, and what we learned building SwarmCorp.</p>
      <ol className="border-t border-line">
        {list.map((p, i) => (
          <li key={p.slug} className="border-b border-line">
            <Link to={`/blog/${p.slug}`} className="group grid gap-2 py-8 md:grid-cols-[80px_1fr_200px] md:gap-8">
              <span className="display num text-[28px] text-ink-3 group-hover:text-signal">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <span className="block text-[26px] leading-tight font-bold group-hover:text-signal">{p.title}</span>
                <span className="mt-2 block max-w-2xl text-[15px] text-ink-3">{p.description}</span>
              </span>
              <span className="hud md:text-right">{p.tag}<br />{p.date} · {p.readingTime}</span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}

export function BlogPost({ slug }: { slug: string }) {
  const doc = find('blog', slug);
  if (!doc) return <NotFound />;
  const list = posts();
  const next = list[(list.findIndex((p) => p.slug === slug) + 1) % list.length];
  return (
    <>
      <Paper doc={doc} back={{ to: '/blog', label: 'All posts' }} />
      {next && next.slug !== slug && (
        <div className="border-t border-line">
          <Link to={`/blog/${next.slug}`} className="group mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-4 py-10 sm:px-6">
            <span><span className="hud block">Next post</span><span className="mt-1 block text-[24px] font-bold group-hover:text-signal">{next.title}</span></span>
            <ArrowRight className="shrink-0 text-ink-3 group-hover:text-signal" />
          </Link>
        </div>
      )}
    </>
  );
}

export function DocPage({ slug }: { slug: string }) {
  const doc = find('docs', slug);
  const path = usePath();
  if (!doc) return <NotFound />;
  const nav = (
    <nav aria-label="Documentation">
      <div className="mb-3 font-mono text-[10px] tracking-[0.18em] uppercase opacity-60">Documentation</div>
      <ul className="space-y-1 text-[14px]">
        {docs().map((d) => {
          const active = path === `/docs/${d.slug}`;
          return (
            <li key={d.slug}>
              <Link to={`/docs/${d.slug}`} className={`block border-l-2 py-1 pl-3 ${active ? 'border-signal font-semibold' : 'border-transparent opacity-70 hover:opacity-100'}`}>{d.title}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
  return <Paper doc={doc} aside={nav} />;
}

export function SinglePage({ slug }: { slug: string }) {
  const doc = page(slug);
  if (!doc) return <NotFound />;
  return <Paper doc={doc} />;
}

export function NotFound() {
  useTitle('Not found · SwarmCorp');
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-[1280px] place-items-center px-4 text-center">
      <div>
        <div className="hud mb-3">404 · no event recorded</div>
        <h1 className="display text-[64px]">Nothing here.</h1>
        <Link to="/" className="mt-6 inline-flex items-center gap-2 font-mono text-[12px] tracking-[0.14em] uppercase hover:text-signal"><ArrowLeft size={14} /> Back to the floor</Link>
      </div>
    </main>
  );
}
