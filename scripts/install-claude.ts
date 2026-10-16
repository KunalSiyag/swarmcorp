// Installs the SwarmCorp company into ~/.claude, merging rather than overwriting:
//   CLAUDE.md          → replaces/appends only the <!-- SWARMCORP:BEGIN/END --> block
//   agents/*.md        → the five employees (existing files that differ are backed up first)
//   swarmcorp/*.mjs    → hook relay + swarm-mail CLI
//   settings.json      → adds env.SWARMCORP_URL and SwarmCorp hook groups; your other hooks are untouched
// Backups go to ~/.claude/backups/swarmcorp-<timestamp>/.
//
//   npm run install-claude                    install / upgrade (idempotent)
//   npm run install-claude -- --uninstall     remove hooks, env var and CLAUDE.md block (agents kept)
//   npm run install-claude -- --target DIR    install somewhere other than ~/.claude (testing)
//   npm run install-claude -- --port 4400     point hooks at a different dashboard port
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'claude-home');
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TARGET = path.resolve(arg('target') ?? path.join(os.homedir(), '.claude'));
const UNINSTALL = argv.includes('--uninstall');
const PORT = arg('port');
const MARK_BEGIN = '<!-- SWARMCORP:BEGIN';
const MARK_END = '<!-- SWARMCORP:END -->';
const HOOK_TAG = 'swarmcorp/swarm-hook.mjs';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(TARGET, 'backups', `swarmcorp-${stamp}`);
let backedUp = false;

function backup(file: string) {
  if (!fs.existsSync(file)) return;
  const dest = path.join(BACKUP, path.relative(TARGET, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  backedUp = true;
}

function writeIfChanged(file: string, content: string, mode?: number) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === content) return 'unchanged';
  if (prev !== null) backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
  if (mode) fs.chmodSync(file, mode);
  return prev === null ? 'created' : 'updated';
}

function stripBlock(md: string) {
  const a = md.indexOf(MARK_BEGIN);
  const b = md.indexOf(MARK_END);
  if (a < 0 || b < a) return md;
  return (md.slice(0, a).replace(/\s+$/, '') + '\n' + md.slice(b + MARK_END.length).replace(/^\s+/, '\n')).trim() + '\n';
}

function mergeClaudeMd() {
  const file = path.join(TARGET, 'CLAUDE.md');
  const block = fs.readFileSync(path.join(SRC, 'CLAUDE.md'), 'utf8').trim();
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const base = stripBlock(prev).trim();
  const next = UNINSTALL ? (base ? `${base}\n` : '') : `${base ? `${base}\n\n` : ''}${block}\n`;
  if (UNINSTALL && !prev) return 'absent';
  if (UNINSTALL && !next) { backup(file); fs.unlinkSync(file); return 'removed'; }
  return writeIfChanged(file, next);
}

function isOurs(group: any) {
  return Array.isArray(group?.hooks) && group.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(HOOK_TAG));
}

function mergeSettings() {
  const file = path.join(TARGET, 'settings.json');
  let settings: any = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try { settings = raw.trim() ? JSON.parse(raw) : {}; }
    catch (e) { throw new Error(`${file} is not valid JSON (${(e as Error).message}); fix it first — refusing to overwrite`); }
  }
  const tpl = JSON.parse(fs.readFileSync(path.join(SRC, 'settings.swarmcorp.json'), 'utf8'));
  const hookScript = path.join(TARGET, 'swarmcorp', 'swarm-hook.mjs');
  settings.hooks ??= {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
  }
  if (UNINSTALL) {
    if (settings.env) { delete settings.env.SWARMCORP_URL; if (!Object.keys(settings.env).length) delete settings.env; }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  } else {
    for (const [event, groups] of Object.entries<any[]>(tpl.hooks)) {
      const ours = groups.map((g) => ({
        ...g,
        hooks: g.hooks.map((h: any) => ({ ...h, command: h.command.replace('"$HOME/.claude/swarmcorp/swarm-hook.mjs"', JSON.stringify(hookScript)) })),
      }));
      settings.hooks[event] = [...(settings.hooks[event] ?? []), ...ours];
    }
    settings.env = { ...(settings.env ?? {}), SWARMCORP_URL: PORT ? `http://127.0.0.1:${PORT}` : tpl.env.SWARMCORP_URL };
  }
  return writeIfChanged(file, JSON.stringify(settings, null, 2) + '\n', 0o600);
}

function main() {
  fs.mkdirSync(TARGET, { recursive: true });
  const report: [string, string][] = [];
  if (!UNINSTALL) {
    for (const f of fs.readdirSync(path.join(SRC, 'agents'))) {
      report.push([`agents/${f}`, writeIfChanged(path.join(TARGET, 'agents', f), fs.readFileSync(path.join(SRC, 'agents', f), 'utf8'))]);
    }
    for (const f of fs.readdirSync(path.join(SRC, 'swarmcorp'))) {
      report.push([`swarmcorp/${f}`, writeIfChanged(path.join(TARGET, 'swarmcorp', f), fs.readFileSync(path.join(SRC, 'swarmcorp', f), 'utf8'), 0o755)]);
    }
  }
  report.push(['CLAUDE.md', mergeClaudeMd()]);
  report.push(['settings.json', mergeSettings()]);
  console.log(`${UNINSTALL ? 'Uninstalled from' : 'Installed into'} ${TARGET}`);
  for (const [f, s] of report) console.log(`  ${s.padEnd(10)} ${f}`);
  if (backedUp) console.log(`Backups: ${BACKUP}`);
  if (!UNINSTALL) console.log('Restart running Claude Code sessions (or run /hooks) to pick up the new hooks.');
}

try { main(); } catch (e) { console.error(`install-claude: ${(e as Error).message}`); process.exit(1); }
