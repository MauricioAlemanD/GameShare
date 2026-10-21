import { ConnectionStats, InviteState, ParticipantStatus } from '../core/models';
import { WsState } from '../core/signaling-client';
import { LinkState } from '../streaming/streaming-engine';
import { StreamStats } from '../streaming/webrtc-utils';

/** Texto de estadísticas de streaming. El anfitrión ve lo que envía; el invitado, lo que recibe. */
export function formatStreamStats(s: StreamStats | null): string {
  if (!s) return 'Midiendo…';
  const parts: string[] = [];
  if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
  if (s.fps !== null) parts.push(`${Math.round(s.fps)} fps`);
  if (s.bitrateKbps !== null) parts.push(`${(s.bitrateKbps / 1000).toFixed(1)} Mbps`);
  if (s.rttMs !== null) parts.push(`latencia de red ${s.rttMs} ms`);
  if (s.packetLossPct !== null) parts.push(`pérdida ${s.packetLossPct.toFixed(1)} %`);
  if (s.jitterMs !== null) parts.push(`jitter ${s.jitterMs} ms`);
  if (s.codec) {
    const hw = s.hardware === true ? ' · hardware' : s.hardware === false ? ' · software' : '';
    parts.push(`${s.codec}${s.implementation ? ` (${s.implementation}${hw})` : ''}`);
  }
  if (s.qualityLimitation && s.qualityLimitation !== 'none') parts.push(`limitado por ${LIMIT_LABEL[s.qualityLimitation] ?? s.qualityLimitation}`);
  return parts.join(' · ') || 'Midiendo…';
}

const LIMIT_LABEL: Record<string, string> = { cpu: 'CPU', bandwidth: 'ancho de banda', other: 'otro' };

export const PATH_LABEL: Record<StreamStats['path'], string> = {
  direct: 'Conexión directa (P2P)',
  relay: 'Conexión retransmitida (TURN)',
  unknown: 'Ruta desconocida',
};

export const LINK_LABEL: Record<LinkState, string> = {
  idle: 'Sin conexión',
  new: 'Preparando…',
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Conexión inestable…',
  failed: 'Conexión fallida, reintentando…',
  closed: 'Cerrada',
};

export function formatStats(s: ConnectionStats | null): string {
  if (!s) return 'Sin datos todavía (aparecen cuando recibe el vídeo).';
  const mbps = (s.bitrateKbps / 1000).toFixed(1);
  return `Latencia ${Math.round(s.rttMs)} ms · ${Math.round(s.fps)} fps · ${mbps} Mbps · pérdida ${s.packetLossPct.toFixed(1)} % · jitter ${Math.round(s.jitterMs)} ms`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

export const WS_LABEL: Record<WsState | 'idle', string> = {
  idle: 'Sin sesión',
  connecting: 'Conectando…',
  online: 'Conectado',
  reconnecting: 'Reconectando…',
  closed: 'Desconectado',
};

export const INVITE_LABEL: Record<InviteState, string> = {
  ACTIVE: 'Activa',
  USED: 'Usada',
  REVOKED: 'Revocada',
  EXPIRED: 'Caducada',
};

export const STATUS_LABEL: Record<ParticipantStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aceptado',
  REJECTED: 'Rechazado',
  REVOKED: 'Revocado',
  LEFT: 'Salió',
};
