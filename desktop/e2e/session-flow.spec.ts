import { expect, test } from '@playwright/test';
import { Instance, launch, shot } from './fixtures';

let host: Instance;
let guest: Instance;

test.beforeEach(async () => {
  host = await launch('e2e-host');
  guest = await launch('e2e-guest');
});

test.afterEach(async () => {
  await host?.app.close();
  await guest?.app.close();
});

async function hostCreatesRoomAndInvite(): Promise<string> {
  const h = host.page;
  await h.getByTestId('display-name').fill('Mau');
  await h.getByTestId('create-session').click();
  await expect(h.getByTestId('ws-state')).toHaveText('Conectado');
  await h.getByTestId('new-invite').click();
  const link = await h.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/^gameshare:\/\/join\?server=.+&code=[A-Za-z0-9_-]{22}$/);
  return link;
}

async function guestJoins(link: string): Promise<void> {
  const g = guest.page;
  await g.getByTestId('display-name').fill('Novia');
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
}

test('flujo completo: crear, invitar, aceptar, dar mando y revocar', async () => {
  const h = host.page;
  const g = guest.page;
  await shot(h, '01-inicio');

  const link = await hostCreatesRoomAndInvite();

  // Copiar al portapapeles real del sistema.
  await h.getByTestId('copy-invite').click();
  await expect(h.getByTestId('notice')).toContainText('copiada');
  expect(await host.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(link);

  await guestJoins(link);
  await expect(g.getByTestId('waiting')).toBeVisible();
  await shot(g, '02-invitada-esperando');

  // El anfitrión ve la solicitud y la acepta.
  await expect(h.getByTestId('request')).toContainText('Novia');
  await shot(h, '03-anfitrion-solicitud');
  await h.getByTestId('approve').click();

  await expect(g.getByTestId('approved')).toBeVisible();
  await expect(g.getByTestId('gamepad-status')).toContainText('no permitido');
  await expect(h.getByTestId('guest-row')).toContainText('Novia');

  // Dar el mando.
  await h.getByTestId('gamepad-toggle').check();
  await expect(g.getByTestId('gamepad-status')).toContainText('Mando: permitido');
  await shot(h, '04-anfitrion-jugadores');
  await shot(g, '05-invitada-dentro');

  // Revocar: la invitada queda fuera de inmediato.
  await h.getByTestId('revoke').click();
  await expect(g.getByTestId('ended')).toContainText('te ha quitado el acceso');
  await expect(h.getByTestId('guest-row')).toHaveCount(0);
  await shot(g, '06-invitada-revocada');

  // La misma invitación ya no sirve.
  await g.getByTestId('back-home').click();
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('error')).toContainText('ya se usó');
});

test('rechazar una solicitud', async () => {
  const link = await hostCreatesRoomAndInvite();
  await guestJoins(link);
  await host.page.getByTestId('reject').click();
  await expect(guest.page.getByTestId('ended')).toContainText('rechazó tu solicitud');
});

test('cierre de la sala desde el anfitrión desconecta a la invitada', async () => {
  const link = await hostCreatesRoomAndInvite();
  await guestJoins(link);
  await host.page.getByTestId('approve').click();
  await expect(guest.page.getByTestId('approved')).toBeVisible();

  await host.page.getByTestId('close-session').click();
  await host.page.getByTestId('confirm-close').click();
  await expect(host.page.getByTestId('ended')).toContainText('Cerraste la sesión');
  await expect(guest.page.getByTestId('ended')).toContainText('cerró la sesión');
});

test('la invitada puede salir por su cuenta', async () => {
  const link = await hostCreatesRoomAndInvite();
  await guestJoins(link);
  await host.page.getByTestId('approve').click();
  await expect(guest.page.getByTestId('approved')).toBeVisible();
  await guest.page.getByTestId('leave').click();
  await expect(guest.page.getByTestId('ended')).toContainText('Saliste');
  await expect(host.page.getByTestId('guest-row')).toHaveCount(0);
});

test('invitaciones inválidas muestran errores comprensibles', async () => {
  const g = guest.page;
  await g.getByTestId('display-name').fill('Novia');

  await g.getByTestId('invite-input').fill('hola qué tal');
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('error')).toContainText('No reconozco esa invitación');

  await g.getByTestId('invite-input').fill('AAAAAAAAAAAAAAAAAAAAAA');
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('error')).toContainText('no es válida');

  // Invitación de otro servidor: pide confirmación antes de cambiar.
  await g.getByTestId('invite-input').fill('gameshare://join?server=https%3A%2F%2Fotro.example&code=AAAAAAAAAAAAAAAAAAAAAA');
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('server-mismatch')).toContainText('https://otro.example');
});
