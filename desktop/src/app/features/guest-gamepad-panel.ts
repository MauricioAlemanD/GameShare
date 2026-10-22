import { Component, computed, inject } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { GuestGamepadService } from '../input/guest-gamepad.service';
import { buttonLabels } from '../input/input-protocol';
import { StreamingEngine } from '../streaming/streaming-engine';

@Component({
  selector: 'app-guest-gamepad-panel',
  template: `
    <section class="card" data-testid="gamepad-panel">
      <h3>🎮 Tu mando</h3>
      @if (pads.pads().length === 0) {
        <p class="muted" data-testid="no-gamepad">
          No se detecta ningún mando. Conéctalo (Xbox, PS4 o PS5) y <strong>pulsa cualquier botón</strong>.
        </p>
      } @else {
        <div class="row">
          <select data-testid="gamepad-select" [value]="pads.selectedIndex()" (change)="pads.select(+$any($event.target).value)">
            @for (p of pads.pads(); track p.index) {
              <option [value]="p.index">{{ p.name }}{{ p.standard ? '' : ' (no compatible)' }}</option>
            }
          </select>
          <label class="toggle">
            <input type="checkbox" [checked]="pads.vibration()" (change)="pads.vibration.set($any($event.target).checked)" />
            Vibración
          </label>
          <button class="ghost small" (click)="pads.testVibration()">Probar vibración</button>
        </div>
      }
      <p data-testid="gamepad-send-status" [class.ok]="pads.sending()">{{ statusText() }}</p>
      @if (pads.selected()) {
        <div class="pad-live" data-testid="pad-live">
          @for (b of labels(); track b[0]) {
            <span class="key" [class.on]="isPressed(b[0])">{{ b[1] }}</span>
          }
          <span class="key" [class.on]="pads.live().lt > 30">{{ family() === 'playstation' ? 'L2' : 'LT' }}</span>
          <span class="key" [class.on]="pads.live().rt > 30">{{ family() === 'playstation' ? 'R2' : 'RT' }}</span>
          <span class="muted small sticks">
            L ({{ pct(pads.live().lx) }}, {{ pct(pads.live().ly) }}) · R ({{ pct(pads.live().rx) }}, {{ pct(pads.live().ry) }})
          </span>
        </div>
      }
    </section>
  `,
})
export class GuestGamepadPanel {
  protected readonly pads = inject(GuestGamepadService);
  private readonly store = inject(SessionStore);
  private readonly engine = inject(StreamingEngine);

  protected readonly family = computed(() => this.pads.selected()?.family ?? 'xbox');
  protected readonly labels = computed(() => buttonLabels(this.family()));

  protected readonly statusText = computed(() => {
    const host = this.store.hostParticipant()?.displayName ?? 'El anfitrión';
    if (!this.pads.allowed()) return `${host} aún no te ha dado el mando.`;
    if (!this.pads.selected()) return 'Conecta un mando para jugar.';
    if (!this.pads.selected()!.standard) return 'Este mando no tiene un mapeo compatible. Prueba con otro.';
    if (!this.engine.inputChannelOpen()) return 'Conectando el mando con el anfitrión…';
    return `✔ Tu mando controla al jugador 2 en el PC de ${host} (${this.pads.framesPerSecond()} envíos/s).`;
  });

  protected isPressed(bit: number): boolean {
    return (this.pads.live().buttons & bit) !== 0;
  }

  protected pct(v: number): number {
    return Math.round((v / 32767) * 100);
  }
}
