import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Instance, launch, ROOT, shot } from './fixtures';

const AGENT = path.resolve(ROOT, '..', 'input-agent', 'dist', 'InputAgent.exe');

interface XSlot {
  connected: boolean;
  buttons?: number;
  lt?: number;
  rt?: number;
  lx?: number;
  ly?: number;
}

/** Lo que ve un juego: estado XInput de los 4 puestos, leído por un proceso independiente. */
function xinput(): XSlot[] {
  return JSON.parse(execFileSync(AGENT, ['probe-xinput'], { encoding: 'utf8' })) as XSlot[];
}

async function waitForXInput(predicate: (slots: XSlot[]) => boolean, timeout = 10_000): Promise<XSlot[]> {
  const end = Date.now() + timeout;
  let last = xinput();
  while (Date.now() < end) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
    last = xinput();
  }
  throw new Error('XInput no llegó al estado esperado: ' + JSON.stringify(last));
}

const connectedCount = (s: XSlot[]) => s.filter((x) => x.connected).length;

/** Sustituye la Gamepad API de la invitada por un mando PS4 simulado. */
async function installFakePad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad = {
      index: 0,
      id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
    };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  });
}

async function setPad(page: Page, pressed: number[], axes: number[] = [0, 0, 0, 0]): Promise<void> {
  await page.evaluate(
    ({ pressed, axes }) => {
      const pad = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } }).__pad;
      pad.buttons.forEach((b, i) => {
        b.pressed = pressed.includes(i);
        b.value = b.pressed ? 1 : 0;
      });
      pad.axes = axes;
    },
    { pressed, axes },
  );
}

let host: Instance;
let guest: Instance;

test.beforeEach(async () => {
  test.skip(!fs.existsSync(AGENT), `Falta ${AGENT}: cd input-agent; dotnet publish src/InputAgent -c Release -o dist`);
  host = await launch('e2e-host');
  guest = await launch('e2e-guest');
});

/** Cierra la app solo si sigue abierta (algunas pruebas la cierran a propósito). */
async function closeIfOpen(inst: Instance | undefined): Promise<void> {
  if (!inst) return;
  await Promise.race([inst.app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
}

test.afterEach(async () => {
  await closeIfOpen(host);
  await closeIfOpen(guest);
});

test('el mando de la invitada aparece como segundo mando Xbox en el anfitrión (XInput real)', async () => {
  test.setTimeout(120_000);
  const h = host.page;
  const g = guest.page;
  const baseline = xinput();
  console.log('Puestos XInput ocupados antes:', baseline.map((s, i) => (s.connected ? i : null)).filter((x) => x !== null));

  // Sala, invitación, aceptación y transmisión.
  await h.getByTestId('display-name').fill('Mau');
  await h.getByTestId('create-session').click();
  await h.getByTestId('new-invite').click();
  const link = await h.getByTestId('invite-link').inputValue();
  await h.getByTestId('pick-source').click();
  await h.locator('[data-testid="source-item"][data-kind="screen"]').first().click();
  await g.getByTestId('display-name').fill('Novia');
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
  await h.getByTestId('approve').click();
  await expect(g.getByTestId('approved')).toBeVisible();

  // Mando PS4 simulado en la invitada.
  await installFakePad(g);
  await expect(g.getByTestId('gamepad-select')).toContainText('Mando PS4 (DualShock 4)');

  // SIN permiso: no hay mando virtual aunque la invitada pulse botones.
  await setPad(g, [0]);
  await expect(g.getByTestId('gamepad-send-status')).toContainText('aún no te ha dado el mando');
  await g.waitForTimeout(1000);
  expect(connectedCount(xinput())).toBe(connectedCount(baseline));

  // CON permiso: aparece un mando Xbox virtual nuevo.
  await h.getByTestId('gamepad-toggle').check();
  await expect(h.getByTestId('virtual-pad')).toContainText('Mando virtual Xbox conectado', { timeout: 15_000 });
  await expect(g.getByTestId('gamepad-send-status')).toContainText('controla al jugador 2', { timeout: 15_000 });
  await waitForXInput((s) => connectedCount(s) === connectedCount(baseline) + 1);
  console.log('Anfitrión:', await h.getByTestId('virtual-pad').textContent());

  // ✕ (A) + stick izquierdo a la derecha y arriba + gatillo R2. El botón PS (16) NO debe llegar.
  await setPad(g, [0, 7, 16], [0.5, -1, 0, 0]);
  const pressed = await waitForXInput((s) => s.some((x) => x.connected && x.buttons === 0x1000 && x.lx === 16384 && x.ly === 32767 && x.rt === 255));
  console.log('XInput con botones pulsados:', JSON.stringify(pressed));
  expect(pressed.some((x) => x.buttons !== undefined && (x.buttons & 0x0400) !== 0)).toBe(false);
  await shot(g, '20-invitada-mando');
  await shot(h, '21-anfitrion-mando');

  // Soltar: el estado vuelve a neutro.
  await setPad(g, []);
  await waitForXInput((s) => !s.some((x) => x.connected && x.buttons === 0x1000));

  // Corte abrupto de la invitada con el botón pulsado: el anfitrión suelta todo (watchdog).
  await setPad(g, [1]); // ○ (B)
  await waitForXInput((s) => s.some((x) => x.connected && x.buttons === 0x2000));
  await guest.app.close();
  await waitForXInput((s) => !s.some((x) => x.connected && x.buttons === 0x2000), 3000);

  // Quitar el permiso: el mando virtual desaparece.
  await h.getByTestId('gamepad-toggle').uncheck();
  await waitForXInput((s) => connectedCount(s) === connectedCount(baseline));
});

test('cerrar la app del anfitrión elimina el mando virtual', async () => {
  test.setTimeout(90_000);
  const h = host.page;
  const g = guest.page;
  const baseline = connectedCount(xinput());

  await h.getByTestId('display-name').fill('Mau');
  await h.getByTestId('create-session').click();
  await h.getByTestId('new-invite').click();
  const link = await h.getByTestId('invite-link').inputValue();
  await g.getByTestId('display-name').fill('Novia');
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
  await h.getByTestId('approve').click();
  await h.getByTestId('gamepad-toggle').check();
  console.log('[paso] permiso concedido');
  await waitForXInput((s) => connectedCount(s) === baseline + 1);
  console.log('[paso] mando virtual visible');

  await host.app.close();
  console.log('[paso] app del anfitrión cerrada');
  await waitForXInput((s) => connectedCount(s) === baseline, 8000);
});
