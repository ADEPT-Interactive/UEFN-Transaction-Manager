import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UpdateInfo } from 'electron-updater';
import { compareSemver, plainReleaseNotes, shouldOfferUpdate } from '../src/services/update.js';
import type { UpdateState } from '../src/services/update.js';
import { detectDistributionMode, readPortableMarker } from '../electron/distributionMode.js';
import { parsePortableUpdateManifest, portableUpdateUrl, verifyPortableDownload } from '../electron/portableUpdate.js';
import { UpdateManager, type UpdateManagerUpdater } from '../electron/updateManager.js';

test('semantic version comparison follows release and prerelease ordering', () => {
  assert.equal(compareSemver('4.0.0', '4.0.0'), 0);
  assert.equal(compareSemver('4.0.0', '4.0.1'), -1);
  assert.equal(compareSemver('4.0.0', '4.1.0'), -1);
  assert.equal(compareSemver('4.0.0', '5.0.0'), -1);
  assert.equal(compareSemver('4.0.0', '3.9.9'), 1);
  assert.equal(compareSemver('4.0.0-beta.2', '4.0.0-beta.10'), -1);
  assert.equal(compareSemver('4.0.0-rc.1', '4.0.0'), -1);
  assert.equal(compareSemver('4.0.0+build.1', '4.0.0+build.2'), 0);
  assert.throws(() => compareSemver('4.0', '4.0.0'), /Invalid semantic version/);
});

test('stable updater policy ignores drafts and prereleases', () => {
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.0' }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1' }), true);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '5.0.0' }), true);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '5.0.0-rc.1' }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1', isDraft: true }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1', isPrerelease: true }), false);
});

test('release notes are displayed as bounded plain text', () => {
  assert.equal(plainReleaseNotes('<h2>Fixes</h2><p>Safe <strong>notes</strong></p>'), 'FixesSafe notes');
  assert.equal(plainReleaseNotes([{ note: 'First' }, { note: 'Second' }]), 'First\n\nSecond');
  assert.equal(plainReleaseNotes('   '), undefined);
});

test('portable distribution is marker-driven and invalid markers fail closed to installed mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-distribution-test-'));
  const executable = path.join(root, 'UEFN Transaction Manager.exe');
  try {
    await fs.writeFile(executable, 'exe');
    assert.equal(detectDistributionMode(executable), 'installed');
    await fs.writeFile(path.join(root, 'portable.json'), JSON.stringify({ distribution: 'portable', version: '4.2.0', schemaVersion: 1, managedFiles: ['UEFN Transaction Manager.exe', 'portable.json'] }));
    assert.equal(detectDistributionMode(executable), 'portable');
    assert.equal(readPortableMarker(executable)?.version, '4.2.0');
    await fs.writeFile(path.join(root, 'portable.json'), '{"distribution":"portable","version":"4.2.0"}');
    assert.equal(detectDistributionMode(executable), 'installed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('portable manifest and archive verification reject wrong version, hash, marker, and unsafe path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-update-test-'));
  const archivePath = path.join(root, 'update.zip');
  try {
    const body = Buffer.from('verified portable archive fixture');
    await fs.writeFile(archivePath, body);
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const manifest = parsePortableUpdateManifest({ version: '4.2.1', filename: 'UEFN-Transaction-Manager-4.2.1-Portable.zip', sha256: digest, size: body.length });
    assert.equal(portableUpdateUrl('https://updates.adeptinteractive.net/uem/stable/', manifest), 'https://updates.adeptinteractive.net/uem/stable/UEFN-Transaction-Manager-4.2.1-Portable.zip');
    assert.throws(() => parsePortableUpdateManifest({ version: '4.2.1', filename: '../unsafe.zip', sha256: digest }), /unsafe|invalid/i);
    const inspected = { root, executablePath: path.join(root, 'UEFN Transaction Manager.exe'), marker: { distribution: 'portable' as const, version: '4.2.1', schemaVersion: 1 as const, managedFiles: ['portable.json'] }, files: ['portable.json'] };
    const verified = await verifyPortableDownload({ archivePath, manifest, extractTo: path.join(root, 'stage'), inspect: async () => inspected });
    assert.equal(verified.manifest.version, '4.2.1');
    await assert.rejects(() => verifyPortableDownload({ archivePath, manifest: { ...manifest, sha256: '0'.repeat(64) }, extractTo: path.join(root, 'bad'), inspect: async () => inspected }), /SHA-256/);
    await assert.rejects(() => verifyPortableDownload({ archivePath, manifest: { ...manifest, version: '4.2.2' }, extractTo: path.join(root, 'bad-version'), inspect: async () => inspected }), /version/);
    await assert.rejects(() => verifyPortableDownload({ archivePath, manifest, extractTo: path.join(root, 'bad-marker'), inspect: async () => ({ ...inspected, marker: { ...inspected.marker, managedFiles: [] } }) }), /marker|portable/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

type FakeCheckResult = { updateInfo: UpdateInfo } | null;

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  logger: unknown;
  forceDevUpdateConfig = false;
  checkCalls = 0;
  quitAndInstallCalls = 0;
  checkForUpdatesImpl: () => Promise<FakeCheckResult> = async () => null;
  downloadUpdateImpl: () => Promise<unknown> = async () => undefined;

  checkForUpdates(): Promise<FakeCheckResult> {
    this.checkCalls += 1;
    return this.checkForUpdatesImpl();
  }

  downloadUpdate(): Promise<unknown> {
    return this.downloadUpdateImpl();
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }
}

function releaseInfo(version: string): UpdateInfo {
  return { version, releaseName: `UEFN Transaction Manager ${version}`, releaseNotes: 'Updater regression fixture.' } as UpdateInfo;
}

function createInstalledManager(updater: FakeUpdater, currentVersion = '4.3.0') {
  const states: UpdateState[] = [];
  const diagnostics: string[] = [];
  const manager = new UpdateManager(
    currentVersion,
    true,
    'win32',
    'installed',
    os.tmpdir(),
    path.join(os.tmpdir(), 'UEFN Transaction Manager.exe'),
    state => states.push(state),
    message => diagnostics.push(message),
    updater as unknown as UpdateManagerUpdater,
  );
  manager.initialize();
  return { manager, states, diagnostics };
}

test('installed automatic discovery publishes available state and can continue to download', async () => {
  const updater = new FakeUpdater();
  const info = releaseInfo('4.3.1');
  updater.checkForUpdatesImpl = async () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    return { updateInfo: info };
  };
  const { manager, states } = createInstalledManager(updater);

  const discovered = await manager.check(false);
  assert.equal(discovered.status, 'available');
  assert.equal(manager.getState().status, 'available');
  assert.equal(manager.getState().availableVersion, '4.3.1');
  assert.deepEqual(states.map(state => state.status), ['checking', 'available']);

  updater.downloadUpdateImpl = async () => {
    updater.emit('download-progress', { percent: 42 });
    updater.emit('update-downloaded', info);
  };
  const downloaded = await manager.download();
  assert.deepEqual(downloaded, { success: true });
  assert.equal(manager.getState().status, 'downloaded');
  assert.deepEqual(states.map(state => state.status), ['checking', 'available', 'downloading', 'downloading', 'downloaded']);
});

test('manual installed discovery still publishes available state', async () => {
  const updater = new FakeUpdater();
  const info = releaseInfo('4.3.1');
  updater.checkForUpdatesImpl = async () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    return { updateInfo: info };
  };
  const { manager, states } = createInstalledManager(updater);

  const result = await manager.check(true);
  assert.equal(result.status, 'available');
  assert.deepEqual(states.map(state => state.status), ['checking', 'checking', 'available']);
});

test('automatic current-version checks settle quietly at idle while manual current checks are explicit', async () => {
  const info = releaseInfo('4.3.0');

  const automaticUpdater = new FakeUpdater();
  automaticUpdater.checkForUpdatesImpl = async () => {
    automaticUpdater.emit('checking-for-update');
    automaticUpdater.emit('update-not-available', info);
    return { updateInfo: info };
  };
  const automatic = createInstalledManager(automaticUpdater);
  const automaticResult = await automatic.manager.check(false);
  assert.equal(automaticResult.status, 'idle');
  assert.equal(automatic.manager.getState().status, 'idle');
  assert.deepEqual(automatic.states.map(state => state.status), ['checking', 'idle']);

  const manualUpdater = new FakeUpdater();
  manualUpdater.checkForUpdatesImpl = async () => {
    manualUpdater.emit('checking-for-update');
    manualUpdater.emit('update-not-available', info);
    return { updateInfo: info };
  };
  const manual = createInstalledManager(manualUpdater);
  const manualResult = await manual.manager.check(true);
  assert.equal(manualResult.status, 'up-to-date');
  assert.equal(manual.manager.getState().message, 'You are using the latest version, 4.3.0.');
  assert.deepEqual(manual.states.map(state => state.status), ['checking', 'checking', 'up-to-date']);
});

test('automatic failures return to idle and manual failures expose a useful error', async () => {
  const automaticUpdater = new FakeUpdater();
  automaticUpdater.checkForUpdatesImpl = async () => {
    automaticUpdater.emit('checking-for-update');
    throw new Error('synthetic network failure');
  };
  const automatic = createInstalledManager(automaticUpdater);
  const automaticResult = await automatic.manager.check(false);
  assert.equal(automaticResult.status, 'idle');
  assert.deepEqual(automatic.states.map(state => state.status), ['checking', 'idle']);
  assert.match(automatic.diagnostics.join('\n'), /synthetic network failure/);

  const manualUpdater = new FakeUpdater();
  manualUpdater.checkForUpdatesImpl = async () => {
    manualUpdater.emit('checking-for-update');
    throw new Error('synthetic manual network failure');
  };
  const manual = createInstalledManager(manualUpdater);
  const manualResult = await manual.manager.check(true);
  assert.equal(manualResult.status, 'error');
  assert.match(manualResult.message ?? '', /Could not check for updates/);
  assert.deepEqual(manual.states.map(state => state.status), ['checking', 'checking', 'error']);
});

test('repeated checks share the in-flight promise, clean it up, and dismissal remains manual-aware', async () => {
  const updater = new FakeUpdater();
  const info = releaseInfo('4.3.1');
  let resolveFirst!: (result: FakeCheckResult) => void;
  updater.checkForUpdatesImpl = () => {
    updater.emit('checking-for-update');
    if (updater.checkCalls === 1) return new Promise<FakeCheckResult>(resolve => { resolveFirst = resolve; });
    updater.emit('update-available', info);
    return Promise.resolve({ updateInfo: info });
  };
  const { manager } = createInstalledManager(updater);

  const first = manager.check(false);
  const second = manager.check(false);
  assert.equal(updater.checkCalls, 1);
  resolveFirst({ updateInfo: info });
  await Promise.all([first, second]);
  assert.equal(manager.getState().status, 'available');

  manager.dismiss();
  assert.equal(manager.getState().dismissed, true);
  const dismissed = await manager.check(false);
  assert.equal(dismissed.status, 'available');
  assert.equal(dismissed.dismissed, true);
  const manual = await manager.check(true);
  assert.equal(manual.status, 'available');
  assert.equal(manual.dismissed, false);
  assert.equal(updater.checkCalls, 3);
});

test('portable automatic discovery publishes available state instead of remaining invisible', async () => {
  const originalFetch = globalThis.fetch;
  const originalManifestUrl = process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL;
  const manifest = {
    version: '4.3.1',
    filename: 'UEFN-Transaction-Manager-4.3.1-Portable.zip',
    sha256: 'a'.repeat(64),
    size: 1,
    notes: 'Portable updater regression fixture.',
  };
  process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL = 'https://updates.example.test/uem/stable/portable-latest.json';
  globalThis.fetch = (async () => new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const updater = new FakeUpdater();
    const states: UpdateState[] = [];
    const manager = new UpdateManager(
      '4.3.0',
      true,
      'win32',
      'portable',
      os.tmpdir(),
      path.join(os.tmpdir(), 'UEFN Transaction Manager.exe'),
      state => states.push(state),
      () => undefined,
      updater as unknown as UpdateManagerUpdater,
    );
    const result = await manager.check(false);
    assert.equal(result.status, 'available');
    assert.equal(manager.getState().availableVersion, '4.3.1');
    assert.deepEqual(states.map(state => state.status), ['available']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalManifestUrl === undefined) delete process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL;
    else process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL = originalManifestUrl;
  }
});
