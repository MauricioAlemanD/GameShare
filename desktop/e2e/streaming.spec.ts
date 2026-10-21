import { expect, Page, test } from '@playwright/test';
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

/** Espera a que el <video> remoto muestre fotogramas que avanzan. */
async function expectVideoPlaying(page: Page): Promise<void> {
  await page.getByTestId('remote-video').waitFor();
  await page.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]');
      return !!v && v.videoWidth > 0 && v.readyState >= 2;
    },
    undefined,
    { timeout: 20_000 },
  );
  const t1 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')!.currentTime);
  await page.waitForTimeout(1000);
  const t2 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')!.currentTime);
  expect(t2).toBeGreaterThan(t1);
}

test('vídeo y audio de anfitrión a invitada, con estadísticas, silenciado, pausa y revocación', async () => {
  test.setTimeout(120_000);
  const h = host.page;
  const g = guest.page;

  // Sala + invitación.
  await h.getByTestId('display-name').fill('Mau');
  await h.getByTestId('create-session').click();
  await h.getByTestId('new-invite').click();
  const link = await h.getByTestId('invite-link').inputValue();

  // El anfitrión empieza a compartir ANTES de aceptar a nadie.
  await h.getByTestId('pick-source').click();
  await h.locator('[data-testid="source-item"][data-kind="screen"]').first().click();
  await expect(h.getByTestId('sharing-name')).not.toBeEmpty();

  // La invitada pendiente no recibe nada.
  await g.getByTestId('display-name').fill('Novia');
  await g.getByTestId('invite-input').fill(link);
  await g.getByTestId('join-session').click();
  await expect(g.getByTestId('waiting')).toBeVisible();
  await h.waitForTimeout(1500);
  await expect(h.getByTestId('peer-state')).toHaveCount(0);
  await expect(g.getByTestId('remote-video')).toHaveCount(0);

  // Al aceptarla, recibe vídeo.
  await h.getByTestId('approve').click();
  await expectVideoPlaying(g);
  await expect(h.getByTestId('peer-state')).toHaveText('Conectado');
  await expect(g.getByTestId('path')).toHaveText('Conexión directa (P2P)');

  const audioTracks = await g.evaluate(
    () => (document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')!.srcObject as MediaStream).getAudioTracks().length,
  );
  expect(audioTracks).toBe(1);

  // Estadísticas en ambos lados (la invitada las informa al servidor y el anfitrión las ve).
  await expect(g.getByTestId('guest-stream-stats')).toContainText('fps', { timeout: 15_000 });
  await expect(h.getByTestId('host-stream-stats')).toContainText('fps', { timeout: 15_000 });
  await expect(h.getByTestId('guest-stats')).toContainText('Latencia', { timeout: 15_000 });
  await h.waitForTimeout(3000); // dejar estabilizar el bitrate
  console.log('ENVÍO     :', await h.getByTestId('host-stream-stats').textContent());
  console.log('RECEPCIÓN :', await g.getByTestId('guest-stream-stats').textContent());
  await shot(h, '10-anfitrion-transmitiendo');
  await shot(g, '11-invitada-viendo');

  // Silenciar en la invitada.
  await g.getByTestId('mute-toggle').click();
  expect(await g.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]')!.muted)).toBe(true);

  // Dejar de enviar audio desde el anfitrión.
  await h.getByTestId('audio-send-toggle').uncheck();
  expect(
    await h.evaluate(() =>
      [...document.querySelectorAll<HTMLVideoElement>('video.preview')].flatMap((v) =>
        (v.srcObject as MediaStream).getAudioTracks().map((t) => t.enabled),
      ),
    ),
  ).toEqual([false]);

  // Detener y volver a compartir: la invitada vuelve a esperar y luego recibe otra vez.
  await h.getByTestId('stop-sharing').click();
  await expect(g.getByTestId('stage-placeholder')).toContainText('Esperando');
  await h.getByTestId('pick-source').click();
  await h.locator('[data-testid="source-item"][data-kind="screen"]').first().click();
  await expectVideoPlaying(g);

  // Revocar: el vídeo se corta y la conexión del anfitrión desaparece.
  await h.getByTestId('revoke').click();
  await expect(g.getByTestId('ended')).toContainText('te ha quitado el acceso');
  await expect(g.getByTestId('remote-video')).toHaveCount(0);
  await expect(h.getByTestId('peer-state')).toHaveCount(0);
  const openPcs = await h.evaluate(() => document.querySelectorAll('video.preview').length);
  expect(openPcs).toBe(1); // sigue compartiendo (para otro invitado), pero sin conexión con la revocada
});
