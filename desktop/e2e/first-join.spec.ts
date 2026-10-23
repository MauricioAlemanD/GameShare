import { expect, test } from '@playwright/test';
import { Instance, launch } from './fixtures';

// Primera vez de la invitada: su app recién instalada apunta a otro servidor (localhost:8080 por defecto).
// Al pegar el enlace, la app pide cambiar al servidor de la invitación, se recarga y se une sola.

let host: Instance;
let guest: Instance;

test.afterEach(async () => {
  for (const i of [host, guest]) {
    if (i) await Promise.race([i.app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
  }
});

test('primera vez: la invitada cambia al servidor del enlace y queda esperando aprobación', async () => {
  host = await launch('e2e-host');
  guest = await launch('e2e-guest', 'http://localhost:9'); // servidor "por defecto" distinto
  const h = host.page;
  const g = guest.page;

  await h.getByTestId('display-name').fill('Mau');
  await h.getByTestId('create-session').click();
  await h.getByTestId('new-invite').click();
  const link = await h.getByTestId('invite-link').inputValue();

  await g.getByTestId('display-name').fill('Novia');
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('server-mismatch')).toContainText(process.env['E2E_BACKEND_URL']!);
  await g.getByRole('button', { name: 'Usar ese servidor y unirme' }).click();

  // Tras recargar, se une sola con el mismo enlace y nombre.
  await expect(g.getByTestId('waiting')).toBeVisible({ timeout: 15_000 });
  await expect(h.getByTestId('request')).toContainText('Novia');
  await h.getByTestId('approve').click();
  await expect(g.getByTestId('approved')).toBeVisible();
});
