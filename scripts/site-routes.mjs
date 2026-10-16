// After the site's client and SSR builds: write a prerendered index.html for every public route (real
// content, per-route title/description/canonical/Open Graph tags and JSON-LD), so static hosts answer 200
// for deep links and crawlers see the page without running JS. Also writes sitemap.xml and robots.txt.
// /thanks and 404.html stay client-rendered and noindex.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = path.resolve('dist-site');
const ssr = await import(pathToFileURL(path.resolve('dist-site-ssr/entry-server.js')).href);
const template = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const HEAD = /<!--head:start-->[\s\S]*?<!--head:end-->/;
if (!HEAD.test(template) || !template.includes('<div id="root"></div>')) throw new Error('site/index.html is missing the head markers or the empty #root');

const write = (route, html) => {
  const dir = route === '/' ? out : path.join(out, route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};

const heads = ssr.heads();
for (const h of heads) {
  const html = template
    .replace(HEAD, () => ssr.headTags(h))
    .replace('<div id="root"></div>', () => `<div id="root">${ssr.render(h.path)}</div>`);
  write(h.path, html);
}

const noindex = template.replace(HEAD, (m) => `${m}\n    <meta name="robots" content="noindex" />`);
write('/thanks', noindex);
fs.writeFileSync(path.join(out, '404.html'), noindex);

const origin = ssr.ORIGIN_URL;
const loc = (p) => `${origin}${p === '/' ? '/' : `${p}/`}`;
const today = new Date().toISOString().slice(0, 10);
const urls = heads.filter((h) => !h.canonical).map((h) => `  <url><loc>${loc(h.path)}</loc><lastmod>${h.date || ssr.lastModified() || today}</lastmod></url>`);
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: ${new URL(loc('/thanks')).pathname}\n\nSitemap: ${origin}/sitemap.xml\n`);

fs.rmSync(path.resolve('dist-site-ssr'), { recursive: true, force: true });
console.log(`site: ${heads.length} prerendered routes, /thanks + 404.html client-only, sitemap.xml (${urls.length} urls), robots.txt`);
