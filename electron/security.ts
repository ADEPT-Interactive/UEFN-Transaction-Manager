export function isHttpExternal(rawUrl: string): boolean {
  if (rawUrl.length === 0 || rawUrl.length > 4096) return false;
  try {
    const parsed = new URL(rawUrl);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
export function isAllowedNavigation(
  mode: 'launcher' | 'dashboard',
  rawUrl: string,
  launcherUrl: string,
  allowedDashboardOrigin: string | null,
): boolean {
  try {
    const target = new URL(rawUrl);
    if (mode === 'launcher') return target.href === launcherUrl;
    return Boolean(
      allowedDashboardOrigin
      && target.origin === allowedDashboardOrigin
      && target.protocol === 'http:'
      && (target.hostname === '127.0.0.1' || target.hostname === 'localhost'),
    );
  } catch {
    return false;
  }
}
