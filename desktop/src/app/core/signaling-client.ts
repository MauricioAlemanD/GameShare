import { ServerMessage } from './models';

export type WsState = 'connecting' | 'online' | 'reconnecting' | 'closed';
/** Motivos por los que el servidor cierra la conexión y no tiene sentido reconectar. */
export type TerminalReason = 'unauthorized' | 'evicted' | 'replaced' | 'session-closed';

export interface SignalingHandlers {
  onMessage(msg: ServerMessage): void;
  onState(state: WsState): void;
  onTerminal(reason: TerminalReason): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

/** Interfaz mínima de WebSocket, para poder sustituirla en las pruebas. */
export interface WsLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const TERMINAL_CODES: Record<number, TerminalReason> = {
  4401: 'unauthorized',
  4403: 'evicted',
  4409: 'replaced',
  4410: 'session-closed',
};

export const PING_INTERVAL_MS = 20_000;
export const MAX_BACKOFF_MS = 15_000;

/** Cliente del WebSocket de señalización: se autentica en el primer mensaje, envía pings y reconecta con backoff. */
export class SignalingClient {
  private ws: WsLike | null = null;
  private stopped = false;
  private attempts = 0;
  private pingTimer: unknown = null;
  private retryTimer: unknown = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly handlers: SignalingHandlers,
    private readonly wsFactory: (url: string) => WsLike = (url) => new WebSocket(url) as unknown as WsLike,
    private readonly timers: Timers = {
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (id) => clearTimeout(id as number),
      setInterval: (f, ms) => setInterval(f, ms),
      clearInterval: (id) => clearInterval(id as number),
    },
  ) {}

  static wsUrl(baseUrl: string): string {
    return baseUrl.replace(/^http/, 'ws') + '/ws';
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close(1000, 'client-stop');
      } catch {
        /* ya cerrado */
      }
      this.ws = null;
    }
    this.handlers.onState('closed');
  }

  /** Envía un mensaje si la conexión está abierta. Devuelve false si no se pudo enviar. */
  send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private connect(): void {
    this.handlers.onState(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const ws = this.wsFactory(SignalingClient.wsUrl(this.baseUrl));
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'auth-ok') {
        this.attempts = 0;
        this.handlers.onState('online');
        this.startPing();
      }
      this.handlers.onMessage(msg);
    };
    ws.onerror = () => {
      /* el cierre llega después por onclose */
    };
    ws.onclose = (ev) => {
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      const terminal = TERMINAL_CODES[ev.code];
      if (terminal) {
        this.stopped = true;
        this.handlers.onState('closed');
        this.handlers.onTerminal(terminal);
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
      this.attempts++;
      this.handlers.onState('reconnecting');
      this.retryTimer = this.timers.setTimeout(() => this.connect(), delay);
    };
  }

  private startPing(): void {
    this.timers.clearInterval(this.pingTimer);
    this.pingTimer = this.timers.setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    this.timers.clearInterval(this.pingTimer);
    this.timers.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}
