import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cdpPort = 9222;
const names = [
  'phase28-launcher',
  'phase28-catalog-overview',
  'phase28-offer-general-pricing',
  'phase28-icon-texture',
  'phase28-behavior-moderation',
  'phase28-dynamic-pricing',
  'phase28-bundles',
  'phase28-storefronts',
  'phase28-validation',
  'phase28-verse-split',
];

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await cdp.evaluate(expression)) return;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function clickText(cdp, text, selector = 'button') {
  const expression = `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => (element.innerText || element.textContent || '').trim().includes(${JSON.stringify(text)})); if (!target) throw new Error(${JSON.stringify(`Could not click ${text}.`)}); target.click(); })()`;
  const result = await cdp.send('Runtime.evaluate', { expression });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? `Could not click ${text}.`);
}

async function clickAria(cdp, label) {
  const expression = `(() => { const target = [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!target) throw new Error(${JSON.stringify(`Could not click ${label}.`)}); target.click(); })()`;
  const result = await cdp.send('Runtime.evaluate', { expression });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? `Could not click ${label}.`);
}

async function scrollToId(cdp, id) {
  const result = await cdp.send('Runtime.evaluate', { expression: `(() => { const target = document.getElementById(${JSON.stringify(id)}); if (!target) throw new Error(${JSON.stringify(`Could not scroll to ${id}.`)}); const root = document.scrollingElement || document.documentElement; const top = Math.max(0, target.getBoundingClientRect().top + root.scrollTop - 220); root.scrollTop = top; window.scrollTo(0, top); })()` });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? `Could not scroll to ${id}.`);
}

async function capture(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const target = path.join(root, 'docs', 'screenshots', `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  console.log(`${name}: ${target}`);
}

let child;
let cdp;
try {
  const fixtureRoot = path.join(root, 'docs', 'showcase', 'runtime', 'ADEPT-Transaction-Gallery');
  const fixtureCommand = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm run showcase:fixture']]
    : ['npm', ['run', 'showcase:fixture']];
  const fixture = spawn(fixtureCommand[0], fixtureCommand[1], { cwd: root, env: { ...process.env, UEM_SHOWCASE_OUTPUT: fixtureRoot }, stdio: 'inherit' });
  await new Promise((resolve, reject) => { fixture.once('exit', code => code === 0 ? resolve() : reject(new Error(`Showcase fixture generation failed with exit code ${code}.`))); fixture.once('error', reject); });
  fs.rmSync(path.join(root, 'docs', 'screenshots'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'docs', 'screenshots'), { recursive: true });
  const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  child = spawn(electronPath, [`--remote-debugging-port=${cdpPort}`, root], {
    cwd: root,
    env: { ...process.env, UEM_SHOWCASE_MODE: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', data => process.stderr.write(data));
  const target = await getTarget();
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await waitFor(cdp, "document.querySelector('[data-uem-launcher-ready]') && document.querySelectorAll('#projects .project').length >= 4", 'showcase launcher projects');
  await capture(cdp, 'phase28-launcher');
  await clickText(cdp, 'Open project in Transaction Manager', '#continue');
  await waitFor(cdp, "document.querySelector('#root') && document.body.innerText.includes('This project is open and fully connected')", 'healthy showcase manager');
  // Keep the manager captures tall enough to show complete cards and dialogs even
  // when the host desktop work area is shorter than the showcase composition.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1400, deviceScaleFactor: 1, mobile: false });
  await wait(2000);
  await capture(cdp, 'phase28-catalog-overview');
  await clickAria(cdp, 'Edit Access Pass');
  await waitFor(cdp, "document.body.innerText.includes('General & Pricing')", 'offer editor');
  await capture(cdp, 'phase28-offer-general-pricing');
  await clickText(cdp, 'Icon & Texture');
  await wait(250);
  await capture(cdp, 'phase28-icon-texture');
  await clickText(cdp, 'Behavior & Moderation');
  await wait(250);
  await capture(cdp, 'phase28-behavior-moderation');
  await clickAria(cdp, 'Close offer editor');
  await wait(250);
  await clickAria(cdp, 'Edit Ember Coins');
  await waitFor(cdp, "document.body.innerText.includes('General & Pricing') && Boolean(document.querySelector('[aria-label=\"Offer price behavior\"]'))", 'dynamic offer editor');
  await capture(cdp, 'phase28-dynamic-pricing');
  await clickAria(cdp, 'Close offer editor');
  await wait(250);
  await scrollToId(cdp, 'bundle-heading');
  await cdp.evaluate('const root = document.scrollingElement || document.documentElement; root.scrollTop += 48; window.scrollTo(0, root.scrollTop);');
  await wait(350);
  await capture(cdp, 'phase28-bundles');
  await clickAria(cdp, 'Edit Seasonal Store');
  await waitFor(cdp, "Boolean(document.querySelector('[aria-label=\"Close storefront editor\"]'))", 'storefront editor');
  await capture(cdp, 'phase28-storefronts');
  await clickAria(cdp, 'Close storefront editor');
  await wait(250);
  await cdp.evaluate('window.scrollTo(0, 0)');
  await clickText(cdp, 'Locally valid');
  await waitFor(cdp, "Boolean(document.querySelector('[aria-label=\"Close validation report\"]'))", 'validation report');
  await capture(cdp, 'phase28-validation');
  await clickAria(cdp, 'Close validation report');
  await wait(250);
  await clickText(cdp, 'Catalog + Verse');
  await cdp.evaluate('window.scrollTo(0, 0)');
  await wait(350);
  await capture(cdp, 'phase28-verse-split');
  console.log(`Captured ${names.length} cursor-free PNG showcase views.`);
} finally {
  cdp?.close();
  if (child && child.exitCode === null) child.kill();
}
