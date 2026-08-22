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
      editorConnected: true,
      projectActive: true,
      differentProjectOpen: false,
      openProjectFile: projectFile,
      pythonEnabled: true,
      autoConnectorInstalled: true,
      nativeTextureImportAvailable: true,
      bootstrapState: 'connected',
    },
  };
}
