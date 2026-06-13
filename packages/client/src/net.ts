import type { ClientMsg, ServerMsg } from '../../server/src/protocol';

export type { ClientMsg, ServerMsg };
export type {
  BuildingView, PlayerView, NodeView, GroundItemView, CreatureView, ProjectileView, ProfileView,
} from '../../server/src/protocol';

type Handler = (msg: ServerMsg) => void;

/**
 * Resolve the game server WebSocket URL. Priority:
 *   1. window.__LF_SERVER__  — injected by the Electron preload (desktop → VDS)
 *   2. VITE_SERVER_URL       — baked at build time
 *   3. same-origin           — browser default (served by the VDS Node server)
 * A value that already carries a ws(s):// scheme is used verbatim.
 */
function resolveServerUrl(): string {
  const injected = (globalThis as { __LF_SERVER__?: string }).__LF_SERVER__;
  const built = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SERVER_URL;
  const v = injected || built;
  if (v) return /^wss?:\/\//.test(v) ? v : `${wsProto()}://${v.replace(/^\/+/, '')}/ws`;
  return `${wsProto()}://${location.host}/ws`;
}
function wsProto(): string { return location.protocol === 'https:' ? 'wss' : 'ws'; }

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: ClientMsg[] = [];

  connect(): void {
    this.ws = new WebSocket(resolveServerUrl());
    this.ws.onopen = () => {
      this.send({ t: 'hello', token: localStorage.getItem('lf_token') ?? undefined });
      for (const m of this.queue) this.send(m);
      this.queue.length = 0;
    };
    this.ws.onmessage = ev => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      if (msg.t === 'welcome') localStorage.setItem('lf_token', msg.token);
      for (const h of this.handlers) h(msg);
    };
    this.ws.onclose = () => {
      // auto-reconnect; server holds our seat for 60 s
      setTimeout(() => this.connect(), 1500);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
