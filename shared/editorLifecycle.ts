export const EDITOR_HEARTBEAT_MAX_AGE_MS = 8_000;
export const PROCESS_PROBE_CACHE_MS = 750;
export const PROCESS_PROBE_FAILURE_GRACE_MS = 5_000;

export type EditorHeartbeatReport = { projectReady: boolean; reportedAt: number; processId: number };

export type UefnProjectLifecycle = {
  openedProject?: string;
  openedPosition: number;
  closedPosition: number;
  latestSelectionPosition: number;
};

const OPENED_PROJECT_PATTERN = /Successfully opened project '([^']+\.uefnproject)'/gi;
const CLOSED_PROJECT_PATTERNS = [
  /Successfully closed \d+ project\(s\)/gi,
  /Current project was closed/gi,
];

/** A close event revokes the preceding open until a newer open is recorded. */
export function parseUefnProjectLifecycleLog(rawText: string): UefnProjectLifecycle {
  const startupMarker = 'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit';
  const startup = rawText.lastIndexOf(startupMarker);
  const text = startup >= 0 ? rawText.slice(startup) : rawText;
  const latestOpen = Array.from(text.matchAll(OPENED_PROJECT_PATTERN)).at(-1);
  const closedPosition = CLOSED_PROJECT_PATTERNS
    .flatMap(pattern => Array.from(text.matchAll(pattern)).map(match => match.index ?? -1))
    .reduce((latest, position) => Math.max(latest, position), -1);
  const openedPosition = latestOpen?.index ?? -1;
  return {
    openedProject: latestOpen && openedPosition > closedPosition ? latestOpen[1] : undefined,
    openedPosition,
    closedPosition,
    latestSelectionPosition: text.lastIndexOf('LogValkyrieProjectBrowser: Selected Project (Direct):'),
  };
}

export function isConnectorHeartbeatFresh(report: EditorHeartbeatReport | undefined, now: number, processRunning: boolean): boolean {
  return Boolean(report && processRunning && now - report.reportedAt <= EDITOR_HEARTBEAT_MAX_AGE_MS);
}

export function isProjectReadinessFresh(report: EditorHeartbeatReport | undefined, now: number, processRunning: boolean): boolean {
  return Boolean(report?.projectReady && isConnectorHeartbeatFresh(report, now, processRunning));
}

export function retainKnownRunningProcess(previousRunning: boolean, lastSuccessfulProbeAt: number, now: number): boolean {
  return previousRunning && now - lastSuccessfulProbeAt <= PROCESS_PROBE_FAILURE_GRACE_MS;
}
