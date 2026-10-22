import { enableOpusStereo, SignalData, sortVideoCodecs, StatsSample, StreamStats, summarizeInbound, summarizeOutbound, VideoCodec } from './webrtc-utils';

export type PeerRole = 'host' | 'guest';

export interface PeerLinkOptions {
  role: PeerRole;
  /** Identificador de esta conexión. Si el anfitrión crea otra, el invitado descarta la anterior. */
  linkId: string;
  rtcConfig: RTCConfiguration;
  sendSignal: (data: SignalData) => void;
  codec: VideoCodec;
  maxBitrateKbps: number;
  maxFps: number;
  onRemoteStream?: (stream: MediaStream) => void;
  onState?: (state: RTCPeerConnectionState) => void;
  /** Canal de datos "input" (mando). El anfitrión lo crea; el invitado lo recibe. */
  onInputChannel?: (channel: RTCDataChannel) => void;
}

export const INPUT_CHANNEL_LABEL = 'input';

/** Una conexión WebRTC con un participante. El anfitrión solo envía y el invitado solo recibe. */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private prevSample: StatsSample | null = null;
  private closed = false;

  constructor(private readonly o: PeerLinkOptions) {
    this.pc = new RTCPeerConnection(o.rtcConfig);
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.o.sendSignal({ kind: 'ice', linkId: o.linkId, candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => this.o.onState?.(this.pc.connectionState);
    this.pc.ontrack = (e) => {
      // Baja latencia en recepción: búfer de reproducción mínimo.
      const r = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number };
      try {
        r.jitterBufferTarget = 0;
      } catch {
        /* no soportado */
      }
      try {
        r.playoutDelayHint = 0;
      } catch {
        /* no soportado */
      }
      this.o.onRemoteStream?.(e.streams[0] ?? new MediaStream([e.track]));
    };
    this.pc.ondatachannel = (e) => {
      // El invitado solo acepta el canal "input" creado por el anfitrión.
      if (this.o.role !== 'guest' || e.channel.label !== INPUT_CHANNEL_LABEL) {
        e.channel.close();
        return;
      }
      e.channel.binaryType = 'arraybuffer';
      this.o.onInputChannel?.(e.channel);
    };
  }

  get linkId(): string {
    return this.o.linkId;
  }

  /** Anfitrión: añade las pistas (solo envío) y envía la oferta. */
  async startAsHost(stream: MediaStream): Promise<void> {
    // Mando: sin orden ni retransmisiones (un estado viejo no sirve; solo importa el último).
    const input = this.pc.createDataChannel(INPUT_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 });
    input.binaryType = 'arraybuffer';
    this.o.onInputChannel?.(input);
    for (const track of stream.getTracks()) {
      const t = this.pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      if (track.kind === 'video') {
        const caps = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
        try {
          t.setCodecPreferences(sortVideoCodecs(caps, this.o.codec));
        } catch {
          /* se usará el orden por defecto */
        }
      }
    }
    await this.sendOffer(false);
  }

  /** Cambia el bitrate y los FPS máximos en caliente (sin renegociar). */
  async setLimits(maxBitrateKbps: number, maxFps: number): Promise<void> {
    this.o.maxBitrateKbps = maxBitrateKbps;
    this.o.maxFps = maxFps;
    if (this.o.role === 'host') await this.applySenderParameters();
  }

  async restartIce(): Promise<void> {
    if (this.o.role === 'host' && !this.closed) await this.sendOffer(true);
  }

  /** Sustituye las pistas sin renegociar. Devuelve false si cambió el tipo de pistas (hay que crear otra conexión). */
  async replaceTracks(stream: MediaStream): Promise<boolean> {
    const senders = this.pc.getSenders();
    const tracks = stream.getTracks();
    const kinds = (list: { kind: string }[]) => list.map((t) => t.kind).sort().join(',');
    if (kinds(senders.map((s) => ({ kind: s.track?.kind ?? '' }))) !== kinds(tracks)) return false;
    for (const s of senders) {
      await s.replaceTrack(tracks.find((t) => t.kind === s.track?.kind) ?? null);
    }
    return true;
  }

  async handleSignal(data: SignalData): Promise<void> {
    if (this.closed) return;
    switch (data.kind) {
      case 'offer': {
        if (this.o.role !== 'guest') return;
        await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        answer.sdp = enableOpusStereo(answer.sdp ?? '');
        await this.pc.setLocalDescription(answer);
        this.o.sendSignal({ kind: 'answer', linkId: this.o.linkId, sdp: answer.sdp });
        break;
      }
      case 'answer':
        if (this.o.role !== 'host' || this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushCandidates();
        break;
      case 'ice':
        if (this.remoteDescriptionSet) {
          await this.pc.addIceCandidate(data.candidate).catch(() => undefined);
        } else if (this.pendingCandidates.length < 100) {
          this.pendingCandidates.push(data.candidate);
        }
        break;
      case 'bye':
        this.close();
        break;
    }
  }

  async getStats(): Promise<StreamStats> {
    const report = await this.pc.getStats();
    const list: (Record<string, unknown> & { type: string; id: string })[] = [];
    report.forEach((s) => list.push(s as Record<string, unknown> & { type: string; id: string }));
    const summarize = this.o.role === 'host' ? summarizeOutbound : summarizeInbound;
    const { stats, sample } = summarize(list, this.prevSample, performance.now());
    this.prevSample = sample;
    return stats;
  }

  close(notifyPeer = false): void {
    if (this.closed) return;
    this.closed = true;
    if (notifyPeer) this.o.sendSignal({ kind: 'bye', linkId: this.o.linkId });
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ondatachannel = null;
    this.pc.close();
    this.o.onState?.('closed');
  }

  private async sendOffer(iceRestart: boolean): Promise<void> {
    const offer = await this.pc.createOffer({ iceRestart });
    offer.sdp = enableOpusStereo(offer.sdp ?? '');
    await this.pc.setLocalDescription(offer);
    await this.applySenderParameters();
    this.o.sendSignal({ kind: 'offer', linkId: this.o.linkId, sdp: offer.sdp });
  }

  /** Bitrate máximo, FPS máximos y preferencia por mantener la fluidez frente a la resolución. */
  private async applySenderParameters(): Promise<void> {
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const p = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
      p.encodings[0].maxBitrate = this.o.maxBitrateKbps * 1000;
      p.encodings[0].maxFramerate = this.o.maxFps;
      (p.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string; priority?: string }).priority = 'high';
      (p.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high';
      p.degradationPreference = 'maintain-framerate';
      try {
        await sender.setParameters(p);
      } catch {
        /* algunos parámetros pueden no estar soportados */
      }
    }
  }

  private async flushCandidates(): Promise<void> {
    this.remoteDescriptionSet = true;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) {
      await this.pc.addIceCandidate(c).catch(() => undefined);
    }
  }
}
