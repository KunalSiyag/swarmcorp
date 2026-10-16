import type { EdgeLabel, ModelTier, NodeStatus, PaneStatus } from '../../shared/types.ts';

// See docs/design-system.md. One accent (SIGNAL) for live data, primary actions and the active tab;
// status colours only on status indicators; model identity by text tag + node size, never hue.
// These are `let` exports: ES modules give importers live bindings, so applyTheme() recolours
// SVG and canvas drawing on the next render without threading a palette through every prop.

export type ThemeName = 'night' | 'daylight';

const PALETTES = {
  // Night: Cutline type and motion on Raycast's midnight surfaces (near-black, hairlines, rationed warm accent).
  night: {
    signal: '#ff5a1f', ink: '#ece7df', ink2: '#a8a39b', ink3: '#6f6b65', line: '#1c1d20', line2: '#2f3031', canvas: '#050506',
    nodeFill: '#0d0e10', gridDot: '#1a1b1e', segIdle: '#26272a', meter: '#d8d2c8',
    run: '#4c8dff', ok: '#3ddc84', wait: '#ffb020', bad: '#ff4d4d', off: '#4a4744',
  },
  // Daylight (Pro): Vercel's typeset-terminal-on-white surfaces with Brex's single ember accent.
  daylight: {
    signal: '#ff5900', ink: '#171717', ink2: '#4d4d4d', ink3: '#8f8f8f', line: '#ebebeb', line2: '#d4d4d4', canvas: '#fafafa',
    nodeFill: '#ffffff', gridDot: '#e6e6e6', segIdle: '#dcdcdc', meter: '#171717',
    run: '#0a63e8', ok: '#18794e', wait: '#a35200', bad: '#cd2b31', off: '#b3b3b3',
  },
} as const;

export let SIGNAL: string = PALETTES.night.signal;
export let INK: string = PALETTES.night.ink;
export let INK_2: string = PALETTES.night.ink2;
export let INK_3: string = PALETTES.night.ink3;
export let LINE: string = PALETTES.night.line;
export let LINE_2: string = PALETTES.night.line2;
export let CANVAS: string = PALETTES.night.canvas;
export let NODE_FILL: string = PALETTES.night.nodeFill;
export let GRID_DOT: string = PALETTES.night.gridDot;
export let SEG_IDLE: string = PALETTES.night.segIdle;
export let METER: string = PALETTES.night.meter;

export const MODEL_TAG: Record<ModelTier, string> = {
  opus: 'OPUS', sonnet: 'SONNET', haiku: 'HAIKU', fable: 'FABLE', unknown: 'CLAUDE',
};
/** Model weight → node size and ring weight (bigger model, heavier mark). */
export const MODEL_WEIGHT: Record<ModelTier, number> = { fable: 1.15, opus: 1.1, sonnet: 1, haiku: 0.9, unknown: 1 };

export const STATUS_COLOR: Record<NodeStatus, string> = {
  running: PALETTES.night.run, idle: PALETTES.night.ok, done: PALETTES.night.ok,
  waiting: PALETTES.night.wait, failed: PALETTES.night.bad, offline: PALETTES.night.off,
};
export const STATUS_WORD: Record<NodeStatus, string> = {
  running: 'Running', idle: 'Idle', done: 'Done', waiting: 'Needs input', failed: 'Failed', offline: 'Offline',
};
export const STATUS_ICON: Record<NodeStatus, string> = {
  running: '▶', idle: '●', done: '✓', waiting: '⏸', failed: '✕', offline: '○',
};

export const PANE_WORD: Record<PaneStatus, string> = {
  running: 'Running', idle: 'Done · Idle', waiting: 'Paused for input', starting: 'Starting', exited: 'Exited',
};
export const PANE_ICON: Record<PaneStatus, string> = {
  running: '▶', idle: '✓', waiting: '⏸', starting: '…', exited: '■',
};

/** Data in motion is SIGNAL. Edge kinds that carry status meaning borrow the status palette. */
export const EDGE_COLOR: Record<EdgeLabel, string> = {
  Task: SIGNAL, Spec: SIGNAL, 'Code review': SIGNAL,
  'Feedback Loop': STATUS_COLOR.failed, 'Permission request': STATUS_COLOR.waiting, Result: STATUS_COLOR.done, Message: INK_2,
};

export function applyTheme(name: ThemeName) {
  const p = PALETTES[name] ?? PALETTES.night;
  SIGNAL = p.signal; INK = p.ink; INK_2 = p.ink2; INK_3 = p.ink3; LINE = p.line; LINE_2 = p.line2; CANVAS = p.canvas;
  NODE_FILL = p.nodeFill; GRID_DOT = p.gridDot; SEG_IDLE = p.segIdle; METER = p.meter;
  Object.assign(STATUS_COLOR, { running: p.run, idle: p.ok, done: p.ok, waiting: p.wait, failed: p.bad, offline: p.off });
  Object.assign(EDGE_COLOR, {
    Task: p.signal, Spec: p.signal, 'Code review': p.signal, 'Feedback Loop': p.bad, 'Permission request': p.wait, Result: p.ok, Message: p.ink2,
  });
  document.documentElement.dataset.theme = name;
}

export const fmtNum = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString();

export const fmtAgo = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
