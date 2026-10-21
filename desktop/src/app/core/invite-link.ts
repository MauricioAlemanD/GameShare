/**
 * Enlace de invitación: gameshare://join?server=<url>&code=<código>
 * El invitado también puede pegar solo el código; en ese caso se usa el servidor configurado.
 */
export const CODE_REGEX = /^[A-Za-z0-9_-]{22}$/;

export interface ParsedInvite {
  /** null si el usuario pegó solo el código. */
  server: string | null;
  code: string;
}

export function buildInviteLink(server: string, code: string): string {
  return `gameshare://join?server=${encodeURIComponent(server)}&code=${code}`;
}

export function parseInvite(input: string): ParsedInvite {
  const text = input.trim();
  if (CODE_REGEX.test(text)) {
    return { server: null, code: text };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('No reconozco esa invitación. Pega el enlace completo o el código de 22 caracteres.');
  }
  if (url.protocol !== 'gameshare:') {
    throw new Error('El enlace no es una invitación de GameShare.');
  }
  const code = url.searchParams.get('code') ?? '';
  const server = url.searchParams.get('server') ?? '';
  if (!CODE_REGEX.test(code)) {
    throw new Error('El código de la invitación está incompleto o dañado.');
  }
  let serverUrl: URL;
  try {
    serverUrl = new URL(server);
  } catch {
    throw new Error('El servidor de la invitación no es válido.');
  }
  if ((serverUrl.protocol !== 'http:' && serverUrl.protocol !== 'https:') || serverUrl.username || serverUrl.password) {
    throw new Error('El servidor de la invitación no es válido.');
  }
  return { server: serverUrl.origin, code };
}
