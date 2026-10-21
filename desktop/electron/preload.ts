// Preload aislado (contextIsolation + sandbox). Expone a la interfaz SOLO estas funciones.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gameshare', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update: unknown) => ipcRenderer.invoke('settings:update', update),
  getHostKey: () => ipcRenderer.invoke('settings:host-key'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  appInfo: () => ipcRenderer.invoke('app:info'),
  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  selectCaptureSource: (id: string) => ipcRenderer.invoke('capture:select', id),
  onEmergency: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('gameshare:emergency', listener);
    return () => ipcRenderer.removeListener('gameshare:emergency', listener);
  },
});
