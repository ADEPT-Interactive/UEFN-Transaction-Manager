import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, FileCode, Layers, Save, Settings, X } from 'lucide-react';
import { ProjectConfig } from '../types/entitlement';
import { validateProjectConfig } from '../services/validator';
import { projectConfigDraftSnapshot } from '../services/draftSnapshots';
import { DraftConfirmDialog } from './DraftConfirmDialog';
import { useModalFocus } from '../hooks/useModalFocus';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  config: ProjectConfig;
  onSaveConfig: (config: ProjectConfig) => void;
  onClose: () => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  isOpen,
  config,
  onSaveConfig,
  onClose,
}) => {
  const [formData, setFormData] = useState<ProjectConfig>({ ...config });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFormRef = useRef<ProjectConfig>({ ...config });
  const [dirtyConfirmationOpen, setDirtyConfirmationOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const nextConfig = { ...config };
    setFormData(nextConfig);
    initialFormRef.current = nextConfig;
    setShowAdvanced(false);
    setDirtyConfirmationOpen(false);
  }, [isOpen]);
  const isDirty = projectConfigDraftSnapshot(formData) !== projectConfigDraftSnapshot(initialFormRef.current);
  const requestClose = () => { if (isDirty) setDirtyConfirmationOpen(true); else onClose(); };
  useModalFocus({ open: isOpen, dialogRef, onEscape: requestClose, paused: dirtyConfirmationOpen });
  if (!isOpen) return null;
  const errors = validateProjectConfig(formData).filter(issue => issue.severity === 'error');

  const commitForm = () => {
    if (errors.length) return;
    onSaveConfig(formData);
    onClose();
  };
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); commitForm(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" onMouseDown={event => { if (event.currentTarget === event.target) requestClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} className="relative w-full max-w-xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[85vh] outline-none">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold shadow-md">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 id="settings-title" className="font-extrabold text-base text-white">
                Project & Generator Settings
              </h2>
              <p className="text-xs text-slate-400">Review project safety and optional generated storefront behavior</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close project settings"
            onClick={requestClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Content Directory Path */}
          <div>
            <label htmlFor="project-content-path" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span>UEFN Content Folder Path *</span>
            </label>
            <input
              id="project-content-path"
              type="text"
              readOnly
              value={formData.contentFolderPath}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-400 font-medium"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Locked to the project selected in UEM's boot menu. Restart UEM to switch projects safely.
            </p>
          </div>

          <button type="button" onClick={() => setShowAdvanced(open => !open)} aria-expanded={showAdvanced} className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-left text-xs font-bold text-slate-200 hover:border-slate-700">
            <span>Advanced generator options</span><ChevronDown className={`h-4 w-4 text-cyan-300 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4 space-y-2">
            <label htmlFor="project-asset-folder" className="block text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Public Dedicated Image Folder Name *</span>
            </label>
            <input
              id="project-asset-folder"
              type="text"
              required
              value={formData.assetFolderName}
              onChange={(e) => setFormData(prev => ({ ...prev, assetFolderName: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))}
              placeholder="EntitlementIcons"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 font-bold"
            />
            <p className="text-[11px] text-slate-400">
              Folder created inside <code className="text-cyan-300">Content/</code> to house all entitlement icons (e.g. <code className="text-cyan-300">Content/{formData.assetFolderName || 'EntitlementIcons'}/</code>). Verse references resolve as <code className="text-cyan-300">{formData.assetFolderName || 'EntitlementIcons'}.ItemName</code>.
            </p>
          </div>

          {/* Target Verse File Name */}
          <div>
            <label htmlFor="project-target-file" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              <span>Target Verse File Name</span>
            </label>
            <input
              id="project-target-file"
              type="text"
              required
              value={formData.targetVerseFileName}
              onChange={(e) => setFormData(prev => ({ ...prev, targetVerseFileName: e.target.value }))}
              placeholder="managed_transactions.verse"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Module Names & Device Class */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Creative Device Class
              </label>
              <input
                type="text"
                value={formData.deviceClassName}
                onChange={(e) => setFormData(prev => ({ ...prev, deviceClassName: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Entitlements Module
              </label>
              <input
                type="text"
                value={formData.entitlementsModuleName}
                onChange={(e) => setFormData(prev => ({ ...prev, entitlementsModuleName: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div><label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Info Module</label><input type="text" value={formData.infoModuleName} onChange={e => setFormData(previous => ({ ...previous, infoModuleName: e.target.value }))} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white" /></div>
            <div><label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Prices Module</label><input type="text" value={formData.pricesModuleName} onChange={e => setFormData(previous => ({ ...previous, pricesModuleName: e.target.value }))} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white" /></div>
            <div><label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Offers Module</label><input type="text" value={formData.offersModuleName} onChange={e => setFormData(previous => ({ ...previous, offersModuleName: e.target.value }))} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white" /></div>
          </div>
          </div>}

          {/* Auto Backup Toggle */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between mt-2">
            <div>
              <p className="text-xs font-bold text-white">Auto-Create Timestamped Backups</p>
              <p className="text-[11px] text-slate-400">Creates a .bak file in .backups/ whenever writing over an existing Verse file.</p>
            </div>
            <input
              aria-label="Auto-create timestamped backups"
              type="checkbox"
              checked={formData.autoBackup}
              onChange={(e) => setFormData(prev => ({ ...prev, autoBackup: e.target.checked }))}
              className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
            />
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
            <div><p className="text-xs font-bold text-cyan-300">Storefront and purchase interaction</p><p className="text-[11px] text-slate-400">Marketplace UI opens from a player-interaction button or an intentionally activated trigger. Passive zone entry is not a supported purchase binding.</p></div>
            <label className="flex items-center justify-between gap-3 text-xs text-slate-300"><span><strong className="block text-white">Generate all-offers Button device array</strong><span className="text-[11px] text-slate-500">Optional. Interacting with an assigned Button device opens the all-offers storefront.</span></span><input type="checkbox" checked={formData.generateStorefrontBinding ?? false} onChange={e => setFormData(prev => ({ ...prev, generateStorefrontBinding: e.target.checked }))} className="w-4 h-4 accent-cyan-500 rounded" /></label>
            {(formData.generateStorefrontBinding ?? false) && <p className="text-[11px] text-slate-500">The all-offers storefront uses the generated <code className="text-cyan-300">AllOffersStore_OpenButtons</code> editable. Its name is derived automatically and is not user-configurable.</p>}
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-white">Enable UEFN Verse Workflow Server</p>
              <p className="text-[11px] text-slate-400">Allows Save &amp; Compile to request an authoritative compile from the open UEFN editor.</p>
            </div>
            <input
              aria-label="Enable UEFN Verse Workflow Server"
              type="checkbox"
              checked={formData.enableVerseWorkflowServer}
              onChange={(e) => setFormData(prev => ({ ...prev, enableVerseWorkflowServer: e.target.checked }))}
              className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
            />
          </div>

          {/* Modal Footer Controls */}
          {errors.length > 0 && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{errors.map(error => <p key={error.id}>{error.message}</p>)}</div>}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={errors.length > 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Save Settings</span>
            </button>
          </div>
        </form>
      </div>
      <DraftConfirmDialog open={dirtyConfirmationOpen} isNew={false} subject="project settings" onSave={() => { setDirtyConfirmationOpen(false); commitForm(); }} onDiscard={() => { setDirtyConfirmationOpen(false); onClose(); }} onContinue={() => setDirtyConfirmationOpen(false)} />
    </div>
  );
};
