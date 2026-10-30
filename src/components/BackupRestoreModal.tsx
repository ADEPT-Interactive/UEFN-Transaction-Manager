import React, { useEffect, useRef, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { FileService, type CatalogSnapshotPayload, type ProjectBackup } from '../services/fileService';
import { useModalFocus } from '../hooks/useModalFocus';
import { ConfirmDialog } from './ConfirmDialog';

interface BackupRestoreModalProps {
  isOpen: boolean;
  isDirty: boolean;
  autoBackupEnabled: boolean;
  onRestored: (result: { catalog: CatalogSnapshotPayload; restored: ProjectBackup }) => void;
  onClose: () => void;
}

export const formatBackupDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({ isOpen, isDirty, autoBackupEnabled, onRestored, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [backups, setBackups] = useState<ProjectBackup[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectBackup | null>(null);
  const [restoring, setRestoring] = useState(false);

  useModalFocus({ open: isOpen, dialogRef, onEscape: onClose, paused: Boolean(pending) });

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setBackups(null);
    setError(null);
    void FileService.listBackups().then(result => {
      if (!active) return;
      if (!result.success) { setError(result.error ?? 'Backups could not be listed.'); setBackups([]); return; }
      setFileName(result.targetVerseFileName ?? '');
      setBackups(result.backups ?? []);
    });
    return () => { active = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const restore = async () => {
    if (!pending) return;
    const target = pending;
    setPending(null);
    setRestoring(true);
    setError(null);
    const result = await FileService.restoreBackup(target.name);
    setRestoring(false);
    if (!result.success || !result.catalog) { setError(result.error ?? 'The backup could not be restored.'); return; }
    onRestored({ catalog: result.catalog, restored: result.restored ?? target });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.currentTarget === event.target && !restoring) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="backup-restore-title" tabIndex={-1} className="animate-modal relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-[#0d1326] shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-cyan-300"><History className="h-5 w-5" /></div>
            <div>
              <h2 id="backup-restore-title" className="text-base font-extrabold text-white">Restore a backup</h2>
              <p className="text-xs text-slate-400">{fileName ? `Earlier saved versions of ${fileName}` : 'Earlier saved versions of the managed Verse file'}</p>
            </div>
          </div>
          <button type="button" aria-label="Close backups" onClick={onClose} disabled={restoring} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-4 text-xs">
          {error && <p role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p>}
          {backups === null && <p className="text-slate-400">Loading backups…</p>}
          {backups?.length === 0 && !error && <p className="leading-5 text-slate-400">No backups yet. {autoBackupEnabled ? 'Transaction Manager creates one each time a save replaces the existing file.' : 'Automatic backups are turned off in Project settings.'}</p>}
          {backups && backups.length > 0 && <ul className="space-y-2">
            {backups.map((backup, index) => <li key={backup.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-bold text-slate-100">{formatBackupDate(backup.createdAt)}{index === 0 && <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">Most recent</span>}</p>
                <p className="text-[11px] text-slate-500">{formatSize(backup.size)}</p>
              </div>
              <button type="button" disabled={restoring} onClick={() => setPending(backup)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-bold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />{restoring ? 'Restoring…' : 'Restore'}</button>
            </li>)}
          </ul>}
          <p className="mt-4 text-[11px] leading-5 text-slate-500">Transaction Manager keeps the 5 most recent backups for this project. Restoring keeps the current file as a backup first, so a restore can be undone.</p>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        tone="warning"
        title="Restore this backup?"
        description={<>This replaces {fileName || 'the managed Verse file'} with the version saved {pending ? formatBackupDate(pending.createdAt) : ''}.{isDirty ? ' Your unsaved changes will be discarded.' : ''} Compile in UEFN afterwards to apply it.</>}
        confirmLabel="Restore backup"
        onCancel={() => setPending(null)}
        onConfirm={() => void restore()}
      />
    </div>
  );
};
