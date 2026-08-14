import React, { useEffect, useState } from 'react';
import { Maximize2, Minus, Square, X } from 'lucide-react';

export const isDesktopHost = () => window.uemDesktop?.isDesktop === true;
export const postDesktopWindowAction = (action: 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close') => window.uemDesktop?.window.action(action);

export const DesktopTitleBar: React.FC<{ dirty: boolean; onRequestClose: () => void }> = ({ dirty, onRequestClose }) => {
  const [visible] = useState(isDesktopHost);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!visible || !window.uemDesktop) return;
    const removeStateListener = window.uemDesktop.window.onState(state => setMaximized(state === 'maximized'));
    const removeCloseListener = window.uemDesktop.window.onConfirmClose(onRequestClose);
    window.uemDesktop.window.action('request-state');
    return () => { removeStateListener(); removeCloseListener(); };
  }, [visible, onRequestClose]);

  useEffect(() => {
    if (visible) window.uemDesktop?.window.setDirty(dirty);
  }, [dirty, visible]);

  if (!visible) return null;
  return (
    <div className="sticky top-0 z-[90] flex h-8 shrink-0 select-none items-center bg-[#080d19] text-slate-400">
      <div className="h-full min-w-0 flex-1 [-webkit-app-region:drag]" aria-hidden="true" />
      <div className="flex h-full items-stretch [-webkit-app-region:no-drag]" aria-label="Window controls">
        <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => postDesktopWindowAction('minimize')} className="flex w-10 items-center justify-center transition-colors hover:bg-slate-800 hover:text-white"><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => postDesktopWindowAction('toggle-maximize')} className="flex w-10 items-center justify-center transition-colors hover:bg-slate-800 hover:text-white">{maximized ? <Square className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
        <button type="button" aria-label="Close window" title="Close" onClick={onRequestClose} className="flex w-11 items-center justify-center text-rose-400 transition-colors hover:bg-rose-600 hover:text-white active:bg-rose-700"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
};
