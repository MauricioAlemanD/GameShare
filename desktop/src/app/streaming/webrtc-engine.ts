import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Subject } from 'rxjs';
import { decodeRumbleFrame, STATE_FRAME_SIZE } from '../input/input-protocol';
import { ApiService } from '../core/api.service';
import { BRIDGE, CaptureSource, ipcErrorMessage } from '../core/bridge';
import { ParticipantView } from '../core/models';
import { SessionStore } from '../core/session.store';
import { PeerLink } from './peer-link';
import { LinkState, StreamingEngine } from './streaming-engine';
import { QUALITY_PRESETS, QualityPreset, SignalData, StreamStats, validateSignal, VideoCodec } from './webrtc-utils';

const STATS_INTERVAL_MS = 1000;
const REPORT_EVERY_MS = 2000;
const ICE_RESTART_COOLDOWN_MS = 10_000;

/** Motor WebRTC: captura con Chromium y conexiones P2P (o por TURN) con cada invitado. */
@Injectable()
export class WebRtcEngine extends StreamingEngine {
  private readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly bridge = inject(BRIDGE);

  readonly name = 'WebRTC (Chromium)';
  readonly localStream = signal<MediaStream | null>(null);
  readonly audioSending = signal(true);
  readonly preset = signal<QualityPreset>(QUALITY_PRESETS[0]);
  readonly codec = signal<VideoCodec>('H264');
  readonly forceRelay = signal(false);
  readonly peerStates = signal<Record<string, LinkState>>({});
  readonly remoteStream = signal<MediaStream | null>(null);
  readonly linkState = signal<LinkState>('idle');
  readonly stats = signal<StreamStats | null>(null);
  readonly inputChannelOpen = signal(false);
  readonly rumble$ = new Subject<{ large: number; small: number }>();

  private readonly peers = new Map<string, PeerLink>();
  /** Anfitrión: canal de mando de cada invitado. */
  private readonly hostChannels = new Map<string, RTCDataChannel>();
  /** Invitado: canal de mando con el anfitrión. */
  private guestChannel: RTCDataChannel | null = null;
  private readonly creating = new Set<string>();
  private readonly lastRestart = new Map<string, number>();
  private ice: { config: RTCConfiguration; expiresAt: number } | null = null;
  /** Procesa las señales en orden: así los candidatos ICE no llegan antes de que exista la conexión. */
  private signalQueue: Promise<void> = Promise.resolve();
  private lastReport = 0;

  constructor() {
    super();
    // Anfitrión: mantener una conexión por invitado aprobado y conectado, mientras haya algo que transmitir.
    effect(() => {
      const role = this.store.role();
      const guests = this.store.approvedGuests();
      const stream = this.localStream();
      untracked(() => {
        if (role === 'HOST') void this.reconcileHost(guests, stream);
      });
    });
    // Fin de la sesión (revocación, cierre, emergencia...): cortar todo al instante.
    effect(() => {
      if (!this.store.creds()) untracked(() => this.stopAll());
    });
    const sub = this.store.signals$.subscribe(({ from, data }) => {
      this.signalQueue = this.signalQueue.then(() => this.onSignal(from, data)).catch((e) => console.warn('Señal', e));
    });
    const timer = setInterval(() => void this.pollStats(), STATS_INTERVAL_MS);
    // Anfitrión: vibración del juego → canal del invitado correspondiente.
    const offRumble = this.bridge.onRumble((guestId, frame) => {
      const ch = this.hostChannels.get(guestId);
      if (ch?.readyState === 'open') ch.send(new Uint8Array(frame));
    });
    inject(DestroyRef).onDestroy(() => {
      offRumble();
      sub.unsubscribe();
      clearInterval(timer);
      this.stopAll();
    });
  }

  // ------------------------------------------------------------------ anfitrión

  listSources(): Promise<CaptureSource[]> {
    return this.bridge.listCaptureSources();
  }

  async startSharing(sourceId: string): Promise<void> {
    const p = this.preset();
    let stream: MediaStream;
    try {
      await this.bridge.selectCaptureSource(sourceId);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: p.width }, height: { max: p.height }, frameRate: { ideal: p.fps, max: p.fps } },
        // Audio de juego: sin procesado de voz (eco, ruido, ganancia) y en estéreo.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      });
    } catch (e) {
      this.store.error.set(`No se pudo capturar la fuente elegida: ${ipcErrorMessage(e)}`);
      return;
    }
    const video = stream.getVideoTracks()[0];
    if (video) {
      video.contentHint = 'motion'; // prioriza la fluidez frente a la nitidez
      video.onended = () => this.stopSharing(); // p. ej., se cerró la ventana capturada
    }
    for (const a of stream.getAudioTracks()) a.enabled = this.audioSending();

    const old = this.localStream();
    if (old) {
      for (const [id, link] of this.peers) {
        if (!(await link.replaceTracks(stream))) this.closePeer(id, true);
      }
      old.getTracks().forEach((t) => t.stop());
    }
    this.localStream.set(stream);
  }

  stopSharing(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    this.localStream()?.getTracks().forEach((t) => t.stop());
    this.localStream.set(null);
    this.stats.set(null);
  }

  setAudioSending(enabled: boolean): void {
    this.audioSending.set(enabled);
    this.localStream()?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  async setPreset(id: string): Promise<void> {
    const p = QUALITY_PRESETS.find((x) => x.id === id);
    if (!p) return;
    this.preset.set(p);
    const video = this.localStream()?.getVideoTracks()[0];
    if (video) {
      await video
        .applyConstraints({ width: { max: p.width }, height: { max: p.height }, frameRate: { ideal: p.fps, max: p.fps } })
        .catch(() => undefined);
    }
    for (const link of this.peers.values()) await link.setLimits(p.maxBitrateKbps, p.fps);
  }

  setCodec(codec: VideoCodec): void {
    this.codec.set(codec); // se aplica a las conexiones nuevas
  }

  setForceRelay(enabled: boolean): void {
    this.forceRelay.set(enabled); // se aplica a las conexiones nuevas
    this.ice = null;
  }

  private async reconcileHost(guests: ParticipantView[], stream: MediaStream | null): Promise<void> {
    const wanted = new Set(guests.filter((g) => g.connected).map((g) => g.id));
    const approved = new Set(guests.map((g) => g.id));
    for (const id of [...this.peers.keys()]) {
      // Revocado o fuera de la sesión: cortar de inmediato. Si solo se cayó su WebSocket, se mantiene el vídeo.
      if (!approved.has(id) || !stream) this.closePeer(id, false);
    }
    if (!stream) return;
    for (const id of wanted) {
      const state = this.peerStates()[id];
      if (this.peers.has(id) && state !== 'failed' && state !== 'closed') continue;
      if (this.creating.has(id)) continue;
      if (this.peers.has(id)) this.closePeer(id, false);
      this.creating.add(id);
      try {
        await this.createHostPeer(id, stream);
      } catch (e) {
        this.store.error.set('No se pudo iniciar la transmisión: ' + ipcErrorMessage(e));
      } finally {
        this.creating.delete(id);
      }
    }
  }

  private async createHostPeer(guestId: string, stream: MediaStream): Promise<void> {
    const p = this.preset();
    const link: PeerLink = new PeerLink({
      role: 'host',
      linkId: randomId(),
      rtcConfig: await this.iceConfig(),
      sendSignal: (d) => this.store.sendSignal(guestId, d),
      codec: this.codec(),
      maxBitrateKbps: p.maxBitrateKbps,
      maxFps: p.fps,
      onState: (s) => {
        if (this.peers.get(guestId) !== link) return;
        this.setPeerState(guestId, s);
        if (s === 'failed') void this.tryRestart(guestId, link);
      },
      onInputChannel: (ch) => this.attachHostChannel(guestId, ch),
    });
    this.peers.set(guestId, link);
    this.setPeerState(guestId, 'new');
    await link.startAsHost(stream);
  }

  private async tryRestart(guestId: string, link: PeerLink): Promise<void> {
    const last = this.lastRestart.get(guestId) ?? 0;
    if (Date.now() - last < ICE_RESTART_COOLDOWN_MS) {
      // Ya se intentó hace poco: crear una conexión nueva en la siguiente reconciliación.
      this.closePeer(guestId, false);
      this.setPeerState(guestId, 'failed');
      void this.reconcileHost(this.store.approvedGuests(), this.localStream());
      return;
    }
    this.lastRestart.set(guestId, Date.now());
    this.ice = null; // las credenciales TURN pueden haber caducado
    await link.restartIce().catch(() => undefined);
  }

  /** Las tramas del mando van directas al proceso principal, que las valida (permiso, formato, secuencia, frecuencia). */
  private attachHostChannel(guestId: string, ch: RTCDataChannel): void {
    this.hostChannels.set(guestId, ch);
    ch.onopen = () => void this.bridge.resetInput(guestId);
    ch.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer && ev.data.byteLength === STATE_FRAME_SIZE) {
        this.bridge.sendInputFrame(guestId, new Uint8Array(ev.data));
      }
    };
  }

  private attachGuestChannel(ch: RTCDataChannel): void {
    this.guestChannel = ch;
    ch.onopen = () => this.inputChannelOpen.set(true);
    ch.onclose = () => {
      if (this.guestChannel === ch) {
        this.guestChannel = null;
        this.inputChannelOpen.set(false);
      }
    };
    ch.onmessage = (ev) => {
      const r = decodeRumbleFrame(ev.data);
      if (r) this.rumble$.next(r);
    };
  }

  sendInputFrame(frame: Uint8Array): boolean {
    const ch = this.guestChannel;
    // Si el canal se satura, se descarta: enviar estados viejos solo añadiría latencia.
    if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 4 * STATE_FRAME_SIZE) return false;
    ch.send(frame as Uint8Array<ArrayBuffer>);
    return true;
  }

  private closePeer(id: string, notifyPeer: boolean): void {
    const link = this.peers.get(id);
    this.peers.delete(id);
    this.hostChannels.delete(id);
    link?.close(notifyPeer);
    this.peerStates.update((m) => {
      const { [id]: _removed, ...rest } = m;
      return rest;
    });
  }

  private setPeerState(id: string, s: LinkState): void {
    this.peerStates.update((m) => ({ ...m, [id]: s }));
  }

  // ------------------------------------------------------------------ señales (ambos)

  private async onSignal(from: string, raw: Record<string, unknown>): Promise<void> {
    const data = validateSignal(raw);
    if (!data) {
      console.warn('Señal WebRTC inválida descartada');
      return;
    }
    if (this.store.role() === 'HOST') {
      const link = this.peers.get(from);
      if (link && link.linkId === data.linkId) await link.handleSignal(data);
      return;
    }
    await this.onGuestSignal(from, data);
  }

  private async onGuestSignal(from: string, data: SignalData): Promise<void> {
    // El invitado solo acepta señales del anfitrión de su sesión, y solo si está aprobado.
    if (from !== this.store.hostParticipant()?.id || this.store.me()?.status !== 'APPROVED') return;
    let link = this.peers.get(from);
    if (data.kind === 'offer' && (!link || link.linkId !== data.linkId)) {
      if (link) this.closePeer(from, false);
      const created: PeerLink = new PeerLink({
        role: 'guest',
        linkId: data.linkId,
        rtcConfig: await this.iceConfig(),
        sendSignal: (d) => this.store.sendSignal(from, d),
        codec: this.codec(),
        maxBitrateKbps: 0,
        maxFps: 0,
        onRemoteStream: (s) => this.remoteStream.set(s),
        onInputChannel: (ch) => this.attachGuestChannel(ch),
        onState: (s) => {
          if (this.peers.get(from) !== created && s !== 'closed') return;
          this.linkState.set(s);
          if (s === 'closed') {
            if (this.peers.get(from) === created) this.peers.delete(from);
            if (this.peers.size === 0) {
              this.remoteStream.set(null);
              this.stats.set(null);
              this.guestChannel = null;
              this.inputChannelOpen.set(false);
            }
          }
        },
      });
      this.peers.set(from, created);
      link = created;
    }
    if (link && link.linkId === data.linkId) await link.handleSignal(data);
  }

  // ------------------------------------------------------------------ estadísticas

  private async pollStats(): Promise<void> {
    const first = this.peers.values().next().value as PeerLink | undefined;
    if (!first) return;
    try {
      const s = await first.getStats();
      this.stats.set(s);
      if (this.store.role() === 'GUEST' && Date.now() - this.lastReport >= REPORT_EVERY_MS && s.fps !== null) {
        this.lastReport = Date.now();
        this.store.reportStats({
          rttMs: s.rttMs ?? 0,
          fps: s.fps ?? 0,
          bitrateKbps: s.bitrateKbps ?? 0,
          packetLossPct: s.packetLossPct ?? 0,
          jitterMs: s.jitterMs ?? 0,
        });
      }
    } catch {
      /* conexión cerrándose */
    }
  }

  // ------------------------------------------------------------------ comunes

  private async iceConfig(): Promise<RTCConfiguration> {
    const base = this.store.baseUrl();
    const creds = this.store.creds();
    if (this.ice && this.ice.expiresAt > Date.now()) return this.ice.config;
    if (!base || !creds) throw new Error('Sin sesión');
    const res = await this.api.iceServers(base, creds);
    const config: RTCConfiguration = {
      iceServers: res.iceServers.map((s) => ({
        urls: s.urls,
        ...(s.username ? { username: s.username } : {}),
        ...(s.credential ? { credential: s.credential } : {}),
      })),
      iceTransportPolicy: this.forceRelay() ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    };
    // Renovar con margen antes de que caduquen las credenciales TURN.
    this.ice = { config, expiresAt: Date.now() + Math.max(60, res.ttlSeconds - 300) * 1000 };
    return config;
  }

  private stopAll(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id, false);
    this.localStream()?.getTracks().forEach((t) => t.stop());
    this.localStream.set(null);
    this.remoteStream.set(null);
    this.linkState.set('idle');
    this.stats.set(null);
    this.ice = null;
    this.hostChannels.clear();
    this.guestChannel = null;
    this.inputChannelOpen.set(false);
  }
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
