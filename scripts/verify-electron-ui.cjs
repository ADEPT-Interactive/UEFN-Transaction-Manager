const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const repositoryRoot = path.resolve(__dirname, '..');
const sourceProjectRoot = path.join(os.homedir(), 'Documents', 'UEFN Projects', 'UTM_Demo');
const runtimeProjectRoot = path.join(os.tmpdir(), `utm-ui-renderer-${process.pid}`);
const sessionToken = crypto.randomBytes(48).toString('base64url');
const editorToken = crypto.randomBytes(48).toString('base64url');

let bridgeProcess;
let bridgePort;
let windowRef;

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const listener = http.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') {
        listener.close();
        reject(new Error('Could not reserve a loopback port for the renderer test.'));
        return;
      }
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function request(pathname, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const requestRef = http.request({
      host: '127.0.0.1',
      port: bridgePort,
      path: pathname,
      method,
      headers: {
        'X-UEM-Token': sessionToken,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    requestRef.once('error', reject);
    requestRef.end(body);
  });
}

async function waitForBridge() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (bridgeProcess.exitCode !== null) throw new Error('The renderer test bridge exited before becoming healthy.');
    try {
      const response = await request('/api/health');
      if (response.status === 200 && response.text.includes('UEFN Entitlement Manager Bridge')) return;
    } catch {
      // The bridge may still be binding its loopback listeners.
    }
    await wait(100);
  }
  throw new Error('The renderer test bridge did not become healthy within 8 seconds.');
}

function evaluate(source) {
  return windowRef.webContents.executeJavaScript(`(${source})()`, true);
}

async function waitForExpression(source, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await evaluate(source);
      if (result) return result;
    } catch {
      // React may still be loading the dashboard.
    }
    await wait(100);
  }
  let rendererSnapshot = '';
  try { rendererSnapshot = String(await evaluate("() => document.body?.innerText?.slice(0, 1200) ?? ''")); } catch { /* renderer may have exited */ }
  throw new Error(`Timed out waiting for ${description}. Renderer text: ${rendererSnapshot}`);
}

async function click(source, description) {
  await waitForExpression(`() => {
    const target = (${source})();
    if (!target) return false;
    target.click();
    return true;
  }`, description);
}

function buttonByText(text, exact = false) {
  return `() => [...document.querySelectorAll('button,[role="button"]')].find(element => {
    const value = element.innerText?.trim() ?? element.textContent?.trim() ?? '';
    return ${exact ? `value === ${JSON.stringify(text)}` : `value.includes(${JSON.stringify(text)})`};
  })`;
}

async function discardDialogChanges() {
  await click(buttonByText('Discard changes', true), 'the unsaved-change discard action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"], [role="dialog"][aria-labelledby="bundle-dialog-title"], [role="dialog"][aria-labelledby="offer-display-dialog-title"]\')', 'the editor dialog to close');
}

async function selectCountry(editorIndex, code) {
  const triggerSource = `() => [...document.querySelectorAll('button[aria-expanded]')].filter(element => (element.innerText ?? '').includes('Choose countries'))[${editorIndex}]`;
  await waitForExpression(`() => {
    const trigger = (${triggerSource})();
    if (!trigger) return false;
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    return trigger.getAttribute('aria-expanded') === 'true';
  }`, `${code} country picker ${editorIndex + 1}`);
  await click(`() => [...document.querySelectorAll('div.max-h-56 button')].find(element => (element.innerText ?? '').trim().endsWith(${JSON.stringify(code)}))`, `${code} country option`);
}

async function selectedFlagReport() {
  return evaluate(`async () => {
    const response = await fetch('/flag-sprite.webp', { cache: 'no-store' });
    const bitmap = await createImageBitmap(await response.blob());
    return [...document.querySelectorAll('button[aria-label^="Remove "]')].map(button => {
      const flag = button.parentElement?.querySelector('[style*="flag-sprite.webp"]');
      if (!flag) return { code: button.parentElement?.innerText ?? '', missing: true };
      const style = getComputedStyle(flag);
      const rect = flag.getBoundingClientRect();
      const position = style.backgroundPosition.split(' ').map(value => Number.parseFloat(value));
      const size = style.backgroundSize.split(' ').map(value => Number.parseFloat(value));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      const context = canvas.getContext('2d');
      let paintedPixels = 0;
      if (context && position.length === 2 && size.length === 2) {
        context.drawImage(bitmap, position[0], position[1], size[0], size[1]);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 10) paintedPixels += 1;
      }
      return {
        code: button.parentElement?.innerText ?? '',
        missing: false,
        width: rect.width,
        height: rect.height,
        backgroundImage: style.backgroundImage,
        backgroundPosition: style.backgroundPosition,
        backgroundSize: style.backgroundSize,
        paintedPixels,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    });
  }`);
}

async function assertDialogLayout(dialogSelector, bodySelector, description) {
  const report = await evaluate(`() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    const body = dialog?.querySelector(${JSON.stringify(bodySelector)});
    if (!dialog || !body) return null;
    const shellStyle = getComputedStyle(dialog);
    const bodyStyle = getComputedStyle(body);
    const shellRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      shellOverflow: shellStyle.overflow,
      shellMinHeight: shellStyle.minHeight,
      bodyOverflowY: bodyStyle.overflowY,
      bodyMinHeight: bodyStyle.minHeight,
      shellTop: shellRect.top,
      shellBottom: shellRect.bottom,
      shellHeight: shellRect.height,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      bodyHeight: bodyRect.height,
      bodyBottom: bodyRect.bottom,
      viewportHeight: window.innerHeight,
      bodyScrolls: body.scrollHeight >= body.clientHeight,
    };
  }`);
  assert.ok(report, `${description} should render its shell and scroll body`);
  assert.equal(report.shellOverflow, 'hidden', `${description} shell must clip its rounded boundary`);
  assert.equal(report.bodyOverflowY, 'auto', `${description} body must own vertical scrolling`);
  assert.equal(report.bodyMinHeight, '0px', `${description} body must be allowed to shrink in a flex shell`);
  assert.ok(report.shellHeight <= report.viewportHeight - 1, `${description} shell must remain inside the viewport`);
  assert.ok(report.bodyTop >= report.shellTop - 1 && report.bodyBottom <= report.shellBottom + 1, `${description} body must render inside its shell`);
}

async function assertSelectFocus() {
  // Chromium does not activate the :focus pseudo-class for a fully hidden
  // native window. Briefly showing the already-rendered window lets this
  // check observe the same focus cascade a user sees, without capturing or
  // writing any visual artifact.
  windowRef.show();
  windowRef.focus();
  const report = await evaluate(`() => [...document.querySelectorAll('select.utm-native-select')].map(element => {
    element.focus();
    const style = getComputedStyle(element);
    return { label: element.getAttribute('aria-label'), active: document.activeElement === element, matchesFocus: element.matches(':focus'), matchesFocusVisible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, boxShadow: style.boxShadow };
  })`);
  windowRef.hide();
  assert.ok(report.length >= 1, 'at least one native select should use the shared focus class');
  for (const item of report) {
    assert.equal(item.outlineStyle, 'solid', `${item.label} should have a visible focus outline`);
    assert.equal(item.outlineWidth, '2px', `${item.label} should use the shared 2px focus outline`);
    assert.equal(item.boxShadow, 'none', `${item.label} should not retain the native yellow/orange focus shadow`);
  }
}

async function assertViewportMatrix(dialogSelector, bodySelector, description) {
  const cases = [
    { width: 1920, height: 1080, zoom: 1 },
    { width: 1366, height: 768, zoom: 1 },
    { width: 1180, height: 760, zoom: 1 },
    { width: 1536, height: 864, zoom: 1.25 },
    { width: 1280, height: 720, zoom: 1.5 },
  ];
  for (const viewport of cases) {
    windowRef.setSize(viewport.width, viewport.height);
    windowRef.webContents.setZoomFactor(viewport.zoom);
    await wait(80);
    await assertDialogLayout(dialogSelector, bodySelector, `${description} at ${viewport.width}x${viewport.height} ${viewport.zoom * 100}%`);
  }
  windowRef.webContents.setZoomFactor(1);
  windowRef.setSize(1440, 900);
  await wait(80);
}

async function runRendererAssertions() {
  const sprite = await evaluate(`async () => {
    const response = await fetch('/flag-sprite.webp', { cache: 'no-store' });
    return { ok: response.ok, contentType: response.headers.get('content-type') };
  }`);
  assert.equal(sprite.ok, true, 'the flag atlas must be served to the renderer');
  assert.match(sprite.contentType ?? '', /image\/webp/i);

  const bodyText = await waitForExpression('() => document.body?.innerText?.includes(\'Bundle offers\') && document.body?.innerText?.includes(\'Storefront membership\')', 'the populated catalog dashboard');
  assert.equal(bodyText, true);

  await click('() => document.querySelector(\'[aria-label="Edit Holo Trail"]\')', 'the Holo Trail editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the entitlement editor');
  assert.match(await evaluate('() => document.body.innerText'), /increments of 50/i);
  assert.doesNotMatch(await evaluate('() => document.body.innerText'), /step 50/i);
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Advanced\')', 'the entitlement advanced controls');
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 1', 'the normal restriction editor');
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Add variant\')', 'an alternate offer editor');
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 2', 'the alternate compact restriction editor');
  await selectCountry(1, 'CA');
  await selectCountry(1, 'US');
  const offerFlags = await selectedFlagReport();
  assert.equal(offerFlags.length, 4, 'normal and alternate restrictions should retain both selected countries');
  for (const flag of offerFlags) {
    assert.equal(flag.missing, false, `${flag.code} should render a flag element`);
    assert.ok(flag.width >= 22.5 && flag.width <= 24.5, `${flag.code} flag width should stay close to 24 CSS pixels (got ${flag.width})`);
    assert.ok(flag.height >= 16.5 && flag.height <= 18.5, `${flag.code} flag height should stay close to 18 CSS pixels (got ${flag.height})`);
    assert.match(flag.backgroundImage, /flag-sprite\.webp/);
    assert.ok(flag.paintedPixels > 0, `${flag.code} flag atlas crop should contain painted pixels`);
    assert.notEqual(flag.visibility, 'hidden');
    assert.notEqual(flag.display, 'none');
    assert.notEqual(flag.opacity, '0');
  }
  await assertSelectFocus();
  await assertDialogLayout('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await assertViewportMatrix('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await click('() => document.querySelector(\'[aria-label="Close offer editor"]\')', 'the entitlement editor close action');
  await discardDialogChanges();

  await click('() => document.querySelector(\'[aria-label="Edit Starter Bundle"]\')', 'the Starter Bundle editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="bundle-dialog-title"]\')', 'the bundle editor');
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  const bundleFlags = await selectedFlagReport();
  assert.equal(bundleFlags.length, 2, 'bundle restrictions should retain both selected countries');
  for (const flag of bundleFlags) {
    assert.equal(flag.missing, false, `${flag.code} should render in the bundle restriction editor`);
    assert.ok(flag.width >= 22.5 && flag.width <= 24.5);
    assert.ok(flag.height >= 16.5 && flag.height <= 18.5);
    assert.match(flag.backgroundImage, /flag-sprite\.webp/);
    assert.ok(flag.paintedPixels > 0, `${flag.code} flag atlas crop should contain painted pixels`);
  }
  await assertSelectFocus();
  await assertDialogLayout('[role="dialog"][aria-labelledby="bundle-dialog-title"]', 'form > div.min-h-0', 'the bundle editor');
  await click('() => document.querySelector(\'[aria-label="Close bundle editor"]\')', 'the bundle editor close action');
  await discardDialogChanges();

  await click('() => document.querySelector(\'[aria-label="Edit All Offers membership"]\')', 'the All Offers editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="offer-display-dialog-title"]\')', 'the All Offers editor');
  await assertDialogLayout('[role="dialog"][aria-labelledby="offer-display-dialog-title"]', 'form > div.min-h-0', 'the storefront editor');
  await click('() => document.querySelector(\'[aria-label="Close storefront editor"]\')', 'the storefront editor close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="offer-display-dialog-title"]\')', 'the storefront editor to close');

  await click(buttonByText('Create Offer', true), 'the creation chooser');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="creation-chooser-title"]\')', 'the creation chooser');
  const chooser = await evaluate(`() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="creation-chooser-title"]');
    const body = dialog?.querySelector('.min-h-0.flex-1.overflow-y-auto');
    return body ? { shellOverflow: getComputedStyle(dialog).overflow, bodyOverflowY: getComputedStyle(body).overflowY, bodyMinHeight: getComputedStyle(body).minHeight } : null;
  }`);
  assert.ok(chooser);
  assert.equal(chooser.shellOverflow, 'hidden');
  assert.equal(chooser.bodyOverflowY, 'auto');
  assert.equal(chooser.bodyMinHeight, '0px');
  await click('() => document.querySelector(\'[aria-label="Close creation chooser"]\')', 'the creation chooser close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="creation-chooser-title"]\')', 'the creation chooser to close');

  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Need Help?\')', 'the setup dialog');
  await waitForExpression('() => document.querySelector(\'[role="dialog"] h2\')?.innerText === \'Need Help?\'', 'the setup dialog');
  await assertDialogLayout('[role="dialog"]', '.min-h-0.flex-1.overflow-y-auto', 'the setup dialog');
  await click('() => document.querySelector(\'[aria-label="Close help"]\')', 'the setup dialog close action');

  const results = await evaluate(`() => ({
    dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
    catalogItems: [...document.querySelectorAll('article')].length,
    nativeSelects: document.querySelectorAll('select.utm-native-select').length,
  })`);
  assert.equal(results.dialogs, 0, 'the renderer test must leave no modal open');
  assert.ok(results.catalogItems >= 10, 'the populated catalog should remain rendered after the checks');
  assert.equal(results.nativeSelects, 0, 'modal-only native selects should be removed when all dialogs close');
}

async function cleanup() {
  try {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
  } catch {
    // Cleanup continues even if Chromium has already exited.
  }
  if (bridgeProcess && bridgeProcess.exitCode === null) {
    try { await request('/api/session/shutdown', 'POST', '{}'); } catch { /* the bridge may already be stopping */ }
    await Promise.race([
      new Promise(resolve => bridgeProcess.once('exit', resolve)),
      wait(3000),
    ]);
    if (bridgeProcess.exitCode === null) bridgeProcess.kill();
  }
  fs.rmSync(runtimeProjectRoot, { recursive: true, force: true });
}

async function main() {
  if (!fs.existsSync(path.join(repositoryRoot, 'dist', 'index.html'))) throw new Error('The renderer build is missing. Run npm run build first.');
  if (!fs.existsSync(path.join(sourceProjectRoot, 'UTM_Demo.uefnproject'))) throw new Error(`The UTM_Demo fixture was not found at ${sourceProjectRoot}.`);
  fs.rmSync(runtimeProjectRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(runtimeProjectRoot, 'Content'), { recursive: true });
  fs.copyFileSync(path.join(sourceProjectRoot, 'UTM_Demo.uefnproject'), path.join(runtimeProjectRoot, 'UTM_Demo.uefnproject'));
  fs.cpSync(path.join(sourceProjectRoot, 'Content'), path.join(runtimeProjectRoot, 'Content'), { recursive: true });

  bridgePort = await reservePort();
  bridgeProcess = spawn(process.execPath, [path.join(repositoryRoot, 'dist', 'server.cjs')], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(bridgePort),
      UEM_SESSION_TOKEN: sessionToken,
      UEM_EDITOR_TOKEN: editorToken,
      UEM_CONTENT_ROOT: path.join(runtimeProjectRoot, 'Content'),
      UEM_ASSET_MOUNT: '/UTM_Demo',
      UEM_PROJECT_FILE: path.join(runtimeProjectRoot, 'UTM_Demo.uefnproject'),
      UEM_PROJECT_PYTHON_ENABLED: '1',
      UEM_AUTO_CONNECTOR_INSTALLED: '0',
      UEM_UEFN_PROCESS_ID: '0',
      UEM_TEST_MODE: '1',
      UEM_TEST_NO_GLOBAL_UEFN_PROBE: '1',
      UEM_IDLE_TIMEOUT_MS: '600000',
    },
  });
  bridgeProcess.stdout.on('data', () => undefined);
  bridgeProcess.stderr.on('data', () => undefined);
  await waitForBridge();

  windowRef = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    backgroundColor: '#080c14',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const contentRoot = path.join(runtimeProjectRoot, 'Content');
  const fragment = new URLSearchParams({
    token: sessionToken,
    contentDir: contentRoot,
    assetFolder: 'EntitlementIcons',
    verseFile: 'managed_transactions.verse',
    projectFile: path.join(runtimeProjectRoot, 'UTM_Demo.uefnproject'),
  });
  await windowRef.loadURL(`http://127.0.0.1:${bridgePort}/#${fragment}`);
  await waitForExpression('() => Boolean(document.getElementById(\'root\')?.firstElementChild)', 'the React dashboard root');
  await runRendererAssertions();
  console.log('Electron UI regression checks passed without capturing screenshots.');
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  try {
    await main();
    await cleanup();
    app.quit();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    await cleanup();
    app.exit(1);
  }
});
