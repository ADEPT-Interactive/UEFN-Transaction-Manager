export function handleExternalLinkClick(
  event: { preventDefault: () => void },
  url: string,
) {
  const desktop = window.uemDesktop;
  if (!desktop) return;

  try {
    void desktop.openExternal(url);
    event.preventDefault();
  } catch {
    // Leave the anchor's normal target behavior intact if the host bridge is unavailable.
  }
}
