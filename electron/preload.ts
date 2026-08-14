import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherState, WindowAction } from './contracts.js';

const windowActions = new Set<WindowAction>(['request-state', 'drag', 'minimize', 'toggle-maximize', 'switch-project', 'close']);

contextBridge.exposeInMainWorld('uemDesktop', Object.freeze({
  isDesktop: true,
  launcher: Object.freeze({
    getState: (): Promise<LauncherState> => ipcRenderer.invoke('uem:launcher:get-state'),
    browse: (): Promise<LauncherState> => ipcRenderer.invoke('uem:launcher:browse'),
    select: (projectId: string): Promise<LauncherState> => ipcRenderer.invoke('uem:launcher:select', typeof projectId === 'string' ? projectId : ''),
    confirm: (projectId: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('uem:launcher:confirm', typeof projectId === 'string' ? projectId : ''),
    onState: (listener: (state: LauncherState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: LauncherState) => listener(state);
      ipcRenderer.on('uem:launcher:state', wrapped);
      return () => ipcRenderer.removeListener('uem:launcher:state', wrapped);
    },
  }),
  window: Object.freeze({
    action: (action: WindowAction) => {
      if (windowActions.has(action)) ipcRenderer.send('uem:window:action', action);
    },
    setDirty: (dirty: boolean) => ipcRenderer.send('uem:window:dirty', dirty === true),
    onState: (listener: (state: 'maximized' | 'normal') => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: 'maximized' | 'normal') => listener(state);
      ipcRenderer.on('uem:window:state', wrapped);
      return () => ipcRenderer.removeListener('uem:window:state', wrapped);
    },
    onConfirmClose: (listener: () => void) => {
      const wrapped = () => listener();
      ipcRenderer.on('uem:window:confirm-close', wrapped);
      return () => ipcRenderer.removeListener('uem:window:confirm-close', wrapped);
    },
  }),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('uem:external:open', typeof url === 'string' ? url : ''),
}));
