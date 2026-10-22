// Protocolo binario del DataChannel "input" (lado de la interfaz). Debe coincidir con electron/input-gateway.ts.

export const INPUT_VERSION = 1;
export const FRAME_STATE = 1;
export const FRAME_RUMBLE = 2;
export const STATE_FRAME_SIZE = 18;

export interface PadState {
  buttons: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export const NEUTRAL: PadState = { buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 };

// Bits XUSB (XInput).
export const XB = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LS: 0x0040, RS: 0x0080,
  LB: 0x0100, RB: 0x0200, A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
} as const;

/**
 * Mapeo "standard" de la Gamepad API (igual para Xbox, DualShock 4 y DualSense en Chromium) → XUSB.
 * El botón 16 (Guide/PS) NO se mapea: abriría menús del sistema en el PC del anfitrión.
 */
const STANDARD_TO_XUSB: [number, number][] = [
  [0, XB.A], [1, XB.B], [2, XB.X], [3, XB.Y],
  [4, XB.LB], [5, XB.RB], [8, XB.BACK], [9, XB.START],
  [10, XB.LS], [11, XB.RS], [12, XB.UP], [13, XB.DOWN], [14, XB.LEFT], [15, XB.RIGHT],
];

interface GamepadLike {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

function axis(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(v * 32767))) || 0; // || 0 evita -0
}

function trigger(b: { pressed: boolean; value: number } | undefined): number {
  if (!b) return 0;
  const v = Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function mapStandardGamepad(gp: GamepadLike): PadState {
  let buttons = 0;
  for (const [index, bit] of STANDARD_TO_XUSB) {
    if (gp.buttons[index]?.pressed) buttons |= bit;
  }
  return {
    buttons,
    lt: trigger(gp.buttons[6]),
    rt: trigger(gp.buttons[7]),
    lx: axis(gp.axes[0]),
    ly: axis(-(gp.axes[1] ?? 0)), // en la Gamepad API, abajo es positivo; en XInput, arriba
    rx: axis(gp.axes[2]),
    ry: axis(-(gp.axes[3] ?? 0)),
  };
}

export function sameState(a: PadState, b: PadState): boolean {
  return a.buttons === b.buttons && a.lt === b.lt && a.rt === b.rt && a.lx === b.lx && a.ly === b.ly && a.rx === b.rx && a.ry === b.ry;
}

export function encodeStateFrame(seq: number, s: PadState): Uint8Array {
  const buf = new Uint8Array(STATE_FRAME_SIZE);
  const v = new DataView(buf.buffer);
  v.setUint8(0, INPUT_VERSION);
  v.setUint8(1, FRAME_STATE);
  v.setUint32(2, seq >>> 0, true);
  v.setUint16(6, s.buttons & 0xffff, true);
  v.setUint8(8, s.lt);
  v.setUint8(9, s.rt);
  v.setInt16(10, s.lx, true);
  v.setInt16(12, s.ly, true);
  v.setInt16(14, s.rx, true);
  v.setInt16(16, s.ry, true);
  return buf;
}

/** Vibración enviada por el anfitrión. Cualquier otra cosa se descarta. */
export function decodeRumbleFrame(data: unknown): { large: number; small: number } | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
  if (!bytes || bytes.byteLength !== 4 || bytes[0] !== INPUT_VERSION || bytes[1] !== FRAME_RUMBLE) return null;
  return { large: bytes[2], small: bytes[3] };
}

export type PadFamily = 'xbox' | 'playstation' | 'other';

export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  if (s.includes('054c') || s.includes('dualshock') || s.includes('dualsense') || s.includes('playstation')) return 'playstation';
  if (s.includes('xinput') || s.includes('xbox') || s.includes('045e')) return 'xbox';
  return 'other';
}

export function friendlyPadName(id: string): string {
  const s = id.toLowerCase();
  if (s.includes('0ce6') || s.includes('0df2') || s.includes('dualsense')) return 'Mando PS5 (DualSense)';
  if (padFamily(id) === 'playstation') return 'Mando PS4 (DualShock 4)';
  if (padFamily(id) === 'xbox') return 'Mando Xbox';
  return id.replace(/\s*\(.*\)\s*$/, '').trim() || 'Mando';
}

/** Nombre de cada botón según la familia del mando (para la vista de prueba). */
export function buttonLabels(family: PadFamily): [number, string][] {
  const ps = family === 'playstation';
  return [
    [XB.A, ps ? '✕' : 'A'], [XB.B, ps ? '○' : 'B'], [XB.X, ps ? '□' : 'X'], [XB.Y, ps ? '△' : 'Y'],
    [XB.LB, ps ? 'L1' : 'LB'], [XB.RB, ps ? 'R1' : 'RB'], [XB.BACK, ps ? 'Share' : 'View'], [XB.START, ps ? 'Options' : 'Menu'],
    [XB.LS, ps ? 'L3' : 'LS'], [XB.RS, ps ? 'R3' : 'RS'], [XB.UP, '↑'], [XB.DOWN, '↓'], [XB.LEFT, '←'], [XB.RIGHT, '→'],
  ];
}
