import {
  decodeRumbleFrame, encodeStateFrame, friendlyPadName, mapStandardGamepad, NEUTRAL, padFamily, sameState, XB,
} from './input-protocol';

function pad(pressed: number[] = [], axes = [0, 0, 0, 0], triggers: [number, number] = [0, 0]) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  buttons[6] = { pressed: triggers[0] > 0.5, value: triggers[0] };
  buttons[7] = { pressed: triggers[1] > 0.5, value: triggers[1] };
  return { buttons, axes };
}

describe('mapStandardGamepad', () => {
  it('mapea botones de cara, gatillos y cruceta', () => {
    const s = mapStandardGamepad(pad([0, 3, 4, 12, 9], [0, 0, 0, 0], [0.5, 1]));
    expect(s.buttons).toBe(XB.A | XB.Y | XB.LB | XB.UP | XB.START);
    expect(s.lt).toBe(128);
    expect(s.rt).toBe(255);
  });

  it('invierte el eje Y (Gamepad API: abajo positivo → XInput: arriba positivo)', () => {
    const s = mapStandardGamepad(pad([], [1, -1, -1, 1]));
    expect(s).toMatchObject({ lx: 32767, ly: 32767, rx: -32767, ry: -32767 });
  });

  it('NO reenvía el botón Guide/PS', () => {
    expect(mapStandardGamepad(pad([16])).buttons).toBe(0);
  });

  it('limita valores fuera de rango y tolera mandos incompletos', () => {
    expect(mapStandardGamepad({ buttons: [], axes: [5, NaN] })).toEqual({ ...NEUTRAL, lx: 32767 });
  });
});

describe('tramas binarias', () => {
  it('codifica 18 bytes con el mismo formato que el proceso principal', () => {
    const f = encodeStateFrame(258, { buttons: XB.A, lt: 10, rt: 255, lx: -32768, ly: 32767, rx: 1, ry: -1 });
    expect(f.byteLength).toBe(18);
    expect([...f]).toEqual([1, 1, 2, 1, 0, 0, 0x00, 0x10, 10, 255, 0x00, 0x80, 0xff, 0x7f, 1, 0, 0xff, 0xff]);
  });

  it('solo acepta tramas de vibración válidas', () => {
    expect(decodeRumbleFrame(Uint8Array.of(1, 2, 200, 10).buffer)).toEqual({ large: 200, small: 10 });
    expect(decodeRumbleFrame(Uint8Array.of(1, 1, 200, 10))).toBeNull();
    expect(decodeRumbleFrame(new Uint8Array(5))).toBeNull();
    expect(decodeRumbleFrame('hola')).toBeNull();
  });

  it('sameState compara todos los campos', () => {
    expect(sameState(NEUTRAL, { ...NEUTRAL })).toBe(true);
    expect(sameState(NEUTRAL, { ...NEUTRAL, ry: 1 })).toBe(false);
  });
});

describe('identificación del mando', () => {
  it.each([
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox', 'Mando Xbox'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'playstation', 'Mando PS4 (DualShock 4)'],
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation', 'Mando PS5 (DualSense)'],
    ['8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8 Product: 6006)', 'other', '8BitDo Pro 2'],
  ])('%s', (id, family, name) => {
    expect(padFamily(id)).toBe(family);
    expect(friendlyPadName(id)).toBe(name);
  });
});
