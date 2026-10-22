// Puerta de entrada de los mandos remotos (proceso principal). Lógica pura, sin Electron, para poder probarla.
//
// Formato binario del DataChannel "input" (little-endian):
//   invitado → anfitrión, 18 bytes:
//     [0] versión=1  [1] tipo=1 (estado)  [2..5] seq u32  [6..7] botones u16 (XUSB)
//     [8] gatillo izq. u8  [9] gatillo der. u8  [10..17] LX, LY, RX, RY i16
//   anfitrión → invitado, 4 bytes:
//     [0] versión=1  [1] tipo=2 (vibración)  [2] motor grande u8  [3] motor pequeño u8

export const INPUT_VERSION = 1;
export const FRAME_STATE = 1;
export const FRAME_RUMBLE = 2;
export const STATE_FRAME_SIZE = 18;
export const RUMBLE_FRAME_SIZE = 4;

/** Guide (0x0400) abre la Xbox Game Bar o Steam del anfitrión, y 0x0800 no está definido: nunca se reenvían. */
export const ALLOWED_BUTTONS = 0xffff & ~(0x0400 | 0x0800);
export const MAX_SLOTS = 4;
export const MAX_FRAMES_PER_SECOND = 250;
export const BURST = 50;

export interface PadState {
  buttons: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export interface DecodedFrame {
  seq: number;
  state: PadState;
}

export function decodeStateFrame(data: Uint8Array): DecodedFrame | null {
  if (!(data instanceof Uint8Array) || data.byteLength !== STATE_FRAME_SIZE) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== INPUT_VERSION || v.getUint8(1) !== FRAME_STATE) return null;
  return {
    seq: v.getUint32(2, true),
    state: {
      buttons: v.getUint16(6, true) & ALLOWED_BUTTONS,
      lt: v.getUint8(8),
      rt: v.getUint8(9),
      lx: v.getInt16(10, true),
      ly: v.getInt16(12, true),
      rx: v.getInt16(14, true),
      ry: v.getInt16(16, true),
    },
  };
}

export function encodeRumbleFrame(large: number, small: number): Uint8Array {
  return Uint8Array.of(INPUT_VERSION, FRAME_RUMBLE, clampByte(large), clampByte(small));
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v) | 0));
}

export type AgentAvailability = 'starting' | 'ready' | 'unavailable';

export interface InputStatus {
  agent: AgentAvailability;
  message: string | null;
  /** Por participantId: si tiene mando virtual y en qué puesto XInput (0-3, -1 si se desconoce). */
  pads: Record<string, { connected: boolean; xinputIndex: number }>;
  dropped: number;
}

interface GuestInput {
  slot: number;
  allowed: boolean;
  connected: boolean;
  xinputIndex: number;
  lastSeq: number;
  tokens: number;
  lastRefill: number;
}

/**
 * Valida y reenvía las entradas de cada invitado a su mando virtual.
 * - Solo con permiso explícito del anfitrión (setPermission).
 * - Descarta tramas malformadas, repetidas o desordenadas (seq ≤ última) y las que superan la frecuencia máxima.
 */
export class InputGateway {
  private readonly guests = new Map<string, GuestInput>();
  private agent: AgentAvailability = 'starting';
  private agentMessage: string | null = null;
  private dropped = 0;

  constructor(
    private readonly sendToAgent: (line: string) => void,
    private readonly onStatus: (s: InputStatus) => void,
    private readonly onRumble: (guestId: string, large: number, small: number) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setPermission(guestId: string, allowed: boolean): void {
    if (typeof guestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(guestId)) return;
    let g = this.guests.get(guestId);
    if (allowed) {
      if (!g) {
        const slot = this.freeSlot();
        if (slot < 0) return;
        g = { slot, allowed: true, connected: false, xinputIndex: -1, lastSeq: -1, tokens: BURST, lastRefill: this.now() };
        this.guests.set(guestId, g);
      }
      if (!g.allowed || !g.connected) {
        g.allowed = true;
        this.sendToAgent(`C ${g.slot}`);
      }
    } else if (g) {
      this.guests.delete(guestId);
      this.sendToAgent(`D ${g.slot}`);
    }
    this.emitStatus();
  }

  /** Nueva conexión de datos con el invitado: se reinicia la secuencia esperada. */
  resetSequence(guestId: string): void {
    const g = this.guests.get(guestId);
    if (g) g.lastSeq = -1;
  }

  handleFrame(guestId: string, data: unknown): boolean {
    const g = this.guests.get(guestId);
    if (!g || !g.allowed) return this.drop();
    const frame = data instanceof Uint8Array ? decodeStateFrame(data) : null;
    if (!frame) return this.drop();
    if (frame.seq <= g.lastSeq) return this.drop(); // repetida o desordenada
    if (!this.takeToken(g)) return this.drop();
    g.lastSeq = frame.seq;
    const s = frame.state;
    this.sendToAgent(`S ${g.slot} ${s.buttons} ${s.lt} ${s.rt} ${s.lx} ${s.ly} ${s.rx} ${s.ry}`);
    return true;
  }

  /** Suelta todo y desconecta todos los mandos virtuales (fin de sesión, emergencia, cierre). */
  releaseAll(): void {
    for (const g of this.guests.values()) this.sendToAgent(`D ${g.slot}`);
    this.guests.clear();
    this.emitStatus();
  }

  /** Procesa una línea de salida del agente. */
  handleAgentLine(line: string): void {
    const p = line.trim().split(' ');
    switch (p[0]) {
      case 'READY':
        this.agent = 'ready';
        this.agentMessage = null;
        // Si el agente se reinició, se vuelven a crear los mandos permitidos.
        for (const g of this.guests.values()) {
          g.connected = false;
          if (g.allowed) this.sendToAgent(`C ${g.slot}`);
        }
        break;
      case 'CONNECTED': {
        const g = this.bySlot(Number(p[1]));
        if (g) {
          g.connected = true;
          g.xinputIndex = Number(p[2]);
        }
        break;
      }
      case 'DISCONNECTED': {
        const g = this.bySlot(Number(p[1]));
        if (g) g.connected = false;
        break;
      }
      case 'RUMBLE': {
        const entry = [...this.guests.entries()].find(([, g]) => g.slot === Number(p[1]));
        if (entry) this.onRumble(entry[0], Number(p[2]), Number(p[3]));
        return;
      }
      case 'ERROR':
        if (p[1] === 'NO_DRIVER') {
          this.agent = 'unavailable';
          this.agentMessage = 'El driver ViGEmBus no está instalado en este PC.';
        } else {
          this.agentMessage = p.slice(2).join(' ') || p[1] || 'Error del agente de mandos';
        }
        break;
      default:
        return;
    }
    this.emitStatus();
  }

  setAgentUnavailable(message: string): void {
    this.agent = 'unavailable';
    this.agentMessage = message;
    for (const g of this.guests.values()) g.connected = false;
    this.emitStatus();
  }

  status(): InputStatus {
    const pads: InputStatus['pads'] = {};
    for (const [id, g] of this.guests) pads[id] = { connected: g.connected, xinputIndex: g.xinputIndex };
    return { agent: this.agent, message: this.agentMessage, pads, dropped: this.dropped };
  }

  private emitStatus(): void {
    this.onStatus(this.status());
  }

  private drop(): boolean {
    this.dropped++;
    return false;
  }

  private takeToken(g: GuestInput): boolean {
    const t = this.now();
    g.tokens = Math.min(BURST, g.tokens + ((t - g.lastRefill) / 1000) * MAX_FRAMES_PER_SECOND);
    g.lastRefill = t;
    if (g.tokens < 1) return false;
    g.tokens -= 1;
    return true;
  }

  private freeSlot(): number {
    const used = new Set([...this.guests.values()].map((g) => g.slot));
    for (let i = 0; i < MAX_SLOTS; i++) if (!used.has(i)) return i;
    return -1;
  }

  private bySlot(slot: number): GuestInput | undefined {
    return [...this.guests.values()].find((g) => g.slot === slot);
  }
}
