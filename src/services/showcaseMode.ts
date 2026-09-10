import type { EditorStatus } from './fileService';

export interface ShowcaseConnectionState {
  serverOnline: true;
  editorStatus: EditorStatus;
}

/** Applied only when Electron explicitly launches a development showcase session. */
export function createHealthyShowcaseConnection(projectFile: string): ShowcaseConnectionState {
  return {
    serverOnline: true,
    editorStatus: {
      success: true,
      uefnRunning: true,
      connectionState: 'connected',
      projectOpening: false,
      editorConnected: true,
      projectActive: true,
      exactProjectOpen: true,
      differentProjectOpen: false,
      openProjectFile: projectFile,
      connectorAlive: true,
      projectReady: true,
      readinessReason: 'verified',
      pythonEnabled: true,
      autoConnectorInstalled: true,
      nativeTextureImportAvailable: true,
      bootstrapState: 'connected',
    },
  };
}
