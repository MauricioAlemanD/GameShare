import { BrowserWindow, desktopCapturer, DesktopCapturerSource, Session } from 'electron';

export interface CaptureSourceInfo {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

/**
 * Control de la captura de pantalla.
 *
 * La interfaz solo puede capturar una fuente que el usuario acaba de elegir en el selector de la app:
 * 1. `list()` devuelve las fuentes y recuerda la lista.
 * 2. `select(id)` marca una de esas fuentes, que se usa una sola vez.
 * 3. `getDisplayMedia()` en la interfaz → el manejador entrega esa fuente con audio del sistema (loopback).
 * Cualquier otra petición de captura se deniega.
 */
export class CaptureController {
  private lastSources: DesktopCapturerSource[] = [];
  private selected: DesktopCapturerSource | null = null;

  constructor(
    private readonly getOwnWindow: () => BrowserWindow | null,
    private readonly isTrustedUrl: (url: string) => boolean,
  ) {}

  async list(): Promise<CaptureSourceInfo[]> {
    const own = this.getOwnWindow()?.getMediaSourceId();
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    // No ofrecer la propia ventana de GameShare ni ventanas sin título.
    this.lastSources = sources.filter((s) => s.id !== own && s.name.trim().length > 0);
    this.selected = null;
    return this.lastSources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    }));
  }

  select(id: unknown): void {
    const source = typeof id === 'string' ? this.lastSources.find((s) => s.id === id) : undefined;
    if (!source) {
      throw new Error('Fuente de captura no válida. Vuelve a abrir el selector.');
    }
    this.selected = source;
  }

  install(session: Session): void {
    session.setDisplayMediaRequestHandler((request, callback) => {
      const source = this.selected;
      this.selected = null; // un solo uso
      const url = request.frame?.url ?? '';
      if (process.env['GAMESHARE_DEBUG']) {
        console.log('[capture] request', { url, securityOrigin: request.securityOrigin, selected: source?.id ?? null });
      }
      if (!source || !this.isTrustedUrl(url)) {
        callback({});
        return;
      }
      // 'loopback' captura el audio del sistema (en Windows no se puede limitar a una sola ventana).
      callback({ video: source, audio: 'loopback' });
    });
  }
}
