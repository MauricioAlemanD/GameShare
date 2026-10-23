import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  net,
  protocol,
  session,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CaptureController } from './capture';
import { InputAgentProcess } from './input-agent-process';
import { encodeRumbleFrame, InputGateway } from './input-gateway';
import { SettingsStore } from './settings';
import { buildCsp, mimeFor, PROFILE_REGEX } from './validation';

const APP_SCHEME = 'app';
const APP_ORIGIN = 'app://gameshare';
/** En desarrollo: URL de `ng serve` (p. ej. http://localhost:4200). */
const DEV_URL = process.env['GAMESHARE_DEV_URL'] || undefined;
const UI_DIR = path.resolve(__dirname, '..', 'dist', 'desktop', 'browser');
const EMERGENCY_SHORTCUT = 'CommandOrControl+Shift+F12';

// Perfiles: permiten abrir dos instancias en el mismo PC (anfitrión + invitado) para pruebas.
const profile = process.env['GAMESHARE_PROFILE'] || null;
if (profile) {
  if (!PROFILE_REGEX.test(profile)) {
    throw new Error('GAMESHARE_PROFILE inválido (solo letras, números y guiones).');
  }
  app.setPath('userData', path.join(app.getPath('appData'), `GameShare-${profile}`));
}

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// El anfitrión juega con otra ventana en primer plano: GameShare no debe ralentizarse en segundo plano.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow: BrowserWindow | null = null;
let settings: SettingsStore;
const capture = new CaptureController(() => mainWindow, (url) => isTrustedUrl(url));

// ---- Mandos remotos: el agente (.NET + ViGEmBus) solo se lanza en el anfitrión al conceder el primer mando.
// Instalada: resources/input-agent/ · En desarrollo: ../input-agent/dist/
const AGENT_EXE =
  process.env['GAMESHARE_INPUT_AGENT'] ||
  (app.isPackaged
    ? path.join(process.resourcesPath, 'input-agent', 'InputAgent.exe')
    : path.resolve(__dirname, '..', '..', 'input-agent', 'dist', 'InputAgent.exe'));
let agentProc: InputAgentProcess | null = null;
const gateway = new InputGateway(
  (line) => {
    if (line.startsWith('C ') && !agentProc) {
      agentProc = new InputAgentProcess(AGENT_EXE, (l) => gateway.handleAgentLine(l), (m) => gateway.setAgentUnavailable(m));
      agentProc.start();
    }
    agentProc?.send(line);
  },
  (status) => sendToUi('input:status', status),
  (guestId, large, small) => sendToUi('input:rumble', guestId, encodeRumbleFrame(large, small)),
);

/** Envía un evento a la interfaz solo si la ventana sigue viva (al cerrarse ya no se puede usar). */
function sendToUi(channel: string, ...args: unknown[]): void {
  const w = mainWindow;
  if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return;
  w.webContents.send(channel, ...args);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
}

function isTrustedUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
}

async function start(): Promise<void> {
  settings = new SettingsStore(
    app.getPath('userData'),
    process.env['GAMESHARE_BACKEND_URL'] || 'http://localhost:8080',
  );

  protocol.handle(APP_SCHEME, serveUi);

  // Permisos mínimos: portapapeles y pantalla completa (vídeo del invitado).
  // Captura de pantalla: Chromium la pide como 'media' sin tipos de dispositivo (mediaTypes vacío).
  // Solo deja llegar la petición a CaptureController, que entrega únicamente la fuente que el usuario
  // acaba de elegir en el selector (si no, deniega).
  // Cámara y micrófono ('media' con 'video'/'audio'), geolocalización, notificaciones, etc. quedan denegados.
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  const debug = !!process.env['GAMESHARE_DEBUG'];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (debug) console.log('[permission:request]', permission, JSON.stringify(details));
    if (permission === 'media') {
      const d = details as { mediaTypes?: string[]; requestingUrl?: string };
      cb((d.mediaTypes ?? ['unknown']).length === 0 && isTrustedUrl(d.requestingUrl ?? ''));
      return;
    }
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (debug) console.log('[permission:check]', permission);
    return allowed.has(permission);
  });
  capture.install(session.defaultSession);

  if (DEV_URL) {
    session.defaultSession.webRequest.onHeadersReceived({ urls: [`${DEV_URL}/*`] }, (details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [buildCsp(settings.get().backendUrl, DEV_URL)],
        },
      });
    });
  }

  registerIpc();
  createWindow();

  // Atajo de emergencia global: corta la sesión aunque la ventana no tenga el foco.
  // Los mandos virtuales se sueltan aquí mismo, sin esperar a la interfaz.
  globalShortcut.register(EMERGENCY_SHORTCUT, () => {
    gateway.releaseAll();
    sendToUi('gameshare:emergency');
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    title: profile ? `GameShare (${profile})` : 'GameShare',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (!DEV_URL) {
    Menu.setApplicationMenu(null);
  }
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null; // primero: la ventana ya no existe
    gateway.releaseAll();
  });
  // Si la interfaz se cuelga o se recarga, no puede quedar ningún botón pulsado.
  mainWindow.webContents.on('render-process-gone', () => gateway.releaseAll());
  mainWindow.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) gateway.releaseAll();
  });
  void mainWindow.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

/** Sirve la interfaz compilada desde app://gameshare/, con CSP y sin permitir salir del directorio. */
async function serveUi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== 'gameshare') {
    return new Response('Not found', { status: 404 });
  }
  let file = path.normalize(path.join(UI_DIR, decodeURIComponent(url.pathname)));
  if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(UI_DIR, 'index.html');
  }
  const res = await net.fetch(pathToFileURL(file).toString());
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': mimeFor(file),
      'Content-Security-Policy': buildCsp(settings.get().backendUrl),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

function registerIpc(): void {
  const guard = (e: IpcMainInvokeEvent) => {
    if (!isTrustedUrl(e.senderFrame?.url ?? '')) {
      throw new Error('Origen no autorizado.');
    }
  };
  ipcMain.handle('settings:get', (e) => {
    guard(e);
    return settings.get();
  });
  ipcMain.handle('settings:update', (e, update: unknown) => {
    guard(e);
    return settings.update(update);
  });
  ipcMain.handle('settings:host-key', (e) => {
    guard(e);
    return settings.getHostKey();
  });
  ipcMain.handle('clipboard:write', (e, text: unknown) => {
    guard(e);
    if (typeof text !== 'string' || text.length > 4096) {
      throw new Error('Texto inválido.');
    }
    clipboard.writeText(text);
  });
  ipcMain.handle('capture:list', (e) => {
    guard(e);
    return capture.list();
  });
  ipcMain.handle('capture:select', (e, id: unknown) => {
    guard(e);
    capture.select(id);
  });
  // Mandos remotos (anfitrión).
  ipcMain.handle('input:set-permission', (e, guestId: unknown, allowed: unknown) => {
    guard(e);
    gateway.setPermission(String(guestId), allowed === true);
  });
  ipcMain.handle('input:reset', (e, guestId: unknown) => {
    guard(e);
    gateway.resetSequence(String(guestId));
  });
  ipcMain.handle('input:release-all', (e) => {
    guard(e);
    gateway.releaseAll();
  });
  ipcMain.handle('input:status', (e) => {
    guard(e);
    return gateway.status();
  });
  // Tramas del mando: sin respuesta (send, no invoke) para no añadir latencia.
  ipcMain.on('input:frame', (e, guestId: unknown, data: unknown) => {
    if (!isTrustedUrl(e.senderFrame?.url ?? '')) return;
    gateway.handleFrame(String(guestId), data);
  });
  ipcMain.handle('app:info', (e) => {
    guard(e);
    return { version: app.getVersion(), profile };
  });
}

// Endurecimiento global: sin ventanas nuevas, sin navegación externa y sin <webview>.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  gateway.releaseAll();
  agentProc?.stop();
});
app.on('window-all-closed', () => app.quit());
