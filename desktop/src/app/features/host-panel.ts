import { Component, inject, signal } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { formatStats, formatTime, INVITE_LABEL } from '../shared/format';
import { HostStream } from './host-stream';

@Component({
  selector: 'app-host-panel',
  imports: [HostStream],
  template: `
    <section class="card session-head">
      <div>
        <h2>Tu sala</h2>
        <p class="muted small">ID de sesión: <code>{{ store.session()?.sessionId }}</code></p>
      </div>
      <div class="row">
        @if (confirmClose()) {
          <span class="small">¿Cerrar la sala y desconectar a todos?</span>
          <button class="danger" data-testid="confirm-close" (click)="store.closeSession()">Sí, cerrar</button>
          <button class="ghost" (click)="confirmClose.set(false)">No</button>
        } @else {
          <button class="danger" data-testid="close-session" (click)="confirmClose.set(true)"
                  title="También con Ctrl+Shift+F12">
            ⏻ Cerrar sala (emergencia)
          </button>
        }
      </div>
    </section>

    <app-host-stream />

    <section class="card">
      <h3>Invitar</h3>
      <p class="muted small">Cada invitación sirve una sola vez y caduca a los 15 minutos.</p>
      <button data-testid="new-invite" [disabled]="store.busy()" (click)="store.createInvite()">Nueva invitación</button>
      @if (store.latestInvite(); as inv) {
        <div class="invite-box">
          <input data-testid="invite-link" readonly [value]="inv.link" (focus)="$any($event.target).select()" />
          <button class="primary" data-testid="copy-invite" (click)="store.copyInvite()">Copiar</button>
        </div>
        <p class="small muted">Caduca a las {{ time(inv.expiresAt) }}. Envíala por un chat privado.</p>
      }
      @if (store.invites().length) {
        <ul class="list">
          @for (i of store.invites(); track i.id) {
            <li>
              <span>Invitación de las {{ time(i.createdAt) }}</span>
              <span class="chip" [class]="'chip ' + i.state.toLowerCase()">{{ inviteLabel[i.state] }}</span>
              @if (i.state === 'ACTIVE') {
                <button class="ghost small" (click)="store.revokeInvite(i.id)">Revocar</button>
              }
            </li>
          }
        </ul>
      }
    </section>

    @if (store.pendingGuests().length) {
      <section class="card highlight" data-testid="requests">
        <h3>Solicitudes para unirse</h3>
        <ul class="list">
          @for (p of store.pendingGuests(); track p.id) {
            <li data-testid="request">
              <strong>{{ p.displayName }}</strong> quiere unirse
              <span class="spacer"></span>
              <button class="primary" data-testid="approve" (click)="store.approve(p.id)">Aceptar</button>
              <button class="ghost" data-testid="reject" (click)="store.reject(p.id)">Rechazar</button>
            </li>
          }
        </ul>
      </section>
    }

    <section class="card">
      <h3>Jugadores</h3>
      <ul class="list">
        <li>
          <span class="dot online"></span>
          <strong>{{ store.hostParticipant()?.displayName }}</strong>
          <span class="muted small">(tú, anfitrión · mando local)</span>
        </li>
        @for (p of store.approvedGuests(); track p.id) {
          <li class="player" data-testid="guest-row">
            <span class="dot" [class.online]="p.connected"></span>
            <strong>{{ p.displayName }}</strong>
            <span class="muted small">{{ p.connected ? 'conectada/o' : 'desconectada/o' }}</span>
            <span class="spacer"></span>
            <label class="toggle">
              <input type="checkbox" data-testid="gamepad-toggle" [checked]="p.gamepadAllowed"
                     (change)="store.setGamepad(p.id, $any($event.target).checked)" />
              Permitir mando
            </label>
            <button class="danger small" data-testid="revoke" (click)="store.revoke(p.id)">Revocar acceso</button>
            <div class="stats small muted" data-testid="guest-stats">{{ stats(p.stats) }}</div>
          </li>
        } @empty {
          <li class="muted">Todavía no hay invitados. Crea una invitación y compártela.</li>
        }
      </ul>
    </section>
  `,
})
export class HostPanel {
  protected readonly store = inject(SessionStore);
  protected readonly confirmClose = signal(false);
  protected readonly inviteLabel = INVITE_LABEL;
  protected readonly time = formatTime;
  protected readonly stats = formatStats;
}
