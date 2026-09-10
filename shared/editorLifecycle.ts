export const EDITOR_HEARTBEAT_MAX_AGE_MS = 8_000;
export const PROCESS_PROBE_CACHE_MS = 750;
export const PROCESS_PROBE_FAILURE_GRACE_MS = 5_000;

export type EditorHeartbeatReport = { projectReady: boolean; reportedAt: number; processId: number };

export type UefnProjectLifecycle = {
  openedProject?: string;
  openingProject?: string;
  projectOpening: boolean;
  openedPosition: number;
  openingPosition: number;
  closedPosition: number;
  latestSelectionPosition: number;
};

const OPENED_PROJECT_PATTERNS = [
  /Successfully opened project\s+['"]([^'"]+\.uefnproject)['"]/gi,
];
const OPENING_PROJECT_PATTERNS = [
  /\bOpening project(?:\s+file)?\s*[:=]?\s*['"]([^'"]+?\.uefnproject)['"]/gi,
  /\bOpening project(?:\s+file)?\s*[:=]?\s*(?!['"])([^\r\n]+?\.uefnproject)(?=\s*(?:\(|$))/gi,
];
const CLOSED_PROJECT_PATTERNS = [
  /Successfully closed \d+ project\(s\)/gi,
  /Current project was closed/gi,
  /Closing project/gi,
];

function latestMatch(patterns: RegExp[], text: string): RegExpMatchArray | undefined {
  return patterns
    .flatMap(pattern => Array.from(text.matchAll(pattern)))
    .sort((left, right) => (left.index ?? -1) - (right.index ?? -1))
    .at(-1);
}

/** A close event revokes the preceding open until a newer open is recorded. */
export function parseUefnProjectLifecycleLog(rawText: string): UefnProjectLifecycle {
  const startupMarker = 'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit';
  const startup = rawText.lastIndexOf(startupMarker);
  const text = startup >= 0 ? rawText.slice(startup) : rawText;
  const latestOpen = latestMatch(OPENED_PROJECT_PATTERNS, text);
  const latestOpening = latestMatch(OPENING_PROJECT_PATTERNS, text);
  const closedPosition = CLOSED_PROJECT_PATTERNS
    .flatMap(pattern => Array.from(text.matchAll(pattern)).map(match => match.index ?? -1))
    .reduce((latest, position) => Math.max(latest, position), -1);
  const openedPosition = latestOpen?.index ?? -1;
  const openingPosition = latestOpening?.index ?? -1;
  const projectOpening = openingPosition > closedPosition && openingPosition > openedPosition;
  return {
    openedProject: latestOpen && !projectOpening && openedPosition > closedPosition ? latestOpen[1] : undefined,
    openingProject: projectOpening ? latestOpening?.[1]?.trim() : undefined,
    projectOpening,
    openedPosition,
    openingPosition,
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
