import fs from 'node:fs';
import { readFile } from 'node:fs/promises';

export interface LauncherAsset {
  path: string;
  type: string;
}

export type LauncherAssetMap = ReadonlyMap<string, LauncherAsset>;
export type LauncherProtocolDiagnostic = (message: string) => void;

function describeRequestUrl(rawUrl: string): string {
  try {
    const target = new URL(rawUrl);
    return `${target.protocol}//${target.host}${target.pathname}`;
  } catch {
    return 'invalid URL';
  }
}

/**
 * Serve the small, known launcher surface directly from the packaged app.
 *
 * Returning file bytes avoids making a second `file:` request from inside a
 * custom-scheme handler. That nested fetch can be cancelled independently of
 * the `uem-launcher:` navigation when a dashboard document is being replaced.
 */
export function createLauncherProtocolHandler(
  assets: LauncherAssetMap,
  writeDiagnostic: LauncherProtocolDiagnostic,
  getNavigationGeneration: () => number = () => 0,
) {
  let requestId = 0;

  return async (request: Request): Promise<Response> => {
    const id = ++requestId;
    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      writeDiagnostic(`Launcher protocol request rejected: id=${id}; generation=${getNavigationGeneration()}; url=invalid URL`);
      return new Response('Not found', { status: 404 });
    }

    const asset = assets.get(target.pathname);
    const exists = Boolean(asset && fs.existsSync(asset.path));
    writeDiagnostic(`Launcher protocol request begin: id=${id}; generation=${getNavigationGeneration()}; url=${describeRequestUrl(request.url)}; pathname=${target.pathname}; asset=${asset?.path ?? 'none'}; exists=${exists}`);
    if (target.protocol !== 'uem-launcher:' || target.host !== 'app' || !asset || !exists) {
      writeDiagnostic(`Launcher protocol request completed: id=${id}; generation=${getNavigationGeneration()}; status=404; reason=${target.host !== 'app' ? 'host' : 'asset'}`);
      return new Response('Not found', { status: 404 });
    }

    try {
      const body = await readFile(asset.path);
      writeDiagnostic(`Launcher protocol request completed: id=${id}; generation=${getNavigationGeneration()}; status=200; ok=true; bytes=${body.byteLength}`);
      return new Response(body, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Length': String(body.byteLength),
          'Content-Type': asset.type,
        },
      });
    } catch (error) {
      writeDiagnostic(`Launcher protocol request failed: id=${id}; generation=${getNavigationGeneration()}; url=${describeRequestUrl(request.url)}; error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  };
}
