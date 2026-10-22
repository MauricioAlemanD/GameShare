import { Component, inject } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { GuestGamepadPanel } from './guest-gamepad-panel';
import { GuestStream } from './guest-stream';

@Component({
  selector: 'app-guest-panel',
  imports: [GuestStream, GuestGamepadPanel],
  template: `
    @let me = store.me();
    @let host = store.hostParticipant();
    <section class="card session-head">
      <div>
        <h2>Sala de {{ host?.displayName ?? '…' }}</h2>
        <p class="muted small">ID de sesión: <code>{{ store.session()?.sessionId ?? store.creds()?.sessionId }}</code></p>
      </div>
      <button class="danger" data-testid="leave" (click)="store.leave()">Salir</button>
    </section>

    @if (!me || me.status === 'PENDING') {
      <section class="card highlight" data-testid="waiting">
        <h3>Esperando aprobación…</h3>
        <p class="muted">{{ host?.displayName ?? 'El anfitrión' }} tiene que aceptarte para empezar.</p>
      </section>
    } @else {
      <app-guest-stream />
      <section class="card" data-testid="approved">
        <h3>Estás dentro ✔</h3>
        <ul class="list">
          <li>
            <span class="dot" [class.online]="host?.connected"></span>
            Anfitrión: <strong>{{ host?.displayName }}</strong>
            <span class="muted small">{{ host?.connected ? 'en línea' : 'desconectado' }}</span>
          </li>
          <li data-testid="gamepad-status">
            🎮 Mando: <strong>{{ me.gamepadAllowed ? 'permitido' : 'no permitido' }}</strong>
            <span class="muted small">
              {{ me.gamepadAllowed ? 'Tu mando controlará al jugador 2.' : 'El anfitrión aún no te ha dado el mando.' }}
            </span>
          </li>
        </ul>
      </section>
      <app-guest-gamepad-panel />
    }
  `,
})
export class GuestPanel {
  protected readonly store = inject(SessionStore);
}
