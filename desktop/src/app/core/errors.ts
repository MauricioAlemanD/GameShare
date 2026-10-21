/** Error de la API con un mensaje listo para mostrar al usuario. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Tu acceso ya no es válido. Puede que la sesión haya terminado o que te hayan expulsado.',
  FORBIDDEN: 'No tienes permiso para hacer esto.',
  RATE_LIMITED: 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.',
  HOST_KEY_INVALID: 'La clave de anfitrión no es correcta. Revísala en Ajustes.',
  SERVER_FULL: 'El servidor está lleno. Inténtalo más tarde.',
  VALIDATION_ERROR: 'Algún dato no es válido.',
  INTERNAL_ERROR: 'El servidor tuvo un error interno. Inténtalo de nuevo.',
};

/**
 * Elige un mensaje comprensible. El backend ya devuelve mensajes en español para los errores de negocio
 * (invitación usada, caducada, etc.); aquí solo se cubren los genéricos.
 */
export function friendlyMessage(code: string | undefined, serverMessage: string | undefined, status: number): string {
  if (code === 'VALIDATION_ERROR' && serverMessage) {
    return `Datos no válidos: ${serverMessage}`;
  }
  // Para estos códigos, el mensaje del servidor es técnico o poco útil para el usuario.
  if (code === 'UNAUTHORIZED' || code === 'INTERNAL_ERROR') {
    return MESSAGES[code];
  }
  if (serverMessage) {
    return serverMessage;
  }
  if (code && MESSAGES[code]) {
    return MESSAGES[code];
  }
  return `Error inesperado del servidor (HTTP ${status}).`;
}

export function networkErrorMessage(baseUrl: string): string {
  return `No se pudo conectar con el servidor ${baseUrl}. Revisa la dirección en Ajustes y tu conexión a Internet.`;
}
