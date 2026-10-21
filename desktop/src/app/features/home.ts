import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-home',
  imports: [FormsModule],
  template: `
    <section class="card">
      <label>
        Tu nombre
        <input data-testid="display-name" [(ngModel)]="name" maxlength="32" placeholder="Ej.: Mau" />
      </label>
      <p class="muted small">Servidor: <code>{{ store.settings()?.backendUrl }}</code></p>
    </section>

    <div class="grid2">
      <section class="card">
        <h2>Ser anfitrión</h2>
        <p class="muted">Tú ejecutas el juego. Creas una sala e invitas a la otra persona.</p>
        <button class="primary" data-testid="create-session" [disabled]="store.busy() || !name.trim()"
                (click)="store.createSession(name.trim())">
          Crear sala
        </button>
      </section>

      <section class="card">
        <h2>Unirme a una sala</h2>
        <label>
          Invitación
          <textarea data-testid="invite-input" rows="3" [(ngModel)]="invite"
                    placeholder="Pega aquí el enlace gameshare://… o el código"></textarea>
        </label>
        <button class="primary" data-testid="join-session" [disabled]="store.busy() || !name.trim() || !invite.trim()"
                (click)="store.join(invite, name.trim())">
          Unirme
        </button>

        @if (store.serverMismatch(); as m) {
          <div class="callout warn" data-testid="server-mismatch">
            <p>Esta invitación usa otro servidor: <code>{{ m.server }}</code>.</p>
            <p class="small">Úsalo solo si confías en quien te envió la invitación.</p>
            <div class="row">
              <button class="primary" (click)="store.acceptInviteServer()">Usar ese servidor y unirme</button>
              <button class="ghost" (click)="store.serverMismatch.set(null)">Cancelar</button>
            </div>
          </div>
        }
      </section>
    </div>
  `,
})
export class Home implements OnInit {
  protected readonly store = inject(SessionStore);
  protected name = '';
  protected invite = '';

  ngOnInit(): void {
    this.name = this.store.settings()?.displayName ?? '';
  }
}
