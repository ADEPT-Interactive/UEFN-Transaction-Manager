import path from 'node:path';

export interface DuckyBootstrapSource {
  scriptPath: string;
  contentRoot: string;
  assetMount: string;
}

/** Optional, focus-free attachment through an already-running Ducky listener. */
export async function tryDuckyBootstrap(source: DuckyBootstrapSource, processId: number, signal?: AbortSignal, port = 4200): Promise<boolean> {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
  try {
    const base = `http://127.0.0.1:${port}`;
    const healthResponse = await fetch(`${base}/health`, { signal: requestSignal, redirect: 'error' });
    if (!healthResponse.ok) return false;
    const health = await healthResponse.json() as { status?: string; commands?: string[]; busy?: boolean; tick_age_sec?: number };
    if (health.status !== 'ok' || !health.commands?.includes('execute_python') || health.busy || typeof health.tick_age_sec !== 'number' || health.tick_age_sec < 0 || health.tick_age_sec > 8) return false;
    const literal = (value: string) => JSON.stringify(value.replaceAll('\\', '/'));
    const mount = source.assetMount.replace(/^\/+|\/+$/g, '');
    // Validate inside the responding editor, before loading any UTM code. The
    // health cache alone is not authoritative project or process identity.
    const code = [
      'import os, runpy',
      `assert os.getpid() == ${processId}, 'UTM editor process mismatch'`,
      `assert str(unreal.EditorAssetLibrary.get_project_root_asset_directory()).strip('/').casefold() == ${literal(mount)}.casefold(), 'UTM project mount mismatch'`,
      `assert os.path.normcase(os.path.realpath(unreal.PluginBlueprintLibrary.get_plugin_content_dir(${literal(mount)}))) == os.path.normcase(os.path.realpath(${literal(path.resolve(source.contentRoot))})), 'UTM project Content root mismatch'`,
      `result = {'attached': bool(runpy.run_path(${literal(path.resolve(source.scriptPath))}, run_name='utm_connector_bootstrap')['install']())}`,
    ].join('\n');
    const response = await fetch(base, { method: 'POST', signal: requestSignal, redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'execute_python', params: { code } }) });
    if (!response.ok) return false;
    const body = await response.json() as { success?: boolean; result?: { result?: { attached?: boolean }; stderr?: string } };
    return body.success === true && body.result?.result?.attached === true && !body.result.stderr;
  } catch {
    return false;
  }
}
