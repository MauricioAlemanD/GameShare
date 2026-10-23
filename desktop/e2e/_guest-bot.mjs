// Invitada simulada: se une a una sala real y maneja un mando simulado según órdenes de un archivo.
// Uso: node e2e/_guest-bot.mjs "<enlace gameshare://...>" <archivo-ordenes.json> <archivo-estado.json>
// Órdenes: {"id": 1, "steps": [{"buttons": ["A"], "lx": 0, "ly": 0, "rx": 0, "ry": 0, "lt": 0, "rt": 0, "ms": 200}, ...]}
import { _electron as electron } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [link, cmdFile, statusFile] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUTTONS = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const status = (stage, extra = {}) => {
  writeFileSync(statusFile, JSON.stringify({ stage, at: new Date().toISOString(), ...extra }, null, 1));
  console.log(new Date().toLocaleTimeString(), stage, JSON.stringify(extra));
};

const env = { ...process.env, GAMESHARE_PROFILE: 'invitada-claude' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], cwd: root, env });
const page = await app.firstWindow();
await page.getByTestId('display-name').waitFor();

// Mando simulado: sustituye la Gamepad API (no ve tus mandos reales ni el virtual).
const installPad = () =>
  page.evaluate(() => {
    const pad = {
      index: 0,
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
    };
    window.__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  });

const setPad = (s) =>
  page.evaluate((s) => {
    const pad = window.__pad;
    if (!pad) return;
    pad.buttons.forEach((b, i) => {
      b.pressed = s.pressed.includes(i);
      b.value = b.pressed ? 1 : 0;
    });
    if (s.lt) pad.buttons[6] = { pressed: s.lt > 0.5, touched: true, value: s.lt };
    if (s.rt) pad.buttons[7] = { pressed: s.rt > 0.5, touched: true, value: s.rt };
    pad.axes = [s.lx, s.ly, s.rx, s.ry];
  }, s);

status('uniéndose');
await page.getByTestId('display-name').fill('Claude-mando');
await page.getByTestId('invite-input').fill(link);
await page.getByTestId('join-session').click();

// Primera vez: la invitación usa otro servidor → aceptar y la app se recarga y se une sola.
const mismatch = page.getByTestId('server-mismatch');
const waiting = page.getByTestId('waiting');
await Promise.race([mismatch.waitFor({ timeout: 20000 }), waiting.waitFor({ timeout: 20000 })]).catch(() => undefined);
if (await mismatch.isVisible().catch(() => false)) {
  await page.getByRole('button', { name: 'Usar ese servidor y unirme' }).click();
}

const errorBox = page.getByTestId('error');
for (let i = 0; i < 40; i++) {
  if (await page.getByTestId('waiting').isVisible().catch(() => false)) break;
  if (await page.getByTestId('approved').isVisible().catch(() => false)) break;
  if (await errorBox.isVisible().catch(() => false)) {
    status('error', { message: await errorBox.textContent() });
    process.exit(1);
  }
  await page.waitForTimeout(500);
}
status('esperando aprobación del anfitrión');

await page.getByTestId('approved').waitFor({ timeout: 10 * 60_000 });
await installPad();
status('aceptada; esperando "Permitir mando"');

let lastId = null;
let lastStatus = '';
while (true) {
  if (await page.getByTestId('ended').isVisible().catch(() => false)) {
    status('sesión terminada', { message: await page.getByTestId('ended').textContent() });
    break;
  }
  const text = (await page.getByTestId('gamepad-send-status').textContent().catch(() => '')) ?? '';
  const stats = (await page.getByTestId('guest-stream-stats').textContent().catch(() => '')) ?? '';
  if (text !== lastStatus) {
    lastStatus = text;
    status(text.includes('controla al jugador 2') ? 'mando activo' : 'mando no activo', { text, stats });
  }
  if (existsSync(cmdFile)) {
    let cmd = null;
    try {
      cmd = JSON.parse(readFileSync(cmdFile, 'utf8'));
    } catch {
      /* archivo a medio escribir */
    }
    if (cmd && cmd.id !== lastId) {
      lastId = cmd.id;
      status('ejecutando orden', { id: cmd.id, steps: cmd.steps.length });
      for (const step of cmd.steps) {
        await setPad({
          pressed: (step.buttons ?? []).map((b) => BUTTONS[b]).filter((x) => x !== undefined),
          lx: step.lx ?? 0, ly: step.ly ?? 0, rx: step.rx ?? 0, ry: step.ry ?? 0,
          lt: step.lt ?? 0, rt: step.rt ?? 0,
        });
        await page.waitForTimeout(step.ms ?? 150);
      }
      await setPad({ pressed: [], lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
      status('orden completada', { id: cmd.id, text, stats });
    }
  }
  await page.waitForTimeout(100);
}
await app.close();
