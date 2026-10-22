import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { BRIDGE, InputStatus } from '../core/bridge';
import { SessionStore } from '../core/session.store';

/**
 * Anfitrión: mantiene un mando virtual por cada invitado APROBADO con permiso de mando.
 * Al quitar el permiso, revocar, cerrar la sala o terminar la sesión, el mando se suelta y se desconecta.
 */
@Injectable({ providedIn: 'root' })
export class HostInputService {
  private readonly store = inject(SessionStore);
  private readonly bridge = inject(BRIDGE);

  readonly status = signal<InputStatus | null>(null);
  private granted = new Set<string>();

  constructor() {
    this.bridge.onInputStatus((s) => this.status.set(s));
    void this.bridge.getInputStatus().then((s) => this.status.set(s)).catch(() => undefined);

    effect(() => {
      const isHost = this.store.role() === 'HOST';
      const wanted = isHost ? this.store.approvedGuests().filter((g) => g.gamepadAllowed).map((g) => g.id) : [];
      untracked(() => this.sync(new Set(wanted), isHost));
    });
  }

  private sync(wanted: Set<string>, isHost: boolean): void {
    for (const id of this.granted) {
      if (!wanted.has(id)) void this.bridge.setGamepadPermission(id, false);
    }
    for (const id of wanted) {
      if (!this.granted.has(id)) void this.bridge.setGamepadPermission(id, true);
    }
    if (!isHost && this.granted.size > 0) void this.bridge.releaseAllInput();
    this.granted = wanted;
  }

  padFor(guestId: string): { connected: boolean; xinputIndex: number } | null {
    return this.status()?.pads[guestId] ?? null;
  }
}
