import React from 'react';
import { AlertCircle, ArrowLeftRight, CheckCircle2, ChevronDown, Download, ExternalLink, FolderOpen, RefreshCw, Save, Settings, ShieldCheck, Terminal, Upload, Wrench } from 'lucide-react';
import { ProjectConfig, ValidationIssue } from '../types/entitlement';
import { handleExternalLinkClick } from '../services/externalLink';

interface HeaderProps {
  config: ProjectConfig;
  onUpdateConfig: (config: ProjectConfig) => void;
  onSaveToDisk: () => void;
  onLoadFromDisk: () => void;
  onCompileVerse: () => void;
  onExportPreset: () => void;
  onImportPreset: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenSettings: () => void;
  onOpenValidator: () => void;
  onSwitchProject: () => void;
  validationIssues: ValidationIssue[];
  isSaving: boolean;
  isCompiling: boolean;
  saveStatusMessage: string | null;
  saveStatusIsError: boolean;
  serverOnline: boolean;
  hasValidationErrors: boolean;
  isDirty: boolean;
  entitlementCount: number;
  desktopHost?: boolean;
  appVersion: string;
  updateState: DesktopUpdateState | null;
  onCheckForUpdates: () => void;
}

const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M19.5 5.3A18 18 0 0 0 15.2 4l-.5 1.1a16.4 16.4 0 0 0-5.4 0L8.7 4a17.7 17.7 0 0 0-4.3 1.3C1.7 9.3 1 13.2 1.4 17a17.5 17.5 0 0 0 5.3 2.7L8 18a11 11 0 0 1-1.7-.8l.4-.3a12.7 12.7 0 0 0 10.6 0l.4.3c-.5.3-1.1.6-1.7.8l1.3 1.7a17.4 17.4 0 0 0 5.3-2.7c.5-4.4-.8-8.3-3.1-11.7ZM8.3 14.7c-1 0-1.9-1-1.9-2.2 0-1.2.8-2.2 1.9-2.2 1 0 1.9 1 1.9 2.2s-.9 2.2-1.9 2.2Zm7.4 0c-1 0-1.9-1-1.9-2.2 0-1.2.8-2.2 1.9-2.2 1 0 1.9 1 1.9 2.2s-.8 2.2-1.9 2.2Z" />
  </svg>
);

export const Header: React.FC<HeaderProps> = ({
  config, onSaveToDisk, onLoadFromDisk, onCompileVerse, onExportPreset, onImportPreset,
  onOpenSettings, onOpenValidator, onSwitchProject, validationIssues, isSaving, isCompiling,
  saveStatusMessage, saveStatusIsError, serverOnline, hasValidationErrors, isDirty, entitlementCount, desktopHost = false, appVersion, updateState, onCheckForUpdates,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const [isProjectOpen, setIsProjectOpen] = React.useState(false);
  const [isToolsOpen, setIsToolsOpen] = React.useState(false);
  const errors = validationIssues.filter(issue => issue.severity === 'error').length;
  const warnings = validationIssues.filter(issue => issue.severity === 'warning').length;
  const blocked = hasValidationErrors || !serverOnline;
  const isFirstOfferStep = entitlementCount === 0 && errors === 1 && validationIssues.some(issue => issue.ruleName === 'entitlements_min');
  const pathSegments = config.contentFolderPath.split(/[\\/]+/).filter(Boolean);
  const contentSegmentIndex = pathSegments.map(segment => segment.toLowerCase()).lastIndexOf('content');
  const projectName = contentSegmentIndex > 0 ? pathSegments[contentSegmentIndex - 1] : pathSegments[pathSegments.length - 1] || 'UEFN project';

  React.useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setIsToolsOpen(false);
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  const runTool = (action: () => void) => { setIsToolsOpen(false); action(); };

  return (
    <header className={`sticky ${desktopHost ? 'top-8' : 'top-0'} z-40 border-b border-slate-800/80 bg-[#080d19]/96 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-md lg:px-8`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              <img src="/uem-mark.svg" alt="UEM" className="h-11 w-11 rounded-xl" />
              <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#080d19] ${serverOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} title={serverOnline ? 'Secure project bridge connected' : 'Project bridge unavailable'} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-lg font-extrabold text-white">UEFN Entitlement Manager</h1><span className="text-[10px] font-semibold text-slate-500">v{appVersion}</span>{isDirty && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">Unsaved</span>}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="relative inline-block">
                  <button type="button" aria-expanded={isProjectOpen} onClick={() => setIsProjectOpen(open => !open)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-white"><FolderOpen className="h-3.5 w-3.5 text-cyan-300" /><span className="text-slate-400">Project</span><span>{projectName}</span><ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${isProjectOpen ? 'rotate-180' : ''}`} /></button>
                  {isProjectOpen && <div className="absolute left-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-slate-700 bg-[#10182c] p-3 text-xs shadow-2xl"><div><p className="font-bold text-white">{projectName}</p><p className="mt-0.5 text-[11px] text-slate-400">Linked UEFN project details</p></div><div className="mt-3 border-t border-slate-800 pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Content folder</p><code className="mt-1 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-cyan-200">{config.contentFolderPath || 'Select a project from the launcher.'}</code></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Icon folder</p><code className="mt-1 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-slate-300">{config.assetFolderName}</code></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Generated Verse file</p><code className="mt-1 block break-all rounded-lg bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-emerald-300">{config.targetVerseFileName}</code></div></div><div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3"><button type="button" onClick={() => { setIsProjectOpen(false); onSwitchProject(); }} disabled={!desktopHost} title={desktopHost ? 'Return to the launcher and choose another UEFN project.' : 'Project switching is available in the desktop app.'} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-2.5 py-1.5 font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeftRight className="h-3.5 w-3.5" />Switch active project</button><button type="button" onClick={() => { setIsProjectOpen(false); onOpenSettings(); }} className="font-bold text-cyan-300 hover:text-cyan-200">Open project settings</button></div></div>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-slate-800 lg:border-l lg:pl-3">
            <a href="https://adeptinteractive.net" target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, 'https://adeptinteractive.net')} aria-label="Visit ADEPT Interactive" className="group flex items-center gap-2.5 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.07] px-3 py-1.5 transition hover:border-cyan-400/70 hover:bg-cyan-500/10">
              <span className="flex h-[26px] w-[42px] shrink-0 items-center justify-center overflow-hidden" aria-hidden="true"><img src="/adept-icon-white.webp" alt="" className="h-7 w-7 object-contain [transform:scale(1.5)]" /></span>
              <span><span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Created by</span><span className="flex items-center gap-1 text-sm font-black tracking-wide text-white group-hover:text-cyan-200">ADEPT INTERACTIVE <ExternalLink className="h-3 w-3 text-cyan-400" /></span></span>
            </a>
            <a href="https://discord.gg/playadept" target="_blank" rel="noreferrer" onClick={event => handleExternalLinkClick(event, 'https://discord.gg/playadept')} aria-label="Join the ADEPT Interactive Discord server" title="Join the ADEPT Interactive Discord server" className="flex items-center gap-2 rounded-xl border border-[#7785f7]/50 bg-[#5865F2] px-3 py-2 text-xs font-extrabold text-white shadow-md shadow-[#5865F2]/15 transition hover:bg-[#6875f5]">
              <DiscordIcon className="h-5 w-5 shrink-0" /><span>Join Discord</span>
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpenValidator} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${isFirstOfferStep ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' : errors ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : warnings ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}><ShieldCheck className="h-3.5 w-3.5" />{isFirstOfferStep ? 'Create an offer' : errors ? `${errors} issues to fix` : warnings ? `${warnings} warnings` : 'Locally valid'}</button>
          <button type="button" onClick={onSaveToDisk} disabled={isSaving || blocked} title={hasValidationErrors ? 'Resolve the listed issues before saving.' : 'Save the manager data to this UEFN project.'} className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-40"><Save className="h-3.5 w-3.5 text-cyan-300" />{isSaving ? 'Saving...' : 'Save to project'}</button>
          <button type="button" onClick={onCompileVerse} disabled={isCompiling || blocked} title={blocked ? 'Connect UEFN and resolve the listed issues first.' : 'Save, then run an authoritative UEFN Verse compile.'} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:from-cyan-300 hover:to-blue-400 disabled:opacity-40"><Terminal className={`h-3.5 w-3.5 ${isCompiling ? 'animate-spin' : ''}`} />{isCompiling ? 'Compiling...' : 'Save & Compile'}</button>
          <div ref={toolsRef} className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={isToolsOpen} onClick={() => setIsToolsOpen(open => !open)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-700"><Wrench className="h-3.5 w-3.5 text-slate-400" />Tools<ChevronDown className={`h-3.5 w-3.5 transition ${isToolsOpen ? 'rotate-180' : ''}`} /></button>
            {isToolsOpen && <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-slate-700 bg-[#10182c] p-1.5 text-xs shadow-2xl">
              <button role="menuitem" type="button" disabled={!serverOnline} onClick={() => runTool(onLoadFromDisk)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-40"><FolderOpen className="h-4 w-4 text-cyan-300" />Reload from project</button>
              <button role="menuitem" type="button" onClick={() => runTool(onExportPreset)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-800"><Download className="h-4 w-4 text-slate-400" />Export JSON preset</button>
              <button role="menuitem" type="button" onClick={() => { setIsToolsOpen(false); fileInputRef.current?.click(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-800"><Upload className="h-4 w-4 text-slate-400" />Import JSON preset</button>
              <div className="my-1 border-t border-slate-800" />
              <button role="menuitem" type="button" onClick={() => runTool(onCheckForUpdates)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-800"><RefreshCw className="h-4 w-4 text-cyan-300" />Check for Updates{updateState?.status === 'checking' && <span className="ml-auto text-[10px] text-slate-500">Checking</span>}</button>
              <button role="menuitem" type="button" onClick={() => runTool(onOpenSettings)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-slate-800"><Settings className="h-4 w-4 text-slate-400" />Project settings</button>
            </div>}
            <input type="file" ref={fileInputRef} onChange={onImportPreset} accept="application/json,.json" className="hidden" />
          </div>
        </div>
      </div>
      {saveStatusMessage && <div role="status" aria-live="polite" className={`mt-2 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${saveStatusIsError ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'}`}>{saveStatusIsError ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{saveStatusMessage}</div>}
    </header>
  );
};
