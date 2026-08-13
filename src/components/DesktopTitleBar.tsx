import React, { useEffect, useState } from 'react';
import { Maximize2, Minus, Square, X } from 'lucide-react';

type WebViewHost = {
  postMessage: (message: string) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<string>) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent<string>) => void) => void;
};

declare global {
  interface Window {
    uemDesktopHost?: boolean;
    chrome?: { webview?: WebViewHost };
  }
}

export const isDesktopHost = () => Boolean(window.uemDesktopHost && window.chrome?.webview);
export const postDesktopWindowAction = (action: 'drag' | 'minimize' | 'toggle-maximize' | 'switch-project' | 'close') => window.chrome?.webview?.postMessage(`window-action|${action}`);

export const DesktopTitleBar: React.FC<{ dirty: boolean; onRequestClose: () => void }> = ({ dirty, onRequestClose }) => {
  const [visible] = useState(isDesktopHost);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!visible || !window.chrome?.webview) return;
    const onMessage = (event: MessageEvent<string>) => {
      if (event.data === 'window-command|confirm-close') onRequestClose();
      else if (event.data === 'window-state|maximized') setMaximized(true);
      else if (event.data === 'window-state|normal') setMaximized(false);
    };
    window.chrome.webview.addEventListener('message', onMessage);
    window.chrome.webview.postMessage('window-action|request-state');
    return () => window.chrome?.webview?.removeEventListener('message', onMessage);
  }, [visible, onRequestClose]);

  useEffect(() => {
    if (visible) window.chrome?.webview?.postMessage(`dirty-state|${dirty}`);
  }, [dirty, visible]);

  if (!visible) return null;
  return (
    <div className="sticky top-0 z-[90] flex h-8 shrink-0 select-none items-center bg-[#080d19] text-slate-400">
      <div
        className="h-full min-w-0 flex-1"
        aria-hidden="true"
        onMouseDown={event => { if (event.button === 0) postDesktopWindowAction('drag'); }}
        onDoubleClick={() => postDesktopWindowAction('toggle-maximize')}
      />
      <div className="flex h-full items-stretch" aria-label="Window controls">
        <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => postDesktopWindowAction('minimize')} className="flex w-10 items-center justify-center transition-colors hover:bg-slate-800 hover:text-white"><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => postDesktopWindowAction('toggle-maximize')} className="flex w-10 items-center justify-center transition-colors hover:bg-slate-800 hover:text-white">{maximized ? <Square className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
        <button type="button" aria-label="Close window" title="Close" onClick={onRequestClose} className="flex w-11 items-center justify-center text-rose-400 transition-colors hover:bg-rose-600 hover:text-white active:bg-rose-700"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
};
