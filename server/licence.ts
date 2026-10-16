import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LicenceInfo } from '../shared/types.ts';

// Two kinds of Pro key:
//  1. Dodo Payments keys: generated and emailed by Dodo for each purchase. Activated once against Dodo's public
//     licence API (no API key needed), then re-validated about once a day. Pro keeps working offline for 30 days
//     after the last successful check.
//  2. Signed keys: base64url(payload) + "." + base64url(Ed25519 signature), minted by scripts/issue-licence.ts for
//     comps, press and manual sales. Verified fully offline with the public key below.

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUagCiqxNHh3ZW7plzT50emKu8PYiEEQQ1stSj5iLNTg=
-----END PUBLIC KEY-----`;

const FILE = path.join(os.homedir(), '.config', 'swarmcorp', 'licence.key');
const DODO = process.env.SWARMCORP_DODO_ENV === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
const DAY = 24 * 3600_000;
const GRACE = 30 * DAY;
const FREE: LicenceInfo = { plan: 'free', email: null, issuedAt: null, source: null, keyHint: null };

type Stored =
  | { kind: 'signed'; key: string }
  | { kind: 'dodo'; key: string; instanceId: string; checkedAt: number; valid: boolean };

const hint = (key: string) => `…${key.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`;
const looksSigned = (key: string) => /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/.test(key.trim());

export function verifySigned(key: string): LicenceInfo | null {
  const [body, sig] = key.trim().split('.');
  if (!body || !sig || body.length > 2048 || sig.length > 512) return null;
  try {
    if (!crypto.verify(null, Buffer.from(body), PUBLIC_KEY, Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p?.plan !== 'pro' || typeof p.email !== 'string') return null;
    return { plan: 'pro', email: p.email, issuedAt: typeof p.issuedAt === 'string' ? p.issuedAt : null, source: 'signed', keyHint: hint(key) };
  } catch {
    return null;
  }
}

async function dodo(endpoint: 'activate' | 'validate' | 'deactivate', body: Record<string, string>) {
  const res = await fetch(`${DODO}/licenses/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

function read(): Stored | null {
  let raw = '';
  try { raw = fs.readFileSync(FILE, 'utf8').trim(); } catch { return null; }
  if (!raw) return null;
  if (raw.startsWith('{')) { try { return JSON.parse(raw); } catch { return null; } }
  return { kind: 'signed', key: raw }; // v0.3 format: the bare signed key
}

function write(s: Stored) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(s) + '\n', { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
}

let cached: { at: number; info: LicenceInfo } | null = null;
let revalidating = false;

/** Re-checks a Dodo key in the background; never blocks a request. */
function revalidate(s: Extract<Stored, { kind: 'dodo' }>) {
  if (revalidating) return;
  revalidating = true;
  dodo('validate', { license_key: s.key, license_key_instance_id: s.instanceId })
    .then(({ status, data }) => {
      if (status === 200 && typeof data.valid === 'boolean') { write({ ...s, valid: data.valid, checkedAt: Date.now() }); cached = null; }
    })
    .catch(() => { /* offline: keep the grace period running */ })
    .finally(() => { revalidating = false; });
}

export function currentLicence(): LicenceInfo {
  if (cached && Date.now() - cached.at < 5000) return cached.info;
  let info = FREE;
  const env = process.env.SWARMCORP_LICENCE;
  if (env && looksSigned(env)) info = verifySigned(env) ?? FREE;
  else {
    const s = read();
    if (s?.kind === 'signed') info = verifySigned(s.key) ?? FREE;
    else if (s?.kind === 'dodo') {
      if (Date.now() - s.checkedAt > DAY) revalidate(s);
      if (s.valid && Date.now() - s.checkedAt < GRACE) info = { plan: 'pro', email: null, issuedAt: null, source: 'dodo', keyHint: hint(s.key) };
    }
  }
  cached = { at: Date.now(), info };
  return info;
}

export const isPro = () => currentLicence().plan === 'pro';

export async function activateLicence(key: string): Promise<LicenceInfo> {
  const k = key.trim();
  if (!k || k.length > 4096) throw Object.assign(new Error('Paste the licence key from your purchase email.'), { status: 400 });
  if (looksSigned(k)) {
    const info = verifySigned(k);
    if (!info) throw Object.assign(new Error('That licence key is not valid. Paste the whole key, including the dot.'), { status: 400 });
    write({ kind: 'signed', key: k });
    cached = null;
    return info;
  }
  let r: Awaited<ReturnType<typeof dodo>>;
  try {
    r = await dodo('activate', { license_key: k, name: `SwarmCorp on ${os.hostname()}`.slice(0, 120) });
  } catch {
    throw Object.assign(new Error("Couldn't reach Dodo Payments to activate the key. Check your connection and try again."), { status: 502 });
  }
  if (r.status === 404) throw Object.assign(new Error('Dodo Payments doesn\'t recognise that key. Copy it again from your purchase email.'), { status: 400 });
  if (r.status === 403) throw Object.assign(new Error('That key is not active (refunded or disabled). Contact support with your receipt.'), { status: 400 });
  if (r.status === 422) throw Object.assign(new Error('That key has reached its activation limit. Deactivate it on another machine first.'), { status: 400 });
  if (r.status >= 300 || typeof r.data.id !== 'string') throw Object.assign(new Error(`Activation failed (${r.status}).`), { status: 502 });
  write({ kind: 'dodo', key: k, instanceId: r.data.id, checkedAt: Date.now(), valid: true });
  cached = null;
  return currentLicence();
}

export async function deactivateLicence(): Promise<LicenceInfo> {
  const s = read();
  // Free the activation slot so the key can be used on another machine.
  if (s?.kind === 'dodo') await dodo('deactivate', { license_key: s.key, license_key_instance_id: s.instanceId }).catch(() => {});
  try { fs.unlinkSync(FILE); } catch { /* not activated */ }
  cached = null;
  return currentLicence();
}
