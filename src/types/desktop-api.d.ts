export {};

type DesktopWindowAction = 'request-state' | 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close';
declare global {
  type DesktopUpdateState = {
    status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';
    currentVersion: string;
    distributionMode?: 'installed' | 'portable';
    availableVersion?: string;
    releaseName?: string;
    releaseNotes?: string;
    progress?: number;
    message?: string;
    dismissed?: boolean;
  };

  interface Window {
    uemDesktop?: {
      readonly isDesktop: true;
      readonly launcher: {
        getState: () => Promise<unknown>;
        browse: () => Promise<unknown>;
        select: (projectId: string) => Promise<unknown>;
        confirm: (projectId: string) => Promise<{ success: boolean; error?: string }>;
        onState: (listener: (state: unknown) => void) => () => void;
      };
      readonly window: {
        action: (action: DesktopWindowAction) => void;
        setDirty: (dirty: boolean) => void;
        onState: (listener: (state: 'maximized' | 'normal') => void) => () => void;
        onConfirmClose: (listener: () => void) => () => void;
      };
      readonly openExternal: (url: string) => Promise<boolean>;
      readonly update: {
        getState: () => Promise<DesktopUpdateState>;
        check: () => Promise<DesktopUpdateState>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: (discardChanges?: boolean) => Promise<{ success: boolean; error?: string }>;
        dismiss: () => Promise<DesktopUpdateState>;
        onState: (listener: (state: DesktopUpdateState) => void) => () => void;
      };
    };
  }
}
