const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const repositoryRoot = path.resolve(__dirname, '..');
const applicationRoot = path.resolve(process.env.UEM_UI_APP_ROOT ?? repositoryRoot);
const serverPath = path.join(applicationRoot, 'dist', 'server.cjs');
const electronPath = path.resolve(process.env.UEM_UI_ELECTRON_PATH ?? path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe'));
const runtimeProjectRoot = path.join(os.tmpdir(), `utm-ui-renderer-${process.pid}-${Date.now()}`);
const showcaseProjectFile = path.join(runtimeProjectRoot, 'Creator Commerce Demo.uefnproject');
const sessionToken = crypto.randomBytes(48).toString('base64url');
const editorToken = crypto.randomBytes(48).toString('base64url');

let bridgeProcess;
let bridgePort;
let windowRef;
let bridgeStdout = '';
let bridgeStderr = '';

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

function createShowcaseFixture() {
  return new Promise((resolve, reject) => {
    const fixtureCommand = process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm run showcase:fixture']]
      : ['npm', ['run', 'showcase:fixture']];
    const fixture = spawn(fixtureCommand[0], fixtureCommand[1], {
      cwd: repositoryRoot,
      env: { ...process.env, UEM_SHOWCASE_OUTPUT: runtimeProjectRoot },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fixture.stdout.on('data', data => process.stdout.write(data));
    fixture.stderr.on('data', data => process.stderr.write(data));
    fixture.once('error', reject);
    fixture.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Deterministic showcase fixture generation failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
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
    if (bridgeProcess.exitCode !== null) throw new Error(`The renderer test bridge exited before becoming healthy.\nSTDOUT:\n${bridgeStdout}\nSTDERR:\n${bridgeStderr}`);
    try {
      const response = await request('/api/health');
      if (response.status === 200 && response.text.includes('UEFN Entitlement Manager Bridge')) return;
    } catch {
      // The bridge may still be binding its loopback listeners.
    }
    await wait(100);
  }
  throw new Error(`The renderer test bridge did not become healthy within 8 seconds.\nSTDOUT:\n${bridgeStdout}\nSTDERR:\n${bridgeStderr}`);
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
  await evaluate(`() => {
    const option = [...document.querySelectorAll('div.max-h-56 button')].find(element => (element.innerText ?? '').trim().endsWith(${JSON.stringify(code)}));
    option?.scrollIntoView({ block: 'nearest' });
  }`);
  const pickerFlag = await inspectFlag(`() => [...document.querySelectorAll('div.max-h-56 button')].find(element => (element.innerText ?? '').trim().endsWith(${JSON.stringify(code)}))?.querySelector('[style*="flag-sprite.webp"]')`);
  assert.equal(pickerFlag.missing, false, `${code} should render in the country picker`);
  assert.ok(pickerFlag.atlasBoundsValid, `${code} country picker flag should map inside the atlas`);
  assert.ok(pickerFlag.paintedPixels > 0, `${code} country picker flag should contain painted pixels`);
  assert.equal(pickerFlag.clipped, false, `${code} country picker flag should not be clipped: ${JSON.stringify(pickerFlag)}`);
  await click(`() => [...document.querySelectorAll('div.max-h-56 button')].find(element => (element.innerText ?? '').trim().endsWith(${JSON.stringify(code)}))`, `${code} country option`);
}

function inspectFlag(selectorSource) {
  return evaluate(`async () => {
    const response = await fetch('/flag-sprite.webp', { cache: 'no-store' });
    const bitmap = await createImageBitmap(await response.blob());
    const flag = (${selectorSource})();
    if (!flag) return { missing: true };
    const style = getComputedStyle(flag);
    const rect = flag.getBoundingClientRect();
    const position = style.backgroundPosition.split(' ').map(value => Number.parseFloat(value));
    const size = style.backgroundSize.split(' ').map(value => Number.parseFloat(value));
    const scaleX = size[0] / bitmap.width;
    const scaleY = size[1] / bitmap.height;
    const sourceLeft = -position[0] / scaleX;
    const sourceTop = -position[1] / scaleY;
    const sourceWidth = rect.width / scaleX;
    const sourceHeight = rect.height / scaleY;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(rect.width));
    canvas.height = Math.max(1, Math.ceil(rect.height));
    const context = canvas.getContext('2d');
    let paintedPixels = 0;
    if (context && position.length === 2 && size.length === 2 && scaleX > 0 && scaleY > 0) {
      context.drawImage(bitmap, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 10) paintedPixels += 1;
    }
    let clipped = false;
    const clipAncestors = [];
    for (let ancestor = flag.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (!/(hidden|clip|scroll|auto)/.test(ancestorStyle.overflow + ' ' + ancestorStyle.overflowX + ' ' + ancestorStyle.overflowY)) continue;
      const ancestorRect = ancestor.getBoundingClientRect();
      const outside = rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1 || rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1;
      if (outside) clipAncestors.push({ tag: ancestor.tagName, className: ancestor.className, rect: { left: ancestorRect.left, top: ancestorRect.top, right: ancestorRect.right, bottom: ancestorRect.bottom }, overflow: ancestorStyle.overflow });
      clipped ||= outside;
    }
    return {
      missing: false,
      width: rect.width,
      height: rect.height,
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize,
      atlasWidth: bitmap.width,
      atlasHeight: bitmap.height,
      sourceLeft,
      sourceTop,
      sourceWidth,
      sourceHeight,
      atlasBoundsValid: sourceLeft >= 0 && sourceTop >= 0 && sourceLeft + sourceWidth <= bitmap.width + 0.01 && sourceTop + sourceHeight <= bitmap.height + 0.01,
      paintedPixels,
      clipped,
      clipAncestors,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
    };
  }`);
}

async function selectedFlagReport() {
  return evaluate(`async () => {
    const response = await fetch('/flag-sprite.webp', { cache: 'no-store' });
    const bitmap = await createImageBitmap(await response.blob());
    const inspect = flag => {
      if (!flag) return { missing: true };
      const style = getComputedStyle(flag);
      const rect = flag.getBoundingClientRect();
      const position = style.backgroundPosition.split(' ').map(value => Number.parseFloat(value));
      const size = style.backgroundSize.split(' ').map(value => Number.parseFloat(value));
      const scaleX = size[0] / bitmap.width;
      const scaleY = size[1] / bitmap.height;
      const sourceLeft = -position[0] / scaleX;
      const sourceTop = -position[1] / scaleY;
      const sourceWidth = rect.width / scaleX;
      const sourceHeight = rect.height / scaleY;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(rect.width));
      canvas.height = Math.max(1, Math.ceil(rect.height));
      const context = canvas.getContext('2d');
      let paintedPixels = 0;
      if (context && position.length === 2 && size.length === 2 && scaleX > 0 && scaleY > 0) {
        context.drawImage(bitmap, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 10) paintedPixels += 1;
      }
      let clipped = false;
      const clipAncestors = [];
      for (let ancestor = flag.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (!/(hidden|clip|scroll|auto)/.test(ancestorStyle.overflow + ' ' + ancestorStyle.overflowX + ' ' + ancestorStyle.overflowY)) continue;
        const ancestorRect = ancestor.getBoundingClientRect();
        const outside = rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1 || rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1;
        if (outside) clipAncestors.push({ tag: ancestor.tagName, className: ancestor.className, rect: { left: ancestorRect.left, top: ancestorRect.top, right: ancestorRect.right, bottom: ancestorRect.bottom }, overflow: ancestorStyle.overflow });
        clipped ||= outside;
      }
      return { missing: false, width: rect.width, height: rect.height, backgroundImage: style.backgroundImage, backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize, atlasWidth: bitmap.width, atlasHeight: bitmap.height, sourceLeft, sourceTop, sourceWidth, sourceHeight, atlasBoundsValid: sourceLeft >= 0 && sourceTop >= 0 && sourceLeft + sourceWidth <= bitmap.width + 0.01 && sourceTop + sourceHeight <= bitmap.height + 0.01, paintedPixels, clipped, clipAncestors, display: style.display, visibility: style.visibility, opacity: style.opacity };
    };
    return [...document.querySelectorAll('button[aria-label^="Remove "]')].map(button => {
      const flag = button.parentElement?.querySelector('[style*="flag-sprite.webp"]');
      flag?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { code: button.parentElement?.innerText ?? '', ...inspect(flag) };
    });
  }`);
}

async function assertDialogLayout(dialogSelector, bodySelector, description, requireScroll = false) {
  const report = await evaluate(`() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
    const body = dialog?.querySelector(${JSON.stringify(bodySelector)});
    if (!dialog || !body) return null;
    const shellStyle = getComputedStyle(dialog);
    const bodyStyle = getComputedStyle(body);
    const shellRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const scrollRoot = document.scrollingElement || document.documentElement;
    const rootScrollTop = scrollRoot.scrollTop;
    const shellScrollTop = dialog.scrollTop;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const probeScrollTop = maxScrollTop > 0 ? Math.min(maxScrollTop, Math.max(1, Math.ceil(maxScrollTop / 2))) : 0;
    body.scrollTop = probeScrollTop;
    const probeChanged = body.scrollTop > 0;
    body.scrollTop = maxScrollTop;
    const action = dialog.querySelector('button[type="submit"]') || dialog.querySelector('button[aria-label^="Close"]');
    const actionRect = action?.getBoundingClientRect();
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
      viewportHeight: window.innerHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      bodyScrollTop: body.scrollTop,
      maxScrollTop,
      probeChanged,
      bodyAtBottom: maxScrollTop === 0 || body.scrollTop >= maxScrollTop - 2,
      rootScrollTop,
      rootScrollUnchanged: rootScrollTop === scrollRoot.scrollTop,
      shellScrollTop,
      shellScrollUnchanged: shellScrollTop === dialog.scrollTop,
      actionVisible: Boolean(actionRect && actionRect.top >= shellRect.top - 1 && actionRect.bottom <= shellRect.bottom + 1 && actionRect.left >= shellRect.left - 1 && actionRect.right <= shellRect.right + 1),
    };
  }`);
  assert.ok(report, `${description} should render its shell and scroll body`);
  assert.equal(report.shellOverflow, 'hidden', `${description} shell must clip its rounded boundary`);
  assert.equal(report.bodyOverflowY, 'auto', `${description} body must own vertical scrolling`);
  assert.equal(report.bodyMinHeight, '0px', `${description} body must be allowed to shrink in a flex shell`);
  assert.ok(report.shellHeight <= report.viewportHeight - 1, `${description} shell must remain inside the viewport`);
  assert.ok(report.bodyTop >= report.shellTop - 1 && report.bodyBottom <= report.shellBottom + 1, `${description} body must render inside its shell`);
  assert.equal(report.rootScrollUnchanged, true, `${description} must not transfer scrolling to the page`);
  assert.equal(report.shellScrollUnchanged, true, `${description} shell must not become the scroll owner`);
  assert.equal(report.actionVisible, true, `${description} close/save control must remain inside the shell after body scrolling`);
  if (requireScroll) {
    assert.ok(report.bodyScrollHeight > report.bodyClientHeight, `${description} body must overflow at a constrained viewport: ${JSON.stringify(report)}`);
    assert.equal(report.probeChanged, true, `${description} body scrollTop must change when probed`);
    assert.equal(report.bodyAtBottom, true, `${description} body must reach its near-bottom position`);
  }
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
    return { label: element.getAttribute('aria-label'), active: document.activeElement === element, matchesFocus: element.matches(':focus'), matchesFocusVisible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor, borderColor: style.borderColor, boxShadow: style.boxShadow };
  })`);
  windowRef.hide();
  assert.ok(report.length >= 1, 'at least one native select should use the shared focus class');
  for (const item of report) {
    assert.equal(item.outlineStyle, 'none', `${item.label} should not render a detached focus outline`);
    assert.equal(item.outlineOffset, '0px', `${item.label} should not render an outline offset`);
    assert.doesNotMatch(item.borderColor, /245,\s*158,\s*11|234,\s*88,\s*12|255,\s*165,\s*0/i, `${item.label} should use the cyan focus border rather than a yellow/orange native halo`);
    assert.notEqual(item.borderColor, 'rgb(71, 85, 105)', `${item.label} should visibly change its focus border`);
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
    await assertDialogLayout(dialogSelector, bodySelector, `${description} at ${viewport.width}x${viewport.height} ${viewport.zoom * 100}%`, viewport.height <= 768 || viewport.zoom > 1);
  }
  windowRef.webContents.setZoomFactor(1);
  windowRef.setSize(1440, 900);
  await wait(80);
  await evaluate(`() => { const body = document.querySelector(${JSON.stringify(bodySelector)}); if (body) body.scrollTop = 0; }`);
}

function assertFlagReports(flags, description) {
  assert.ok(flags.length > 0, `${description} should render selected flags`);
  for (const flag of flags) {
    assert.equal(flag.missing, false, `${description} ${flag.code} should render a flag element`);
    assert.ok(flag.width >= 22.5 && flag.width <= 24.5, `${description} ${flag.code} flag width should stay close to 24 CSS pixels (got ${flag.width})`);
    assert.ok(flag.height >= 16.5 && flag.height <= 18.5, `${description} ${flag.code} flag height should stay close to 18 CSS pixels (got ${flag.height})`);
    assert.match(flag.backgroundImage, /flag-sprite\.webp/);
    assert.ok(flag.atlasWidth > 0 && flag.atlasHeight > 0, `${description} ${flag.code} should use a decoded atlas`);
    assert.ok(flag.atlasBoundsValid, `${description} ${flag.code} crop should stay within atlas bounds`);
    assert.ok(flag.paintedPixels > 0, `${description} ${flag.code} flag atlas crop should contain painted pixels`);
    assert.equal(flag.clipped, false, `${description} ${flag.code} flag should not be clipped by an ancestor: ${JSON.stringify(flag)}`);
    assert.notEqual(flag.visibility, 'hidden');
    assert.notEqual(flag.display, 'none');
    assert.notEqual(flag.opacity, '0');
  }
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

  await click('() => document.querySelector(\'[aria-label="Edit Access Pass"]\')', 'the Access Pass editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the entitlement editor');
  assert.match(await evaluate('() => document.body.innerText'), /increments of 50/i);
  assert.doesNotMatch(await evaluate('() => document.body.innerText'), /step 50/i);
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Advanced\')', 'the entitlement advanced controls');
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 1', 'the normal restriction editor');
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  await selectCountry(0, 'JP');
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Add variant\')', 'an alternate offer editor');
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 2', 'the alternate compact restriction editor');
  await selectCountry(1, 'CA');
  await selectCountry(1, 'US');
  await selectCountry(1, 'JP');
  const offerFlags = await selectedFlagReport();
  assert.equal(offerFlags.length, 6, 'normal and alternate restrictions should retain CA, US, and JP');
  assertFlagReports(offerFlags, 'normal and alternate restrictions');
  await assertSelectFocus();
  await assertDialogLayout('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await assertViewportMatrix('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await click('() => document.querySelector(\'[aria-label="Close offer editor"]\')', 'the entitlement editor close action');
  await discardDialogChanges();

  await click('() => document.querySelector(\'[aria-label="Edit Starter Bundle"]\')', 'the Starter Bundle editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="bundle-dialog-title"]\')', 'the bundle editor');
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  await selectCountry(0, 'JP');
  const bundleFlags = await selectedFlagReport();
  assert.equal(bundleFlags.length, 3, 'bundle restrictions should retain CA, US, and JP');
  assertFlagReports(bundleFlags, 'bundle restrictions');
  await assertSelectFocus();
  await assertDialogLayout('[role="dialog"][aria-labelledby="bundle-dialog-title"]', 'form > div.min-h-0', 'the bundle editor');
  await click('() => document.querySelector(\'[aria-label="Close bundle editor"]\')', 'the bundle editor close action');
  await discardDialogChanges();

  await click('() => document.querySelector(\'[aria-label="Edit All Offers membership"]\')', 'the All Offers editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="offer-display-dialog-title"]\')', 'the All Offers editor');
  windowRef.setSize(1000, 480);
  windowRef.webContents.setZoomFactor(1.5);
  await wait(80);
  await assertDialogLayout('[role="dialog"][aria-labelledby="offer-display-dialog-title"]', 'form > div.min-h-0', 'the storefront editor at 1000x480 150%', true);
  windowRef.webContents.setZoomFactor(1);
  windowRef.setSize(1440, 900);
  await wait(80);
  await click('() => document.querySelector(\'[aria-label="Close storefront editor"]\')', 'the storefront editor close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="offer-display-dialog-title"]\')', 'the storefront editor to close');

  await click(buttonByText('Create Offer', true), 'the creation chooser');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="creation-chooser-title"]\')', 'the creation chooser');
  windowRef.setSize(1280, 720);
  windowRef.webContents.setZoomFactor(1.5);
  await wait(80);
  await assertDialogLayout('[role="dialog"][aria-labelledby="creation-chooser-title"]', '.min-h-0.flex-1.overflow-y-auto', 'the creation chooser at 1280x720 150%', true);
  windowRef.webContents.setZoomFactor(1);
  windowRef.setSize(1440, 900);
  await wait(80);
  await click('() => document.querySelector(\'[aria-label="Close creation chooser"]\')', 'the creation chooser close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="creation-chooser-title"]\')', 'the creation chooser to close');

  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Need Help?\')', 'the setup dialog');
  await waitForExpression('() => document.querySelector(\'[role="dialog"] h2\')?.innerText === \'Need Help?\'', 'the setup dialog');
  windowRef.setSize(1280, 720);
  windowRef.webContents.setZoomFactor(1.5);
  await wait(80);
  await assertDialogLayout('[role="dialog"]', '.min-h-0.flex-1.overflow-y-auto', 'the setup dialog at 1280x720 150%', true);
  windowRef.webContents.setZoomFactor(1);
  windowRef.setSize(1440, 900);
  await wait(80);
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
  if (!fs.existsSync(path.join(applicationRoot, 'dist', 'index.html'))) throw new Error(`The renderer build is missing from ${applicationRoot}.`);
  fs.rmSync(runtimeProjectRoot, { recursive: true, force: true });
  await createShowcaseFixture();
  if (!fs.existsSync(showcaseProjectFile)) throw new Error(`The deterministic showcase fixture was not created at ${showcaseProjectFile}.`);

  bridgePort = await reservePort();
  bridgeProcess = spawn(electronPath, [serverPath], {
    cwd: applicationRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(bridgePort),
      UEM_SESSION_TOKEN: sessionToken,
      UEM_EDITOR_TOKEN: editorToken,
      UEM_CONTENT_ROOT: path.join(runtimeProjectRoot, 'Content'),
      UEM_ASSET_MOUNT: '/Showcase',
      UEM_PROJECT_FILE: showcaseProjectFile,
      UEM_PROJECT_PYTHON_ENABLED: '1',
      UEM_AUTO_CONNECTOR_INSTALLED: '0',
      UEM_UEFN_PROCESS_ID: '0',
      UEM_TEST_MODE: '1',
      UEM_TEST_NO_GLOBAL_UEFN_PROBE: '1',
      UEM_IDLE_TIMEOUT_MS: '600000',
    },
  });
  bridgeProcess.stdout.on('data', data => { bridgeStdout = `${bridgeStdout}${data}`.slice(-12000); });
  bridgeProcess.stderr.on('data', data => { bridgeStderr = `${bridgeStderr}${data}`.slice(-12000); });
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
    projectFile: showcaseProjectFile,
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
