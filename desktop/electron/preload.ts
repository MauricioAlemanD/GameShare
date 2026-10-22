// Preload aislado (contextIsolation + sandbox). Expone a la interfaz SOLO estas funciones.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

function subscribe<T extends unknown[]>(channel: string, callback: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => callback(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('gameshare', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update: unknown) => ipcRenderer.invoke('settings:update', update),
  getHostKey: () => ipcRenderer.invoke('settings:host-key'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  appInfo: () => ipcRenderer.invoke('app:info'),
  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  selectCaptureSource: (id: string) => ipcRenderer.invoke('capture:select', id),
  onEmergency: (callback: () => void) => subscribe('gameshare:emergency', callback),

  // Mandos remotos (anfitrión)
  setGamepadPermission: (guestId: string, allowed: boolean) => ipcRenderer.invoke('input:set-permission', guestId, allowed),
  resetInput: (guestId: string) => ipcRenderer.invoke('input:reset', guestId),
  releaseAllInput: () => ipcRenderer.invoke('input:release-all'),
  getInputStatus: () => ipcRenderer.invoke('input:status'),
  sendInputFrame: (guestId: string, frame: Uint8Array) => ipcRenderer.send('input:frame', guestId, frame),
  onInputStatus: (callback: (status: unknown) => void) => subscribe('input:status', callback),
  onRumble: (callback: (guestId: string, frame: Uint8Array) => void) => subscribe('input:rumble', callback),
});
