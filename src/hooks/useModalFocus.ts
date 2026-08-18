import { useEffect, useRef, type RefObject } from 'react';

interface UseModalFocusOptions {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  paused?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Keeps modal focus management tied to the modal lifecycle, not to callback
 * identities that are commonly recreated by a parent render.
 */
export function useModalFocus({ open, dialogRef, onEscape, paused = false, initialFocusRef }: UseModalFocusOptions): void {
  const onEscapeRef = useRef(onEscape);
  const pausedRef = useRef(paused);
  onEscapeRef.current = onEscape;
  pausedRef.current = paused;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = initialFocusRef?.current ?? dialogRef.current;
    if (!pausedRef.current) initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, dialogRef, initialFocusRef]);
}
