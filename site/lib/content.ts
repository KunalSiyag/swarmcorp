import { Marked } from 'marked';

export interface Doc {
  slug: string;
  section: 'blog' | 'docs' | 'page';
  title: string;
  description: string;
  date: string;
  tag: string;
  readingTime: string;
  html: string;
  headings: { id: string; text: string }[];
}

const raw = import.meta.glob('../content/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const slugify = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parse(path: string, src: string): Doc {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = /^(\w+):\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  const body = m ? src.slice(m[0].length) : src;
  const headings: Doc['headings'] = [];
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2) headings.push({ id, text: decode(text.replace(/<[^>]+>/g, '')) });
        return `<h${depth} id="${id}">${text}</h${depth}>`;
      },
    },
  });
  const rel = path.replace('../content/', '').replace(/\.md$/, '');
  const section = rel.startsWith('blog/') ? 'blog' : rel.startsWith('docs/') ? 'docs' : 'page';
  return {
    slug: rel.split('/').pop()!,
    section,
    title: meta.title ?? rel,
    description: meta.description ?? '',
    date: meta.date ?? '',
    tag: meta.tag ?? '',
    readingTime: meta.readingTime ?? '',
    // Absolute links in Markdown must respect the base path (GitHub Pages serves under /<repo>/).
    html: (md.parse(body) as string).replace(/href="\//g, `href="${import.meta.env.BASE_URL.replace(/\/$/, '')}/`),
    headings,
  };
}

export const DOCS: Doc[] = Object.entries(raw).map(([p, s]) => parse(p, s));
export const posts = () => DOCS.filter((d) => d.section === 'blog').sort((a, b) => b.date.localeCompare(a.date));
const DOC_ORDER = ['getting-started', 'agents', 'pro', 'hooks', 'dispatch-queue', 'configuration', 'troubleshooting'];
export const docs = () => DOCS.filter((d) => d.section === 'docs').sort((a, b) => DOC_ORDER.indexOf(a.slug) - DOC_ORDER.indexOf(b.slug));
export const page = (slug: string) => DOCS.find((d) => d.section === 'page' && d.slug === slug);
export const find = (section: Doc['section'], slug: string) => DOCS.find((d) => d.section === section && d.slug === slug);
