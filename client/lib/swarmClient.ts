import { useSyncExternalStore } from 'react';
import type { ClientMsg, Pulse, ServerMsg, Snapshot } from '../../shared/types.ts';

type Listener = () => void;
const PTY_HISTORY_MAX = 512 * 1024;

/** Single WebSocket connection to the SwarmCorp hub, shared by every component. */
class SwarmClient {
  snapshot: Snapshot | null = null;
  connected = false;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pulseListeners = new Set<(p: Pulse) => void>();
  private ptyListeners = new Map<string, Set<(d: string) => void>>();
  private ptyHistory = new Map<string, string>();
  private retry = 0;
  private outbox: ClientMsg[] = [];

  constructor() { this.connect(); }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      // Replays arrive fresh after a reconnect; drop stale local history first.
      this.ptyHistory.clear();
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
      this.emit();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.t) {
        case 'snapshot': this.snapshot = msg.s; this.emit(); break;
        case 'pulse': for (const l of this.pulseListeners) l(msg.p); break;
        case 'pty':
        case 'pty-replay': {
          const h = (this.ptyHistory.get(msg.id) ?? '') + msg.d;
          this.ptyHistory.set(msg.id, h.length > PTY_HISTORY_MAX ? h.slice(-PTY_HISTORY_MAX) : h);
          for (const l of this.ptyListeners.get(msg.id) ?? []) l(msg.d);
          break;
        }
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit();
      const delay = Math.min(8000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private emit() { for (const l of this.listeners) l(); }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  onPulse(l: (p: Pulse) => void) { this.pulseListeners.add(l); return () => { this.pulseListeners.delete(l); }; }

  /** Subscribe to a terminal's output; returns everything received so far for initial paint. */
  attachPty(id: string, l: (d: string) => void): { history: string; detach: () => void } {
    let set = this.ptyListeners.get(id);
    if (!set) { set = new Set(); this.ptyListeners.set(id, set); }
    set.add(l);
    return { history: this.ptyHistory.get(id) ?? '', detach: () => { set!.delete(l); } };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'in') this.outbox.push(m);
  }

  async api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
    return data as T;
  }
}

export const swarm = new SwarmClient();

export function useSnapshot(): Snapshot | null {
  return useSyncExternalStore(swarm.subscribe, () => swarm.snapshot);
}
export function useConnected(): boolean {
  return useSyncExternalStore(swarm.subscribe, () => swarm.connected);
}
