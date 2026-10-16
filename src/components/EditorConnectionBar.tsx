import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { EditorStatus } from '../services/fileService';
import { deriveEditorConnectionState } from '../../shared/editorState';

export function getEditorConnectionState(status: EditorStatus) {
  return status.connectionState ?? deriveEditorConnectionState({
    uefnRunning: status.uefnRunning,
    projectOpening: status.projectOpening ?? false,
    exactProjectOpen: status.exactProjectOpen ?? status.projectActive,
    differentProjectOpen: status.differentProjectOpen,
    pythonEnabled: status.pythonEnabled,
    connectorAlive: status.connectorAlive ?? status.editorConnected,
    projectReady: status.projectReady ?? status.editorConnected,
    editorConnected: status.editorConnected,
  });
}

export const EditorConnectionBar: React.FC<{ status: EditorStatus | null; projectName?: string }> = ({ status, projectName }) => {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [feedback, setFeedback] = useState<{ context: string; message: string } | null>(null);
  const requestSequence = useRef(0);
  const state = status?.success ? getEditorConnectionState(status) : 'checking';
  const context = `${state}:${status?.bootstrapState}:${status?.readinessReason}:${status?.processId}`;
  const currentContext = useRef(context);
  currentContext.current = context;

  useEffect(() => {
    requestSequence.current += 1;
    setRetrying(false);
    setFeedback(null);
  }, [context]);
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => () => { requestSequence.current += 1; }, []);

  const retry = async () => {
    if (!window.uemDesktop?.editor || retrying) return;
    const sequence = ++requestSequence.current;
    const requestedContext = context;
    setRetrying(true);
    setFeedback(null);
    try {
      const result = await window.uemDesktop.editor.reconnect();
      if (sequence !== requestSequence.current || requestedContext !== currentContext.current) return;
      setFeedback({ context: requestedContext, message: result.success ? 'Retry requested. Watching for the editor connection…' : result.error ?? 'Could not retry. Automatic recovery is still active.' });
    } catch {
      if (sequence === requestSequence.current && requestedContext === currentContext.current) setFeedback({ context: requestedContext, message: 'Could not retry. Automatic recovery is still active.' });
    } finally {
      if (sequence === requestSequence.current) setRetrying(false);
    }
  };

  const connected = state === 'connected';
  const actionable = ['uefn-closed', 'different-project', 'python-required', 'project-readiness-waiting', 'uefn-running-project-unknown'].includes(state);
  const project = projectName || 'the linked project';
  const presentation = {
    checking: ['Checking UEFN', 'Checking the editor connection', 'Waiting for the local project bridge to report its status.'],
    'uefn-closed': ['UEFN closed', `Open ${project} to connect`, `Open ${project} in UEFN. Transaction Manager stays linked and reconnects automatically.`],
    'different-project': ['Different project open', `Open ${project} in UEFN`, `Switch UEFN to ${project}. This window keeps its current catalog; native operations wait for the matching project.`],
    'project-opening': ['Opening UEFN project', 'Waiting for loading to finish', 'Keep the linked project open. Connection and native operations become available when loading finishes.'],
    'python-required': ['Python disabled', 'Enable Python in UEFN', 'Enable Python Editor Scripting in Project Settings, then Tools → Enable Python for your user. UTM detects both settings and connects when the runtime is ready.'],
    connected: ['UEFN connected', projectName || 'Project ready', 'The linked project is verified. Saving, Verse compilation, and native Texture2D importing are available.'],
    'connector-waiting': ['Connecting to UEFN', 'Automatic recovery is active', status?.autoConnectorInstalled ? 'Keep the linked project open with Tools → Enable Python enabled. Close blocking dialogs. UTM retries automatically after a short cooldown, or you can retry now.' : 'The application connector is missing. Reinstall this UTM build to restore it.'],
    'project-readiness-waiting': ['Waiting for UEFN', 'Editor readiness is pending', status?.readinessReason === 'project-browser-open' ? 'Close the Project Browser or finish opening the linked project. Native operations pause while the selector is open.' : status?.readinessReason === 'editor-tick-stale' ? 'Close blocking dialogs and let UEFN finish loading. The editor connection resumes when it responds again.' : 'The connector is alive. Native operations unlock when UEFN confirms the exact project is ready.'],
    'uefn-running-project-unknown': ['Waiting for project', `Open ${project} in UEFN`, 'UEFN is running, but the linked project has not been detected yet. Open it or allow loading to finish.'],
  }[state];
  const [heading, hint, guidance] = presentation;
  const tone = connected ? 'border-emerald-500/20 bg-emerald-500/5' : actionable ? 'border-amber-500/25 bg-amber-500/5' : 'border-slate-700 bg-slate-900/40';
  return (
    <section aria-label="UEFN editor connection" data-connection-state={state} className={`mx-auto mb-4 max-w-6xl rounded-xl border ${tone}`}>
      <div className="flex min-h-10 items-center gap-2.5 px-3 py-2 text-xs">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : actionable ? 'bg-amber-400' : 'bg-cyan-400'}`} />
        <span className="shrink-0 font-semibold text-slate-100">{heading}</span>
        <span className="min-w-0 flex-1 truncate text-slate-400" title={hint}>{hint}</span>
        <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold text-slate-300 hover:bg-slate-800 hover:text-white">
          {expanded ? 'Hide details' : actionable ? 'How to connect' : 'Details'}<ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && <div id={detailsId} className="space-y-3 border-t border-slate-700/60 px-4 py-3 text-xs leading-relaxed text-slate-300">
        <p>{guidance}</p>
        {state === 'connector-waiting' && status?.autoConnectorInstalled && window.uemDesktop?.editor && <button type="button" onClick={() => void retry()} disabled={retrying || status.bootstrapState === 'attempting'} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-1.5 font-semibold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{retrying || status.bootstrapState === 'attempting' ? 'Connecting…' : 'Retry connection'}</button>}
        {feedback?.context === context && state === 'connector-waiting' && <p role="status">{feedback.message}</p>}
        {status?.success && !connected && ['connector-waiting', 'project-readiness-waiting'].includes(state) && <details className="text-slate-400"><summary className="cursor-pointer">Technical details</summary><div className="mt-2 space-y-1 break-words">{status.bootstrapMessage && <p>{status.bootstrapMessage}</p>}{status.readinessReason && <p>Readiness: <code>{status.readinessReason}</code></p>}</div></details>}
      </div>}
    </section>
  );
};
