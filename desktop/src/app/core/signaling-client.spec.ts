import { ServerMessage } from './models';
import { SignalingClient, Timers, TerminalReason, WsLike, WsState } from './signaling-client';

class FakeWs implements WsLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

class FakeTimers implements Timers {
  timeouts: { fn: () => void; ms: number }[] = [];
  intervals: { fn: () => void; ms: number }[] = [];
  setTimeout(fn: () => void, ms: number) {
    this.timeouts.push({ fn, ms });
    return this.timeouts.length;
  }
  clearTimeout() {}
  setInterval(fn: () => void, ms: number) {
    this.intervals.push({ fn, ms });
    return this.intervals.length;
  }
  clearInterval() {}
}

function setup() {
  const sockets: FakeWs[] = [];
  const timers = new FakeTimers();
  const states: WsState[] = [];
  const messages: ServerMessage[] = [];
  const terminal: TerminalReason[] = [];
  const client = new SignalingClient(
    'http://localhost:8080',
    'secret-token',
    { onMessage: (m) => messages.push(m), onState: (s) => states.push(s), onTerminal: (r) => terminal.push(r) },
    (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
    timers,
  );
  return { client, sockets, timers, states, messages, terminal };
}

describe('SignalingClient', () => {
  it('convierte la URL http en ws y https en wss', () => {
    expect(SignalingClient.wsUrl('http://localhost:8080')).toBe('ws://localhost:8080/ws');
    expect(SignalingClient.wsUrl('https://gs.example.com')).toBe('wss://gs.example.com/ws');
  });

  it('se autentica en el primer mensaje, sin poner el token en la URL', () => {
    const { client, sockets, states } = setup();
    client.start();
    expect(sockets[0].url).not.toContain('secret-token');
    sockets[0].open();
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ type: 'auth', token: 'secret-token' });
    sockets[0].receive({ type: 'auth-ok', participantId: 'p', role: 'HOST' });
    expect(states).toEqual(['connecting', 'online']);
  });

  it('envía ping periódico tras autenticarse', () => {
    const { client, sockets, timers } = setup();
    client.start();
    sockets[0].open();
    sockets[0].receive({ type: 'auth-ok', participantId: 'p', role: 'HOST' });
    expect(timers.intervals[0].ms).toBe(20_000);
    timers.intervals[0].fn();
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({ type: 'ping' });
  });

  it('reconecta con backoff exponencial si la conexión se cae', () => {
    const { client, sockets, timers, states } = setup();
    client.start();
    sockets[0].serverClose(1006);
    expect(states.at(-1)).toBe('reconnecting');
    expect(timers.timeouts[0].ms).toBe(1000);
    timers.timeouts[0].fn();
    expect(sockets).toHaveLength(2);
    sockets[1].serverClose(1006);
    expect(timers.timeouts[1].ms).toBe(2000);
  });

  it('el backoff tiene un máximo de 15 s', () => {
    const { client, sockets, timers } = setup();
    client.start();
    for (let i = 0; i < 8; i++) {
      sockets[i].serverClose(1006);
      timers.timeouts[i].fn();
    }
    expect(timers.timeouts.at(-1)!.ms).toBe(15_000);
  });

  it.each([
    [4401, 'unauthorized'],
    [4403, 'evicted'],
    [4409, 'replaced'],
    [4410, 'session-closed'],
  ] as const)('no reconecta tras el cierre terminal %i', (code, reason) => {
    const { client, sockets, timers, terminal, states } = setup();
    client.start();
    sockets[0].serverClose(code);
    expect(terminal).toEqual([reason]);
    expect(states.at(-1)).toBe('closed');
    expect(timers.timeouts).toHaveLength(0);
  });

  it('stop() cierra sin reconectar', () => {
    const { client, sockets, timers } = setup();
    client.start();
    sockets[0].open();
    client.stop();
    expect(sockets[0].closedWith).toBe(1000);
    expect(timers.timeouts).toHaveLength(0);
  });

  it('send() devuelve false si no hay conexión abierta', () => {
    const { client } = setup();
    client.start();
    expect(client.send({ type: 'ping' })).toBe(false);
  });

  it('ignora mensajes que no son JSON', () => {
    const { client, sockets, messages } = setup();
    client.start();
    sockets[0].onmessage?.({ data: '{roto' });
    expect(messages).toHaveLength(0);
  });
});
