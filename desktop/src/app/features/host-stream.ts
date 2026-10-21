import { Component, computed, inject, signal } from '@angular/core';
import { CaptureSource, ipcErrorMessage } from '../core/bridge';
import { SessionStore } from '../core/session.store';
import { formatStreamStats, LINK_LABEL, PATH_LABEL } from '../shared/format';
import { SrcObjectDirective } from '../shared/src-object.directive';
import { LinkState, StreamingEngine } from '../streaming/streaming-engine';
import { QUALITY_PRESETS, VideoCodec } from '../streaming/webrtc-utils';

@Component({
  selector: 'app-host-stream',
  imports: [SrcObjectDirective],
  template: `
    <section class="card" data-testid="stream-card">
      <h3>Transmisión</h3>

      @if (!engine.localStream()) {
        <p class="muted small">
          Elige la ventana del juego (mejor en modo <em>ventana sin bordes</em>) o una pantalla completa.
          Se envía también el audio del sistema.
        </p>
        <div class="row">
          <select data-testid="quality" [value]="engine.preset().id" (change)="engine.setPreset($any($event.target).value)">
            @for (p of presets; track p.id) {
              <option [value]="p.id">{{ p.label }}</option>
            }
          </select>
          <button class="primary" data-testid="pick-source" (click)="openPicker()">Elegir qué compartir</button>
        </div>
      } @else {
        <div class="live">
          <video class="preview" muted autoplay [appSrcObject]="engine.localStream()"></video>
          <div class="live-info">
            <p><span class="dot online"></span> Transmitiendo <strong data-testid="sharing-name">{{ sourceName() }}</strong></p>
            <div class="row">
              <label class="toggle">
                <input type="checkbox" data-testid="audio-send-toggle" [checked]="engine.audioSending()"
                       [disabled]="!hasAudio()" (change)="engine.setAudioSending($any($event.target).checked)" />
                {{ hasAudio() ? 'Enviar audio del sistema' : 'Sin audio (no disponible)' }}
              </label>
            </div>
            <div class="row">
              <select data-testid="quality" [value]="engine.preset().id" (change)="engine.setPreset($any($event.target).value)">
                @for (p of presets; track p.id) {
                  <option [value]="p.id">{{ p.label }}</option>
                }
              </select>
              <button (click)="openPicker()">Cambiar fuente</button>
              <button class="danger" data-testid="stop-sharing" (click)="engine.stopSharing()">Detener</button>
            </div>
          </div>
        </div>
        <p class="small muted" data-testid="host-stream-stats">Envío: {{ statsText() }}</p>
        @for (g of store.approvedGuests(); track g.id) {
          <p class="small">
            {{ g.displayName }}: <strong data-testid="peer-state">{{ linkLabel[stateOf(g.id)] }}</strong>
            @if (engine.stats(); as s) { · {{ pathLabel[s.path] }} }
          </p>
        }
      }

      @if (picking()) {
        <div class="picker" data-testid="picker">
          @if (sources().length === 0) {
            <p class="muted">Buscando pantallas y ventanas…</p>
          }
          <div class="sources">
            @for (s of sources(); track s.id) {
              <button class="source" data-testid="source-item" [attr.data-kind]="s.kind" (click)="share(s)">
                @if (s.thumbnail) {
                  <img [src]="s.thumbnail" alt="" />
                }
                <span>{{ s.kind === 'screen' ? '🖥 ' : '🪟 ' }}{{ s.name }}</span>
              </button>
            }
          </div>
          <button class="ghost" (click)="picking.set(false)">Cancelar</button>
        </div>
      }

      <details class="small advanced">
        <summary>Opciones avanzadas</summary>
        <label>
          Códec de vídeo (se aplica a las conexiones nuevas)
          <select [value]="engine.codec()" (change)="setCodec($any($event.target).value)">
            <option value="H264">H.264 High (recomendado, aceleración por hardware)</option>
            <option value="H265">H.265 / HEVC (hardware, mejor calidad por bit)</option>
            <option value="VP8">VP8</option>
            <option value="VP9">VP9</option>
            <option value="AV1">AV1</option>
          </select>
        </label>
        <label class="toggle">
          <input type="checkbox" data-testid="force-relay" [checked]="engine.forceRelay()"
                 (change)="engine.setForceRelay($any($event.target).checked)" />
          Forzar retransmisión por TURN (para pruebas)
        </label>
      </details>
    </section>
  `,
})
export class HostStream {
  protected readonly engine = inject(StreamingEngine);
  protected readonly store = inject(SessionStore);
  protected readonly presets = QUALITY_PRESETS;
  protected readonly linkLabel = LINK_LABEL;
  protected readonly pathLabel = PATH_LABEL;
  protected readonly picking = signal(false);
  protected readonly sources = signal<CaptureSource[]>([]);
  protected readonly sourceName = signal('');
  protected readonly statsText = computed(() => formatStreamStats(this.engine.stats()));
  protected readonly hasAudio = computed(() => (this.engine.localStream()?.getAudioTracks().length ?? 0) > 0);

  async openPicker(): Promise<void> {
    this.sources.set([]);
    this.picking.set(true);
    try {
      this.sources.set(await this.engine.listSources());
    } catch (e) {
      this.picking.set(false);
      this.store.error.set('No se pudieron listar las fuentes: ' + ipcErrorMessage(e));
    }
  }

  async share(s: CaptureSource): Promise<void> {
    this.picking.set(false);
    await this.engine.startSharing(s.id);
    if (this.engine.localStream()) this.sourceName.set(s.name);
  }

  stateOf(guestId: string): LinkState {
    const states: Partial<Record<string, LinkState>> = this.engine.peerStates();
    return states[guestId] ?? 'idle';
  }

  setCodec(codec: VideoCodec): void {
    this.engine.setCodec(codec);
  }
}
