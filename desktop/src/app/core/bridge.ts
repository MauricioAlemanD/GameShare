import { InjectionToken } from '@angular/core';

export interface AppSettings {
  backendUrl: string;
  displayName: string;
  hasHostKey: boolean;
}

export interface SettingsUpdate {
  backendUrl: string;
  displayName: string;
  /** undefined = no cambiar · null o '' = borrar · texto = guardar (cifrado). */
  hostKey?: string | null;
}

/** API que expone el preload de Electron en window.gameshare. */
export interface GameShareBridge {
  getSettings(): Promise<AppSettings>;
  updateSettings(update: SettingsUpdate): Promise<AppSettings>;
  getHostKey(): Promise<string | null>;
  copyText(text: string): Promise<void>;
  appInfo(): Promise<{ version: string; profile: string | null }>;
  onEmergency(callback: () => void): () => void;
  /** Lista pantallas y ventanas capturables (excluye GameShare). */
  listCaptureSources(): Promise<CaptureSource[]>;
  /** Autoriza UNA captura de la fuente elegida; después se llama a getDisplayMedia(). */
  selectCaptureSource(id: string): Promise<void>;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

declare global {
  interface Window {
    gameshare?: GameShareBridge;
  }
}

export const BRIDGE = new InjectionToken<GameShareBridge>('GameShareBridge', {
  providedIn: 'root',
  factory: () => window.gameshare ?? browserBridge(),
});

/** Alternativa para ejecutar la interfaz en un navegador normal (solo para desarrollo). */
function browserBridge(): GameShareBridge {
  const KEY = 'gameshare.settings';
  let hostKey: string | null = null;
  const read = (): AppSettings => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (s) return { ...s, hasHostKey: !!hostKey };
    } catch {
      /* sin almacenamiento */
    }
    return { backendUrl: 'http://localhost:8080', displayName: '', hasHostKey: !!hostKey };
  };
  return {
    getSettings: async () => read(),
    updateSettings: async (u) => {
      if (u.hostKey !== undefined) hostKey = u.hostKey || null;
      const s = { backendUrl: u.backendUrl.replace(/\/+$/, ''), displayName: u.displayName.trim() };
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* sin almacenamiento */
      }
      return read();
    },
    getHostKey: async () => hostKey,
    copyText: (t) => navigator.clipboard.writeText(t),
    appInfo: async () => ({ version: 'browser', profile: null }),
    onEmergency: () => () => {},
    // En el navegador, getDisplayMedia() muestra el selector del propio navegador.
    listCaptureSources: async () => [{ id: 'browser', name: 'Selector del navegador', kind: 'screen', thumbnail: '' }],
    selectCaptureSource: async () => {},
  };
}

/** Quita el prefijo "Error invoking remote method ..." que añade Electron a los errores IPC. */
export function ipcErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
