# Aplicación de escritorio (Electron + Angular)

Electron 44 · Angular 21 (LTS) · TypeScript · Vitest · Playwright.

> Se usa Angular 21 y no 22 porque Angular 22 exige Node ≥ 24.15, y el equipo de desarrollo tiene Node 24.9.

## Comandos (Windows, PowerShell, desde `desktop/`)

```powershell
npm install                 # primera vez
npm start                   # compila la interfaz y Electron y abre la app
npm run dev                 # modo desarrollo: ng serve + Electron con recarga
npm test                    # pruebas unitarias de la interfaz (Vitest, 34)
npm run test:electron       # pruebas del proceso principal (node:test, 5)
npm run e2e                 # extremo a extremo: 2 instancias de la app + backend real (Playwright, 15)
```

`npm run e2e` necesita el JAR del backend: `cd backend; .\mvnw.cmd package`.

### Dos instancias en el mismo PC

Cada perfil tiene su propia configuración (`%APPDATA%\GameShare-<perfil>`):

```powershell
$env:GAMESHARE_PROFILE="anfitrion"; npm run app
# en otra terminal
$env:GAMESHARE_PROFILE="invitada"; npm run app
```

Variables opcionales: `GAMESHARE_BACKEND_URL` (servidor por defecto la primera vez) y `GAMESHARE_PROFILE`.

> `scripts/run-electron.mjs` elimina `ELECTRON_RUN_AS_NODE`. La terminal integrada de VS Code define esa variable, y con ella Electron arrancaría como Node en lugar de abrir la ventana.

## Estructura

```
desktop/
  electron/            proceso principal (Node)
    main.ts            ventana, protocolo app://, permisos, IPC, atajo de emergencia
    preload.ts         puente mínimo window.gameshare (contextBridge)
    settings.ts        ajustes en %APPDATA%; clave de anfitrión cifrada con safeStorage (DPAPI)
    validation.ts      validación pura (URL, nombre, CSP) + pruebas
  src/app/
    core/              ApiService (REST), SignalingClient (WS), SessionStore (estado con signals)
    features/          Home, SettingsPanel, HostPanel, GuestPanel
  e2e/                 pruebas Playwright sobre Electron
```

## Funciones

| Función | Estado |
|---|---|
| Configurar el servidor y la clave de anfitrión (cifrada) | ✅ probado (e2e de seguridad) |
| Crear una sala | ✅ probado e2e |
| Crear, copiar y revocar invitaciones (enlace `gameshare://join?server=…&code=…` o solo el código) | ✅ probado e2e (copiar al portapapeles real) |
| Aceptar o rechazar solicitudes | ✅ probado e2e |
| Ver quién está conectado | ✅ probado e2e |
| Conceder o retirar el mando | ✅ probado e2e (aún solo el permiso; el mando real llega en la fase 5) |
| Revocar el acceso al instante | ✅ probado e2e |
| Cerrar la sala (botón con confirmación) y atajo global **Ctrl+Shift+F12** | ✅ botón probado e2e · ⚠ atajo con prueba unitaria; la pulsación real del teclado no se ha automatizado |
| Salir (invitado) | ✅ probado e2e |
| Errores comprensibles (red, invitación usada/caducada/inválida, otro servidor) | ✅ probado (unitarias + e2e) |
| Reconexión automática del WebSocket con backoff (1 s → 15 s) | ✅ probado con pruebas unitarias |
| Estadísticas (resolución, fps, bitrate, RTT, pérdida, jitter, códec, hardware, P2P/TURN) | ✅ probado e2e (ver [07-streaming](07-streaming.md)) |
| Vídeo y audio, silenciar (invitada), dejar de enviar audio (anfitrión), pantalla completa | ✅ probado e2e en 1 PC · ⚠ pantalla completa sin prueba automática |

## Seguridad de la ventana (verificada con e2e)

- `contextIsolation`, `sandbox` y `nodeIntegration: false`: la interfaz no tiene `require` ni `process`.
- El puente expone exactamente 6 funciones, y el proceso principal comprueba el origen de cada llamada IPC.
- La interfaz se sirve desde `app://gameshare` con CSP: `script-src 'self'`, y `connect-src` solo admite el backend configurado.
- No se pueden abrir ventanas nuevas, navegar fuera de la app ni usar `<webview>`.
- No hay acceso a archivos fuera del directorio de la interfaz.
- Permisos de Chromium: portapapeles, pantalla completa y captura de pantalla, pero esta solo de la fuente elegida en el selector y una sola vez. La cámara y el micrófono están denegados.
- Una invitación que apunta a otro servidor pide confirmación explícita antes de cambiarlo.

## Limitaciones conocidas

- El **modo `npm run dev`** (ng serve + Electron) no se ha verificado de forma automática. `npm start` y las pruebas e2e usan la versión compilada.
- Las sesiones no sobreviven a cerrar la app: los tokens solo viven en memoria, a propósito.
- No hay instalador (`.exe`) todavía; se añadirá con electron-builder cuando el streaming funcione.
- `npm audit` reporta 4 vulnerabilidades altas en **herramientas de desarrollo** de Angular (servidor MCP del CLI y Vite). No forman parte de la app empaquetada. El arreglo automático implica bajar de versión con cambios incompatibles, así que se actualizará cuando Angular 21 publique un parche.
