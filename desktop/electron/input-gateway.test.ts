import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStateFrame, encodeRumbleFrame, InputGateway, InputStatus, MAX_FRAMES_PER_SECOND } from './input-gateway';

function frame(seq: number, buttons = 0x1000, extra: Partial<{ lt: number; rt: number; lx: number; ly: number; rx: number; ry: number }> = {}): Uint8Array {
  const b = new Uint8Array(18);
  const v = new DataView(b.buffer);
  v.setUint8(0, 1);
  v.setUint8(1, 1);
  v.setUint32(2, seq, true);
  v.setUint16(6, buttons, true);
  v.setUint8(8, extra.lt ?? 0);
  v.setUint8(9, extra.rt ?? 0);
  v.setInt16(10, extra.lx ?? 0, true);
  v.setInt16(12, extra.ly ?? 0, true);
  v.setInt16(14, extra.rx ?? 0, true);
  v.setInt16(16, extra.ry ?? 0, true);
  return b;
}

function setup() {
  const lines: string[] = [];
  const statuses: InputStatus[] = [];
  const rumbles: [string, number, number][] = [];
  let t = 0;
  const gw = new InputGateway((l) => lines.push(l), (s) => statuses.push(s), (g, a, b) => rumbles.push([g, a, b]), () => t);
  return { gw, lines, statuses, rumbles, advance: (ms: number) => (t += ms) };
}

test('decodifica una trama válida y elimina el botón Guide', () => {
  const d = decodeStateFrame(frame(7, 0x1000 | 0x0400 | 0x0800, { lt: 10, rt: 255, lx: -32768, ly: 32767, rx: 5, ry: -5 }));
  assert.deepEqual(d, { seq: 7, state: { buttons: 0x1000, lt: 10, rt: 255, lx: -32768, ly: 32767, rx: 5, ry: -5 } });
});

test('rechaza tramas con tamaño, versión o tipo incorrectos', () => {
  assert.equal(decodeStateFrame(new Uint8Array(17)), null);
  assert.equal(decodeStateFrame(new Uint8Array(19)), null);
  const badVersion = frame(1);
  badVersion[0] = 2;
  assert.equal(decodeStateFrame(badVersion), null);
  const badType = frame(1);
  badType[1] = 2;
  assert.equal(decodeStateFrame(badType), null);
});

test('sin permiso no se reenvía nada', () => {
  const { gw, lines } = setup();
  assert.equal(gw.handleFrame('guest1', frame(1)), false);
  assert.deepEqual(lines, []);
});

test('con permiso: conecta un mando y reenvía el estado', () => {
  const { gw, lines } = setup();
  gw.setPermission('guest1', true);
  assert.deepEqual(lines, ['C 0']);
  assert.equal(gw.handleFrame('guest1', frame(1, 0x1000, { lx: 100, ly: -200 })), true);
  assert.equal(lines[1], 'S 0 4096 0 0 100 -200 0 0');
});

test('descarta tramas repetidas o desordenadas (anti-repetición)', () => {
  const { gw, lines } = setup();
  gw.setPermission('g', true);
  assert.equal(gw.handleFrame('g', frame(5)), true);
  assert.equal(gw.handleFrame('g', frame(5)), false);
  assert.equal(gw.handleFrame('g', frame(4)), false);
  assert.equal(gw.handleFrame('g', frame(6)), true);
  assert.equal(lines.filter((l) => l.startsWith('S')).length, 2);
  gw.resetSequence('g'); // nueva conexión de datos
  assert.equal(gw.handleFrame('g', frame(1)), true);
});

test('limita la frecuencia de tramas', () => {
  const { gw, advance } = setup();
  gw.setPermission('g', true);
  let ok = 0;
  for (let i = 1; i <= 500; i++) if (gw.handleFrame('g', frame(i))) ok++;
  assert.equal(ok, 50); // ráfaga máxima sin que pase el tiempo
  advance(1000);
  let ok2 = 0;
  for (let i = 501; i <= 1500; i++) if (gw.handleFrame('g', frame(i))) ok2++;
  assert.ok(ok2 <= 50, `ok2=${ok2}`);
  // A ritmo sostenido de 250/s se aceptan todas.
  let sustained = 0;
  for (let i = 0; i < MAX_FRAMES_PER_SECOND; i++) {
    advance(1000 / MAX_FRAMES_PER_SECOND);
    if (gw.handleFrame('g', frame(2000 + i))) sustained++;
  }
  assert.ok(sustained >= MAX_FRAMES_PER_SECOND - 1, `sustained=${sustained}`);
});

test('quitar el permiso desconecta el mando y bloquea las entradas', () => {
  const { gw, lines } = setup();
  gw.setPermission('g', true);
  gw.setPermission('g', false);
  assert.deepEqual(lines, ['C 0', 'D 0']);
  assert.equal(gw.handleFrame('g', frame(1)), false);
});

test('cada invitado tiene su propio puesto y releaseAll desconecta todos', () => {
  const { gw, lines } = setup();
  gw.setPermission('a', true);
  gw.setPermission('b', true);
  gw.handleFrame('b', frame(1, 0x2000));
  assert.ok(lines.includes('S 1 8192 0 0 0 0 0 0'));
  gw.releaseAll();
  assert.deepEqual(lines.slice(-2).sort(), ['D 0', 'D 1']);
  assert.equal(gw.handleFrame('a', frame(2)), false);
});

test('ids de invitado inválidos se ignoran', () => {
  const { gw, lines } = setup();
  gw.setPermission('../../x', true);
  gw.setPermission('a'.repeat(65), true);
  assert.deepEqual(lines, []);
});

test('procesa las respuestas del agente: puesto, vibración y driver ausente', () => {
  const { gw, statuses, rumbles } = setup();
  gw.handleAgentLine('READY 1 ViGEmBus (Xbox 360)');
  gw.setPermission('g', true);
  gw.handleAgentLine('CONNECTED 0 1');
  assert.deepEqual(statuses.at(-1)!.pads, { g: { connected: true, xinputIndex: 1 } });
  gw.handleAgentLine('RUMBLE 0 200 10');
  assert.deepEqual(rumbles, [['g', 200, 10]]);
  gw.handleAgentLine('ERROR NO_DRIVER ViGEmBus no está instalado');
  assert.equal(statuses.at(-1)!.agent, 'unavailable');
});

test('si el agente se reinicia, se vuelven a conectar los mandos permitidos', () => {
  const { gw, lines } = setup();
  gw.setPermission('g', true);
  gw.handleAgentLine('CONNECTED 0 1');
  gw.handleAgentLine('READY 1 x');
  assert.deepEqual(lines, ['C 0', 'C 0']);
});

test('codifica la vibración en 4 bytes y limita los valores', () => {
  assert.deepEqual([...encodeRumbleFrame(300, -5)], [1, 2, 255, 0]);
});
