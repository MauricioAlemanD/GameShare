import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { StreamingEngine } from './streaming/streaming-engine';
import { WebRtcEngine } from './streaming/webrtc-engine';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Motor de streaming intercambiable: para usar otro, basta con cambiar esta línea.
    { provide: StreamingEngine, useClass: WebRtcEngine },
  ],
};
