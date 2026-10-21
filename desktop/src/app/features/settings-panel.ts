import { Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-settings-panel',
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Ajustes</h2>
      <label>
        Servidor de coordinación
        <input data-testid="backend-url" [(ngModel)]="backendUrl" placeholder="https://gameshare.ejemplo.com" />
      </label>
      <label>
        Clave de anfitrión <span class="muted">(opcional; solo si tu servidor la exige)</span>
        <input data-testid="host-key" type="password" [(ngModel)]="hostKey"
               [placeholder]="store.settings()?.hasHostKey ? '•••••• (guardada, cifrada)' : 'sin clave'" />
      </label>
      <div class="row">
        <button class="primary" data-testid="save-settings" (click)="save()">Guardar</button>
        @if (store.settings()?.hasHostKey) {
          <button (click)="clearKey()">Borrar clave</button>
        }
        <button class="ghost" (click)="closed.emit()">Cerrar</button>
      </div>
      <p class="muted small">Si cambias el servidor, la aplicación se recarga para aplicar la política de seguridad.</p>
    </section>
  `,
})
export class SettingsPanel implements OnInit {
  protected readonly store = inject(SessionStore);
  readonly closed = output<void>();
  protected backendUrl = '';
  protected hostKey = '';
  protected readonly saving = signal(false);

  ngOnInit(): void {
    this.backendUrl = this.store.settings()?.backendUrl ?? '';
  }

  async save(): Promise<void> {
    const before = this.store.settings();
    if (!before) return;
    const ok = await this.store.saveSettings({
      backendUrl: this.backendUrl,
      displayName: before.displayName || 'Jugador',
      hostKey: this.hostKey ? this.hostKey : undefined,
    });
    if (!ok) return;
    this.hostKey = '';
    if (this.store.settings()?.backendUrl !== before.backendUrl) {
      location.reload();
      return;
    }
    this.closed.emit();
  }

  async clearKey(): Promise<void> {
    const s = this.store.settings();
    if (!s) return;
    await this.store.saveSettings({ backendUrl: s.backendUrl, displayName: s.displayName || 'Jugador', hostKey: null });
  }
}
