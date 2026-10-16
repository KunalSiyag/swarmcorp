import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelTier, RoleInfo } from '../shared/types.ts';

// Presentation for the SwarmCorp org chart plus Claude Code's built-in agent types.
const PRESETS: Record<string, { label: string; avatar: string; model?: ModelTier }> = {
  'ceo-dispatcher': { label: 'CEO / Dispatcher', avatar: 'CEO', model: 'opus' },
  'opus-researcher': { label: 'Deep-Researcher', avatar: 'RES', model: 'opus' },
  'sonnet-implementer': { label: 'Code Implementer', avatar: 'DEV', model: 'sonnet' },
  'haiku-tester': { label: 'QA Tester', avatar: 'QA', model: 'haiku' },
  'opus-auditor': { label: 'Security Auditor', avatar: 'SEC', model: 'opus' },
  'general-purpose': { label: 'Generalist', avatar: 'GEN' },
  Explore: { label: 'Explorer', avatar: 'EXP', model: 'haiku' },
  Plan: { label: 'Planner', avatar: 'PLN' },
  'claude-code-guide': { label: 'Docs Guide', avatar: 'DOC' },
  'statusline-setup': { label: 'Statusline', avatar: 'CFG' },
  user: { label: 'You · Founder', avatar: 'YOU' },
  shell: { label: 'Shell', avatar: 'SH' },
  claude: { label: 'Claude', avatar: 'CC' },
  codex: { label: 'Codex', avatar: 'CDX', model: 'gpt' },
  gemini: { label: 'Gemini CLI', avatar: 'GEM', model: 'gemini' },
  antigravity: { label: 'Antigravity', avatar: 'AGY', model: 'gemini' },
  opencode: { label: 'opencode', avatar: 'OC' },
};

export function modelTier(s: unknown): ModelTier {
  const v = String(s ?? '').toLowerCase();
  if (v.includes('opus')) return 'opus';
  if (v.includes('sonnet')) return 'sonnet';
  if (v.includes('haiku')) return 'haiku';
  if (v.includes('fable')) return 'fable';
  if (v.includes('claude')) return 'unknown';
  if (/\bgpt|codex|\bo[134]\b|\bo[134]-/.test(v)) return 'gpt';
  if (v.includes('gemini')) return 'gemini';
  return 'unknown';
}

function parseFrontmatter(src: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

export class RoleRegistry {
  private roles = new Map<string, RoleInfo>();
  private loadedAt = 0;

  constructor(private extraDirs: () => string[]) {}

  private load() {
    if (Date.now() - this.loadedAt < 10_000) return;
    this.loadedAt = Date.now();
    const next = new Map<string, RoleInfo>();
    const dirs = [path.join(os.homedir(), '.claude', 'agents'), ...this.extraDirs().map((d) => path.join(d, '.claude', 'agents'))];
    for (const dir of dirs) {
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
      for (const f of files) {
        try {
          const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
          const name = fm.name || f.replace(/\.md$/, '');
          const preset = PRESETS[name];
          next.set(name, {
            name,
            label: preset?.label ?? name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            avatar: preset?.avatar ?? 'GEN',
            model: modelTier(fm.model) !== 'unknown' ? modelTier(fm.model) : (preset?.model ?? 'unknown'),
            description: (fm.description ?? '').slice(0, 300),
          });
        } catch { /* unreadable agent file */ }
      }
    }
    this.roles = next;
  }

  list(): RoleInfo[] {
    this.load();
    return [...this.roles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string | null | undefined): RoleInfo {
    this.load();
    const key = name || 'claude';
    const known = this.roles.get(key);
    if (known) return known;
    // Instance ids like "sonnet-implementer-2" inherit their role's presentation.
    const base = key.replace(/-\d+$/, '');
    if (base !== key && this.roles.has(base)) return { ...this.roles.get(base)!, name: key };
    const preset = PRESETS[key] ?? PRESETS[base];
    return {
      name: key,
      label: preset?.label ?? key,
      avatar: preset?.avatar ?? 'GEN',
      model: preset?.model ?? 'unknown',
      description: '',
    };
  }

  /** Strip an instance suffix: "sonnet-implementer-2" -> "sonnet-implementer" when that role exists. */
  baseRole(name: string): string {
    this.load();
    if (this.roles.has(name) || PRESETS[name]) return name;
    const base = name.replace(/-\d+$/, '');
    return this.roles.has(base) || PRESETS[base] ? base : name;
  }
}
