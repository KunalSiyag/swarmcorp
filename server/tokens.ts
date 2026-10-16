import fs from 'node:fs';
import type { TokenTotals } from '../shared/types.ts';

const MAX_READ_PER_PASS = 8 * 1024 * 1024;

interface FileCursor {
  pos: number;
  partial: string;
  seen: Set<string>;
  totals: TokenTotals;
  busy: boolean;
  model: string | null;
  context: number;
}

export const emptyTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

/**
 * Incrementally sums `message.usage` from Claude Code transcript JSONL files.
 * A single API response is split across several transcript lines (one per content block) that repeat
 * the same usage, so usage is de-duplicated by message id.
 */
export class TokenMeter {
  private files = new Map<string, FileCursor>();

  /** Last model id seen in the transcript (e.g. claude-opus-5-5). */
  model(file: string | null | undefined): string | null {
    return file ? this.files.get(file)?.model ?? null : null;
  }

  /** Size of the context window at the last request (input + cache read + cache write). */
  context(file: string | null | undefined): number {
    return file ? this.files.get(file)?.context ?? 0 : 0;
  }

  totals(file: string): TokenTotals {
    return this.files.get(file)?.totals ?? emptyTotals();
  }

  /**
   * Reads any bytes appended since the last call. Returns the usage delta.
   * Rows timestamped before `sinceMs` (history from before the hub started) are skipped.
   */
  async update(file: string | null | undefined, sinceMs = 0): Promise<TokenTotals> {
    const delta = emptyTotals();
    if (!file || !file.endsWith('.jsonl')) return delta;
    let cur = this.files.get(file);
    if (!cur) {
      cur = { pos: 0, partial: '', seen: new Set(), totals: emptyTotals(), busy: false, model: null, context: 0 };
      this.files.set(file, cur);
    }
    if (cur.busy) return delta;
    cur.busy = true;
    let fh: fs.promises.FileHandle | null = null;
    try {
      const st = await fs.promises.stat(file);
      if (st.size < cur.pos) { cur.pos = 0; cur.partial = ''; } // truncated / rewritten
      if (st.size === cur.pos) return delta;
      const len = Math.min(st.size - cur.pos, MAX_READ_PER_PASS);
      fh = await fs.promises.open(file, 'r');
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, cur.pos);
      cur.pos += bytesRead;
      const text = cur.partial + buf.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      cur.partial = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        let row: any;
        try { row = JSON.parse(line); } catch { continue; }
        const msg = row?.message;
        const u = msg?.usage;
        if (!u) continue;
        if (typeof msg.model === 'string' && !msg.model.startsWith('<')) cur.model = msg.model;
        cur.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        if (sinceMs && row.timestamp && Date.parse(row.timestamp) < sinceMs) continue;
        const key = msg.id ?? row.requestId ?? row.uuid;
        if (key) {
          if (cur.seen.has(key)) continue;
          cur.seen.add(key);
        }
        const d: TokenTotals = {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          total: 0,
        };
        d.total = d.input + d.output + d.cacheRead + d.cacheWrite;
        Object.assign(delta, addTotals(delta, d));
      }
      cur.totals = addTotals(cur.totals, delta);
      return delta;
    } catch {
      return delta;
    } finally {
      cur.busy = false;
      await fh?.close().catch(() => {});
    }
  }

  forget(file: string) {
    this.files.delete(file);
  }
}
