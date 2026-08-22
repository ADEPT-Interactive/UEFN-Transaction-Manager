export type ProjectSource = 'active' | 'last-opened' | 'recent' | 'cached' | 'discovered' | 'browse' | 'command-line';

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
  scanning: boolean;
}

export type WindowAction = 'request-state' | 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close';

export interface UpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string;
  distributionMode?: 'installed' | 'portable';
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  progress?: number;
  message?: string;
  dismissed?: boolean;
}
