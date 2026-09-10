export type EditorConnectionState =
  | 'uefn-closed'
  | 'uefn-running-project-unknown'
  | 'project-opening'
  | 'different-project'
  | 'python-required'
  | 'connector-waiting'
  | 'project-readiness-waiting'
  | 'connected';

export interface EditorStateFacts {
  uefnRunning: boolean;
  projectOpening: boolean;
  exactProjectOpen: boolean;
  differentProjectOpen: boolean;
  pythonEnabled: boolean;
  connectorAlive: boolean;
  projectReady: boolean;
  editorConnected: boolean;
}

/**
 * Keep the creator-facing lifecycle ordering in one place. Identity is
 * intentionally evaluated before connector/readiness facts, while mutations
 * remain fail-closed on the stricter editorConnected result.
 */
export function deriveEditorConnectionState(facts: EditorStateFacts): EditorConnectionState {
  if (!facts.uefnRunning) return 'uefn-closed';
  if (facts.differentProjectOpen) return 'different-project';
  if (facts.projectOpening) return 'project-opening';
  if (!facts.exactProjectOpen) return 'uefn-running-project-unknown';
  if (!facts.pythonEnabled) return 'python-required';
  if (!facts.connectorAlive) return 'connector-waiting';
  if (!facts.projectReady || !facts.editorConnected) return 'project-readiness-waiting';
  return 'connected';
}
