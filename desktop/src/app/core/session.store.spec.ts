import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';
import { AppSettings, BRIDGE, GameShareBridge } from './bridge';
import { ApiError } from './errors';
import { Credentials, ServerMessage, SessionView } from './models';
import { SessionStore } from './session.store';
import { SignalingHandlers } from './signaling-client';

const BASE = 'http://localhost:8080';
const HOST: Credentials = { sessionId: 's1', participantId: 'h1', role: 'HOST', status: 'APPROVED', token: 'th' };
const GUEST: Credentials = { sessionId: 's1', participantId: 'g1', role: 'GUEST', status: 'PENDING', token: 'tg' };

function view(you: string, guestStatus: 'PENDING' | 'APPROVED' = 'PENDING'): SessionView {
  return {
    sessionId: 's1',
    createdAt: '2026-01-01T00:00:00Z',
    you,
    yourRole: you === 'h1' ? 'HOST' : 'GUEST',
    yourStatus: you === 'h1' ? 'APPROVED' : guestStatus,
    participants: [
      { id: 'h1', displayName: 'Mau', role: 'HOST', status: 'APPROVED', gamepadAllowed: false, connected: true, stats: null },
      { id: 'g1', displayName: 'Novia', role: 'GUEST', status: guestStatus, gamepadAllowed: false, connected: true, stats: null },
    ],
  };
}

function setup() {
  let settings: AppSettings = { backendUrl: BASE, displayName: 'Mau', hasHostKey: false };
  const bridge: GameShareBridge = {
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (u) => (settings = { ...settings, backendUrl: u.backendUrl, displayName: u.displayName })),
    getHostKey: vi.fn(async () => null),
    copyText: vi.fn(async () => {}),
    appInfo: vi.fn(async () => ({ version: 't', profile: null })),
    onEmergency: vi.fn(() => () => {}),
    listCaptureSources: vi.fn(async () => []),
    selectCaptureSource: vi.fn(async () => {}),
    setGamepadPermission: vi.fn(async () => {}),
    resetInput: vi.fn(async () => {}),
    releaseAllInput: vi.fn(async () => {}),
    getInputStatus: vi.fn(async () => ({ agent: 'starting' as const, message: null, pads: {}, dropped: 0 })),
    sendInputFrame: vi.fn(),
    onInputStatus: vi.fn(() => () => {}),
    onRumble: vi.fn(() => () => {}),
  };
  const api = {
    createSession: vi.fn(async () => HOST),
    getSession: vi.fn(async () => view('h1')),
    redeem: vi.fn(async () => GUEST),
    createInvite: vi.fn(async () => ({ id: 'i1', code: 'W5oH_YRU3zg50DvMBKU_wA', createdAt: '', expiresAt: '2026-01-01T00:15:00Z', state: 'ACTIVE' })),
    listInvites: vi.fn(async () => []),
    closeSession: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    approve: vi.fn(async () => view('h1', 'APPROVED')),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: BRIDGE, useValue: bridge },
      { provide: ApiService, useValue: api },
    ],
  });
  const store = TestBed.inject(SessionStore);
  let handlers: SignalingHandlers | null = null;
  const ws = { start: vi.fn(), stop: vi.fn(), send: vi.fn(() => true) };
  store.setSignalingFactory((_b, _t, h) => {
    handlers = h;
    return ws;
  });
  const push = (m: ServerMessage) => handlers!.onMessage(m);
  return { store, api, bridge, ws, push, handlers: () => handlers! };
}

describe('SessionStore', () => {
  it('el anfitrión crea la sesión, abre el WebSocket y genera un enlace', async () => {
    const { store, api, ws } = setup();
    await store.init();
    await store.createSession('Mau');
    expect(api.createSession).toHaveBeenCalledWith(BASE, 'Mau', null);
    expect(ws.start).toHaveBeenCalled();
    expect(store.role()).toBe('HOST');

    await store.createInvite();
    expect(store.latestInvite()?.link).toContain('gameshare://join?server=');
  });

  it('avisa al anfitrión de una solicitud y la muestra como pendiente', async () => {
    const { store, push } = setup();
    await store.init();
    await store.createSession('Mau');
    push({ type: 'session-updated', reason: 'join-request', session: view('h1') });
    expect(store.pendingGuests().map((p) => p.displayName)).toEqual(['Novia']);
    expect(store.notice()).toMatch(/quiere unirse/);
  });

  it('el invitado pasa de pendiente a aceptado', async () => {
    const { store, push } = setup();
    await store.init();
    await store.join('W5oH_YRU3zg50DvMBKU_wA', 'Novia');
    expect(store.role()).toBe('GUEST');
    push({ type: 'auth-ok', participantId: 'g1', role: 'GUEST', session: view('g1') });
    expect(store.me()?.status).toBe('PENDING');
    push({ type: 'session-updated', reason: 'approved', session: view('g1', 'APPROVED') });
    expect(store.me()?.status).toBe('APPROVED');
    expect(store.notice()).toMatch(/aceptado/);
  });

  it('si el invitado es expulsado, se desmonta todo y se explica el motivo', async () => {
    const { store, push, ws } = setup();
    await store.init();
    await store.join('W5oH_YRU3zg50DvMBKU_wA', 'Novia');
    push({ type: 'evicted', reason: 'revoked' });
    expect(ws.stop).toHaveBeenCalled();
    expect(store.creds()).toBeNull();
    expect(store.ended()).toBe('El anfitrión te ha quitado el acceso.');
  });

  it('una invitación de otro servidor exige confirmación', async () => {
    const { store, api } = setup();
    await store.init();
    await store.join('gameshare://join?server=https%3A%2F%2Fother.example&code=W5oH_YRU3zg50DvMBKU_wA', 'Novia');
    expect(api.redeem).not.toHaveBeenCalled();
    expect(store.serverMismatch()?.server).toBe('https://other.example');
  });

  it('muestra errores de la API de forma legible', async () => {
    const { store, api } = setup();
    api.redeem.mockRejectedValueOnce(new ApiError(410, 'INVITE_USED', 'Esta invitación ya se usó.'));
    await store.init();
    await store.join('W5oH_YRU3zg50DvMBKU_wA', 'Novia');
    expect(store.error()).toBe('Esta invitación ya se usó.');
    expect(store.creds()).toBeNull();
    expect(store.busy()).toBe(false);
  });

  it('cerrar la sesión desmonta el estado aunque falle la red', async () => {
    const { store, api, ws } = setup();
    await store.init();
    await store.createSession('Mau');
    api.closeSession.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'sin red'));
    await store.closeSession();
    expect(ws.stop).toHaveBeenCalled();
    expect(store.creds()).toBeNull();
    expect(store.ended()).toBe('Cerraste la sesión.');
  });

  it('el atajo de emergencia cierra la sesión', async () => {
    const { store, api } = setup();
    await store.init();
    await store.createSession('Mau');
    await store.emergencyStop();
    expect(api.closeSession).toHaveBeenCalled();
    expect(store.ended()).toMatch(/Corte de emergencia/);
  });

  it('reenvía los mensajes de señalización y los envía al otro extremo', async () => {
    const { store, push, ws } = setup();
    await store.init();
    await store.createSession('Mau');
    const received: unknown[] = [];
    store.signals$.subscribe((s) => received.push(s));
    push({ type: 'signal', from: 'g1', data: { kind: 'answer' } });
    expect(received).toEqual([{ from: 'g1', data: { kind: 'answer' } }]);
    expect(store.sendSignal('g1', { kind: 'offer' })).toBe(true);
    expect(ws.send).toHaveBeenCalledWith({ type: 'signal', to: 'g1', data: { kind: 'offer' } });
  });
});
