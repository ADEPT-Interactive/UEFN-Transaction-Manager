import React from 'react';
import { CheckCircle2, Download, RefreshCw, X } from 'lucide-react';

interface UpdateCardProps {
  state: DesktopUpdateState | null;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onLater: () => void;
}

export const UpdateCard: React.FC<UpdateCardProps> = ({ state, onCheck, onDownload, onInstall, onLater }) => {
  if (!state || state.status === 'idle') return null;
  if (state.status === 'up-to-date') {
    return <section className="mx-auto mb-5 flex max-w-6xl items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-200" role="status"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />UEM is up to date ({state.currentVersion}).</span><button type="button" onClick={onLater} className="text-emerald-300/70 hover:text-emerald-100" aria-label="Dismiss update status"><X className="h-4 w-4" /></button></section>;
  }
  if (state.status === 'checking') return <section className="mx-auto mb-5 flex max-w-6xl items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs text-slate-300" role="status"><RefreshCw className="h-4 w-4 animate-spin text-cyan-300" />Checking for UEM updates…</section>;
  if (state.status === 'error') return <section className="mx-auto mb-5 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200" role="alert"><span>{state.message ?? 'The update check failed. UEM is still ready to use.'}</span><button type="button" onClick={onCheck} className="font-bold text-cyan-300 hover:text-cyan-200">Try again</button></section>;

  const downloaded = state.status === 'downloaded';
  const downloading = state.status === 'downloading';
  if (state.dismissed && !downloaded && !downloading) return null;
  return <section className="mx-auto mb-5 max-w-6xl rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.07] p-4 shadow-lg shadow-cyan-950/10" aria-label="UEM update">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-white">{downloaded ? 'UEM is ready to restart' : downloading ? 'Downloading the UEM update' : `UEM ${state.availableVersion ?? 'update'} is available`}</p>
        <p className="mt-1 text-xs text-slate-300">Current version {state.currentVersion}{state.availableVersion ? ` · New version ${state.availableVersion}` : ''}{state.releaseName && state.releaseName !== state.availableVersion ? ` · ${state.releaseName}` : ''}</p>
        {state.releaseNotes && <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">{state.releaseNotes}</p>}
        {downloading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-label={`${state.progress ?? 0}% downloaded`}><div className="h-full rounded-full bg-cyan-400 transition-[width]" style={{ width: `${state.progress ?? 0}%` }} /></div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {downloaded ? <button type="button" onClick={onInstall} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-300"><RefreshCw className="h-3.5 w-3.5" />Restart and Install</button> : downloading ? <span className="text-xs font-semibold text-cyan-200">{state.progress ?? 0}%</span> : <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-300"><Download className="h-3.5 w-3.5" />Download Update</button>}
        {!downloading && <button type="button" onClick={onLater} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-300 hover:border-slate-400 hover:text-white">Later</button>}
      </div>
    </div>
  </section>;
};
