import { safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeBackendUrl, validateDisplayName } from './validation';

export interface PublicSettings {
  backendUrl: string;
  displayName: string;
  hasHostKey: boolean;
}

interface StoredSettings {
  backendUrl: string;
  displayName: string;
  /** Clave de anfitrión cifrada con DPAPI (safeStorage), en base64. */
  hostKeyEncrypted?: string;
}

/**
 * Configuración local en %APPDATA%/GameShare[-perfil]/settings.json.
 * La clave de anfitrión se cifra con safeStorage. Si el cifrado no está disponible, solo se guarda en memoria.
 */
export class SettingsStore {
  private readonly file: string;
  private data: StoredSettings;
  private volatileHostKey: string | null = null;

  constructor(dir: string, defaultBackendUrl: string) {
    this.file = path.join(dir, 'settings.json');
    this.data = { backendUrl: normalizeBackendUrl(defaultBackendUrl), displayName: '' };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoredSettings>;
      this.data = {
        backendUrl: safe(() => normalizeBackendUrl(raw.backendUrl), this.data.backendUrl),
        displayName: safe(() => validateDisplayName(raw.displayName), ''),
        hostKeyEncrypted: typeof raw.hostKeyEncrypted === 'string' ? raw.hostKeyEncrypted : undefined,
      };
    } catch {
      // Primera ejecución o archivo dañado: se usan los valores por defecto.
    }
  }

  get(): PublicSettings {
    return {
      backendUrl: this.data.backendUrl,
      displayName: this.data.displayName,
      hasHostKey: !!this.data.hostKeyEncrypted || !!this.volatileHostKey,
    };
  }

  getHostKey(): string | null {
    if (this.volatileHostKey) {
      return this.volatileHostKey;
    }
    if (!this.data.hostKeyEncrypted || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(this.data.hostKeyEncrypted, 'base64'));
    } catch {
      return null;
    }
  }

  update(input: unknown): PublicSettings {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Configuración inválida.');
    }
    const i = input as Record<string, unknown>;
    const next: StoredSettings = {
      ...this.data,
      backendUrl: normalizeBackendUrl(i['backendUrl']),
      displayName: validateDisplayName(i['displayName']),
    };
    // hostKey: undefined = no cambiar; null o '' = borrar; texto = guardar cifrado.
    const hostKey = i['hostKey'];
    if (hostKey === null || hostKey === '') {
      next.hostKeyEncrypted = undefined;
      this.volatileHostKey = null;
    } else if (typeof hostKey === 'string') {
      if (hostKey.length > 200) {
        throw new Error('La clave de anfitrión es demasiado larga.');
      }
      if (safeStorage.isEncryptionAvailable()) {
        next.hostKeyEncrypted = safeStorage.encryptString(hostKey).toString('base64');
        this.volatileHostKey = null;
      } else {
        next.hostKeyEncrypted = undefined;
        this.volatileHostKey = hostKey;
      }
    } else if (hostKey !== undefined) {
      throw new Error('Clave de anfitrión inválida.');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8');
    this.data = next;
    return this.get();
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
