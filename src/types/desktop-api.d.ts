export {};

type DesktopWindowAction = 'request-state' | 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close';

declare global {
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
    };
  }
}
