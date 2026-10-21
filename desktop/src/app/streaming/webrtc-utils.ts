// Funciones puras del motor WebRTC: validación de señales remotas, SDP, códecs y estadísticas.

export type VideoCodec = 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1';

export interface QualityPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  maxBitrateKbps: number;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: 'balanced', label: 'Equilibrado · 1080p 60 fps · 10 Mbps', width: 1920, height: 1080, fps: 60, maxBitrateKbps: 10_000 },
  { id: 'smooth', label: 'Fluido · 720p 60 fps · 6 Mbps', width: 1280, height: 720, fps: 60, maxBitrateKbps: 6_000 },
  { id: 'saver', label: 'Ahorro · 720p 30 fps · 3 Mbps', width: 1280, height: 720, fps: 30, maxBitrateKbps: 3_000 },
  { id: 'max', label: 'Máxima · 1080p 60 fps · 20 Mbps', width: 1920, height: 1080, fps: 60, maxBitrateKbps: 20_000 },
];

// ---------------------------------------------------------------- señales remotas

export type SignalData =
  | { kind: 'offer'; linkId: string; sdp: string }
  | { kind: 'answer'; linkId: string; sdp: string }
  | { kind: 'ice'; linkId: string; candidate: RTCIceCandidateInit }
  | { kind: 'bye'; linkId: string };

const MAX_SDP = 30_000;
const LINK_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Valida un mensaje de señalización recibido del otro extremo. Devuelve null si no es válido. */
export function validateSignal(data: unknown): SignalData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d['linkId'] !== 'string' || !LINK_ID.test(d['linkId'])) return null;
  const linkId = d['linkId'];
  switch (d['kind']) {
    case 'offer':
    case 'answer': {
      const sdp = d['sdp'];
      if (typeof sdp !== 'string' || sdp.length === 0 || sdp.length > MAX_SDP || !sdp.startsWith('v=0')) return null;
      return { kind: d['kind'], linkId, sdp };
    }
    case 'ice': {
      const c = d['candidate'];
      if (typeof c !== 'object' || c === null) return null;
      const cand = c as Record<string, unknown>;
      if (typeof cand['candidate'] !== 'string' || cand['candidate'].length > 1000) return null;
      const mid = cand['sdpMid'];
      const idx = cand['sdpMLineIndex'];
      if (mid !== undefined && mid !== null && (typeof mid !== 'string' || mid.length > 32)) return null;
      if (idx !== undefined && idx !== null && (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 64)) return null;
      return {
        kind: 'ice',
        linkId,
        candidate: { candidate: cand['candidate'], sdpMid: (mid as string | null) ?? null, sdpMLineIndex: (idx as number | null) ?? null },
      };
    }
    case 'bye':
      return { kind: 'bye', linkId };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- SDP

/** Activa Opus estéreo a 128 kbps (el audio de juegos suele ser estéreo; WebRTC usa mono por defecto). */
export function enableOpusStereo(sdp: string): string {
  const m = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const add = ['stereo=1', 'sprop-stereo=1', 'maxaveragebitrate=128000'];
  if (re.test(sdp)) {
    return sdp.replace(re, (_line, params: string) => {
      const extra = add.filter((p) => !params.includes(p.split('=')[0] + '='));
      return `a=fmtp:${pt} ${[params, ...extra].filter(Boolean).join(';')}`;
    });
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${add.join(';')}`);
}

// ---------------------------------------------------------------- códecs

interface CodecLike {
  mimeType: string;
  sdpFmtpLine?: string;
}

/**
 * Pone primero el códec preferido.
 *
 * Para H.264 prioriza el perfil High, luego Main y luego Baseline. Medido en Electron 44 con una GTX 1050 Ti:
 * Constrained Baseline (42e01f) usa OpenH264 por SOFTWARE, mientras que Baseline (42001f), Main y High usan
 * NVENC por hardware (MediaFoundationVideoEncodeAccelerator). Ver docs/07-streaming.md.
 */
export function sortVideoCodecs<T extends CodecLike>(codecs: T[], preferred: VideoCodec): T[] {
  const mime = `video/${preferred}`.toLowerCase();
  const score = (c: T): number => {
    if (c.mimeType.toLowerCase() !== mime) return 0;
    let s = 10;
    const fmtp = c.sdpFmtpLine ?? '';
    if (preferred === 'H264') {
      if (fmtp.includes('packetization-mode=1')) s += 10;
      if (fmtp.includes('profile-level-id=64')) s += 4; // High
      else if (fmtp.includes('profile-level-id=4d')) s += 3; // Main
      else if (fmtp.includes('profile-level-id=4200')) s += 2; // Baseline
      // 42e0 (Constrained Baseline) → software en Chromium/Windows: el último.
    }
    if (preferred === 'H265' && fmtp.includes('profile-id=1')) s += 2; // Main
    return s;
  };
  return [...codecs].sort((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------- estadísticas

export interface StreamStats {
  rttMs: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  /** Implementación del (de)codificador, p. ej. "MediaFoundationVideoEncodeAccelerator" o "libvpx". */
  implementation: string | null;
  /** true si el navegador informa de que usa hardware. */
  hardware: boolean | null;
  qualityLimitation: string | null;
  path: 'direct' | 'relay' | 'unknown';
  framesDropped: number | null;
}

export interface StatsSample {
  ts: number;
  bytes: number;
  packetsLost: number;
  packets: number;
}

type Stat = Record<string, unknown> & { type: string; id: string };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function selectedPair(stats: Stat[]): Stat | undefined {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const transport = stats.find((s) => s.type === 'transport' && typeof s['selectedCandidatePairId'] === 'string');
  if (transport) return byId.get(transport['selectedCandidatePairId'] as string);
  return stats.find((s) => s.type === 'candidate-pair' && s['nominated'] === true && s['state'] === 'succeeded');
}

function pathAndRtt(stats: Stat[]): { path: StreamStats['path']; rttMs: number | null } {
  const pair = selectedPair(stats);
  if (!pair) return { path: 'unknown', rttMs: null };
  const local = stats.find((s) => s.id === pair['localCandidateId']);
  const remote = stats.find((s) => s.id === pair['remoteCandidateId']);
  const relay = local?.['candidateType'] === 'relay' || remote?.['candidateType'] === 'relay';
  const rtt = num(pair['currentRoundTripTime']);
  return { path: relay ? 'relay' : 'direct', rttMs: rtt === null ? null : Math.round(rtt * 1000) };
}

function codecName(stats: Stat[], codecId: unknown): string | null {
  const c = stats.find((s) => s.type === 'codec' && s.id === codecId);
  return typeof c?.['mimeType'] === 'string' ? (c['mimeType'] as string).replace(/^video\//i, '') : null;
}

function rateAndLoss(sample: StatsSample, prev: StatsSample | null): { bitrateKbps: number | null; packetLossPct: number | null } {
  if (!prev || sample.ts <= prev.ts) return { bitrateKbps: null, packetLossPct: null };
  const dt = sample.ts - prev.ts;
  const bitrateKbps = Math.max(0, Math.round(((sample.bytes - prev.bytes) * 8) / dt));
  const lost = Math.max(0, sample.packetsLost - prev.packetsLost);
  const got = Math.max(0, sample.packets - prev.packets);
  const packetLossPct = lost + got > 0 ? round1((lost / (lost + got)) * 100) : 0;
  return { bitrateKbps, packetLossPct };
}

/** Resumen del vídeo recibido (invitado). `prev` es la muestra anterior, para calcular el bitrate y la pérdida. */
export function summarizeInbound(stats: Stat[], prev: StatsSample | null, now: number): { stats: StreamStats; sample: StatsSample } {
  const v = stats.find((s) => s.type === 'inbound-rtp' && s['kind'] === 'video');
  const sample: StatsSample = {
    ts: now,
    bytes: num(v?.['bytesReceived']) ?? 0,
    packetsLost: num(v?.['packetsLost']) ?? 0,
    packets: num(v?.['packetsReceived']) ?? 0,
  };
  const { path, rttMs } = pathAndRtt(stats);
  const jitter = num(v?.['jitter']);
  return {
    sample,
    stats: {
      rttMs,
      fps: num(v?.['framesPerSecond']),
      ...rateAndLoss(sample, prev),
      jitterMs: jitter === null ? null : Math.round(jitter * 1000),
      width: num(v?.['frameWidth']),
      height: num(v?.['frameHeight']),
      codec: codecName(stats, v?.['codecId']),
      implementation: typeof v?.['decoderImplementation'] === 'string' ? (v['decoderImplementation'] as string) : null,
      hardware: typeof v?.['powerEfficientDecoder'] === 'boolean' ? (v['powerEfficientDecoder'] as boolean) : null,
      qualityLimitation: null,
      path,
      framesDropped: num(v?.['framesDropped']),
    },
  };
}

/** Resumen del vídeo enviado (anfitrión). */
export function summarizeOutbound(stats: Stat[], prev: StatsSample | null, now: number): { stats: StreamStats; sample: StatsSample } {
  const v = stats.find((s) => s.type === 'outbound-rtp' && s['kind'] === 'video');
  const remote = stats.find((s) => s.type === 'remote-inbound-rtp' && s['kind'] === 'video');
  const sample: StatsSample = {
    ts: now,
    bytes: num(v?.['bytesSent']) ?? 0,
    packetsLost: num(remote?.['packetsLost']) ?? 0,
    packets: num(v?.['packetsSent']) ?? 0,
  };
  const { path, rttMs } = pathAndRtt(stats);
  const rate = rateAndLoss(sample, prev);
  const fraction = num(remote?.['fractionLost']);
  const jitter = num(remote?.['jitter']);
  return {
    sample,
    stats: {
      rttMs,
      fps: num(v?.['framesPerSecond']),
      bitrateKbps: rate.bitrateKbps,
      packetLossPct: fraction !== null ? round1(fraction * 100) : rate.packetLossPct,
      jitterMs: jitter === null ? null : Math.round(jitter * 1000),
      width: num(v?.['frameWidth']),
      height: num(v?.['frameHeight']),
      codec: codecName(stats, v?.['codecId']),
      implementation: typeof v?.['encoderImplementation'] === 'string' ? (v['encoderImplementation'] as string) : null,
      hardware: typeof v?.['powerEfficientEncoder'] === 'boolean' ? (v['powerEfficientEncoder'] as boolean) : null,
      qualityLimitation: typeof v?.['qualityLimitationReason'] === 'string' ? (v['qualityLimitationReason'] as string) : null,
      path,
      framesDropped: null,
    },
  };
}
