import fs from 'node:fs';
import path from 'node:path';

// Renders a Claude Code transcript (JSONL) as ANSI text, so a session running in a terminal the
// dashboard doesn't own can still be watched live in a read-only pane.

const ORANGE = '\x1b[38;5;209m';
const PURPLE = '\x1b[38;5;141m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const HISTORY_BYTES = 256 * 1024;
const MAX_READ = 2 * 1024 * 1024;

const nl = (s: string) => s.replace(/\r?\n/g, '\r\n');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const stripTags = (s: string) => {
  const i = s.indexOf('<system-reminder>');
  return (i >= 0 ? s.slice(0, i) : s).trim();
};

export function toolSummary(name: string, input: any, cwd: string): string {
  const rel = (p: unknown) => (typeof p === 'string' ? (p.startsWith(cwd) ? path.relative(cwd, p) || '.' : p) : '');
  switch (name) {
    case 'Bash': return clip(String(input?.command ?? '').split('\n')[0], 110);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return rel(input?.file_path ?? input?.notebook_path);
    case 'Glob': case 'Grep': return clip(String(input?.pattern ?? ''), 80);
    case 'WebFetch': return clip(String(input?.url ?? ''), 90);
    case 'WebSearch': return clip(String(input?.query ?? ''), 90);
    case 'TodoWrite': return `${Array.isArray(input?.todos) ? input.todos.length : 0} todos`;
    default: {
      const s = JSON.stringify(input ?? {});
      return clip(s === '{}' ? '' : s, 90);
    }
  }
}

export function formatTranscriptRow(row: any, cwd: string): string {
  const msg = row?.message;
  if (!msg || row.isMeta) return '';
  const content = msg.content;
  let out = '';
  if (row.type === 'user') {
    if (typeof content === 'string') {
      const text = stripTags(content);
      if (text && !text.startsWith('<')) out += `\r\n${ORANGE}${BOLD}❯${RESET} ${nl(clip(text, 600))}\r\n`;
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'text') {
          const text = stripTags(String(b.text ?? ''));
          if (text && !text.startsWith('<')) out += `\r\n${ORANGE}${BOLD}❯${RESET} ${nl(clip(text, 600))}\r\n`;
        } else if (b?.type === 'tool_result' && b.is_error) {
          const raw = Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? '').join(' ') : String(b.content ?? '');
          out += `  ${RED}⎿ ${clip(raw.split('\n')[0], 140)}${RESET}\r\n`;
        }
      }
    }
  } else if (row.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === 'text' && b.text?.trim()) {
        out += `${BOLD}●${RESET} ${nl(b.text.trim())}\r\n`;
      } else if (b?.type === 'tool_use') {
        const name = String(b.name ?? 'tool');
        if (name === 'Agent' || name === 'Task') {
          const i = b.input ?? {};
          out += `${PURPLE}⏺ Agent[${i.subagent_type ?? 'general-purpose'}]${RESET} ${clip(String(i.description ?? ''), 100)}${i.run_in_background ? `${DIM} (background)${RESET}` : ''}\r\n`;
        } else {
          const short = name.startsWith('mcp__') ? name.split('__').slice(1).join(':') : name;
          out += `${CYAN}⏺ ${short}${RESET}${DIM}(${toolSummary(name, b.input, cwd)})${RESET}\r\n`;
        }
      }
    }
  }
  return out;
}

/** What a (sub)agent transcript says it is doing right now, read from the file's tail. */
export async function lastActivity(file: string, cwd: string): Promise<{ title: string; text: string; done: boolean; mtime: number } | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const st = await fs.promises.stat(file);
    const len = Math.min(st.size, 128 * 1024);
    fh = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    let lastType = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      let row: any;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      if (row.type !== 'user' && row.type !== 'assistant') continue;
      if (!lastType) lastType = row.type;
      if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue;
      const blocks = row.message.content;
      const tool = [...blocks].reverse().find((b: any) => b?.type === 'tool_use');
      if (tool) {
        const name = String(tool.name ?? 'tool');
        const short = name.startsWith('mcp__') ? name.split('__').slice(1).join(':') : name;
        return { title: `⏺ ${short} ${toolSummary(name, tool.input, cwd)}`.trim(), text: '', done: false, mtime: st.mtimeMs };
      }
      const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim();
      if (!text) continue;
      const line = text.split('\n').map((l: string) => l.trim()).find(Boolean) ?? '';
      // A final text reply that nothing followed means the agent finished its turn.
      return { title: clip(line, 90), text, done: lastType === 'assistant', mtime: st.mtimeMs };
    }
    return { title: '', text: '', done: false, mtime: st.mtimeMs };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

interface Tail { file: string; cwd: string; pos: number; partial: string; primed: boolean; busy: boolean }

/** Incremental reader for one transcript file; the first read starts near the end for recent history. */
export class TranscriptTail {
  private t: Tail;
  constructor(file: string, cwd: string) {
    this.t = { file, cwd, pos: 0, partial: '', primed: false, busy: false };
  }

  async read(): Promise<string> {
    const t = this.t;
    if (t.busy) return '';
    t.busy = true;
    let fh: fs.promises.FileHandle | null = null;
    try {
      const st = await fs.promises.stat(t.file);
      if (!t.primed) {
        t.pos = Math.max(0, st.size - HISTORY_BYTES);
        t.primed = true;
        t.partial = '';
        if (t.pos > 0) t.partial = '\u0000'; // drop the first, probably partial, line
      }
      if (st.size < t.pos) { t.pos = 0; t.partial = ''; }
      if (st.size === t.pos) return '';
      const len = Math.min(st.size - t.pos, MAX_READ);
      fh = await fs.promises.open(t.file, 'r');
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, t.pos);
      t.pos += bytesRead;
      const lines = (t.partial + buf.subarray(0, bytesRead).toString('utf8')).split('\n');
      t.partial = lines.pop() ?? '';
      let out = '';
      for (const [i, line] of lines.entries()) {
        if (i === 0 && line.startsWith('\u0000')) continue;
        if (!line.trim()) continue;
        try { out += formatTranscriptRow(JSON.parse(line), t.cwd); } catch { /* skip malformed */ }
      }
      return out;
    } catch {
      return '';
    } finally {
      t.busy = false;
      await fh?.close().catch(() => {});
    }
  }
}
