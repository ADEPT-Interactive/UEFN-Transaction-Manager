import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onCancel,
  onConfirm,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;
  const Icon = tone === 'danger' ? Trash2 : AlertTriangle;
  const iconStyle = tone === 'danger' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  const confirmStyle = tone === 'danger' ? 'bg-rose-500 hover:bg-rose-400' : 'bg-amber-400 hover:bg-amber-300';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.currentTarget === event.target) onCancel(); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="animate-modal w-full max-w-md rounded-3xl border border-slate-700 bg-[#0d1326] p-6 shadow-2xl shadow-black/50 outline-none">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${iconStyle}`}><Icon className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3"><h2 id={titleId} className="text-base font-extrabold text-white">{title}</h2><button type="button" aria-label="Close confirmation" onClick={onCancel} className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>
            <div id={descriptionId} className="mt-2 text-xs leading-5 text-slate-400">{description}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-800 pt-4">
          <button ref={cancelRef} type="button" onClick={onCancel} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={`rounded-xl px-4 py-2 text-xs font-extrabold text-slate-950 transition ${confirmStyle}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};
