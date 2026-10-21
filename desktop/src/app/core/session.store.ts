import { computed, inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { AppSettings, BRIDGE, ipcErrorMessage, SettingsUpdate } from './bridge';
import { ApiError } from './errors';
import { buildInviteLink, parseInvite } from './invite-link';
import { Credentials, InviteView, ServerMessage, SessionView } from './models';
import { SignalingClient, SignalingHandlers, TerminalReason, WsState } from './signaling-client';

export interface LatestInvite {
  id: string;
  link: string;
  code: string;
  expiresAt: string;
}

/** Datos de un canje pendiente cuando la invitación usa otro servidor (hay que cambiar ajustes y recargar). */
interface PendingJoin {
  invite: string;
  displayName: string;
}

const PENDING_JOIN_KEY = 'gameshare.pendingJoin';

/** Fábrica del cliente de señalización (se sustituye en las pruebas). */
export type SignalingFactory = (base: string, token: string, h: SignalingHandlers) => Pick<SignalingClient, 'start' | 'stop' | 'send'>;

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiService);
  private readonly bridge = inject(BRIDGE);

  readonly settings = signal<AppSettings | null>(null);
  readonly baseUrl = signal<string | null>(null);
  readonly creds = signal<Credentials | null>(null);
  readonly session = signal<SessionView | null>(null);
  readonly invites = signal<InviteView[]>([]);
  readonly latestInvite = signal<LatestInvite | null>(null);
  readonly wsState = signal<WsState | 'idle'>('idle');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  /** Mensaje final cuando la sesión termina para este usuario. */
  readonly ended = signal<string | null>(null);
  /** El enlace apunta a otro servidor: hay que confirmar el cambio. */
  readonly serverMismatch = signal<{ server: string; invite: string; displayName: string } | null>(null);

  readonly role = computed(() => this.creds()?.role ?? null);
  readonly me = computed(() => {
    const s = this.session();
    return s?.participants.find((p) => p.id === s.you) ?? null;
  });
  readonly hostParticipant = computed(() => this.session()?.participants.find((p) => p.role === 'HOST') ?? null);
  readonly guests = computed(() => this.session()?.participants.filter((p) => p.role === 'GUEST') ?? []);
  readonly pendingGuests = computed(() => this.guests().filter((p) => p.status === 'PENDING'));
  readonly approvedGuests = computed(() => this.guests().filter((p) => p.status === 'APPROVED'));

  /** Mensajes de señalización WebRTC entrantes (los consumirá el motor de streaming en la fase 4). */
  readonly signals$ = new Subject<{ from: string; data: Record<string, unknown> }>();

  private client: Pick<SignalingClient, 'start' | 'stop' | 'send'> | null = null;
  private signalingFactory: SignalingFactory = (b, t, h) => new SignalingClient(b, t, h);

  setSignalingFactory(f: SignalingFactory): void {
    this.signalingFactory = f;
  }

  // ------------------------------------------------------------------ ajustes

  async init(): Promise<void> {
    this.settings.set(await this.bridge.getSettings());
    this.bridge.onEmergency(() => void this.emergencyStop());
    const pending = this.takePendingJoin();
    if (pending) {
      await this.join(pending.invite, pending.displayName);
    }
  }

  async saveSettings(update: SettingsUpdate): Promise<boolean> {
    try {
      this.settings.set(await this.bridge.updateSettings(update));
      this.notice.set('Ajustes guardados.');
      this.error.set(null);
      return true;
    } catch (e) {
      this.error.set(ipcErrorMessage(e));
      return false;
    }
  }

  // ------------------------------------------------------------------ anfitrión

  async createSession(displayName: string): Promise<void> {
    const settings = this.settings();
    if (!settings) return;
    await this.run(async () => {
      if (displayName !== settings.displayName) {
        this.settings.set(await this.bridge.updateSettings({ backendUrl: settings.backendUrl, displayName }));
      }
      const hostKey = await this.bridge.getHostKey();
      const creds = await this.api.createSession(settings.backendUrl, displayName, hostKey);
      this.startSession(settings.backendUrl, creds);
      this.session.set(await this.api.getSession(settings.backendUrl, creds));
    });
  }

  async createInvite(): Promise<void> {
    await this.withSession(async (base, c) => {
      const inv = await this.api.createInvite(base, c);
      this.latestInvite.set({ id: inv.id, code: inv.code!, link: buildInviteLink(base, inv.code!), expiresAt: inv.expiresAt });
      await this.refreshInvites();
    });
  }

  async refreshInvites(): Promise<void> {
    const base = this.baseUrl();
    const c = this.creds();
    if (!base || !c || c.role !== 'HOST') return;
    this.invites.set(await this.api.listInvites(base, c));
  }

  async revokeInvite(id: string): Promise<void> {
    await this.withSession(async (base, c) => {
      await this.api.revokeInvite(base, c, id);
      if (this.latestInvite()?.id === id) this.latestInvite.set(null);
      await this.refreshInvites();
    });
  }

  async copyInvite(): Promise<void> {
    const inv = this.latestInvite();
    if (!inv) return;
    try {
      await this.bridge.copyText(inv.link);
      this.notice.set('Invitación copiada. Envíasela por un canal privado.');
    } catch (e) {
      this.error.set('No se pudo copiar: ' + ipcErrorMessage(e));
    }
  }

  approve(pid: string): Promise<void> {
    return this.withSession(async (base, c) => this.session.set(await this.api.approve(base, c, pid)));
  }

  reject(pid: string): Promise<void> {
    return this.withSession(async (base, c) => this.session.set(await this.api.reject(base, c, pid)));
  }

  revoke(pid: string): Promise<void> {
    return this.withSession(async (base, c) => {
      await this.api.removeParticipant(base, c, pid);
      this.session.set(await this.api.getSession(base, c));
    });
  }

  setGamepad(pid: string, allowed: boolean): Promise<void> {
    return this.withSession(async (base, c) => this.session.set(await this.api.setGamepad(base, c, pid, allowed)));
  }

  /** Cierra la sesión en el servidor. Aunque falle la red, el estado local se desmonta siempre. */
  async closeSession(): Promise<void> {
    const base = this.baseUrl();
    const c = this.creds();
    if (!base || !c) return;
    this.busy.set(true);
    try {
      if (c.role === 'HOST') {
        await this.api.closeSession(base, c);
      } else {
        await this.api.removeParticipant(base, c, c.participantId);
      }
    } catch {
      // Si no hay red, el servidor expulsará por inactividad; localmente se corta igual.
    } finally {
      this.busy.set(false);
      this.teardown(c.role === 'HOST' ? 'Cerraste la sesión.' : 'Saliste de la sesión.');
    }
  }

  /** Atajo global Ctrl+Shift+F12. */
  async emergencyStop(): Promise<void> {
    if (!this.creds()) return;
    await this.closeSession();
    this.ended.set('Corte de emergencia: la sesión se cerró y se desconectó a todos.');
  }

  // ------------------------------------------------------------------ invitado

  async join(inviteText: string, displayName: string): Promise<void> {
    const settings = this.settings();
    if (!settings) return;
    this.serverMismatch.set(null);
    let parsed;
    try {
      parsed = parseInvite(inviteText);
    } catch (e) {
      this.error.set((e as Error).message);
      return;
    }
    const server = parsed.server ?? settings.backendUrl;
    if (server !== settings.backendUrl) {
      // La política de seguridad (CSP) solo permite el servidor configurado: hay que confirmar el cambio.
      this.serverMismatch.set({ server, invite: inviteText, displayName });
      return;
    }
    await this.run(async () => {
      if (displayName !== settings.displayName) {
        this.settings.set(await this.bridge.updateSettings({ backendUrl: settings.backendUrl, displayName }));
      }
      const creds = await this.api.redeem(server, parsed.code, displayName);
      this.startSession(server, creds);
    });
  }

  /** El usuario acepta usar el servidor de la invitación: se guarda, se recarga y se reanuda el canje. */
  async acceptInviteServer(): Promise<void> {
    const m = this.serverMismatch();
    const settings = this.settings();
    if (!m || !settings) return;
    const ok = await this.saveSettings({ backendUrl: m.server, displayName: m.displayName || settings.displayName });
    if (!ok) return;
    try {
      sessionStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ invite: m.invite, displayName: m.displayName }));
    } catch {
      /* sin almacenamiento: el usuario tendrá que pegar el enlace otra vez */
    }
    location.reload();
  }

  leave(): Promise<void> {
    return this.closeSession();
  }

  // ------------------------------------------------------------------ comunes

  dismissEnded(): void {
    this.ended.set(null);
  }

  dismissError(): void {
    this.error.set(null);
  }

  /** Envía un mensaje de señalización WebRTC al otro participante. */
  sendSignal(to: string, data: object): boolean {
    return this.client?.send({ type: 'signal', to, data }) ?? false;
  }

  /** Informa al servidor de la calidad de recepción (la ve el anfitrión). */
  reportStats(data: { rttMs: number; fps: number; bitrateKbps: number; packetLossPct: number; jitterMs: number }): void {
    this.client?.send({ type: 'stats', data });
  }

  private startSession(base: string, creds: Credentials): void {
    this.ended.set(null);
    this.error.set(null);
    this.baseUrl.set(base);
    this.creds.set(creds);
    this.client?.stop();
    this.client = this.signalingFactory(base, creds.token, {
      onMessage: (m) => this.onMessage(m),
      onState: (s) => this.wsState.set(s),
      onTerminal: (r) => this.onTerminal(r),
    });
    this.client.start();
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'auth-ok':
        if (msg.session) this.session.set(msg.session);
        break;
      case 'session-updated': {
        this.session.set(msg.session);
        const host = this.creds()?.role === 'HOST';
        if (host && msg.reason === 'join-request') {
          this.notice.set('Alguien quiere unirse. Revisa las solicitudes.');
          void this.refreshInvites();
        } else if (!host && msg.reason === 'approved' && msg.session.yourStatus === 'APPROVED') {
          this.notice.set('El anfitrión te ha aceptado.');
        }
        break;
      }
      case 'signal':
        this.signals$.next({ from: msg.from, data: msg.data });
        break;
      case 'evicted':
        this.teardown(
          msg.reason === 'rejected'
            ? 'El anfitrión rechazó tu solicitud.'
            : msg.reason === 'revoked'
              ? 'El anfitrión te ha quitado el acceso.'
              : 'Saliste de la sesión.',
        );
        break;
      case 'session-closed':
        this.teardown(msg.reason === 'expired' ? 'La sesión terminó por inactividad.' : 'El anfitrión cerró la sesión.');
        break;
      case 'error':
        this.error.set(msg.message);
        break;
    }
  }

  private onTerminal(reason: TerminalReason): void {
    if (!this.creds()) return; // ya se desmontó por un evento previo
    const messages: Record<TerminalReason, string> = {
      unauthorized: 'Tu acceso ya no es válido.',
      evicted: 'El anfitrión te ha quitado el acceso.',
      replaced: 'Esta sesión se abrió en otra ventana.',
      'session-closed': 'La sesión terminó.',
    };
    this.teardown(messages[reason]);
  }

  private teardown(message: string): void {
    this.client?.stop();
    this.client = null;
    this.creds.set(null);
    this.session.set(null);
    this.invites.set([]);
    this.latestInvite.set(null);
    this.baseUrl.set(null);
    this.wsState.set('idle');
    this.ended.set(message);
  }

  private async withSession(fn: (base: string, c: Credentials) => Promise<void>): Promise<void> {
    const base = this.baseUrl();
    const c = this.creds();
    if (!base || !c) return;
    await this.run(() => fn(base, c));
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : ipcErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private takePendingJoin(): PendingJoin | null {
    try {
      const raw = sessionStorage.getItem(PENDING_JOIN_KEY);
      sessionStorage.removeItem(PENDING_JOIN_KEY);
      return raw ? (JSON.parse(raw) as PendingJoin) : null;
    } catch {
      return null;
    }
  }
}
