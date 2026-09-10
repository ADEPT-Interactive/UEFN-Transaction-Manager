const { app, BrowserWindow, net, protocol } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(process.argv[2] || process.cwd());
const mode = process.argv.includes('--direct') ? 'direct' : 'net-fetch';
const cycles = Number(process.argv.find((value, index) => process.argv[index - 1] === '--cycles') || 5);
const pending = !process.argv.includes('--no-pending');
const supersede = process.argv.includes('--supersede');
const catalogState = process.argv.find((value, index) => process.argv[index - 1] === '--catalog-state') || 'uninitialized';
if (!['initialized', 'uninitialized'].includes(catalogState)) throw new Error(`Unsupported synthetic catalog state: ${catalogState}`);
const failAll = process.argv.includes('--fail-all');
const indexDelayMs = Number(process.argv.find((value, index) => process.argv[index - 1] === '--delay-index-ms') || 0);
const launcherUrl = 'uem-launcher://app/index.html';
const assets = new Map([
  ['/index.html', { path: path.join(root, 'electron', 'launcher.html'), type: 'text/html; charset=utf-8' }],
  ['/launcher.js', { path: path.join(root, 'electron', 'launcher.js'), type: 'text/javascript; charset=utf-8' }],
  ['/uem-icon.svg', { path: path.join(root, 'electron', 'assets', 'uem-icon.svg'), type: 'image/svg+xml' }],
  ['/discord-icon.svg', { path: path.join(root, 'electron', 'assets', 'discord-icon.svg'), type: 'image/svg+xml' }],
  ['/adept-insignia.png', { path: path.join(root, 'electron', 'assets', 'adept-insignia.png'), type: 'image/png' }],
]);

protocol.registerSchemesAsPrivileged([{ scheme: 'uem-launcher', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const once = (emitter, event) => new Promise(resolve => emitter.once(event, resolve));

async function waitForDocument(window, predicate, label) {
  const deadline = Date.now() + (failAll ? 2_000 : 10_000);
  while (Date.now() < deadline) {
    try {
      const result = await window.webContents.executeJavaScript(`(${predicate.toString()})()`);
      if (result) return result;
    } catch {
      // Navigation may have replaced the document between the URL and script checks.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}; current URL=${window.webContents.getURL()}`);
}

async function startServer(cycle) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/pending')) {
      // Keep a renderer request open until the synthetic bridge is torn down.
      request.once('close', () => undefined);
      return;
    }
    if (request.url === `/dashboard/${cycle}`) {
      const script = pending ? "fetch('/pending', { cache: 'no-store' }).catch(() => undefined);" : '';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`<!doctype html><html><body data-dashboard-ready data-catalog-state="${catalogState}"><div id="root">Synthetic project dashboard cycle ${cycle} (${catalogState})</div><script>${script}</script></body></html>`);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic bridge did not expose a loopback port.');
  return {
    server,
    url: `http://127.0.0.1:${address.port}/dashboard/${cycle}`,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `uem-navigation-repro-${process.pid}`,
    },
  });
  const session = window.webContents.session;
  let requestId = 0;
  let failAllLauncherRequests = false;
  const events = [];
  const event = (name, details = {}) => events.push({ at: new Date().toISOString(), name, url: window.webContents.getURL(), ...details });
  session.protocol.handle('uem-launcher', async request => {
    const id = ++requestId;
    const target = new URL(request.url);
    const asset = assets.get(target.pathname);
    const exists = Boolean(asset && fs.existsSync(asset.path));
    event('protocol-begin', { id, requestUrl: request.url, pathname: target.pathname, assetPath: asset?.path || null, exists, mode });
    if (target.host !== 'app' || !asset || !exists) {
      event('protocol-end', { id, status: 404 });
      return new Response('Not found', { status: 404 });
    }
    try {
      if (target.pathname === '/index.html' && failAllLauncherRequests) {
        const error = Object.assign(new Error("ERR_FAILED (-2) loading 'uem-launcher://app/index.html'"), { code: -2 });
        event('protocol-error', { id, code: -2, error: error.message });
        throw error;
      }
      if (target.pathname === '/index.html' && indexDelayMs > 0) await delay(indexDelayMs);
      if (mode === 'direct') {
        const body = await fsp.readFile(asset.path);
        const response = new Response(body, { status: 200, headers: { 'Content-Type': asset.type, 'Content-Length': String(body.byteLength) } });
        event('protocol-end', { id, status: response.status, ok: response.ok, bytes: body.byteLength });
        return response;
      }
      const response = await net.fetch(pathToFileURL(asset.path).toString());
      event('protocol-end', { id, status: response.status, ok: response.ok });
      return response;
    } catch (error) {
      event('protocol-error', { id, error: error?.stack || String(error) });
      throw error;
    }
  });
  session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'"] } }));
  window.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => event('did-start-navigation', { navigationUrl: url, isMainFrame }));
  window.webContents.on('did-start-loading', () => event('did-start-loading'));
  window.webContents.on('will-navigate', (_event, url) => event('will-navigate', { navigationUrl: url }));
  window.webContents.on('did-frame-navigate', (_event, url, status, statusText, isMainFrame) => event('did-frame-navigate', { navigationUrl: url, status, statusText, isMainFrame }));
  window.webContents.on('did-navigate', (_event, url, status, statusText) => event('did-navigate', { navigationUrl: url, status, statusText }));
  window.webContents.on('did-finish-load', () => event('did-finish-load'));
  window.webContents.on('did-stop-loading', () => event('did-stop-loading'));
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => event('did-fail-load', { code, description, navigationUrl: url, isMainFrame }));

  const load = async (url, label, predicate) => {
    let promiseError = null;
    const isLauncherReturn = label.startsWith('launcher after teardown');
    if (isLauncherReturn && failAll) failAllLauncherRequests = true;
    if (supersede && label.startsWith('launcher after teardown')) {
      const first = window.loadURL(url);
      await delay(0);
      const second = window.loadURL(url);
      const results = await Promise.allSettled([first, second]);
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') event('loadURL-resolved', { label, attempt: index + 1, targetUrl: url });
        else {
          promiseError ||= result.reason;
          event('loadURL-rejected', { label, attempt: index + 1, targetUrl: url, error: result.reason?.stack || String(result.reason), code: result.reason?.code || null });
        }
      }
    }
    else {
      try {
        await window.loadURL(url);
        event('loadURL-resolved', { label, targetUrl: url });
      } catch (error) {
        promiseError = error;
        event('loadURL-rejected', { label, targetUrl: url, error: error?.stack || String(error), code: error?.code || null });
      }
    }
    const document = await waitForDocument(window, predicate, label);
    event('document-validated', { label, targetUrl: url, document });
    return { promiseError, document };
  };

  const summary = { root, mode, pending, supersede, catalogState, indexDelayMs, failAll, cycles, transitions: [], events };
  const dashboardPredicate = catalogState === 'initialized'
    ? () => document.querySelector('[data-dashboard-ready]')?.dataset.catalogState === 'initialized'
    : () => document.querySelector('[data-dashboard-ready]')?.dataset.catalogState === 'uninitialized';
  try {
    await load(launcherUrl, 'initial launcher', () => Boolean(document.querySelector('[data-uem-launcher-ready]')));
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const bridge = await startServer(cycle);
      await load(bridge.url, `dashboard ${cycle}`, dashboardPredicate);
      await delay(100);
      await bridge.stop();
      try {
        const result = await load(launcherUrl, `launcher after teardown ${cycle}`, () => Boolean(document.querySelector('[data-uem-launcher-ready]')));
        summary.transitions.push({ cycle, promiseError: result.promiseError ? { code: result.promiseError.code || null, message: result.promiseError.message } : null, launcherValid: true });
      } catch (error) {
        if (!failAll) throw error;
        summary.transitions.push({ cycle, launcherValid: false, unavailableHandled: true, error: error?.message || String(error) });
        break;
      }
    }
    process.stdout.write(JSON.stringify(summary, null, 2));
  } finally {
    window.destroy();
    await app.quit();
  }
}

main().catch(error => {
  process.stderr.write(`${error?.stack || String(error)}\n`);
  app.quit();
  process.exitCode = 1;
});
