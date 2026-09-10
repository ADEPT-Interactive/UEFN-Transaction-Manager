import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLauncherProtocolHandler } from '../electron/launcherProtocol.js';
import { isExpectedNavigationAbort, NavigationTransaction } from '../electron/navigation.js';

test('the launcher protocol returns known packaged assets as explicit responses', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-launcher-protocol-'));
  const htmlPath = path.join(root, 'launcher.html');
  const scriptPath = path.join(root, 'launcher.js');
  const iconPath = path.join(root, 'uem-icon.svg');
  const insigniaPath = path.join(root, 'adept-insignia.png');
  fs.writeFileSync(htmlPath, '<!doctype html><body>launcher</body>');
  fs.writeFileSync(scriptPath, 'window.__launcher = true;');
  fs.writeFileSync(iconPath, '<svg></svg>');
  fs.writeFileSync(insigniaPath, Buffer.from([137, 80, 78, 71]));
  const diagnostics: string[] = [];
  try {
    const handler = createLauncherProtocolHandler(new Map([
      ['/index.html', { path: htmlPath, type: 'text/html; charset=utf-8' }],
      ['/launcher.js', { path: scriptPath, type: 'text/javascript; charset=utf-8' }],
      ['/uem-icon.svg', { path: iconPath, type: 'image/svg+xml' }],
      ['/adept-insignia.png', { path: insigniaPath, type: 'image/png' }],
    ]), message => diagnostics.push(message), () => 4);
    const response = await handler({ url: 'uem-launcher://app/index.html' } as Request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('content-length'), String(fs.statSync(htmlPath).size));
    assert.equal(await response.text(), '<!doctype html><body>launcher</body>');
    assert.ok(diagnostics.some(message => message.includes('generation=4') && message.includes('status=200')));

    const scriptResponse = await handler({ url: 'uem-launcher://app/launcher.js' } as Request);
    assert.equal(scriptResponse.status, 200);
    assert.equal(scriptResponse.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await scriptResponse.text(), 'window.__launcher = true;');

    const iconResponse = await handler({ url: 'uem-launcher://app/uem-icon.svg' } as Request);
    assert.equal(iconResponse.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await iconResponse.text(), '<svg></svg>');
    const insigniaResponse = await handler({ url: 'uem-launcher://app/adept-insignia.png' } as Request);
    assert.equal(insigniaResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await insigniaResponse.arrayBuffer())], [137, 80, 78, 71]);

    const missingResponse = await handler({ url: 'uem-launcher://app/missing.svg' } as Request);
    assert.equal(missingResponse.status, 404);
    const wrongHostResponse = await handler({ url: 'uem-launcher://other/index.html' } as Request);
    assert.equal(wrongHostResponse.status, 404);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a protocol read failure is surfaced instead of converted into a successful response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-launcher-protocol-error-'));
  const directoryPath = path.join(root, 'not-a-file');
  fs.mkdirSync(directoryPath);
  const diagnostics: string[] = [];
  try {
    const handler = createLauncherProtocolHandler(new Map([
      ['/index.html', { path: directoryPath, type: 'text/html; charset=utf-8' }],
    ]), message => diagnostics.push(message));
    await assert.rejects(() => handler({ url: 'uem-launcher://app/index.html' } as Request));
    assert.ok(diagnostics.some(message => message.includes('Launcher protocol request failed')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ERR_FAILED is deferred only while an exact launcher destination is being proved', () => {
  const expected = { generation: 11, targetUrl: 'uem-launcher://app/index.html' };
  const transaction = new NavigationTransaction(expected);
  assert.equal(transaction.observeFailure({ code: -2, description: 'ERR_FAILED', url: expected.targetUrl }), true);
  assert.equal(transaction.isValidated, false);
  assert.match(transaction.failureAfterUnverifiedDestination().message, /-2 ERR_FAILED/);
  assert.equal(transaction.markDestinationValidated(expected.targetUrl), true);
  assert.equal(transaction.isValidated, true);
  assert.equal(transaction.observeFailure({ code: -2, url: 'http://127.0.0.1:3210/' }), false);
});

test('ERR_ABORTED is also deferred only until the exact launcher destination is validated', () => {
  const expected = { generation: 12, targetUrl: 'uem-launcher://app/index.html' };
  const transaction = new NavigationTransaction(expected);
  assert.equal(transaction.observeFailure({ code: -3, description: 'ERR_ABORTED', url: expected.targetUrl }), true);
  assert.equal(transaction.isValidated, false);
  assert.equal(transaction.markDestinationValidated(expected.targetUrl), true);
  assert.equal(transaction.isValidated, true);
});

test('unexpected navigation failures remain outside the controlled transaction', () => {
  const expected = { generation: 13, targetUrl: 'uem-launcher://app/index.html' };
  const transaction = new NavigationTransaction(expected);
  assert.equal(transaction.observeFailure({ code: -3, url: 'http://127.0.0.1:3210/' }), false);
  assert.equal(transaction.observeFailure({ code: -2, url: undefined }), false);
  assert.equal(isExpectedNavigationAbort({ expected: null, code: -3, url: expected.targetUrl }), false);
  assert.equal(isExpectedNavigationAbort({ expected, code: -2, url: expected.targetUrl }), false);
});
