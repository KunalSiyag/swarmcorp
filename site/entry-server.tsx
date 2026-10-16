// Build-time prerender (see scripts/site-routes.mjs): each public route is rendered to HTML with its own
// head tags and structured data, so search engines and link previews see real content without running JS.
import { renderToString } from 'react-dom/server';
import App from './App.tsx';
import { setServerPath } from './lib/router.tsx';
import { DOCS, docs, page, posts } from './lib/content.ts';
import { FAQ } from './pages/Landing.tsx';
import { SITE } from './config.ts';

const ORIGIN = SITE.siteUrl.replace(/\/$/, '');
const abs = (p: string) => `${ORIGIN}${p === '/' ? '/' : `${p}/`}`;
const OG_IMAGE = `${ORIGIN}/og.png`;
const AUTHOR = { '@type': 'Person', name: 'Kunal Siyag', url: 'https://github.com/KunalSiyag' };
const PRICE = SITE.proPrice.replace(/[^0-9.]/g, '');
const HOME_DESC = 'See every session, subagent and background agent from Claude Code, Codex, Gemini CLI, Antigravity and opencode work in real time, on your machine. Export a receipt for every run.';

export interface Head {
  path: string;
  title: string;
  description: string;
  /** Canonical path, when it differs from the route (e.g. /docs → /docs/getting-started). */
  canonical?: string;
  type?: 'website' | 'article';
  date?: string;
  jsonLd: object[];
}

const crumbs = (items: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(p) })),
});

const app = {
  '@context': 'https://schema.org', '@type': 'SoftwareApplication',
  name: 'SwarmCorp', url: abs('/'), image: OG_IMAGE,
  description: HOME_DESC,
  applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux',
  softwareVersion: SITE.version, license: 'https://fsl.software/', author: AUTHOR,
  screenshot: ['dashboard-night', 'map', 'timeline', 'daylight'].map((s) => `${ORIGIN}/screenshots/${s}.webp`),
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', url: abs('/') },
    { '@type': 'Offer', name: 'Pro (one-time licence)', price: PRICE, priceCurrency: 'USD', url: abs('/pricing') },
  ],
};

/** Every route worth indexing. /thanks and 404 are left to the client and marked noindex. */
export function heads(): Head[] {
  const list: Head[] = [
    {
      path: '/', title: 'SwarmCorp: mission control for coding agents', description: HOME_DESC, type: 'website',
      jsonLd: [
        app,
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'SwarmCorp', url: abs('/') },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      ],
    },
    {
      path: '/pricing', title: 'Pricing · SwarmCorp',
      description: `SwarmCorp is free to run locally. Pro is a one-time ${SITE.proPrice} licence for run history, a receipt archive with run-to-run compare, project switching and the Daylight theme.`,
      jsonLd: [app, crumbs([['SwarmCorp', '/'], ['Pricing', '/pricing']])],
    },
    {
      path: '/account', title: 'Your licence · SwarmCorp',
      description: 'Find your SwarmCorp Pro licence key and invoices in the billing portal, activate it on a machine, or move it to a new one.',
      jsonLd: [crumbs([['SwarmCorp', '/'], ['Your licence', '/account']])],
    },
    {
      path: '/blog', title: 'Blog · SwarmCorp',
      description: 'Field notes on running coding agent fleets: what to measure, what breaks, and what we learned building SwarmCorp.',
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Blog', name: 'SwarmCorp blog', url: abs('/blog'),
        blogPost: posts().map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: abs(`/blog/${p.slug}`), datePublished: p.date })) }],
    },
  ];
  for (const p of posts()) {
    list.push({
      path: `/blog/${p.slug}`, title: `${p.title} · SwarmCorp`, description: p.description, type: 'article', date: p.date,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description,
          datePublished: p.date, dateModified: p.date, author: AUTHOR, publisher: AUTHOR, image: OG_IMAGE,
          mainEntityOfPage: abs(`/blog/${p.slug}`) },
        crumbs([['SwarmCorp', '/'], ['Blog', '/blog'], [p.title, `/blog/${p.slug}`]]),
      ],
    });
  }
  for (const d of docs()) {
    list.push({
      path: `/docs/${d.slug}`, title: `${d.title} · SwarmCorp`, description: d.description, type: 'article', date: d.date,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'TechArticle', headline: d.title, description: d.description,
          dateModified: d.date, author: AUTHOR, image: OG_IMAGE, mainEntityOfPage: abs(`/docs/${d.slug}`) },
        crumbs([['SwarmCorp', '/'], ['Docs', '/docs/getting-started'], [d.title, `/docs/${d.slug}`]]),
      ],
    });
  }
  const start = docs()[0];
  list.push({ path: '/docs', title: `${start.title} · SwarmCorp`, description: start.description, canonical: `/docs/${start.slug}`, jsonLd: [] });
  for (const slug of ['tips', 'changelog']) {
    const d = page(slug)!;
    list.push({
      path: `/${slug}`, title: `${d.title} · SwarmCorp`, description: d.description, type: 'article', date: d.date,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'Article', headline: d.title, description: d.description,
          dateModified: d.date, author: AUTHOR, image: OG_IMAGE, mainEntityOfPage: abs(`/${slug}`) },
        crumbs([['SwarmCorp', '/'], [d.title, `/${slug}`]]),
      ],
    });
  }
  return list;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The <head> tags for a route. JSON-LD is escaped so no string can close the script element. */
export function headTags(h: Head): string {
  const url = abs(h.canonical ?? h.path);
  const t = esc(h.title);
  const d = esc(h.description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="SwarmCorp" />`,
    `<meta property="og:type" content="${h.type ?? 'website'}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="The SwarmCorp dashboard: agent terminals, swarm map, meters and event log" />`,
    ...(h.type === 'article' && h.date ? [`<meta property="article:published_time" content="${h.date}" />`] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    ...h.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ');
}

export function render(path: string): string {
  setServerPath(path);
  return renderToString(<App />);
}

export const ORIGIN_URL = ORIGIN;
export const lastModified = () => DOCS.reduce((m, d) => (d.date > m ? d.date : m), '');
