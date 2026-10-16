import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReceiptCompare, ReceiptSummary, RunResult, TimelineLane } from '../shared/types.ts';

// Pro: history and receipts that outlive the hub process. Stored per project under
// $XDG_DATA_HOME/swarmcorp (default ~/.local/share/swarmcorp). Plain JSON/JSONL, owner-only files.

const DATA = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'swarmcorp');
const keyFor = (root: string) => crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
const dirFor = (root: string, kind: 'history' | 'receipts') => {
  const d = path.join(DATA, kind, keyFor(root));
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

// ───────────────────────────── run history ────────────────────────────────────

export interface HistoryRecord {
  laneId: string;
  kind: 'session' | 'agent';
  label: string;
  model: TimelineLane['model'];
  parentLabel: string | null;
  start: number;
  end: number;
  result: RunResult;
  title: string;
  ticks: number[];
  tokens: number;
}

export function appendHistory(root: string, rec: HistoryRecord) {
  try {
    fs.appendFileSync(path.join(dirFor(root, 'history'), 'lanes.jsonl'), JSON.stringify(rec) + '\n', { mode: 0o600 });
  } catch { /* history is best-effort */ }
}

/** Finished lanes from earlier hub runs, newest last, grouped back into lanes. */
export function loadHistory(root: string, since: number, limit = 400): TimelineLane[] {
  let lines: string[] = [];
  try { lines = fs.readFileSync(path.join(dirFor(root, 'history'), 'lanes.jsonl'), 'utf8').trim().split('\n').slice(-limit * 4); } catch { return []; }
  const lanes = new Map<string, TimelineLane>();
  for (const line of lines) {
    let r: HistoryRecord;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.end >= since) continue; // this hub run already shows it live
    let l = lanes.get(r.laneId);
    if (!l) {
      l = { id: `h:${r.laneId}`, nodeId: `h:${r.laneId}`, parentNodeId: null, kind: r.kind, label: r.label, model: r.model,
        segments: [], ticks: [], tokens: 0, archived: true };
      lanes.set(r.laneId, l);
    }
    l.segments.push({ start: r.start, end: r.end, result: r.result, title: r.title });
    l.ticks.push(...r.ticks);
    l.tokens += r.tokens;
  }
  return [...lanes.values()].slice(-limit);
}

// ───────────────────────────── receipt archive ────────────────────────────────

export interface StoredReceipt extends ReceiptSummary {
  markdown: string;
  agents: Record<string, { runs: number; tokens: number; fails: number }>;
}

export function saveReceipt(root: string, r: Omit<StoredReceipt, 'id'>): ReceiptSummary {
  const id = `${new Date(r.createdAt).toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${crypto.randomBytes(2).toString('hex')}`;
  const full: StoredReceipt = { ...r, id };
  fs.writeFileSync(path.join(dirFor(root, 'receipts'), `${id}.json`), JSON.stringify(full, null, 2), { mode: 0o600 });
  return summary(full);
}

const summary = ({ markdown: _m, agents: _a, ...s }: StoredReceipt): ReceiptSummary => s;

export function listReceipts(root: string): ReceiptSummary[] {
  const dir = dirFor(root, 'receipts');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return summary(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { return null; }
  }).filter((x): x is ReceiptSummary => !!x).sort((a, b) => b.createdAt - a.createdAt);
}

export function getReceipt(root: string, id: string): StoredReceipt | null {
  if (!/^[0-9TZ]{15}-[0-9a-f]{4}$/.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dirFor(root, 'receipts'), `${id}.json`), 'utf8')); } catch { return null; }
}

export function compareReceipts(a: StoredReceipt, b: StoredReceipt): ReceiptCompare {
  const roles = [...new Set([...Object.keys(a.agents), ...Object.keys(b.agents)])].sort();
  return {
    a: summary(a), b: summary(b),
    rows: [
      { metric: 'Tokens', a: a.tokens, b: b.tokens },
      { metric: 'Agent runs', a: a.runs, b: b.runs },
      { metric: 'Failed runs', a: a.fails, b: b.fails },
      { metric: 'Avg run duration (s)', a: Math.round(a.avgRunMs / 1000), b: Math.round(b.avgRunMs / 1000) },
      { metric: 'Tasks done', a: a.tasksDone, b: b.tasksDone },
      ...roles.map((role) => ({ metric: `${role} tokens`, a: a.agents[role]?.tokens ?? 0, b: b.agents[role]?.tokens ?? 0 })),
    ],
  };
}
