#!/usr/bin/env node
// SwarmCorp dispatch queue: file-based async messaging between Claude Code employees.
//
//   swarm-mail send  --from <id> --to <id|role> --kind <kind> --subject <s> [--body <b> | --body-file <f>]
//                    [--task <task-id>] [--files a,b] [--branch <b>] [--priority low|normal|urgent] [--reply-to <id>]
//   swarm-mail inbox --me <id> [--role <role>] [--json]
//   swarm-mail claim <file> --me <id>
//   swarm-mail done  <file> --me <id>
//
// Layout (project root resolved via $SWARM_PROJECT, nearest .claude/swarm-*, or the git common dir):
//   .claude/swarm-inbox/<recipient>/<ts>__<from>__<id>.json      unread
//   .claude/swarm-inbox/<recipient>/.processing/<me>__<file>     claimed (atomic rename = lock)
//   .claude/swarm-inbox/<recipient>/.done/<file>                 archived
//   .claude/swarm-outbox/<sender>/<file>                         sent copies

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KINDS = ['task', 'spec', 'review', 'feedback', 'permission', 'question', 'answer', 'status'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FILE_RE = /^[0-9TZ]+__[A-Za-z0-9._-]+__[a-z0-9]+\.json$/;

export function assertName(label, v) {
  if (!v || !NAME_RE.test(v)) throw new Error(`invalid ${label}: ${JSON.stringify(v)} (allowed: letters, digits, . _ -)`);
  return v;
}

export function resolveProjectRoot(cwd = process.cwd()) {
  if (process.env.SWARM_PROJECT) return path.resolve(process.env.SWARM_PROJECT);
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const c = path.join(dir, '.claude');
    if (fs.existsSync(path.join(c, 'swarm-plan.json')) || fs.existsSync(path.join(c, 'swarm-inbox'))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  try {
    // Inside a git worktree the shared queue lives in the main checkout.
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500,
    }).toString().trim();
    if (common) return path.dirname(common);
  } catch { /* not a git repo */ }
  return path.resolve(cwd);
}

const inboxDir = (root, who) => path.join(root, '.claude', 'swarm-inbox', assertName('recipient', who));
const outboxDir = (root, who) => path.join(root, '.claude', 'swarm-outbox', assertName('sender', who));

function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function writeAtomic(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, name));
}

export function send(root, msg) {
  const from = assertName('from', msg.from);
  const to = assertName('to', msg.to);
  const kind = msg.kind ?? 'status';
  if (!KINDS.includes(kind)) throw new Error(`invalid kind ${kind}; expected one of ${KINDS.join(', ')}`);
  const id = crypto.randomBytes(4).toString('hex').slice(0, 6);
  const now = new Date();
  const full = {
    id, from, to, kind,
    subject: String(msg.subject ?? '').slice(0, 200),
    body: String(msg.body ?? ''),
    refs: { task_id: msg.task ?? null, files: msg.files ?? [], branch: msg.branch ?? null },
    priority: ['low', 'normal', 'urgent'].includes(msg.priority) ? msg.priority : 'normal',
    reply_to: msg.replyTo ?? null,
    created_at: now.toISOString(),
  };
  const name = `${stamp(now)}__${from}__${id}.json`;
  const data = JSON.stringify(full, null, 2) + '\n';
  writeAtomic(outboxDir(root, from), name, data);
  writeAtomic(inboxDir(root, to), name, data);
  return { file: path.join(inboxDir(root, to), name), message: full };
}

export function inbox(root, me, role) {
  const boxes = [...new Set([me, role].filter(Boolean))];
  const out = [];
  for (const box of boxes) {
    let dir;
    try { dir = inboxDir(root, box); } catch { continue; }
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)); } catch { continue; }
    for (const n of names.sort()) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
        out.push({ ...m, box, file: path.join(dir, n) });
      } catch { /* partially written by a non-atomic writer; pick it up next time */ }
    }
  }
  const rank = { urgent: 0, normal: 1, low: 2 };
  return out.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || a.file.localeCompare(b.file));
}

function locate(root, fileArg) {
  const base = path.basename(fileArg);
  if (!FILE_RE.test(base)) throw new Error(`not a swarm message file: ${fileArg}`);
  const abs = path.resolve(fileArg);
  const inboxRoot = path.join(root, '.claude', 'swarm-inbox') + path.sep;
  if (!abs.startsWith(inboxRoot)) throw new Error(`message must live under ${inboxRoot}`);
  return { abs, base, box: path.dirname(abs) };
}

export function claim(root, fileArg, me) {
  assertName('me', me);
  const { abs, base, box } = locate(root, fileArg);
  const dest = path.join(box, '.processing', `${me}__${base}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(abs, dest); // atomic: exactly one claimant wins
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('already claimed by another employee (or done)');
    throw e;
  }
  return dest;
}

export function done(root, fileArg, me) {
  assertName('me', me);
  // Accept either the original inbox path or the .processing/<me>__<file> path returned by claim.
  let box = path.dirname(path.resolve(fileArg));
  let base = path.basename(fileArg);
  if (path.basename(box) === '.processing') {
    box = path.dirname(box);
    base = base.replace(/^[A-Za-z0-9._-]+?__(?=[0-9TZ]+__)/, '');
  }
  const { abs } = locate(root, path.join(box, base));
  const claimed = path.join(box, '.processing', `${me}__${base}`);
  const src = fs.existsSync(claimed) ? claimed : abs;
  const dest = path.join(box, '.done', base);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  return dest;
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[k] = true;
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const root = resolveProjectRoot(opt.project ?? process.cwd());
  const me = opt.me ?? process.env.SWARM_AGENT_ID ?? process.env.SWARM_ROLE;
  switch (cmd) {
    case 'send': {
      const body = opt['body-file'] ? fs.readFileSync(opt['body-file'], 'utf8') : opt.body;
      const r = send(root, {
        from: opt.from ?? me, to: opt.to, kind: opt.kind, subject: opt.subject, body,
        task: opt.task, branch: opt.branch, priority: opt.priority, replyTo: opt['reply-to'],
        files: typeof opt.files === 'string' ? opt.files.split(',').map((s) => s.trim()).filter(Boolean) : [],
      });
      console.log(`sent ${r.message.kind} ${r.message.id} → ${r.message.to}: ${path.relative(root, r.file)}`);
      break;
    }
    case 'inbox': {
      const msgs = inbox(root, me, opt.role ?? process.env.SWARM_ROLE);
      if (opt.json) { console.log(JSON.stringify(msgs, null, 2)); break; }
      if (!msgs.length) { console.log('inbox empty'); break; }
      for (const m of msgs) {
        console.log(`[${m.priority}] ${m.kind.padEnd(10)} from ${m.from} → ${m.box}  "${m.subject}"\n    ${path.relative(root, m.file)}`);
      }
      break;
    }
    case 'claim': console.log(`claimed → ${path.relative(root, claim(root, pos[0], me))}`); break;
    case 'done': console.log(`archived → ${path.relative(root, done(root, pos[0], me))}`); break;
    default:
      console.log('usage: swarm-mail <send|inbox|claim|done> ... (see header of this file)');
      process.exitCode = cmd ? 1 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`swarm-mail: ${e.message}`); process.exit(1); }
}
