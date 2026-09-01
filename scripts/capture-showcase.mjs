import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotRoot = process.env.UEM_SCREENSHOT_ROOT ? path.resolve(process.env.UEM_SCREENSHOT_ROOT) : path.join(root, 'docs', 'screenshots');
const cdpPort = 9222;
const showcaseStateRoot = path.join(os.tmpdir(), 'utm-4.3-showcase-state');
const names = [
  'launcher',
  'catalog-overview',
  'offer-editor',
  'dynamic-transactions',
  'icon-texture',
  'bundles-storefronts',
  'validation',
  'verse-integration',
  'agent-integration',
  'moderation-guidance',
];

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function freeLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') {
        listener.close();
        reject(new Error('Could not reserve a showcase MCP port.'));
        return;
      }
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.url = new URL(webSocketUrl);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(Number(this.url.port || 80), this.url.hostname);
      this.socket = socket;
      let handshake = Buffer.alloc(0);
      const key = crypto.randomBytes(16).toString('base64');
      socket.on('data', chunk => {
        if (!this.connected) {
          handshake = Buffer.concat([handshake, chunk]);
          const marker = handshake.indexOf('\r\n\r\n');
          if (marker < 0) return;
          const response = handshake.subarray(0, marker).toString('ascii');
          if (!response.startsWith('HTTP/1.1 101')) return reject(new Error(`CDP WebSocket handshake failed: ${response.split('\r\n')[0]}`));
          this.connected = true;
          this.buffer = handshake.subarray(marker + 4);
          this.parseFrames();
          resolve();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.parseFrames();
      });
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write([
          `GET ${this.url.pathname} HTTP/1.1`,
          `Host: ${this.url.hostname}:${this.url.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'));
      });
    });
  }

  parseFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wideLength = this.buffer.readBigUInt64BE(2);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CDP frame is too large to buffer safely.');
        length = Number(wideLength);
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if ((first & 0x0f) !== 1) continue;
      const message = JSON.parse(payload.toString('utf8'));
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
    }
  }

  sendFrame(payload) {
    const body = Buffer.from(payload);
    const mask = crypto.randomBytes(4);
    let header;
    if (body.length < 126) header = Buffer.from([0x81, 0x80 | body.length]);
    else if (body.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(body.length, 2);
    } else throw new Error('CDP command is unexpectedly large.');
    for (let index = 0; index < body.length; index += 1) body[index] ^= mask[index % 4];
    this.socket.write(Buffer.concat([header, mask, body]));
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, method });
      this.sendFrame(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Renderer evaluation failed.');
    return result.result?.value;
  }

  close() {
    this.socket?.end();
  }
}

async function getTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
      const target = targets.find(item => item.type === 'page');
      if (target) return target;
    } catch {
      // Electron is still starting.
    }
    await wait(250);
  }
  throw new Error('Electron did not expose a renderer debugging target.');
}

async function waitFor(cdp, expression, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await cdp.evaluate(expression)) return;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function clickText(cdp, text, selector = 'button') {
  const expression = `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => (element.innerText || element.textContent || '').trim().includes(${JSON.stringify(text)})); if (!target) throw new Error(${JSON.stringify(`Could not click ${text}.`)}); target.click(); })()`;
  await cdp.evaluate(expression);
}

async function clickAria(cdp, label) {
  const expression = `(() => { const target = [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!target) throw new Error(${JSON.stringify(`Could not click ${label}.`)}); target.click(); })()`;
  await cdp.evaluate(expression);
}

async function scrollToId(cdp, id) {
  const expression = `(() => { const target = document.getElementById(${JSON.stringify(id)}); if (!target) throw new Error(${JSON.stringify(`Could not scroll to ${id}.`)}); const root = document.scrollingElement || document.documentElement; const top = Math.max(0, target.getBoundingClientRect().top + root.scrollTop - 24); root.scrollTop = top; window.scrollTo(0, top); })()`;
  await cdp.evaluate(expression);
}

async function setViewport(cdp, width, height, deviceScaleFactor = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false, screenWidth: width, screenHeight: height });
  await wait(350);
}

async function capture(cdp, name, { width, height, selector, padding = 36, paddingX = padding, paddingY = padding } = {}) {
  await setViewport(cdp, width, height);
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (selector) {
    const rect = await cdp.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error(${JSON.stringify(`Could not capture ${selector}.`)}); const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`);
    const x = Math.max(0, rect.x - paddingX);
    const y = Math.max(0, rect.y - paddingY);
    const right = Math.min(width, rect.x + rect.width + paddingX);
    const bottom = Math.min(height, rect.y + rect.height + paddingY);
    params.clip = { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), scale: 1 };
  }
  const result = await cdp.send('Page.captureScreenshot', params);
  const target = path.join(screenshotRoot, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  console.log(`${name}: ${target}`);
}

async function verifyAgentModalLayout(cdp) {
  const sizes = [
    [1920, 1080, 1, '1920x1080'],
    [1366, 768, 1, 'short laptop'],
    [1180, 760, 1, 'non-maximized resize'],
    [1536, 864, 1.25, '125% scaling'],
    [1280, 720, 1.5, '150% scaling'],
  ];
  for (const [width, height, deviceScaleFactor, label] of sizes) {
    await setViewport(cdp, width, height, deviceScaleFactor);
    const metrics = await cdp.evaluate(`(() => {
      const dialog = document.querySelector('[aria-labelledby="agent-integration-title"]');
      const overlay = dialog?.parentElement;
      const chrome = document.querySelector('[data-app-chrome="true"]');
      const scrollArea = dialog?.children[1];
      const close = dialog?.querySelector('[aria-label="Close Agent Integration"]');
      if (!dialog || !overlay || !chrome || !scrollArea || !close) return null;
      const rect = dialog.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const chromeRect = chrome.getBoundingClientRect();
      const scrollRect = scrollArea.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      scrollArea.scrollTop = scrollArea.scrollHeight;
      const details = [...dialog.querySelectorAll('details')].slice(-2).map(element => {
        const detailRect = element.getBoundingClientRect();
        return detailRect.top >= scrollRect.top - 1 && detailRect.bottom <= scrollRect.bottom + 1;
      });
      scrollArea.scrollTop = 0;
      return {
        topGap: rect.top - chromeRect.bottom,
        bottomGap: window.innerHeight - rect.bottom,
        overlayTop: overlayRect.top,
        overlayBottom: window.innerHeight - overlayRect.bottom,
        closeReachable: closeRect.top >= rect.top && closeRect.bottom <= rect.bottom,
        contentScrolls: scrollArea.scrollHeight > scrollArea.clientHeight,
        bottomDetailsReachable: details.every(Boolean),
        bodyLocked: document.body.style.overflow === 'hidden',
      };
    })()`);
    if (!metrics) throw new Error(`Agent Integration layout could not be inspected at ${label}.`);
    if (metrics.topGap < 12 || metrics.bottomGap < 12 || metrics.overlayTop < 0 || metrics.overlayBottom < 0 || !metrics.closeReachable || !metrics.contentScrolls || !metrics.bottomDetailsReachable || !metrics.bodyLocked) {
      throw new Error(`Agent Integration layout failed at ${label}: ${JSON.stringify(metrics)}`);
    }
    console.log(`Agent Integration layout: ${label} passed (${JSON.stringify(metrics)}).`);
  }
}

let child;
let cdp;
try {
  const showcaseRuntimeRoot = path.join(root, 'docs', 'showcase', 'runtime');
  const fixtureRoot = path.join(showcaseRuntimeRoot, 'Creator Commerce Demo');
  fs.rmSync(showcaseRuntimeRoot, { recursive: true, force: true });
  const fixtureCommand = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm run showcase:fixture']]
    : ['npm', ['run', 'showcase:fixture']];
  const fixture = spawn(fixtureCommand[0], fixtureCommand[1], { cwd: root, env: { ...process.env, UEM_SHOWCASE_OUTPUT: fixtureRoot }, stdio: 'inherit' });
  await new Promise((resolve, reject) => { fixture.once('exit', code => code === 0 ? resolve() : reject(new Error(`Showcase fixture generation failed with exit code ${code}.`))); fixture.once('error', reject); });
  fs.rmSync(screenshotRoot, { recursive: true, force: true });
  fs.mkdirSync(screenshotRoot, { recursive: true });
  fs.rmSync(showcaseStateRoot, { recursive: true, force: true });
  fs.mkdirSync(showcaseStateRoot, { recursive: true });
  const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  child = spawn(electronPath, [`--remote-debugging-port=${cdpPort}`, '.'], {
    cwd: root,
    env: { ...process.env, LOCALAPPDATA: showcaseStateRoot, UEM_SHOWCASE_MODE: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', data => process.stderr.write(data));
  const target = await getTarget();
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await waitFor(cdp, "document.querySelector('[data-uem-launcher-ready]') && [...document.querySelectorAll('#projects .project')].some(element => (element.innerText || '').includes('Creator Commerce Demo'))", 'deterministic showcase launcher project');
  await capture(cdp, 'launcher', { width: 1100, height: 820 });

  await clickText(cdp, 'Creator Commerce Demo', '#projects .project');
  await clickText(cdp, 'Open project in Transaction Manager', '#continue');
  await waitFor(cdp, "document.querySelector('#root') && document.body.innerText.includes('This project is open and fully connected')", 'healthy showcase manager');
  // The bridge may finish the catalog load before the image elements have
  // committed. Give the renderer a short, deterministic hydration window;
  // the capture remains useful even when a local preview cache is unavailable.
  await wait(1500);
  const bridgeToken = await cdp.evaluate("sessionStorage.getItem('uem_bridge_token')");
  const showcaseMcpPort = await freeLoopbackPort();
  const agentConfigResult = await cdp.evaluate(`fetch('/api/agent-integration/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Token': ${JSON.stringify(bridgeToken)} }, body: JSON.stringify({ enabled: true, port: ${showcaseMcpPort} }) }).then(async response => ({ status: response.status, body: await response.json() }))`, true);
  if (!agentConfigResult?.body?.success || !agentConfigResult.body.status?.running) throw new Error(`Showcase UTM MCP did not start: ${JSON.stringify(agentConfigResult)}`);
  await waitFor(cdp, "document.body.innerText.includes('This project is open and fully connected')", 'healthy connected state');

  await capture(cdp, 'catalog-overview', { width: 1440, height: 980 });

  await clickAria(cdp, 'Edit Access Pass');
  await waitFor(cdp, "document.body.innerText.includes('General & Pricing')", 'offer editor');
  await capture(cdp, 'offer-editor', { width: 1200, height: 1100, selector: '[role="dialog"]', paddingX: 180, paddingY: 52 });
  await clickText(cdp, 'Icon & Texture');
  await capture(cdp, 'icon-texture', { width: 1120, height: 820, selector: '[role="dialog"]' });
  await clickText(cdp, 'Behavior & Moderation');
  await capture(cdp, 'moderation-guidance', { width: 1120, height: 820, selector: '[role="dialog"]' });
  await clickAria(cdp, 'Close offer editor');
  await wait(250);

  await clickAria(cdp, 'Edit Ember Coins');
  await waitFor(cdp, "document.body.innerText.includes('General & Pricing') && Boolean(document.querySelector('[aria-label=\"Offer price behavior\"]'))", 'dynamic transaction editor');
  await capture(cdp, 'dynamic-transactions', { width: 1200, height: 1100, selector: '[role="dialog"]', paddingX: 180, paddingY: 52 });
  await clickAria(cdp, 'Close offer editor');
  await wait(250);

  await cdp.evaluate('window.scrollTo(0, 0)');
  await clickText(cdp, 'No Issues');
  await waitFor(cdp, "Boolean(document.querySelector('[aria-label=\"Close validation report\"]'))", 'validation report');
  await capture(cdp, 'validation', { width: 1100, height: 820, selector: '[role="dialog"]' });
  await clickAria(cdp, 'Close validation report');
  await wait(250);

  await scrollToId(cdp, 'bundle-heading');
  await capture(cdp, 'bundles-storefronts', { width: 1440, height: 980 });
  await cdp.evaluate('window.scrollTo(0, 0)');
  await clickText(cdp, 'Catalog + Verse');
  await wait(350);
  await capture(cdp, 'verse-integration', { width: 1440, height: 1000 });

  await clickText(cdp, 'Catalog');
  await wait(250);
  await clickText(cdp, 'Tools');
  await clickText(cdp, 'Agent Integration');
  await waitFor(cdp, "Boolean(document.querySelector('[aria-labelledby=\"agent-integration-title\"]'))", 'Agent Integration panel');
  await waitFor(cdp, "document.body.innerText.toLowerCase().includes('running')", 'running UTM MCP status');
  await verifyAgentModalLayout(cdp);
  await capture(cdp, 'agent-integration', { width: 1200, height: 1100, selector: '[aria-labelledby="agent-integration-title"]', paddingX: 160, paddingY: 40 });
  console.log(`Captured ${names.length} cursor-free PNG showcase views.`);
} finally {
  cdp?.close();
  if (child && child.exitCode === null) child.kill();
}
