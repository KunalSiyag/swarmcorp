// After `vite build` of the site: give every route its own index.html, so static hosts (GitHub Pages)
// answer 200 for deep links instead of serving them through 404.html.
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('dist-site');
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const slugs = (dir) => fs.readdirSync(path.join('site/content', dir)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
const routes = ['blog', 'docs', 'tips', 'changelog', 'pricing', 'thanks',
  ...slugs('blog').map((s) => `blog/${s}`), ...slugs('docs').map((s) => `docs/${s}`)];
for (const r of routes) {
  fs.mkdirSync(path.join(out, r), { recursive: true });
  fs.writeFileSync(path.join(out, r, 'index.html'), html);
}
fs.writeFileSync(path.join(out, '404.html'), html);
console.log(`site routes: ${routes.length} static entries + 404.html`);
