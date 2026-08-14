export type ProjectSource = 'active' | 'last-opened' | 'recent' | 'discovered' | 'browse' | 'command-line';

export interface ProjectCandidate {
  id: string;
  projectFile: string;
  contentDirectory: string;
  name: string;
  assetMount: string;
  source: ProjectSource;
  sourceLabel: string;
  isActive: boolean;
  pythonEnabled: boolean;
  lastModifiedUtc: string;
  uefnProcessId: number;
  uefnWindowTitle?: string;
}

export interface LauncherState {
  projects: Array<Omit<ProjectCandidate, 'contentDirectory' | 'assetMount' | 'uefnProcessId' | 'uefnWindowTitle'>>;
  selectedId: string | null;
  status: string;
  busy: boolean;
}

export type WindowAction = 'request-state' | 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close';
