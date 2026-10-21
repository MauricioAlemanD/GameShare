import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { SessionStore } from './core/session.store';
import { GuestPanel } from './features/guest-panel';
import { Home } from './features/home';
import { HostPanel } from './features/host-panel';
import { SettingsPanel } from './features/settings-panel';
import { StreamingEngine } from './streaming/streaming-engine';
import { WS_LABEL } from './shared/format';

@Component({
  selector: 'app-root',
  imports: [Home, HostPanel, GuestPanel, SettingsPanel],
  template: `
    <header class="topbar">
      <h1>🎮 GameShare</h1>
      <span class="chip" data-testid="ws-state" [class]="'chip ' + store.wsState()">{{ wsLabel[store.wsState()] }}</span>
      <span class="spacer"></span>
      @if (!store.creds()) {
        <button class="ghost" data-testid="open-settings" (click)="showSettings.set(!showSettings())">⚙ Ajustes</button>
      }
    </header>

    <main>
      @if (store.error(); as err) {
        <div class="banner error" role="alert" data-testid="error">
          <span>{{ err }}</span>
          <button class="ghost small" (click)="store.dismissError()">✕</button>
        </div>
      }
      @if (store.notice(); as n) {
        <div class="banner info" role="status" data-testid="notice">{{ n }}</div>
      }

      @if (!ready()) {
        <p class="muted">Cargando…</p>
      } @else if (store.ended(); as msg) {
        <section class="card" data-testid="ended">
          <h2>Sesión finalizada</h2>
          <p>{{ msg }}</p>
          <button class="primary" data-testid="back-home" (click)="store.dismissEnded()">Volver al inicio</button>
        </section>
      } @else if (store.role() === 'HOST') {
        <app-host-panel />
      } @else if (store.role() === 'GUEST') {
        <app-guest-panel />
      } @else {
        @if (showSettings()) {
          <app-settings-panel (closed)="showSettings.set(false)" />
        }
        <app-home />
      }
    </main>
  `,
})
export class App implements OnInit {
  protected readonly store = inject(SessionStore);
  /** Se crea al arrancar para que el motor escuche las señales desde el principio. */
  protected readonly engine = inject(StreamingEngine);
  protected readonly ready = signal(false);
  protected readonly showSettings = signal(false);
  protected readonly wsLabel = WS_LABEL;

  constructor() {
    // Los avisos desaparecen solos a los 4 s.
    effect((onCleanup) => {
      if (!this.store.notice()) return;
      const t = setTimeout(() => this.store.notice.set(null), 4000);
      onCleanup(() => clearTimeout(t));
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.store.init();
    } finally {
      this.ready.set(true);
    }
  }
}
