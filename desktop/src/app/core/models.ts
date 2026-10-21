// Espejo de las vistas del backend (dev.gameshare.backend.session.Views).

export type Role = 'HOST' | 'GUEST';
export type ParticipantStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'LEFT';
export type InviteState = 'ACTIVE' | 'USED' | 'REVOKED' | 'EXPIRED';

export interface Credentials {
  sessionId: string;
  participantId: string;
  role: Role;
  status: ParticipantStatus;
  token: string;
}

export interface ConnectionStats {
  rttMs: number;
  fps: number;
  bitrateKbps: number;
  packetLossPct: number;
  jitterMs: number;
  reportedAt: string | null;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  role: Role;
  status: ParticipantStatus;
  gamepadAllowed: boolean;
  connected: boolean;
  stats: ConnectionStats | null;
}

export interface SessionView {
  sessionId: string;
  createdAt: string;
  you: string;
  yourRole: Role;
  yourStatus: ParticipantStatus;
  participants: ParticipantView[];
}

export interface InviteView {
  id: string;
  code: string | null;
  createdAt: string;
  expiresAt: string;
  state: InviteState;
}

export interface IceConfig {
  iceServers: { urls: string[]; username: string | null; credential: string | null }[];
  ttlSeconds: number;
}

/** Mensajes WebSocket servidor → cliente. */
export type ServerMessage =
  | { type: 'auth-ok'; participantId: string; role: Role; session?: SessionView }
  | { type: 'session-updated'; reason: string; session: SessionView }
  | { type: 'signal'; from: string; data: Record<string, unknown> }
  | { type: 'evicted'; reason: string }
  | { type: 'session-closed'; reason: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
