// Drives the SwarmCorp hub with a scripted "company at work" so the dashboard can be previewed
// without spending tokens. It uses the real paths: POST /api/events with hook payloads, real queue
// files in <dir>/.claude/swarm-inbox, a real swarm-plan.json, and fake transcripts carrying usage.
//
//   npm run simulate -- [--dir /tmp/swarmcorp-demo] [--speed 1] [--loops 1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = path.resolve(arg('dir', path.join(os.tmpdir(), 'swarmcorp-demo')));
const SPEED = Number(arg('speed', '1'));
const LOOPS = Number(arg('loops', '1'));
const HUB = process.env.SWARMCORP_URL ?? `http://127.0.0.1:${process.env.SWARMCORP_PORT ?? 4317}`;
const RUN = crypto.randomBytes(2).toString('hex');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / SPEED));
const rand = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));

interface Actor { sid: string; role: string; agentId: string; transcript: string }
const actor = (role: string, agentId = role): Actor => ({
  sid: `sim-${RUN}-${agentId}`, role, agentId,
  transcript: path.join(DIR, '.sim-transcripts', `${agentId}.jsonl`),
});
const CEO = actor('ceo-dispatcher');
const RES = actor('opus-researcher');
const IMPL = [actor('sonnet-implementer', 'sonnet-implementer-1'), actor('sonnet-implementer', 'sonnet-implementer-2')];
const QA = actor('haiku-tester');
const AUD = actor('opus-auditor');
const ALL = [CEO, RES, ...IMPL, QA, AUD];

async function hook(a: Actor, hook: string, extra: Record<string, unknown> = {}) {
  const payload = { session_id: a.sid, transcript_path: a.transcript, cwd: DIR, hook_event_name: hook, ...extra };
  try {
    await fetch(`${HUB}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-swarmcorp-hook': '1' },
      body: JSON.stringify({ hook, swarm: { role: a.role, agentId: a.agentId, paneId: null }, payload }),
    });
  } catch (e) {
    console.error(`hub unreachable at ${HUB}: ${(e as Error).message}`);
    process.exit(1);
  }
}

function burn(a: Actor, scale = 1) {
  const usage = {
    input_tokens: rand(800, 4000) * scale, output_tokens: rand(300, 2500) * scale,
    cache_read_input_tokens: rand(8000, 40000) * scale, cache_creation_input_tokens: rand(0, 6000) * scale,
  };
  fs.appendFileSync(a.transcript, JSON.stringify({ type: 'assistant', message: { id: `msg_${crypto.randomBytes(6).toString('hex')}`, usage } }) + '\n');
}

function mail(from: string, to: string, kind: string, subject: string, task?: string) {
  const id = crypto.randomBytes(3).toString('hex');
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
  const name = `${ts}__${from}__${id}.json`;
  const msg = { id, from, to, kind, subject, body: subject, refs: { task_id: task ?? null, files: [], branch: null }, priority: 'normal', reply_to: null, created_at: now.toISOString() };
  for (const dir of [path.join(DIR, '.claude', 'swarm-inbox', to), path.join(DIR, '.claude', 'swarm-outbox', from)]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(msg, null, 2));
  }
  return path.join(DIR, '.claude', 'swarm-inbox', to, name);
}
function claim(file: string, me: string) {
  const dest = path.join(path.dirname(file), '.processing', `${me}__${path.basename(file)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(file, dest); } catch { /* already moved */ }
  return dest;
}
function done(claimed: string) {
  const box = path.dirname(path.dirname(claimed));
  const dest = path.join(box, '.done', path.basename(claimed).replace(/^.+?__(?=\d)/, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(claimed, dest); } catch { /* ignore */ }
}

const plan = {
  epic: 'EPIC-42 · Multi-tenant billing',
  goal: 'Every invoice, plan and webhook is tenant-scoped with audit trails',
  created_at: new Date().toISOString(),
  sprints: [
    { id: 'S1', name: 'Tenant data model', tasks: [
      { id: 'S1-T1', title: 'Add tenant_id to invoices', role: 'sonnet-implementer', status: 'pending' },
      { id: 'S1-T2', title: 'Row-level security policies', role: 'sonnet-implementer', status: 'pending' },
    ] },
    { id: 'S2', name: 'Billing API', tasks: [
      { id: 'S2-T1', title: 'Scope /invoices endpoints', role: 'sonnet-implementer', status: 'pending' },
      { id: 'S2-T2', title: 'Stripe webhook tenant routing', role: 'sonnet-implementer', status: 'pending' },
    ] },
    { id: 'S3', name: 'Hardening', tasks: [
      { id: 'S3-T1', title: 'Idempotency keys on retries', role: 'sonnet-implementer', status: 'pending' },
      { id: 'S3-T2', title: 'Audit log for plan changes', role: 'sonnet-implementer', status: 'pending' },
    ] },
  ],
};
const planFile = path.join(DIR, '.claude', 'swarm-plan.json');
function setTask(id: string, status: string, assignee?: string) {
  for (const s of plan.sprints) for (const t of s.tasks as any[]) if (t.id === id) { t.status = status; if (assignee) t.assignee = assignee; }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
}

let agentSeq = 0;
async function subagent(parent: Actor, type: string, description: string, ms: number, status: string) {
  const tool_use_id = `toolu_sim_${RUN}_${agentSeq}`;
  const agent_id = `agent-sim-${RUN}-${agentSeq++}`;
  const agentTranscript = path.join(DIR, '.sim-transcripts', `${agent_id}.jsonl`);
  await hook(parent, 'PreToolUse', { tool_name: 'Agent', tool_use_id, tool_input: { subagent_type: type, description, prompt: description } });
  await hook(parent, 'SubagentStart', { agent_id, agent_type: type });
  await sleep(ms);
  const sub = { ...parent, transcript: agentTranscript };
  burn(sub, 2); burn(sub, 1);
  await hook(parent, 'SubagentStop', { agent_id, agent_type: type, agent_transcript_path: agentTranscript, last_assistant_message: `Done.\nSTATUS: ${status}` });
  await hook(parent, 'PostToolUse', { tool_name: 'Agent', tool_use_id, tool_response: { status: 'completed', agentId: agent_id } });
}

async function work(a: Actor, prompt: string, ms: number, finalStatus: string) {
  await hook(a, 'UserPromptSubmit', { prompt });
  burn(a);
  await sleep(ms / 2);
  burn(a);
  await sleep(ms / 2);
  await hook(a, 'Stop', { last_assistant_message: `Work complete.\nSTATUS: ${finalStatus}` });
}

async function deliverTask(impl: Actor, taskId: string, title: string, failFirst: boolean) {
  const spec = claim(mail('opus-researcher', impl.agentId, 'spec', `${taskId} micro-spec: ${title}`, taskId), impl.agentId);
  setTask(taskId, 'in_progress', impl.agentId);
  await work(impl, `Implement ${taskId}: ${title}`, 2600, `PASS — ${taskId} implemented on swarm/${taskId.toLowerCase()}`);
  done(spec);
  let attempt = 0;
  for (;;) {
    setTask(taskId, 'review');
    const rv = claim(mail(impl.agentId, 'haiku-tester', 'review', `QA ${taskId} (branch swarm/${taskId.toLowerCase()})`, taskId), 'haiku-tester');
    const fail = failFirst && attempt === 0;
    await work(QA, `Run checks for ${taskId}`, 1600, fail ? `FAIL — 2 tests failing in ${taskId}` : `PASS — 48 checks green`);
    done(rv);
    if (!fail) break;
    attempt++;
    const fb = claim(mail('haiku-tester', impl.agentId, 'feedback', `${taskId}: invoice_test.ts:88 expected tenant scope`, taskId), impl.agentId);
    setTask(taskId, 'in_progress');
    await work(impl, `Fix QA feedback for ${taskId}`, 1800, `PASS — fixed tenant scope in ${taskId}`);
    done(fb);
  }
  const au = claim(mail('haiku-tester', 'opus-auditor', 'review', `Audit ${taskId}: QA PASS`, taskId), 'opus-auditor');
  await work(AUD, `Audit ${taskId} for races & authz`, 2200, `PASS — 0 critical, 0 high`);
  done(au);
  mail('opus-auditor', 'ceo-dispatcher', 'status', `Audit PASS ${taskId}`, taskId);
  setTask(taskId, 'done');
}

async function main() {
  fs.mkdirSync(path.join(DIR, '.sim-transcripts'), { recursive: true });
  fs.mkdirSync(path.join(DIR, '.claude', 'swarm-inbox'), { recursive: true });
  for (const s of plan.sprints) for (const t of s.tasks as any[]) { t.status = 'pending'; t.assignee = null; }
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  console.log(`Simulating SwarmCorp in ${DIR} → ${HUB} (speed ${SPEED}x)`);

  for (const a of ALL) { await hook(a, 'SessionStart', { source: 'startup', model: a.role.startsWith('opus') || a.role === 'ceo-dispatcher' ? 'claude-opus-5-5' : a.role.startsWith('sonnet') ? 'claude-sonnet-5-5' : 'claude-haiku-5-5' }); await sleep(250); }

  for (let loop = 0; loop < LOOPS; loop++) {
    await hook(CEO, 'UserPromptSubmit', { prompt: 'Ship EPIC-42: multi-tenant billing. Plan it, staff it, gate it.' });
    burn(CEO, 2);
    await subagent(CEO, 'opus-researcher', 'Impact study: tenancy across billing', 2400, 'PASS — impact study + 6 specs in .claude/docs');
    await subagent(CEO, 'Explore', 'Map invoice call sites', 1200, 'PASS — 23 call sites');
    mail('ceo-dispatcher', 'opus-researcher', 'task', 'Write micro-specs for sprint S1–S3');
    await work(RES, 'Process inbox: write micro-specs', 2000, 'PASS — 6 specs dispatched');

    for (const sprint of plan.sprints) {
      await hook(CEO, 'PreToolUse', { tool_name: 'Bash', tool_input: {} });
      const [a, b] = sprint.tasks;
      await Promise.all([
        deliverTask(IMPL[0], a.id, a.title, sprint.id === 'S1'),
        (async () => {
          await sleep(700);
          if (sprint.id === 'S2') {
            await hook(IMPL[1], 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash: npm install stripe@latest' });
            mail('sonnet-implementer-2', 'ceo-dispatcher', 'permission', 'Approve adding dependency stripe@latest?', b.id);
            await sleep(2500);
          }
          await deliverTask(IMPL[1], b.id, b.title, sprint.id === 'S3');
        })(),
        subagent(CEO, 'haiku-tester', `Smoke-test integration branch after ${sprint.id}`, 1800, 'PASS — smoke green'),
      ]);
      await subagent(CEO, 'opus-auditor', `Pre-merge audit ${sprint.id}`, 1500, 'PASS — merge approved');
      await hook(CEO, 'Stop', { last_assistant_message: `Sprint ${sprint.id} merged.\nSTATUS: PASS — ${sprint.name} shipped` });
      burn(CEO);
      await sleep(600);
    }
  }
  console.log('Simulation finished. (Session ids prefixed sim-; use Reset in the dashboard to clear.)');
}

main();
