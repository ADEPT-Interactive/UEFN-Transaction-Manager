import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareSemver, plainReleaseNotes, shouldOfferUpdate } from '../src/services/update.js';
import { detectDistributionMode, readPortableMarker } from '../electron/distributionMode.js';
import { parsePortableUpdateManifest, portableUpdateUrl, verifyPortableDownload } from '../electron/portableUpdate.js';

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
