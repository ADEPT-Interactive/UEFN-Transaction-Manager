import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readProject } from '../electron/projectDiscovery.js';
import { isAllowedNavigation, isHttpExternal } from '../electron/security.js';

test('Electron navigation stays on the exact launcher or authenticated loopback origin', () => {
  const launcher = 'uem-launcher://app/index.html';
  assert.equal(isAllowedNavigation('launcher', launcher, launcher, null), true);
  assert.equal(isAllowedNavigation('launcher', 'uem-launcher://app/launcher.js', launcher, null), false);
  assert.equal(isAllowedNavigation('launcher', 'https://example.com/', launcher, null), false);
  assert.equal(isAllowedNavigation('dashboard', 'http://127.0.0.1:48123/#token=secret', launcher, 'http://127.0.0.1:48123'), true);
  assert.equal(isAllowedNavigation('dashboard', 'http://127.0.0.1:48124/', launcher, 'http://127.0.0.1:48123'), false);
  assert.equal(isAllowedNavigation('dashboard', 'https://127.0.0.1:48123/', launcher, 'http://127.0.0.1:48123'), false);
  assert.equal(isAllowedNavigation('dashboard', 'file:///C:/Windows/System32/calc.exe', launcher, 'http://127.0.0.1:48123'), false);
});

test('external link allowlist accepts only absolute HTTP and HTTPS URLs', () => {
  assert.equal(isHttpExternal('https://adeptinteractive.net/path'), true);
  assert.equal(isHttpExternal('http://localhost:3000/path'), true);
  assert.equal(isHttpExternal('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isHttpExternal('javascript:alert(1)'), false);
  assert.equal(isHttpExternal('not a URL'), false);
});

test('project selection resolves a real descriptor and verified Content root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-electron-project-'));
  try {
    const projectFile = path.join(root, 'PortableTest.uefnproject');
    const content = path.join(root, 'Plugins', 'PortableTest', 'Content');
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(projectFile, JSON.stringify({ title: 'Portable Test', plugins: [{ name: 'PortableTest', bIsRoot: true }], bEnablePythonForProject: true }));
    const candidate = readProject(projectFile, 'browse', false, undefined);
    assert.ok(candidate);
    assert.equal(candidate.name, 'Portable Test');
    assert.equal(candidate.assetMount, 'PortableTest');
    assert.equal(candidate.contentDirectory, fs.realpathSync.native(content));
    assert.equal(candidate.pythonEnabled, true);
    assert.equal(candidate.isActive, false);
    assert.equal(readProject(path.join(root, 'missing.uefnproject'), 'browse', false, undefined), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop source keeps the renderer sandboxed behind narrow IPC', () => {
  const main = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8');
  const preload = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webviewTag:\s*false/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.doesNotMatch(preload, /require\(['"]node:fs/);
  assert.doesNotMatch(preload, /shell:/);
  assert.doesNotMatch(preload, /:\s*ipcRenderer(?:\s*[,}])/);
});

test('desktop verification explicitly installs the locked Electron runtime', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { scripts?: Record<string, string> };
  assert.equal(packageJson.scripts?.['install:electron-runtime'], 'node node_modules/electron/install.js');
  assert.match(packageJson.scripts?.['test:desktop'] ?? '', /npm run install:electron-runtime/);
});
