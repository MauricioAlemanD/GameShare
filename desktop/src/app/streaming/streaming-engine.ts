import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { CaptureSource } from '../core/bridge';
import { QualityPreset, StreamStats, VideoCodec } from './webrtc-utils';

export type LinkState = RTCPeerConnectionState | 'idle';

/**
 * Contrato del motor de streaming. La interfaz y la lógica de sesión solo dependen de esto,
 * así que el motor se puede sustituir (p. ej., por Sunshine/Moonlight como proceso externo)
 * sin tocar las pantallas, las invitaciones ni los permisos.
 */
export abstract class StreamingEngine {
  abstract readonly name: string;

  // ---- anfitrión
  /** Lo que se está transmitiendo, o null. */
  abstract readonly localStream: Signal<MediaStream | null>;
  abstract readonly audioSending: Signal<boolean>;
  abstract readonly preset: Signal<QualityPreset>;
  abstract readonly codec: Signal<VideoCodec>;
  abstract readonly forceRelay: Signal<boolean>;
  /** Estado de la conexión con cada invitado, por participantId. */
  abstract readonly peerStates: Signal<Record<string, LinkState>>;
  abstract listSources(): Promise<CaptureSource[]>;
  abstract startSharing(sourceId: string): Promise<void>;
  abstract stopSharing(): void;
  abstract setAudioSending(enabled: boolean): void;
  abstract setPreset(id: string): Promise<void>;
  abstract setCodec(codec: VideoCodec): void;
  abstract setForceRelay(enabled: boolean): void;

  // ---- invitado
  abstract readonly remoteStream: Signal<MediaStream | null>;
  abstract readonly linkState: Signal<LinkState>;
  /** Canal del mando abierto con el anfitrión. */
  abstract readonly inputChannelOpen: Signal<boolean>;
  /** Envía una trama de estado del mando. Devuelve false si no se pudo (canal cerrado o saturado). */
  abstract sendInputFrame(frame: Uint8Array): boolean;
  /** Vibración pedida por el juego del anfitrión. */
  abstract readonly rumble$: Observable<{ large: number; small: number }>;

  // ---- ambos
  /** Estadísticas de la conexión principal (envío en el anfitrión, recepción en el invitado). */
  abstract readonly stats: Signal<StreamStats | null>;
}
