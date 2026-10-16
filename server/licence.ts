import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LicenceInfo } from '../shared/types.ts';

// Offline verification of Pro licence keys: base64url(payload) + "." + base64url(Ed25519 signature).
// Keys are minted by scripts/issue-licence.ts with the seller's private key; only the public key ships.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUagCiqxNHh3ZW7plzT50emKu8PYiEEQQ1stSj5iLNTg=
-----END PUBLIC KEY-----`;

const FILE = path.join(os.homedir(), '.config', 'swarmcorp', 'licence.key');
const FREE: LicenceInfo = { plan: 'free', email: null, issuedAt: null };

export function verifyKey(key: string): LicenceInfo | null {
  const [body, sig] = key.trim().split('.');
  if (!body || !sig || body.length > 2048 || sig.length > 512) return null;
  try {
    if (!crypto.verify(null, Buffer.from(body), PUBLIC_KEY, Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p?.plan !== 'pro' || typeof p.email !== 'string') return null;
    return { plan: 'pro', email: p.email, issuedAt: typeof p.issuedAt === 'string' ? p.issuedAt : null };
  } catch {
    return null;
  }
}

let cached: { at: number; info: LicenceInfo } | null = null;

export function currentLicence(): LicenceInfo {
  if (cached && Date.now() - cached.at < 5000) return cached.info;
  let info = FREE;
  const fromEnv = process.env.SWARMCORP_LICENCE;
  const key = fromEnv ?? (() => { try { return fs.readFileSync(FILE, 'utf8'); } catch { return ''; } })();
  if (key) info = verifyKey(key) ?? FREE;
  cached = { at: Date.now(), info };
  return info;
}

export const isPro = () => currentLicence().plan === 'pro';

export function activateLicence(key: string): LicenceInfo {
  const info = verifyKey(key);
  if (!info) throw Object.assign(new Error('That licence key is not valid. Paste the whole key, including the dot.'), { status: 400 });
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, key.trim() + '\n', { mode: 0o600 });
  cached = null;
  return info;
}

export function deactivateLicence(): LicenceInfo {
  try { fs.unlinkSync(FILE); } catch { /* not activated */ }
  cached = null;
  return currentLicence();
}
