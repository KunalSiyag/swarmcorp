// Seller-side tool: mints SwarmCorp Pro licence keys. Never ship the private key.
//   npx tsx scripts/issue-licence.ts --init                 create the signing keypair in ~/.config/swarmcorp-seller/
//   npx tsx scripts/issue-licence.ts --email a@b.com        print a Pro licence key for that buyer
// A key is base64url(payload) + "." + base64url(Ed25519 signature). server/licence.ts verifies it offline
// with the public key, so no licence server is needed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.config', 'swarmcorp-seller');
const PRIV = path.join(DIR, 'private.pem');
const PUB = path.join(DIR, 'public.pem');
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };

if (argv.includes('--init')) {
  if (fs.existsSync(PRIV)) {
    console.error(`A signing key already exists at ${PRIV}. Refusing to overwrite it (keys issued with it would stop working).`);
    process.exit(1);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  console.log(`Signing keypair written to ${DIR}. Back up private.pem somewhere safe.\nPaste this public key into server/licence.ts:\n`);
  console.log(fs.readFileSync(PUB, 'utf8'));
  process.exit(0);
}

const email = arg('email');
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('usage: issue-licence.ts --email buyer@example.com   (or --init once to create the signing key)');
  process.exit(1);
}
if (!fs.existsSync(PRIV)) {
  console.error(`No signing key at ${PRIV}. Run with --init first.`);
  process.exit(1);
}
const payload = { v: 1, plan: 'pro', email, id: crypto.randomUUID(), issuedAt: new Date().toISOString() };
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.sign(null, Buffer.from(body), fs.readFileSync(PRIV, 'utf8')).toString('base64url');
console.log(`${body}.${sig}`);
