import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SessionStore } from '../core/session.store';
import { StreamingEngine } from '../streaming/streaming-engine';
import { encodeStateFrame, friendlyPadName, mapStandardGamepad, NEUTRAL, PadFamily, padFamily, PadState, sameState } from './input-protocol';

export interface PadInfo {
  index: number;
  id: string;
  name: string;
  family: PadFamily;
  standard: boolean;
}

/** Frecuencia de lectura del mando: 125 Hz. */
export const SAMPLE_INTERVAL_MS = 8;
/** Aunque no cambie nada, se reenvía el estado cada 100 ms (el anfitrión suelta todo a los 500 ms sin datos). */
export const HEARTBEAT_MS = 100;
const RUMBLE_REFRESH_MS = 1500;

/**
 * Invitado: lee el mando elegido (Xbox, PS4/PS5 u otro con mapeo estándar) y envía su estado al anfitrión
 * por el canal de datos, solo si el anfitrión ha dado permiso.
 */
@Injectable({ providedIn: 'root' })
export class GuestGamepadService {
  private readonly store = inject(SessionStore);
  private readonly engine = inject(StreamingEngine);

  readonly pads = signal<PadInfo[]>([]);
  readonly selectedIndex = signal<number | null>(null);
  readonly live = signal<PadState>(NEUTRAL);
  readonly vibration = signal(true);
  readonly framesPerSecond = signal(0);

  readonly selected = computed(() => this.pads().find((p) => p.index === this.selectedIndex()) ?? null);
  readonly allowed = computed(() => this.store.role() === 'GUEST' && this.store.me()?.gamepadAllowed === true);
  readonly sending = computed(
    () => this.allowed() && this.engine.inputChannelOpen() && !!this.selected() && this.selected()!.standard,
  );

  private seq = 0;
  private lastSentAt = 0;
  private lastSent: PadState | null = null;
  private sentThisSecond = 0;
  private rumbleTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const tick = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
    const fps = setInterval(() => {
      this.framesPerSecond.set(this.sentThisSecond);
      this.sentThisSecond = 0;
    }, 1000);
    const sub = this.engine.rumble$.subscribe((r) => this.rumble(r.large, r.small));
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      clearInterval(fps);
      sub.unsubscribe();
      this.stopRumble();
    });
  }

  select(index: number): void {
    this.selectedIndex.set(index);
    this.lastSent = null;
  }

  /** Vibración de prueba local (no se envía nada). */
  testVibration(): void {
    this.rumble(160, 160);
    setTimeout(() => this.rumble(0, 0), 400);
  }

  private tick(): void {
    if (this.store.role() !== 'GUEST') return;
    const list = (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g && g.connected);
    this.refreshList(list);

    const gp = list.find((g) => g.index === this.selectedIndex());
    const state = gp && gp.mapping === 'standard' ? mapStandardGamepad(gp) : NEUTRAL;
    if (!sameState(state, this.live())) this.live.set(state);

    if (!this.sending()) {
      this.lastSent = null;
      return;
    }
    const now = performance.now();
    const changed = !this.lastSent || !sameState(state, this.lastSent);
    if (!changed && now - this.lastSentAt < HEARTBEAT_MS) return;
    if (this.engine.sendInputFrame(encodeStateFrame(++this.seq, state))) {
      this.lastSent = state;
      this.lastSentAt = now;
      this.sentThisSecond++;
    }
  }

  private refreshList(list: Gamepad[]): void {
    const current = this.pads();
    const same = current.length === list.length && current.every((p, i) => p.id === list[i].id && p.index === list[i].index);
    if (!same) {
      this.pads.set(
        list.map((g) => ({ index: g.index, id: g.id, name: friendlyPadName(g.id), family: padFamily(g.id), standard: g.mapping === 'standard' })),
      );
    }
    // Elegir automáticamente el primer mando compatible; si se desconecta, pasar al siguiente.
    if (!list.some((g) => g.index === this.selectedIndex())) {
      const first = list.find((g) => g.mapping === 'standard') ?? list[0];
      this.selectedIndex.set(first ? first.index : null);
    }
  }

  private rumble(large: number, small: number): void {
    const gp = navigator.getGamepads?.().find((g) => g?.index === this.selectedIndex());
    const actuator = gp?.vibrationActuator;
    if (!actuator) return;
    this.stopRumble();
    if (!this.vibration() || (large === 0 && small === 0)) {
      void actuator.reset?.().catch(() => undefined);
      return;
    }
    const play = () =>
      void actuator
        .playEffect('dual-rumble', { startDelay: 0, duration: RUMBLE_REFRESH_MS + 500, strongMagnitude: large / 255, weakMagnitude: small / 255 })
        .catch(() => undefined);
    play();
    // La vibración del juego dura hasta que pide parar: se renueva mientras siga activa.
    this.rumbleTimer = setInterval(play, RUMBLE_REFRESH_MS);
  }

  private stopRumble(): void {
    if (this.rumbleTimer) clearInterval(this.rumbleTimer);
    this.rumbleTimer = null;
  }
}
