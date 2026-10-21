import { buildInviteLink, parseInvite } from './invite-link';
import { friendlyMessage } from './errors';

const CODE = 'W5oH_YRU3zg50DvMBKU_wA';

describe('invitaciones', () => {
  it('crea y lee un enlace completo', () => {
    const link = buildInviteLink('https://gs.example.com', CODE);
    expect(link).toBe(`gameshare://join?server=https%3A%2F%2Fgs.example.com&code=${CODE}`);
    expect(parseInvite(link)).toEqual({ server: 'https://gs.example.com', code: CODE });
  });

  it('acepta solo el código (usa el servidor configurado)', () => {
    expect(parseInvite(`  ${CODE}\n`)).toEqual({ server: null, code: CODE });
  });

  it.each([
    ['texto cualquiera', /No reconozco/],
    ['https://evil.example/?code=' + CODE, /no es una invitación/],
    ['gameshare://join?server=http%3A%2F%2Fx&code=corto', /incompleto/],
    [`gameshare://join?server=file%3A%2F%2F%2Fc%3A&code=${CODE}`, /servidor/],
    [`gameshare://join?server=javascript%3Aalert(1)&code=${CODE}`, /servidor/],
    [`gameshare://join?server=https%3A%2F%2Fu%3Ap%40x.com&code=${CODE}`, /servidor/],
  ])('rechaza "%s"', (input, msg) => {
    expect(() => parseInvite(input)).toThrow(msg);
  });
});

describe('friendlyMessage', () => {
  it('usa el mensaje del servidor para errores de negocio', () => {
    expect(friendlyMessage('INVITE_USED', 'Esta invitación ya se usó.', 410)).toBe('Esta invitación ya se usó.');
  });
  it('sustituye mensajes genéricos', () => {
    expect(friendlyMessage('UNAUTHORIZED', 'Token ausente, inválido o revocado.', 401)).toMatch(/Tu acceso ya no es válido/);
  });
  it('detalla los errores de validación', () => {
    expect(friendlyMessage('VALIDATION_ERROR', 'displayName: nombre inválido', 400)).toBe('Datos no válidos: displayName: nombre inválido');
  });
  it('tiene un mensaje por defecto', () => {
    expect(friendlyMessage(undefined, undefined, 502)).toBe('Error inesperado del servidor (HTTP 502).');
  });
});
