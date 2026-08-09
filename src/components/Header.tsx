import React, { useState } from 'react';
import { 
  FolderOpen, 
  Save, 
  Play, 
  Download, 
  Upload, 
  Settings, 
  Sparkles, 
  ShieldCheck, 
  Terminal,
  ExternalLink,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { ProjectConfig, ValidationIssue } from '../types/entitlement';

interface HeaderProps {
  config: ProjectConfig;
  onUpdateConfig: (config: ProjectConfig) => void;
  onSaveToDisk: () => void;
  onLoadFromDisk: () => void;
  onCompileVerse: () => void;
  onExportPreset: () => void;
  onImportPreset: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenSettings: () => void;
  onOpenSimulator: () => void;
  onOpenValidator: () => void;
  validationIssues: ValidationIssue[];
  isSaving: boolean;
  isCompiling: boolean;
  saveStatusMessage: string | null;
  serverOnline: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  onSaveToDisk,
  onLoadFromDisk,
  onCompileVerse,
  onExportPreset,
  onImportPreset,
  onOpenSettings,
  onOpenSimulator,
  onOpenValidator,
  validationIssues,
  isSaving,
  isCompiling,
  saveStatusMessage,
  serverOnline,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const errorCount = validationIssues.filter(i => i.severity === 'error').length;
  const warningCount = validationIssues.filter(i => i.severity === 'warning').length;

  return (
    <header className="sticky top-0 z-40 bg-[#0a0f1d]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3 transition-all">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        
        {/* Left: Brand & Project Path */}
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-indigo-600 to-purple-600 p-[1.5px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-[#0d1326] rounded-[10px] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-cyan-400 group-hover:rotate-12 transition-transform duration-300" />
              </div>
            </div>
            {/* Status dot */}
            <span 
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0a0f1d] ${
                serverOnline ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'
              }`}
              title={serverOnline ? 'Local Bridge Server Connected' : 'Standalone Web Mode'}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-lg text-white tracking-tight flex items-center gap-1.5">
                <span>UEFN Entitlement Manager</span>
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                ADEPT Interactive
              </span>
            </div>
            
            {/* Project Path & Target File */}
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono">
              <span className="text-slate-500 font-sans font-semibold">Active Project:</span>
              <button 
                onClick={onOpenSettings}
                title={`Content Directory: ${config.contentFolderPath || 'Not Set'}\nClick to change in Settings`}
                className="flex items-center gap-1.5 text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 px-2 py-0.5 rounded-lg border border-slate-700/60 hover:border-cyan-500/40 transition-colors text-left group"
              >
                <FolderOpen className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate max-w-[280px] md:max-w-[420px] text-cyan-300 font-semibold">
                  {config.contentFolderPath ? (
                    config.contentFolderPath.split(/[/\\]/).filter(Boolean).slice(-2).join('/') || config.contentFolderPath
                  ) : 'No folder set'}
                </span>
              </button>
              <span className="text-slate-600">/</span>
              <span className="text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                {config.targetVerseFileName || 'managed_transactions.verse'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Actions Bar */}
        <div className="flex items-center flex-wrap gap-2">
          
          {/* Validation Pill */}
          <button
            onClick={onOpenValidator}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              errorCount > 0
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                : warningCount > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>
              {errorCount > 0 ? `${errorCount} Errors` : warningCount > 0 ? `${warningCount} Warnings` : 'All Compliant'}
            </span>
          </button>

          {/* Sandbox Simulator */}
          <button
            onClick={onOpenSimulator}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 transition-all shadow-sm hover:shadow-indigo-500/20"
          >
            <Play className="w-3.5 h-3.5 text-indigo-400" />
            <span>Store Simulator</span>
          </button>

          {/* Verse Compile Trigger */}
          <button
            onClick={onCompileVerse}
            disabled={isCompiling}
            title="Compile Verse in active UEFN Editor session (Port 1962)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50 transition-all"
          >
            <Terminal className={`w-3.5 h-3.5 text-cyan-400 ${isCompiling ? 'animate-spin' : ''}`} />
            <span>{isCompiling ? 'Compiling...' : 'Compile Verse'}</span>
          </button>

          {/* Load from Disk */}
          <button
            onClick={onLoadFromDisk}
            title="Load existing in_island_transactions.verse from project"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-all"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Load File</span>
          </button>

          {/* Direct Save Button */}
          <button
            onClick={onSaveToDisk}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-md shadow-cyan-500/25 transition-all disabled:opacity-50 active:scale-95"
          >
            <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-bounce' : ''}`} />
            <span>{isSaving ? 'Saving...' : 'Save Verse'}</span>
          </button>

          {/* Preset Import/Export Dropdown */}
          <div className="flex items-center border border-slate-700/80 rounded-lg bg-slate-800/50 p-0.5">
            <button
              onClick={onExportPreset}
              title="Export configuration as JSON preset"
              className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-700 rounded transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Import configuration from JSON preset"
              className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-700 rounded transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={onImportPreset} 
              accept=".json" 
              className="hidden" 
            />
          </div>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            title="Project & Generator Settings"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-all hover:rotate-45"
          >
            <Settings className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Save Notification Banner */}
      {saveStatusMessage && (
        <div className="mt-2 text-xs py-1 px-3 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 flex items-center justify-between animate-fadeIn">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            {saveStatusMessage}
          </span>
        </div>
      )}
    </header>
  );
};
