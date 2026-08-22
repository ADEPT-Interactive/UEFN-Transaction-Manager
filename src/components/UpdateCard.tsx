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
  const portable = state.distributionMode === 'portable';
  if (state.status === 'up-to-date') {
    if (state.dismissed) return null;
    return <section className="fixed bottom-5 right-5 z-[70] flex w-[min(28rem,calc(100vw-2rem))] items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-[#101b25]/95 px-4 py-3 text-xs text-emerald-200 shadow-2xl shadow-black/40 backdrop-blur-md" role="status"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Transaction Manager is up to date ({state.currentVersion}).</span><button type="button" onClick={onLater} className="text-emerald-300/70 hover:text-emerald-100" aria-label="Dismiss update status"><X className="h-4 w-4" /></button></section>;
  }
  if (state.status === 'checking') return <section className="fixed bottom-5 right-5 z-[70] flex w-[min(28rem,calc(100vw-2rem))] items-center gap-2 rounded-2xl border border-slate-700 bg-[#10182c]/95 px-4 py-3 text-xs text-slate-300 shadow-2xl shadow-black/40 backdrop-blur-md" role="status"><RefreshCw className="h-4 w-4 animate-spin text-cyan-300" />Checking for Transaction Manager updates…</section>;
  if (state.status === 'error') return <section className="fixed bottom-5 right-5 z-[70] flex w-[min(30rem,calc(100vw-2rem))] items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-[#211b12]/95 px-4 py-3 text-xs text-amber-200 shadow-2xl shadow-black/40 backdrop-blur-md" role="alert"><span>{state.message ?? 'The update check failed. Transaction Manager is still ready to use.'}</span><div className="flex items-center gap-3"><button type="button" onClick={onCheck} className="font-bold text-cyan-300 hover:text-cyan-200">Try again</button><button type="button" onClick={onLater} aria-label="Dismiss update error" className="text-amber-300/70 hover:text-amber-100"><X className="h-4 w-4" /></button></div></section>;

  const downloaded = state.status === 'downloaded';
  const downloading = state.status === 'downloading';
  if (state.dismissed && !downloaded && !downloading) return null;
  return <section className="fixed bottom-5 right-5 z-[70] w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-cyan-500/30 bg-[#10182c]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-md" aria-label="Transaction Manager update">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-white">{downloaded ? (portable ? 'Portable update is ready' : 'Transaction Manager is ready to restart') : downloading ? 'Downloading the Transaction Manager update' : `Transaction Manager ${state.availableVersion ?? 'update'} is available`}</p>
        <p className="mt-1 text-xs text-slate-300">Current version {state.currentVersion}{state.availableVersion ? ` · New version ${state.availableVersion}` : ''}{state.releaseName && state.releaseName !== state.availableVersion ? ` · ${state.releaseName}` : ''}</p>
        {state.releaseNotes && <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">{state.releaseNotes}</p>}
        {downloading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-label={`${state.progress ?? 0}% downloaded`}><div className="h-full rounded-full bg-cyan-400 transition-[width]" style={{ width: `${state.progress ?? 0}%` }} /></div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {downloaded ? <button type="button" onClick={onInstall} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-cyan-300 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10182c]"><RefreshCw className="h-3.5 w-3.5" />{portable ? 'Restart & Update' : 'Restart & Install'}</button> : downloading ? <span className="text-xs font-semibold text-cyan-200">{state.progress ?? 0}%</span> : <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-cyan-300 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10182c]"><Download className="h-3.5 w-3.5" />Download Update</button>}
        {!downloading && <button type="button" onClick={onLater} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10182c]">Later</button>}
      </div>
    </div>
  </section>;
};
