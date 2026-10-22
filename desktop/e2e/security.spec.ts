import { expect, test } from '@playwright/test';
import { Instance, launch } from './fixtures';

let inst: Instance;

test.beforeAll(async () => {
  inst = await launch('e2e-security');
});

test.afterAll(async () => {
  await inst?.app.close();
});

test('la interfaz no tiene acceso a Node.js', async () => {
  const result = await inst.page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    module: typeof (globalThis as Record<string, unknown>)['module'],
  }));
  expect(result).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });
});

test('el puente expone solo la API prevista', async () => {
  const keys = await inst.page.evaluate(() => Object.keys(window.gameshare ?? {}).sort());
  expect(keys).toEqual([
    'appInfo', 'copyText', 'getHostKey', 'getInputStatus', 'getSettings', 'listCaptureSources', 'onEmergency', 'onInputStatus',
    'onRumble', 'releaseAllInput', 'resetInput', 'selectCaptureSource', 'sendInputFrame', 'setGamepadPermission', 'updateSettings',
  ]);
});

test('no se puede capturar la pantalla sin elegir una fuente en el selector', async () => {
  const result = await inst.page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
      return 'capturado';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(result).not.toBe('capturado');
});

test('solo se puede elegir una fuente de la última lista ofrecida', async () => {
  const err = await inst.page.evaluate(async () => {
    try {
      await window.gameshare!.selectCaptureSource('screen:999:0');
      return null;
    } catch (e) {
      return String(e);
    }
  });
  expect(err).toContain('no válida');
});

test('cámara y micrófono están denegados', async () => {
  const result = await inst.page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return 'concedido';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(result).not.toBe('concedido');
});

test('se sirve desde app://gameshare con CSP', async () => {
  expect(inst.page.url()).toBe('app://gameshare/index.html');
  // La CSP bloquea conexiones a hosts distintos del backend configurado.
  const blocked = await inst.page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test('no se pueden abrir ventanas ni navegar fuera de la app', async () => {
  const opened = await inst.page.evaluate(() => window.open('https://example.com') === null);
  expect(opened).toBe(true);
  expect(inst.app.windows()).toHaveLength(1);
  await inst.page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await inst.page.waitForTimeout(500);
  expect(inst.page.url()).toBe('app://gameshare/index.html');
});

test('las rutas fuera del directorio de la interfaz no son accesibles', async () => {
  const status = await inst.page.evaluate(async () => {
    const r = await fetch('app://gameshare/..%2F..%2Fpackage.json');
    return { status: r.status, text: (await r.text()).slice(0, 30) };
  });
  // O bien se rechaza (403) o se sirve index.html, pero nunca package.json.
  expect(status.text).not.toContain('"name"');
});

test('la configuración rechaza URLs de servidor peligrosas', async () => {
  const err = await inst.page.evaluate(async () => {
    try {
      await window.gameshare!.updateSettings({ backendUrl: 'file:///C:/Windows', displayName: 'X' });
      return null;
    } catch (e) {
      return String(e);
    }
  });
  expect(err).toContain('http:// o https://');
});
