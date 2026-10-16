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
 * Reads one transcript line from any supported agent. Formats (see docs/adapters-research.md):
 *  - Claude Code: `message.usage` (input/output/cache_read/cache_creation), keyed by message id.
 *  - Codex CLI rollout: `event_msg` lines with `payload.type == "token_count"`; `info.last_token_usage` is per
 *    request. Its input_tokens include cached_input_tokens. Model comes from `turn_context.payload.model`.
 *  - Gemini CLI chat: messages of `type: "gemini"` with `tokens {input, output, cached, thoughts}`.
 *  - Antigravity: `PLANNER_RESPONSE` steps carrying input_tokens / cache_read_tokens / output_tokens.
 */
function readUsage(row: any): { usage: TokenTotals | null; context: number; key: string | null; model: string | null } | null {
  const mk = (input: number, output: number, cacheRead: number, cacheWrite: number): TokenTotals =>
    ({ input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite });
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const msg = row?.message;
  if (msg?.usage) {
    const u = msg.usage;
    const model = typeof msg.model === 'string' && !msg.model.startsWith('<') ? msg.model : null;
    return { usage: mk(n(u.input_tokens), n(u.output_tokens), n(u.cache_read_input_tokens), n(u.cache_creation_input_tokens)),
      context: n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens), key: msg.id ?? row.requestId ?? row.uuid ?? null, model };
  }
  if (row?.type === 'turn_context' && typeof row.payload?.model === 'string') return { usage: null, context: 0, key: null, model: row.payload.model };
  if (row?.type === 'event_msg' && row.payload?.type === 'token_count') {
    const u = row.payload.info?.last_token_usage;
    if (!u) return null;
    const cached = n(u.cached_input_tokens);
    return { usage: mk(Math.max(0, n(u.input_tokens) - cached), n(u.output_tokens), cached, n(u.cache_write_input_tokens)),
      context: n(u.input_tokens), key: `${row.timestamp ?? ''}:${n(row.payload.info?.total_token_usage?.total_tokens)}`, model: null };
  }
  const gm = row?.type === 'gemini' ? row : row?.$set?.type === 'gemini' ? row.$set : null;
  if (gm?.tokens) {
    const t = gm.tokens;
    return { usage: mk(Math.max(0, n(t.input) - n(t.cached)), n(t.output) + n(t.thoughts), n(t.cached), 0),
      context: n(t.input), key: gm.id ?? null, model: typeof gm.model === 'string' ? gm.model : null };
  }
  if (typeof row?.type === 'string' && /PLANNER_RESPONSE/.test(row.type)) {
    const src = row.input_tokens !== undefined ? row : row.metadata ?? row.usage ?? row;
    if (src.input_tokens === undefined && src.output_tokens === undefined) return null;
    return { usage: mk(n(src.input_tokens), n(src.output_tokens), n(src.cache_read_tokens), 0),
      context: n(src.input_tokens) + n(src.cache_read_tokens), key: row.step_index !== undefined ? `step:${row.step_index}` : null, model: null };
  }
  return null;
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
        if (!/"usage"|token_count|"tokens"|input_tokens|"model"/.test(line)) continue;
        let row: any;
        try { row = JSON.parse(line); } catch { continue; }
        const u = readUsage(row);
        if (u?.model) cur.model = u.model;
        if (!u?.usage) continue;
        cur.context = u.context;
        if (sinceMs && row.timestamp && Date.parse(row.timestamp) < sinceMs) continue;
        if (u.key) {
          if (cur.seen.has(u.key)) continue;
          cur.seen.add(u.key);
        }
        Object.assign(delta, addTotals(delta, u.usage));
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
