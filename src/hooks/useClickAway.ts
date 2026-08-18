import { useEffect, useRef, type RefObject } from 'react';

export function useClickAway(ref: RefObject<HTMLElement | null>, enabled: boolean, onAway: () => void): void {
  const onAwayRef = useRef(onAway);
  onAwayRef.current = onAway;

  useEffect(() => {
    if (!enabled) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !ref.current?.contains(target)) onAwayRef.current();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [enabled, ref]);
}
