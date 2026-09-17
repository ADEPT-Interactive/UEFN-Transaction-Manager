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
let fakeEditorProcess;
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
    requestRef.setTimeout(3000, () => requestRef.destroy(new Error(`Renderer test bridge request timed out: ${pathname}`)));
    requestRef.end(body);
  });
}

function editorRequest(pathname, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const requestRef = http.request({
      host: '127.0.0.1',
      port: bridgePort,
      path: pathname,
      method,
      headers: {
        'X-UEM-Editor-Token': editorToken,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    requestRef.once('error', reject);
    requestRef.setTimeout(3000, () => requestRef.destroy(new Error(`Renderer test editor request timed out: ${pathname}`)));
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

async function physicalClick(source, description) {
  const point = await waitForExpression(`() => {
    const target = (${source})();
    if (!target) return null;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }`, `${description} hit target`);
  windowRef.show();
  windowRef.focus();
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  windowRef.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  windowRef.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  windowRef.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(120);
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

async function offerEditorGeometry() {
  return evaluate(`() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="entitlement-dialog-title"]');
    const tabList = dialog?.querySelector('[role="tablist"]');
    const panel = dialog?.querySelector('#offer-editor-panel');
    const footer = dialog?.querySelector('#offer-editor-footer');
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const tabReports = [...(tabList?.querySelectorAll('[role="tab"]') ?? [])].map(tab => {
      const label = tab.querySelector('span');
      return { rect: rect(tab), labelRect: rect(label), label: label?.textContent?.trim() ?? '', height: tab.getBoundingClientRect().height, scrollWidth: tab.scrollWidth, clientWidth: tab.clientWidth };
    });
    const buttons = [...(footer?.querySelectorAll('button') ?? [])];
    const save = buttons.find(button => button.type === 'submit');
    const cancel = buttons.find(button => button.textContent?.trim() === 'Cancel');
    const footerStyle = footer ? getComputedStyle(footer) : null;
    return {
      dialog: rect(dialog),
      tabList: rect(tabList),
      footer: rect(footer),
      save: rect(save),
      cancel: rect(cancel),
      tabs: tabReports,
      tabListScrollWidth: tabList?.scrollWidth ?? 0,
      tabListClientWidth: tabList?.clientWidth ?? 0,
      tabListOverflowX: tabList ? getComputedStyle(tabList).overflowX : '',
      footerParent: footer?.parentElement?.tagName ?? '',
      footerInsidePanel: Boolean(footer && panel?.contains(footer)),
      footerPaddingLeft: Number.parseFloat(footerStyle?.paddingLeft ?? '0'),
      footerPaddingRight: Number.parseFloat(footerStyle?.paddingRight ?? '0'),
      footerPaddingBottom: Number.parseFloat(footerStyle?.paddingBottom ?? '0'),
    };
  }`);
}

function assertRectClose(actual, expected, field, description, tolerance = 1) {
  assert.ok(Math.abs(actual[field] - expected[field]) <= tolerance, `${description} ${field} changed from ${expected[field]} to ${actual[field]} (tolerance ${tolerance}px)`);
}

function assertOfferGeometryParity(measurements, description) {
  assert.ok(measurements.length > 1, `${description} should include more than one geometry sample`);
  const baseline = measurements[0];
  for (const [index, measurement] of measurements.entries()) {
    for (const field of ['top', 'bottom', 'height', 'width']) assertRectClose(measurement.dialog, baseline.dialog, field, `${description} dialog sample ${index + 1}`);
    for (const field of ['top', 'bottom']) assertRectClose(measurement.tabList, baseline.tabList, field, `${description} tab-list sample ${index + 1}`);
    for (const field of ['top', 'bottom']) assertRectClose(measurement.footer, baseline.footer, field, `${description} footer sample ${index + 1}`);
  }
}

async function assertOfferFooterLayout(description) {
  const report = await offerEditorGeometry();
  assert.ok(report.dialog && report.footer && report.save && report.cancel, `${description} should expose dialog footer actions`);
  assert.equal(report.footerParent, 'FORM', `${description} footer must stay outside the scroll panel but inside the form`);
  assert.equal(report.footerInsidePanel, false, `${description} footer must not be inside the scroll owner`);
  assert.ok(report.footerPaddingLeft >= 20 && report.footerPaddingRight >= 20, `${description} footer must provide meaningful horizontal inset: ${JSON.stringify(report)}`);
  assert.ok(report.footerPaddingBottom >= 12, `${description} footer must provide meaningful bottom inset: ${JSON.stringify(report)}`);
  assert.ok(report.save.right <= report.dialog.right - 18, `${description} Save Offer must have a right inset: ${JSON.stringify(report)}`);
  assert.ok(report.save.bottom <= report.dialog.bottom - 12, `${description} Save Offer must have a bottom inset: ${JSON.stringify(report)}`);
  for (const [label, action] of [['Save Offer', report.save], ['Cancel', report.cancel]]) {
    assert.ok(action.left >= report.dialog.left - 1 && action.right <= report.dialog.right + 1 && action.top >= report.dialog.top - 1 && action.bottom <= report.dialog.bottom + 1, `${description} ${label} must remain inside the dialog: ${JSON.stringify(report)}`);
  }
}

async function assertOfferTabLayout(description, expectedCount) {
  const report = await offerEditorGeometry();
  assert.equal(report.tabs.length, expectedCount, `${description} should expose ${expectedCount} visible tabs`);
  assert.ok(report.tabListScrollWidth <= report.tabListClientWidth + 1, `${description} tab list must not overflow horizontally: ${JSON.stringify(report)}`);
  assert.equal(report.tabListOverflowX, 'hidden', `${description} tab list must not own a horizontal scrollbar`);
  const heights = report.tabs.map(tab => tab.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `${description} tab heights must remain uniform: ${JSON.stringify(report)}`);
  for (const tab of report.tabs) {
    assert.ok(tab.rect.left >= report.tabList.left - 1 && tab.rect.right <= report.tabList.right + 1, `${description} ${tab.label} tab must fit inside the tab list: ${JSON.stringify(report)}`);
    assert.ok(tab.labelRect.left >= tab.rect.left - 1 && tab.labelRect.right <= tab.rect.right + 1, `${description} ${tab.label} label must not be clipped: ${JSON.stringify(report)}`);
    assert.ok(tab.scrollWidth <= tab.clientWidth + 1, `${description} ${tab.label} button content must not overflow: ${JSON.stringify(report)}`);
  }
}

async function assertBundlePriceControl() {
  const report = await evaluate(`() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="bundle-dialog-title"]');
    const control = dialog?.querySelector('[data-vbucks-price-control="true"]');
    const input = dialog?.querySelector('#bundle-price');
    const slider = dialog?.querySelector('#bundle-price-slider');
    const decrease = dialog?.querySelector('button[aria-label="Decrease Bundle price in V-Bucks"]');
    const rect = element => element ? (() => { const value = element.getBoundingClientRect(); return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; })() : null;
    const inputRect = input?.getBoundingClientRect();
    const centerElement = inputRect ? document.elementFromPoint(inputRect.left + inputRect.width / 2, inputRect.top + inputRect.height / 2) : null;
    return {
      dialog: rect(dialog),
      control: rect(control),
      input: rect(input),
      decrease: rect(decrease),
      labelFor: dialog?.querySelector('label[for="bundle-price"]')?.getAttribute('for') ?? null,
      sliderId: slider?.id ?? null,
      presetValues: [...(control?.querySelectorAll('button[data-vbucks-price-preset]') ?? [])].map(button => button.getAttribute('data-vbucks-price-preset')),
      inputValue: input?.value ?? null,
      centerElement: centerElement?.tagName ?? null,
    };
  }`);
  assert.ok(report.dialog && report.control && report.input && report.decrease, `bundle price control should expose its complete geometry: ${JSON.stringify(report)}`);
  assert.equal(report.labelFor, 'bundle-price', 'bundle price label must explicitly target the numeric input');
  assert.equal(report.sliderId, 'bundle-price-slider', 'bundle price control must expose its range slider');
  assert.ok(report.presetValues.includes('50') && report.presetValues.includes('5000'), `bundle price control must expose the canonical presets: ${JSON.stringify(report)}`);
  assert.ok(report.control.width >= report.dialog.width - 90, `bundle price control should use the full editor width: ${JSON.stringify(report)}`);
  assert.ok(report.decrease.right <= report.input.left + 1, `bundle minus hitbox must not overlap the numeric input: ${JSON.stringify(report)}`);
  assert.equal(report.centerElement, 'INPUT', `bundle numeric input center must remain pointer-addressable: ${JSON.stringify(report)}`);

  const initialValue = Number(report.inputValue);
  await physicalClick('() => document.querySelector(\'[role="dialog"][aria-labelledby="bundle-dialog-title"] button[aria-label="Decrease Bundle price in V-Bucks"]\')', 'the bundle price minus button');
  const decreased = await waitForExpression('() => Number(document.querySelector(\'#bundle-price\')?.value)', 'the decreased bundle price');
  assert.equal(decreased, Math.max(50, initialValue - 50), 'bundle minus pointer click must decrement exactly one V-Bucks step');
  await physicalClick('() => document.querySelector(\'[role="dialog"][aria-labelledby="bundle-dialog-title"] button[aria-label="Increase Bundle price in V-Bucks"]\')', 'the bundle price plus button');
  const restored = await waitForExpression('() => Number(document.querySelector(\'#bundle-price\')?.value) === ' + JSON.stringify(initialValue), 'the restored bundle price');
  assert.equal(restored, true, 'bundle price pointer test must restore the fixture value');
}

async function assertEntitlementDuplicate() {
  const beforeResponse = await request('/api/catalog/snapshot');
  assert.equal(beforeResponse.status, 200, `the duplicate acceptance should read the initial catalog: ${beforeResponse.text}`);
  const before = JSON.parse(beforeResponse.text);
  const target = before.catalog?.entitlements?.find(item => item.name === 'Builder Kit');
  assert.ok(target, 'the duplicate acceptance fixture should contain Builder Kit');
  const beforeCount = before.catalog.entitlements.length;
  const original = JSON.parse(JSON.stringify(target));
  const beforeIdentity = { id: original.id, verseKey: original.verseKey, publicIdentity: original.publicIdentity ?? null };
  await evaluate(`() => {
    window.__uemRendererTrace = [];
    window.__uemRendererErrors = [];
    window.addEventListener('error', event => window.__uemRendererErrors.push({ type: 'error', message: event.message }));
    window.addEventListener('unhandledrejection', event => window.__uemRendererErrors.push({ type: 'unhandledrejection', message: String(event.reason) }));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestValue = args[0];
      const url = typeof requestValue === 'string' ? requestValue : requestValue?.url ?? '';
      const init = args[1];
      const entry = url.includes('/api/') ? { url, method: init?.method ?? 'GET', requestBody: init?.body ?? null } : null;
      if (entry) window.__uemRendererTrace.push(entry);
      const response = await originalFetch(...args);
      if (entry) {
        entry.status = response.status;
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          entry.streaming = true;
        } else {
          entry.responseBody = await response.clone().text();
        }
      }
      return response;
    };
  }`);
  await physicalClick('() => document.querySelector(\'button[aria-label="Duplicate Builder Kit"]\')', 'the entitlement Duplicate button');

  let latest = before;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await wait(100);
    const response = await request('/api/catalog/snapshot');
    assert.equal(response.status, 200, `the duplicate acceptance should read the updated catalog: ${response.text}`);
    latest = JSON.parse(response.text);
    if (latest.catalog?.entitlements?.length === beforeCount + 1) break;
  }
  const renderer = await evaluate(`() => ({
    cards: [...document.querySelectorAll('article')].map(card => ({
      name: card.querySelector('h3')?.textContent?.trim() ?? '',
      duplicate: card.querySelector('button[aria-label^="Duplicate "]')?.getAttribute('aria-label') ?? '',
    })),
    status: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(element => element.textContent?.trim()).filter(Boolean),
    trace: window.__uemRendererTrace ?? [],
    errors: window.__uemRendererErrors ?? [],
  })`);
  assert.equal(latest.catalog?.entitlements?.length, beforeCount + 1, 'entitlement Duplicate must create exactly one new catalog record');
  const copies = latest.catalog.entitlements.filter(item => item.name === 'Builder Kit Copy');
  assert.equal(copies.length, 1, 'entitlement Duplicate must create exactly one copy card');
  const copy = copies[0];
  assert.notEqual(copy.id, original.id, 'the duplicate must receive a fresh id');
  assert.notEqual(copy.verseKey, original.verseKey, 'the duplicate must receive a fresh public Verse key');
  assert.deepEqual(copy.publicIdentity ?? null, null, 'a generic duplicate must not inherit a published public identity override');
  assert.deepEqual(latest.catalog.entitlements.find(item => item.id === original.id), original, 'the original entitlement must remain unchanged');
  const mutationEntries = renderer.trace.filter(entry => entry.url.includes('/api/catalog/mutate') && entry.method === 'POST');
  assert.equal(mutationEntries.length, 1, `Duplicate must make one awaited bridge mutation: ${JSON.stringify(renderer.trace)}`);
  const mutation = JSON.parse(mutationEntries[0].requestBody);
  assert.equal(mutation.operation?.type, 'create_entitlement');
  assert.equal(mutation.operation?.data?.name, 'Builder Kit Copy');
  const mutationData = mutation.operation?.data ?? {};
  for (const identityField of ['id', 'verseKey', 'publicIdentity']) assert.equal(identityField in mutationData, false, `duplicate payload must let the bridge allocate ${identityField}`);
  assert.equal(mutationEntries[0].status, 200, `Duplicate bridge mutation must succeed: ${mutationEntries[0].responseBody}`);
  assert.equal(renderer.errors.length, 0, `Duplicate must not create renderer errors: ${JSON.stringify(renderer.errors)}`);
  assert.ok(mutationEntries[0].responseBody?.includes('"catalog"'), 'the bridge mutation response must carry the returned catalog used to render the new card');
  const copyCardCount = await waitForExpression('() => [...document.querySelectorAll(\'article h3\')].filter(element => element.textContent?.trim() === \'Builder Kit Copy\').length', 'the returned duplicate card');
  assert.equal(copyCardCount, 1, 'the returned catalog must render exactly one new duplicate card');
  console.log('ENTITLEMENT_DUPLICATE_ACCEPTANCE', JSON.stringify({
    before: { count: beforeCount, identity: beforeIdentity },
    after: { count: latest.catalog.entitlements.length, identity: { id: copy.id, verseKey: copy.verseKey, publicIdentity: copy.publicIdentity ?? null } },
    mutation: { type: mutation.operation.type, status: mutationEntries[0].status },
    rendererTraceCount: renderer.trace.length,
  }));

  await physicalClick('() => document.querySelector(\'button[aria-label="Delete Builder Kit Copy"]\')', 'the duplicate cleanup Delete button');
  await waitForExpression('() => document.querySelector(\'[role="alertdialog"] button\')', 'the duplicate cleanup confirmation');
  await physicalClick('() => [...document.querySelectorAll(\'[role="alertdialog"] button\')].find(element => element.textContent?.trim() === \'Delete offer\')', 'the duplicate cleanup confirmation action');
  const cleanupDeadline = Date.now() + 5000;
  while (Date.now() < cleanupDeadline) {
    await wait(100);
    const response = await request('/api/catalog/snapshot');
    const cleaned = JSON.parse(response.text);
    if (cleaned.catalog?.entitlements?.length === beforeCount) break;
  }
  const cleanedResponse = await request('/api/catalog/snapshot');
  const cleaned = JSON.parse(cleanedResponse.text);
  assert.equal(cleaned.catalog?.entitlements?.length, beforeCount, 'duplicate acceptance cleanup must remove only the temporary copy');
  assert.deepEqual(cleaned.catalog.entitlements.find(item => item.id === original.id), original, 'duplicate cleanup must preserve the original entitlement');
}

async function assertTextFieldFocus(rootSelector, description) {
  windowRef.show();
  windowRef.focus();
  const report = await evaluate(`() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    const fields = root ? [...root.querySelectorAll('input.utm-native-field')] : [];
    return fields.map(element => {
      element.focus();
      const style = getComputedStyle(element);
      return { label: element.getAttribute('aria-label') || element.id || element.value, outlineStyle: style.outlineStyle, outlineOffset: style.outlineOffset, borderColor: style.borderColor, boxShadow: style.boxShadow, active: document.activeElement === element };
    });
  }`);
  windowRef.hide();
  assert.ok(report.length > 0, `${description} should expose shared text fields`);
  for (const field of report) {
    assert.equal(field.active, true, `${description} ${field.label} should receive focus`);
    assert.equal(field.outlineStyle, 'none', `${description} ${field.label} should not render a native outline`);
    assert.equal(field.outlineOffset, '0px', `${description} ${field.label} should not render an outline offset`);
    assert.doesNotMatch(field.borderColor, /245,\s*158,\s*11|234,\s*88,\s*12|255,\s*165,\s*0/i, `${description} ${field.label} should not use a yellow/orange focus border`);
    assert.notEqual(field.borderColor, 'rgb(71, 85, 105)', `${description} ${field.label} should use the canonical cyan focus border`);
    assert.equal(field.boxShadow, 'none', `${description} ${field.label} should not render a focus shadow`);
  }
}

async function setTextareaValue(selector, value) {
  const changed = await evaluate(`() => {
    const textarea = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!textarea || !setter) return false;
    setter.call(textarea, ${JSON.stringify(value)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }`);
  assert.equal(changed, true, `the ${selector} textarea should accept fixture content`);
  await wait(80);
}

async function setTextInputValue(selector, value) {
  const changed = await evaluate(`() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!input || !setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(value)};
  }`);
  assert.equal(changed, true, `the ${selector} input should accept fixture content`);
  await wait(80);
}

async function uploadRendererPng(inputSelectorSource, fileName) {
  const result = await evaluate(`() => {
    const input = (${inputSelectorSource})();
    if (!input || typeof DataTransfer === 'undefined') return null;
    const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(fileName)}, { type: 'image/png' }));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files);
    else Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    const assigned = { count: input.files?.length ?? 0, name: input.files?.[0]?.name ?? '' };
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return assigned;
  }`);
  assert.deepEqual(result, { count: 1, name: fileName }, 'the renderer must accept a PNG through the alternate icon file input');
  await wait(160);
}

async function waitForRendererTextureJob(pathname, description) {
  return waitForExpression(`() => {
    const trace = window.__uemRendererTrace ?? [];
    for (let index = trace.length - 1; index >= 0; index -= 1) {
      const entry = trace[index];
      if (entry.method !== 'POST' || entry.status !== 202 || !entry.responseBody) continue;
      try {
        if (new URL(entry.url, window.location.href).pathname !== ${JSON.stringify(pathname)}) continue;
        const body = JSON.parse(entry.responseBody);
        if (body.jobId) return body.jobId;
      } catch {
        // The fetch wrapper may still be recording the response body.
      }
    }
    return null;
  }`, description, 10000);
}

async function completeRendererTextureJob(jobId, assetName, sourceKind) {
  const claimedResponse = await editorRequest('/api/texture/import/next');
  assert.equal(claimedResponse.status, 200, `the renderer texture job should be claimable: ${claimedResponse.text}`);
  const claimed = JSON.parse(claimedResponse.text);
  assert.equal(claimed.job?.jobId, jobId, `the editor connector should claim the ${assetName} job exactly once`);
  assert.equal(claimed.job?.status, 'processing');
  if (sourceKind === 'uefn-texture') {
    const sourcePath = path.join(runtimeProjectRoot, 'Content', 'EntitlementIcons', 'AccessPass.png');
    fs.copyFileSync(sourcePath, claimed.job.sourcePath);
  }
  const completedResponse = await editorRequest(
    `/api/texture/import/${encodeURIComponent(jobId)}/result`,
    'POST',
    JSON.stringify({
      success: true,
      destinationPath: '/Showcase/EntitlementIcons',
      assetObjectPath: `/Showcase/EntitlementIcons/${assetName}.${assetName}`,
    }),
  );
  assert.equal(completedResponse.status, 200, `the editor connector should complete the ${assetName} job: ${completedResponse.text}`);
  const completed = JSON.parse(completedResponse.text);
  assert.equal(completed.status, 'completed', `the ${assetName} texture job should complete: ${completedResponse.text}`);
  const packagePath = path.join(runtimeProjectRoot, 'Content', 'EntitlementIcons', `${assetName}.uasset`);
  fs.writeFileSync(packagePath, 'showcase fixture native asset created by the verified editor connector');
  return completed;
}

async function assertTextareaPresentation(rootSelector = '[role="dialog"][aria-labelledby="entitlement-dialog-title"]', description = 'Offer Editor textareas', requireOverflow = true) {
  windowRef.show();
  windowRef.focus();
  const report = await evaluate(`() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    return root ? [...root.querySelectorAll('textarea')].map(textarea => {
      const shell = textarea.closest('.utm-native-textarea-shell');
      textarea.focus();
      const textareaStyle = getComputedStyle(textarea);
      const shellStyle = shell ? getComputedStyle(shell) : null;
      textarea.scrollTop = textarea.scrollHeight;
      return {
        label: textarea.getAttribute('aria-label') || textarea.id || 'textarea',
        scrollHeight: textarea.scrollHeight,
        clientHeight: textarea.clientHeight,
        scrollTop: textarea.scrollTop,
        scrollWidth: textarea.scrollWidth,
        clientWidth: textarea.clientWidth,
        resize: textareaStyle.resize,
        overflowX: textareaStyle.overflowX,
        overflowY: textareaStyle.overflowY,
        outlineStyle: textareaStyle.outlineStyle,
        boxShadow: textareaStyle.boxShadow,
        textareaBorderWidth: textareaStyle.borderTopWidth,
        shellOverflow: shellStyle?.overflow ?? '',
        shellRadius: shellStyle?.borderTopLeftRadius ?? '',
        shellBorderStyle: shellStyle?.borderTopStyle ?? '',
        shellBorderColor: shellStyle?.borderTopColor ?? '',
      };
    }) : [];
  }`);
  windowRef.hide();
  assert.ok(report.length > 0, `${description} should render at least one textarea inside a shell`);
  if (requireOverflow) assert.ok(report.some(item => item.scrollHeight > item.clientHeight && item.scrollTop > 0), `${description} should retain internal vertical scrolling for multiline content: ${JSON.stringify(report)}`);
  for (const item of report) {
    assert.ok(item.scrollWidth <= item.clientWidth + 1, `${description} ${item.label} should not overflow horizontally: ${JSON.stringify(item)}`);
    assert.equal(item.resize, 'none', `${description} ${item.label} should not expose a native resize grip: ${JSON.stringify(item)}`);
    assert.equal(item.overflowX, 'hidden', `${description} ${item.label} should clip horizontal overflow: ${JSON.stringify(item)}`);
    assert.equal(item.overflowY, 'auto', `${description} ${item.label} should retain vertical scrolling: ${JSON.stringify(item)}`);
    assert.equal(item.outlineStyle, 'none', `${description} ${item.label} should not render a native outline: ${JSON.stringify(item)}`);
    assert.equal(item.boxShadow, 'none', `${description} ${item.label} should not render a focus shadow: ${JSON.stringify(item)}`);
    assert.equal(item.textareaBorderWidth, '0px', `${description} ${item.label} textarea should not own the visible outer border: ${JSON.stringify(item)}`);
    assert.equal(item.shellOverflow, 'hidden', `${description} ${item.label} shell should clip its rounded boundary: ${JSON.stringify(item)}`);
    assert.notEqual(item.shellRadius, '0px', `${description} ${item.label} shell should retain rounded corners: ${JSON.stringify(item)}`);
    assert.equal(item.shellBorderStyle, 'solid', `${description} ${item.label} shell should own the visible border: ${JSON.stringify(item)}`);
    assert.notEqual(item.shellBorderColor, 'rgb(71, 85, 105)', `${description} ${item.label} shell should use the canonical cyan focus border: ${JSON.stringify(item)}`);
  }
}

async function assertSubtitleTypographyStable() {
  const readTypography = () => evaluate(`() => {
    const subtitle = [...document.querySelectorAll('[role="dialog"] p')].find(element => element.textContent?.trim() === 'Add the storefront details players will see.');
    if (!subtitle) return null;
    const style = getComputedStyle(subtitle);
    const rect = subtitle.getBoundingClientRect();
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, color: style.color, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  }`);
  const before = await readTypography();
  assert.ok(before, 'Offer Editor subtitle should render before Advanced is enabled');
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Advanced\')', 'the entitlement advanced controls');
  await waitForExpression('() => document.querySelector(\'[role="tablist"]\')?.querySelectorAll(\'[role="tab"]\').length === 4', 'the Advanced offer tabs');
  const after = await readTypography();
  assert.ok(after, 'Offer Editor subtitle should render after Advanced is enabled');
  for (const field of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'color']) assert.equal(after[field], before[field], `Offer Editor subtitle ${field} must not change when Advanced is toggled`);
  for (const field of ['left', 'top', 'width', 'height']) assertRectClose(after.rect, before.rect, field, `Offer Editor subtitle geometry ${field}`, 1);
}

async function assertStableOfferTabs() {
  const tabIds = ['offer-tab-general', 'offer-tab-icon', 'offer-tab-behavior', 'offer-tab-hooks'];
  const measurements = [];
  for (const tabId of tabIds) {
    await click(`() => document.getElementById(${JSON.stringify(tabId)})`, `${tabId} tab`);
    await waitForExpression(`() => document.getElementById(${JSON.stringify(tabId)})?.getAttribute('aria-selected') === 'true'`, `${tabId} selection`);
    measurements.push(await offerEditorGeometry());
  }
  assertOfferGeometryParity(measurements, 'Offer Editor tab switching');
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

  await assertEntitlementDuplicate();

  await click('() => document.querySelector(\'[aria-label="Edit Access Pass"]\')', 'the Access Pass editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the entitlement editor');
  assert.match(await evaluate('() => document.body.innerText'), /increments of 50/i);
  assert.doesNotMatch(await evaluate('() => document.body.innerText'), /step 50/i);
  await assertOfferTabLayout('Offer Editor Advanced off', 3);
  await assertOfferFooterLayout('Offer Editor footer');
  await assertTextFieldFocus('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', 'Offer Editor text focus');
  await setTextareaValue('#offer-full-description', Array.from({ length: 8 }, (_, index) => `Demo line ${index + 1}: readable player-facing entitlement details.`).join('\n'));
   await assertTextareaPresentation();
  await assertSubtitleTypographyStable();
  await assertOfferTabLayout('Offer Editor Advanced on', 4);
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 1', 'the normal restriction editor');
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  await selectCountry(0, 'JP');
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Add variant\')', 'an alternate offer editor');
  await waitForExpression('() => [...document.querySelectorAll(\'button\')].filter(element => (element.innerText ?? \'\').includes(\'Choose countries\')).length === 2', 'the alternate compact restriction editor');
  await selectCountry(1, 'CA');
  await selectCountry(1, 'US');
  await selectCountry(1, 'JP');
  const alternateId = await waitForExpression('() => document.querySelector(\'[data-alternate-icon-upload]\')?.getAttribute(\'data-alternate-icon-upload\')', 'the alternate icon editor identity');
  const alternateSelector = `[data-alternate-icon-upload="${alternateId}"]`;
  const alternateFileSelector = `${alternateSelector} input[type="file"]`;
  const alternateExpressionSelector = `${alternateSelector} input[type="text"]:not([aria-label="Existing UEFN Texture2D object path"])`;
  const alternateInitialState = await evaluate(`() => ({
    fileInput: Boolean(document.querySelector(${JSON.stringify(alternateFileSelector)})),
    adoptInput: Boolean(document.querySelector(${JSON.stringify(`${alternateSelector} input[aria-label="Existing UEFN Texture2D object path"]`)})),
    adoptButton: [...(document.querySelector(${JSON.stringify(alternateSelector)})?.querySelectorAll('button') ?? [])].some(element => element.textContent?.trim() === 'Adopt'),
    expression: document.querySelector(${JSON.stringify(alternateExpressionSelector)})?.value ?? '',
  })`);
  assert.equal(alternateInitialState.fileInput, true, 'alternate offers must expose the same PNG file import control as primary offers');
  assert.equal(alternateInitialState.adoptInput, true, 'alternate offers must expose existing Texture2D adoption');
  assert.equal(alternateInitialState.adoptButton, true, 'alternate offers must expose the existing Texture2D Adopt action');
  assert.ok(alternateInitialState.expression, 'alternate offers must retain their Verse texture expression before import');

  await uploadRendererPng(`() => document.querySelector(${JSON.stringify(alternateFileSelector)})`, 'alternate-upload.png');
  await waitForExpression(`() => document.querySelector(${JSON.stringify(alternateSelector)})?.innerText.includes('Awaiting confirmation')`, 'the alternate pending import preview');
  const pendingAlternateState = await evaluate(`() => ({
    expression: document.querySelector(${JSON.stringify(alternateExpressionSelector)})?.value ?? '',
    preview: document.querySelector(${JSON.stringify(alternateSelector)})?.querySelector('img[alt="Texture preview"]')?.getAttribute('src') ?? '',
  })`);
  assert.equal(pendingAlternateState.expression, alternateInitialState.expression, 'a transient alternate preview must not change the saved Verse texture expression');
  assert.match(pendingAlternateState.preview, /^data:image\//, 'the alternate upload must render an immediate transient preview');
  await physicalClick(`() => [...(document.querySelector(${JSON.stringify(alternateSelector)})?.querySelectorAll('button') ?? [])].find(element => element.textContent?.trim() === 'Cancel')`, 'the alternate pending import Cancel action');
  await waitForExpression(`() => !document.querySelector(${JSON.stringify(alternateSelector)})?.innerText.includes('Awaiting confirmation')`, 'the alternate transient import cancellation');
  const cancelledAlternateExpression = await evaluate(`() => document.querySelector(${JSON.stringify(alternateExpressionSelector)})?.value ?? ''`);
  assert.equal(cancelledAlternateExpression, alternateInitialState.expression, 'cancelling a transient alternate preview must preserve the original expression');

  await uploadRendererPng(`() => document.querySelector(${JSON.stringify(alternateFileSelector)})`, 'alternate-upload.png');
  await waitForExpression(`() => document.querySelector(${JSON.stringify(alternateSelector)})?.innerText.includes('Awaiting confirmation')`, 'the alternate confirmed-import preview');
  await physicalClick(`() => [...(document.querySelector(${JSON.stringify(alternateSelector)})?.querySelectorAll('button') ?? [])].find(element => element.textContent?.trim() === 'Confirm & import into UEFN')`, 'the alternate Confirm and import action');
  const alternateImportJob = await waitForRendererTextureJob('/api/texture/import', 'the alternate PNG import job');
  await completeRendererTextureJob(alternateImportJob, 'access_pass_alternate_1', 'local-image');
  await waitForExpression(`() => {
    const text = document.querySelector(${JSON.stringify(alternateSelector)})?.innerText ?? '';
    return text.includes('In Content Browser') && !text.includes('Awaiting confirmation');
  }`, 'the completed alternate PNG import');
  const importedAlternateState = await evaluate(`() => ({
    expression: document.querySelector(${JSON.stringify(alternateExpressionSelector)})?.value ?? '',
    preview: document.querySelector(${JSON.stringify(alternateSelector)})?.querySelector('img[alt="Texture preview"]')?.getAttribute('src') ?? '',
    status: document.querySelector(${JSON.stringify(alternateSelector)})?.innerText ?? '',
  })`);
  assert.equal(importedAlternateState.expression, 'EntitlementIcons.access_pass_alternate_1', 'completed alternate import must adopt the generated Verse texture expression');
  assert.match(importedAlternateState.preview, /^data:image\//, 'completed alternate import must retain its preview');
  assert.match(importedAlternateState.status, /In Content Browser/);

  const offerFlags = await selectedFlagReport();
  assert.equal(offerFlags.length, 6, 'normal and alternate restrictions should retain CA, US, and JP');
  assertFlagReports(offerFlags, 'normal and alternate restrictions');
  await assertSelectFocus();
   await assertTextFieldFocus('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', 'Offer Editor and alternate-offer text focus');
   await assertTextareaPresentation('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', 'Offer Editor and alternate-offer textareas');
  await assertDialogLayout('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await assertViewportMatrix('[role="dialog"][aria-labelledby="entitlement-dialog-title"]', '#offer-editor-panel', 'the entitlement editor');
  await assertOfferFooterLayout('Offer Editor footer after body scrolling');
  await assertStableOfferTabs();
  await physicalClick('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"] button[type="submit"]\')', 'the Access Pass Save Offer action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the saved Access Pass editor');
  await physicalClick('() => document.querySelector(\'button[aria-label="Save project"]\')', 'the project save action after alternate import');
  await waitForExpression('() => [...document.querySelectorAll(\'[role="status"]\')].some(element => (element.textContent ?? \'\').includes(\'Saved \') && (element.textContent ?? \'\').includes(\'managed_transactions.verse\'))', 'the project save confirmation for the alternate icon');
  await physicalClick('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Tools\')', 'the project Tools menu');
  await physicalClick(buttonByText('Reload from project', true), 'the project reload action after alternate save');
  await wait(150);
  const reloadNeedsConfirmation = await evaluate(`() => Boolean([...document.querySelectorAll('[role="alertdialog"] button')].find(element => element.textContent?.trim() === 'Discard changes and reload'))`);
  if (reloadNeedsConfirmation) await physicalClick(buttonByText('Discard changes and reload', true), 'the project reload discard confirmation');
  await waitForExpression('() => [...document.querySelectorAll(\'[role="status"]\')].some(element => (element.textContent ?? \'\').includes(\'Loaded 5 entitlements and 3 bundles\'))', 'the project reload confirmation');
  await click('() => document.querySelector(\'[aria-label="Edit Access Pass"]\')', 'the reloaded Access Pass editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the reloaded entitlement editor');
  await click('() => [...document.querySelectorAll(\'button\')].find(element => element.innerText?.trim() === \'Advanced\')', 'the reloaded advanced controls');
  await waitForExpression(`() => document.querySelector(${JSON.stringify(alternateSelector)})`, 'the reloaded alternate icon editor');
  const reloadedAlternateState = await evaluate(`() => ({
    expression: document.querySelector(${JSON.stringify(alternateExpressionSelector)})?.value ?? '',
    preview: document.querySelector(${JSON.stringify(alternateSelector)})?.querySelector('img[alt="Texture preview"]')?.getAttribute('src') ?? '',
    status: document.querySelector(${JSON.stringify(alternateSelector)})?.innerText ?? '',
  })`);
  assert.equal(reloadedAlternateState.expression, 'EntitlementIcons.access_pass_alternate_1', 'saved alternate imports must persist their Verse expression through reload');
  assert.match(reloadedAlternateState.preview, /^data:image\//, 'saved alternate imports must reload their persisted preview');
  assert.match(reloadedAlternateState.status, /In Content Browser/);
  const alternateAdoptionInput = `${alternateSelector} input[aria-label="Existing UEFN Texture2D object path"]`;
  await setTextInputValue(alternateAdoptionInput, '/Showcase/LegacyShopIcons/Vip.Vip');
  await physicalClick(`() => [...(document.querySelector(${JSON.stringify(alternateSelector)})?.querySelectorAll('button') ?? [])].find(element => element.textContent?.trim() === 'Adopt')`, 'the alternate existing Texture2D Adopt action');
  const alternateAdoptionJob = await waitForRendererTextureJob('/api/texture/adopt', 'the alternate Texture2D adoption job');
  await completeRendererTextureJob(alternateAdoptionJob, 'access_pass_alternate_1', 'uefn-texture');
  await waitForExpression(`() => document.querySelector(${JSON.stringify(alternateSelector)})?.innerText.includes('Adopted /Showcase/LegacyShopIcons/Vip.Vip')`, 'the completed alternate Texture2D adoption');
  await physicalClick('() => document.querySelector(\'[aria-label="Close offer editor"]\')', 'the reloaded entitlement editor close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\') && !document.querySelector(\'[role="alertdialog"]\')', 'the reloaded entitlement editor to close');

  await click('() => document.querySelector(\'[aria-label="Edit Starter Bundle"]\')', 'the Starter Bundle editor');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="bundle-dialog-title"]\')', 'the bundle editor');
  await assertBundlePriceControl();
  await selectCountry(0, 'CA');
  await selectCountry(0, 'US');
  await selectCountry(0, 'JP');
  const bundleFlags = await selectedFlagReport();
  assert.equal(bundleFlags.length, 3, 'bundle restrictions should retain CA, US, and JP');
  assertFlagReports(bundleFlags, 'bundle restrictions');
  await assertSelectFocus();
   await assertTextFieldFocus('[role="dialog"][aria-labelledby="bundle-dialog-title"]', 'Bundle Editor text focus');
   await assertTextareaPresentation('[role="dialog"][aria-labelledby="bundle-dialog-title"]', 'Bundle Editor textarea', false);
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
  await click('() => [...document.querySelectorAll(\'button[aria-expanded]\')].find(element => element.innerText?.trim() === \'Durable entitlement\')', 'the durable offer template');
  await click(buttonByText('Use this template', true), 'the creation template');
  await waitForExpression('() => document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the created offer editor');
  await assertOfferTabLayout('Create Offer initial step', 3);
  await assertOfferFooterLayout('Create Offer footer');
  await wait(300);
  const creationMeasurements = [await offerEditorGeometry()];
  const creationNextState = await evaluate(`() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="entitlement-dialog-title"]');
    const next = [...(dialog?.querySelectorAll('button') ?? [])].find(element => (element.innerText ?? '').trim().startsWith('Next'));
    return { disabled: next?.disabled ?? null, issues: [...(dialog?.querySelectorAll('[role="alert"], [role="status"]') ?? [])].map(element => element.innerText?.trim()).filter(Boolean) };
  }`);
  assert.equal(creationNextState.disabled, false, `Create Offer first Next action should be enabled for the configured template: ${JSON.stringify(creationNextState)}`);
  await click(buttonByText('Next'), 'the Create Offer next step');
  await waitForExpression('() => document.getElementById(\'offer-tab-icon\')?.getAttribute(\'aria-selected\') === \'true\'', 'the Create Offer icon step');
  creationMeasurements.push(await offerEditorGeometry());
  await click(buttonByText('Next'), 'the Create Offer final step');
  await waitForExpression('() => document.getElementById(\'offer-tab-behavior\')?.getAttribute(\'aria-selected\') === \'true\'', 'the Create Offer behavior step');
  creationMeasurements.push(await offerEditorGeometry());
  assertOfferGeometryParity(creationMeasurements, 'Create Offer step switching');
  await click(buttonByText('Back', true), 'the Create Offer back action');
  await waitForExpression('() => document.getElementById(\'offer-tab-icon\')?.getAttribute(\'aria-selected\') === \'true\'', 'the Create Offer back navigation');
  await click('() => document.querySelector(\'[aria-label="Close offer editor"]\')', 'the created offer editor close action');
  await waitForExpression('() => !document.querySelector(\'[role="dialog"][aria-labelledby="entitlement-dialog-title"]\')', 'the created offer editor to close');

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
    try {
      await Promise.race([
        request('/api/session/shutdown', 'POST', '{}'),
        wait(3000).then(() => { throw new Error('The renderer test bridge shutdown exceeded its bounded cleanup window.'); }),
      ]);
    } catch { /* the bridge may already be stopping or unreachable */ }
    await Promise.race([
      new Promise(resolve => bridgeProcess.once('exit', resolve)),
      wait(3000),
    ]);
    if (bridgeProcess.exitCode === null) bridgeProcess.kill();
  }
  if (fakeEditorProcess && fakeEditorProcess.exitCode === null) fakeEditorProcess.kill();
  fs.rmSync(runtimeProjectRoot, { recursive: true, force: true });
}

async function main() {
  if (!fs.existsSync(path.join(applicationRoot, 'dist', 'index.html'))) throw new Error(`The renderer build is missing from ${applicationRoot}.`);
  fs.rmSync(runtimeProjectRoot, { recursive: true, force: true });
  await createShowcaseFixture();
  if (!fs.existsSync(showcaseProjectFile)) throw new Error(`The deterministic showcase fixture was not created at ${showcaseProjectFile}.`);

  bridgePort = await reservePort();
  // This is a disposable connector identity for renderer-only acceptance. It
  // is deliberately not a UEFN process and never opens or manipulates an
  // editor session.
  fakeEditorProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 600000)'], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
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
      LOCALAPPDATA: path.join(runtimeProjectRoot, 'LocalAppData'),
      UEM_PROJECT_PYTHON_ENABLED: '1',
      UEM_AUTO_CONNECTOR_INSTALLED: '0',
      UEM_UEFN_PROCESS_ID: String(fakeEditorProcess.pid),
      UEM_TEST_MODE: '1',
      UEM_TEST_NO_GLOBAL_UEFN_PROBE: '1',
      UEM_IDLE_TIMEOUT_MS: '600000',
    },
  });
  bridgeProcess.stdout.on('data', data => { bridgeStdout = `${bridgeStdout}${data}`.slice(-12000); });
  bridgeProcess.stderr.on('data', data => { bridgeStderr = `${bridgeStderr}${data}`.slice(-12000); });
  await waitForBridge();
  const editorSession = await editorRequest('/api/editor/session', 'POST', JSON.stringify({
    contentRoot: path.join(runtimeProjectRoot, 'Content'),
    assetMount: '/Showcase',
    projectFile: showcaseProjectFile,
    projectReady: true,
    processId: fakeEditorProcess.pid,
    readinessReason: 'renderer-acceptance-fixture',
  }));
  assert.equal(editorSession.status, 200, `the renderer acceptance connector session should be accepted: ${editorSession.text}`);
  const editorStatus = JSON.parse((await request('/api/editor/status')).text);
  assert.equal(editorStatus.freshExactConnector, true, `the renderer acceptance connector must be exact and fresh: ${JSON.stringify(editorStatus)}`);
  assert.equal(editorStatus.editorConnected, true, `the renderer acceptance connector must be ready: ${JSON.stringify(editorStatus)}`);

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
    // This is a bounded verification process, not the interactive manager.
    // Force the Electron host to terminate after cleanup so packaged callers
    // cannot retain a hidden parent process after a passing probe.
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    await cleanup();
    app.exit(1);
  }
});
