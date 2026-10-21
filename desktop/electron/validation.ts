// Validación pura, sin dependencias de Electron, para poder probarla con node:test.

export const DISPLAY_NAME_REGEX = /^[\p{L}\p{N} ._-]{1,32}$/u;
export const PROFILE_REGEX = /^[a-z0-9-]{1,32}$/i;

/** Normaliza y valida la URL del backend: solo http/https, sin credenciales, ruta, query ni fragmento. */
export function normalizeBackendUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 300) {
    throw new Error('La dirección del servidor es obligatoria.');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('La dirección del servidor no es una URL válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('El servidor debe empezar por http:// o https://');
  }
  if (url.username || url.password) {
    throw new Error('La dirección del servidor no puede incluir usuario ni contraseña.');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('Indica solo el servidor, sin ruta (ej.: https://gameshare.ejemplo.com).');
  }
  return url.origin;
}

export function validateDisplayName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!DISPLAY_NAME_REGEX.test(name)) {
    throw new Error('El nombre debe tener 1-32 letras, números, espacios o . _ -');
  }
  return name;
}

/** CSP de la interfaz. connect-src solo permite el backend configurado. */
export function buildCsp(backendUrl: string, devUrl?: string): string {
  const backend = new URL(backendUrl);
  const ws = `${backend.protocol === 'https:' ? 'wss:' : 'ws:'}//${backend.host}`;
  const connect = ["'self'", backend.origin, ws];
  const script = ["'self'"];
  if (devUrl) {
    const dev = new URL(devUrl);
    connect.push(dev.origin, `ws://${dev.host}`);
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self' blob: mediastream:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeFor(file: string): string {
  const dot = file.lastIndexOf('.');
  return MIME[dot >= 0 ? file.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
}
