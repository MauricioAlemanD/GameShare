import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { BRIDGE, GameShareBridge } from './core/bridge';
import { StreamingEngine } from './streaming/streaming-engine';
import { WebRtcEngine } from './streaming/webrtc-engine';

describe('App', () => {
  beforeEach(async () => {
    const bridge: GameShareBridge = {
      getSettings: async () => ({ backendUrl: 'http://localhost:8080', displayName: '', hasHostKey: false }),
      updateSettings: async (u) => ({ ...u, hasHostKey: false }),
      getHostKey: async () => null,
      copyText: async () => {},
      appInfo: async () => ({ version: 't', profile: null }),
      onEmergency: () => () => {},
      listCaptureSources: async () => [],
      selectCaptureSource: async () => {},
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: BRIDGE, useValue: bridge },
        { provide: StreamingEngine, useClass: WebRtcEngine },
      ],
    }).compileComponents();
  });

  it('muestra la pantalla de inicio con las dos opciones', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r)); // deja terminar store.init()
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('GameShare');
    expect(el.querySelector('[data-testid="create-session"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="join-session"]')).toBeTruthy();
  });
});
