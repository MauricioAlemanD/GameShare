import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { formatStreamStats, LINK_LABEL, PATH_LABEL } from '../shared/format';
import { SrcObjectDirective } from '../shared/src-object.directive';
import { StreamingEngine } from '../streaming/streaming-engine';

@Component({
  selector: 'app-guest-stream',
  imports: [SrcObjectDirective],
  template: `
    <section class="card stage-card">
      <div class="stage" #stage (dblclick)="toggleFullscreen()">
        @if (engine.remoteStream()) {
          <video data-testid="remote-video" autoplay playsinline
                 [appSrcObject]="engine.remoteStream()" [muted]="muted()"></video>
        } @else {
          <div class="placeholder" data-testid="stage-placeholder">{{ placeholder() }}</div>
        }
      </div>
      <div class="row stage-controls">
        <button data-testid="mute-toggle" (click)="muted.set(!muted())">
          {{ muted() ? '🔇 Activar audio' : '🔊 Silenciar' }}
        </button>
        <button data-testid="fullscreen" [disabled]="!engine.remoteStream()" (click)="toggleFullscreen()">⛶ Pantalla completa</button>
        <span class="spacer"></span>
        @if (engine.stats(); as s) {
          <span class="chip" [class.relay]="s.path === 'relay'" data-testid="path">{{ pathLabel[s.path] }}</span>
        }
        <span class="chip" data-testid="link-state">{{ linkLabel[engine.linkState()] }}</span>
      </div>
      <p class="small muted" data-testid="guest-stream-stats">Recepción: {{ statsText() }}</p>
    </section>
  `,
})
export class GuestStream {
  protected readonly engine = inject(StreamingEngine);
  protected readonly muted = signal(false);
  protected readonly linkLabel = LINK_LABEL;
  protected readonly pathLabel = PATH_LABEL;
  protected readonly statsText = computed(() => formatStreamStats(this.engine.stats()));
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly placeholder = computed(() => {
    switch (this.engine.linkState()) {
      case 'new':
      case 'connecting':
        return 'Conectando con el anfitrión…';
      case 'disconnected':
      case 'failed':
        return 'Conexión perdida. Reintentando…';
      default:
        return 'Esperando a que el anfitrión empiece a compartir…';
    }
  });

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (this.engine.remoteStream()) {
      void this.stage().nativeElement.requestFullscreen().catch(() => undefined);
    }
  }
}
