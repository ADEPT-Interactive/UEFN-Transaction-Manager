import React, { useState } from 'react';
import { X, Settings, Folder, FileCode, Layers, ShieldCheck, Save, Sparkles } from 'lucide-react';
import { ProjectConfig } from '../types/entitlement';

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
  if (!isOpen) return null;

  const [formData, setFormData] = useState<ProjectConfig>({ ...config });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-xl bg-[#0d1326] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-modal flex flex-col max-h-[85vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold shadow-md">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white">
                Project & Generator Settings
              </h2>
              <p className="text-xs text-slate-400">
                Configure paths, public icon folders, module names, and backup options
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Content Directory Path */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span>UEFN Content Folder Path *</span>
            </label>
            <input
              type="text"
              required
              value={formData.contentFolderPath}
              onChange={(e) => setFormData(prev => ({ ...prev, contentFolderPath: e.target.value }))}
              placeholder="e.g. <project-root>\TaB\Content"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 font-medium"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Absolute path to your UEFN project's <code className="text-slate-400">Content/</code> folder on Windows.
            </p>
          </div>

          {/* Dedicated Public Image Folder */}
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4 space-y-2">
            <label className="block text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Public Dedicated Image Folder Name *</span>
            </label>
            <input
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
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              <span>Target Verse File Name</span>
            </label>
            <input
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
          </div>

          {/* Auto Backup Toggle */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between mt-2">
            <div>
              <p className="text-xs font-bold text-white">Auto-Create Timestamped Backups</p>
              <p className="text-[11px] text-slate-400">Creates a .bak file in .backups/ whenever writing over an existing Verse file.</p>
            </div>
            <input
              type="checkbox"
              checked={formData.autoBackup}
              onChange={(e) => setFormData(prev => ({ ...prev, autoBackup: e.target.checked }))}
              className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
            />
          </div>

          {/* Modal Footer Controls */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Save Settings</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
