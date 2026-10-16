/** Desktop copies use the write-only preload API, independent of browser permissions. */
export async function copyText(text: string): Promise<void> {
  if (window.uemDesktop?.clipboard) {
    await window.uemDesktop.clipboard.writeText(text);
    return;
  }

  let timeout: number | undefined;
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Clipboard access timed out.')), 1500); }),
      ]);
      return;
    }
  } catch {
    // Older desktop builds and browsers can deny or stall this permission.
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }

  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard access is unavailable.');
  } finally {
    textarea.remove();
    focused?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
