import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { isPng, tokensEqual, validateIdentifier, validateVerseFileName } from '../server/security';

test('security primitives reject traversal, weak names, and fake PNGs', () => {
  assert.equal(validateVerseFileName('managed_transactions.verse'), 'managed_transactions.verse');
  assert.throws(() => validateVerseFileName('..\\README.md'));
  assert.throws(() => validateVerseFileName('nested/file.verse'));
  assert.throws(() => validateIdentifier('../icons', 'Folder'));
  assert.equal(tokensEqual('a'.repeat(48), 'a'.repeat(48)), true);
  assert.equal(tokensEqual('a'.repeat(48), 'b'.repeat(48)), false);
  assert.equal(isPng(Buffer.from('not a png')), false);
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP port assigned.'));
      server.close(() => resolve(address.port));
    });
  });
}

test('bridge requires its session and confines all Verse IO to the authorized root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-security-'));
  const port = await freePort();
  const token = 'test-token-'.padEnd(48, 'x');
  const editorToken = 'editor-token-'.padEnd(48, 'x');
  const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), UEM_SESSION_TOKEN: token, UEM_EDITOR_TOKEN: editorToken, UEM_CONTENT_ROOT: root, UEM_ASSET_MOUNT: '/SecurityTest', UEM_IDLE_TIMEOUT_MS: '60000' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Content-Type': 'application/json', 'X-UEM-Token': token };
  let leaseController: AbortController | undefined;

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const unauthorized = await fetch(`${base}/api/project/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    const foreignOrigin = await fetch(`${base}/api/project/scan`, { method: 'POST', headers: { ...auth, Origin: 'https://attacker.example' }, body: '{}' });
    assert.equal(foreignOrigin.status, 403);
    const traversal = await fetch(`${base}/api/verse/load`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: '..\\README.md' }) });
    assert.equal(traversal.status, 400);

    const firstSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', content: 'first', createBackup: true, expectedHash: null }) });
    assert.equal(firstSave.status, 200);
    const firstHash = ((await firstSave.json()) as { contentHash: string }).contentHash;
    const secondSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', content: 'second', createBackup: true, expectedHash: firstHash }) });
    assert.equal(secondSave.status, 200);
    const secondHash = ((await secondSave.json()) as { contentHash: string }).contentHash;
    assert.equal(fs.readFileSync(path.join(root, 'managed_transactions.verse'), 'utf8'), 'second');
    assert.equal(fs.readdirSync(path.join(root, '.backups')).length, 1);

    const staleSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', content: 'lost update', createBackup: true, expectedHash: firstHash }) });
    assert.equal(staleSave.status, 409);
    assert.equal(fs.readFileSync(path.join(root, 'managed_transactions.verse'), 'utf8'), 'second');
    assert.equal(fs.readdirSync(path.join(root, '.backups')).length, 1);

    const compileWithoutEditorIdentity = await fetch(`${base}/api/verse/compile`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', expectedHash: secondHash }) });
    assert.equal(compileWithoutEditorIdentity.status, 409);
    const statusWithoutEditorIdentity = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    assert.equal(statusWithoutEditorIdentity.status, 200);
    assert.equal((await statusWithoutEditorIdentity.json()).editorConnected, false);
    const mismatchedEditorIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/AnotherProject', processId: process.pid }) });
    assert.equal(mismatchedEditorIdentity.status, 409);
    const matchingEditorIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/SecurityTest', processId: process.pid }) });
    assert.equal(matchingEditorIdentity.status, 200);
    const statusWithEditorIdentity = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    assert.equal((await statusWithEditorIdentity.json()).editorConnected, true);

    leaseController = new AbortController();
    const leaseResponse = await fetch(`${base}/api/session/lease`, { headers: { 'X-UEM-Token': token }, signal: leaseController.signal });
    assert.equal(leaseResponse.status, 200);
    const leaseReader = leaseResponse.body?.getReader();
    assert.ok(leaseReader);
    await leaseReader.read();
    void leaseReader.read().catch(() => undefined);
    leaseController.abort();

    const form = new FormData();
    const validPng = await sharp({ create: { width: 3, height: 5, channels: 4, background: { r: 20, g: 180, b: 220, alpha: 1 } } }).png().toBuffer();
    form.append('image', new Blob([validPng], { type: 'image/png' }), 'VipPass.png');
    form.append('assetFolderName', 'EntitlementIcons');
    form.append('assetName', 'VipPass');
    const queued = await fetch(`${base}/api/texture/import`, { method: 'POST', headers: { 'X-UEM-Token': token }, body: form });
    assert.equal(queued.status, 202);
    const queuedBody = await queued.json() as { jobId: string; status: string };
    assert.equal(queuedBody.status, 'queued');
    assert.equal(fs.existsSync(path.join(root, 'EntitlementIcons', 'VipPass.png')), false);

    const browserCannotClaim = await fetch(`${base}/api/texture/import/next`, { headers: { 'X-UEM-Token': token } });
    assert.equal(browserCannotClaim.status, 401);
    const next = await fetch(`${base}/api/texture/import/next`, { headers: { 'X-UEM-Editor-Token': editorToken } });
    assert.equal(next.status, 200);
    const nextBody = await next.json() as { job: { jobId: string; status: string; sourcePath: string } };
    assert.equal(nextBody.job.jobId, queuedBody.jobId);
    assert.equal(nextBody.job.status, 'processing');
    assert.equal(fs.existsSync(nextBody.job.sourcePath), true);
    const importResult = await fetch(`${base}/api/texture/import/${queuedBody.jobId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ success: true, destinationPath: '/Project/EntitlementIcons', assetObjectPath: '/Project/EntitlementIcons/VipPass.VipPass' }) });
    assert.equal(importResult.status, 200);
    assert.equal((await importResult.json()).status, 'completed');
    const scan = await fetch(`${base}/api/project/scan`, { method: 'POST', headers: auth, body: JSON.stringify({ assetFolderName: 'EntitlementIcons' }) });
    assert.equal(scan.status, 200);
    assert.deepEqual((await scan.json()).iconPreviews, [{ assetFolderName: 'EntitlementIcons', assetName: 'VipPass', verseAssetPath: 'EntitlementIcons.VipPass', assetObjectPath: '/Project/EntitlementIcons/VipPass.VipPass' }]);
    const preview = await fetch(`${base}/api/project/icon-preview/EntitlementIcons/VipPass`, { headers: { 'X-UEM-Token': token } });
    assert.equal(preview.status, 200);
    const previewMetadata = await sharp(Buffer.from(await preview.arrayBuffer())).metadata();
    assert.equal(previewMetadata.width, 4);
    assert.equal(previewMetadata.height, 8);

    await fetch(`${base}/api/session/shutdown`, { method: 'POST', headers: auth, body: '{}' });
  } finally {
    leaseController?.abort();
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bridge exits after the browser lease closes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-lease-'));
  const port = await freePort();
  const token = 'lease-token-'.padEnd(48, 'x');
  const editorToken = 'lease-editor-'.padEnd(48, 'x');
  const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), UEM_SESSION_TOKEN: token, UEM_EDITOR_TOKEN: editorToken, UEM_CONTENT_ROOT: root, UEM_ASSET_MOUNT: '/LeaseTest', UEM_IDLE_TIMEOUT_MS: '60000' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const controller = new AbortController();

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const lease = await fetch(`${base}/api/session/lease`, { headers: { 'X-UEM-Token': token }, signal: controller.signal });
    assert.equal(lease.status, 200);
    const reader = lease.body!.getReader();
    await reader.read();
    const pendingRead = reader.read().catch(() => ({ done: true }));
    controller.abort();
    await pendingRead;

    const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
    const result = await Promise.race([exit, new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 8000))]);
    assert.notEqual(result, 'timeout');
  } finally {
    controller.abort();
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('standalone bridge verifies the active UEFN project without a Python editor session', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-active-project-'));
  const projectDirectory = path.join(tempRoot, 'StandaloneProject');
  const contentRoot = path.join(projectDirectory, 'Content');
  const localAppData = path.join(tempRoot, 'LocalAppData');
  const logDirectory = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Logs');
  const projectFile = path.join(projectDirectory, 'StandaloneProject.uefnproject');
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify({ fileVersion: 15, title: 'Standalone Project', plugins: [{ name: 'StandaloneProject', bIsRoot: true }] }));
  fs.writeFileSync(path.join(logDirectory, 'UnrealEditorFortnite.log'), `[Test] LogValkyrie: Display: Successfully opened project '${projectFile.replace(/\\/g, '/')}' (took 1 sec)\n`);

  const port = await freePort();
  const unavailableWorkflowPort = await freePort();
  const token = 'standalone-token-'.padEnd(48, 'x');
  const editorToken = 'standalone-editor-'.padEnd(48, 'x');
  const fakeUefn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });
  const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      PORT: String(port),
      UEM_SESSION_TOKEN: token,
      UEM_EDITOR_TOKEN: editorToken,
      UEM_CONTENT_ROOT: contentRoot,
      UEM_ASSET_MOUNT: '/StandaloneProject',
      UEM_PROJECT_FILE: projectFile,
      UEM_PROJECT_PYTHON_ENABLED: '0',
      UEM_UEFN_PROCESS_ID: String(fakeUefn.pid),
      UEM_VERSE_WORKFLOW_PORT: String(unavailableWorkflowPort),
      UEM_IDLE_TIMEOUT_MS: '60000',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Content-Type': 'application/json', 'X-UEM-Token': token };

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const saved = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', content: '# standalone compile preflight', expectedHash: null }) });
    assert.equal(saved.status, 200);
    const contentHash = ((await saved.json()) as { contentHash: string }).contentHash;
    const editorStatus = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    assert.deepEqual(await editorStatus.json(), {
      success: true,
      uefnRunning: true,
      editorConnected: false,
      projectActive: true,
      differentProjectOpen: false,
      openProjectFile: projectFile.replace(/\\/g, '/'),
      pythonEnabled: false,
      autoConnectorInstalled: false,
      nativeTextureImportAvailable: false,
      bootstrapState: 'not-needed',
    });
    const compile = await fetch(`${base}/api/verse/compile`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', expectedHash: contentHash }) });
    assert.equal(compile.status, 422);
    assert.match(String((await compile.json()).error), /workflow server/i);
    const otherProjectFile = path.join(tempRoot, 'OtherProject', 'OtherProject.uefnproject');
    fs.appendFileSync(path.join(logDirectory, 'UnrealEditorFortnite.log'), `[Test] LogValkyrie: Display: Successfully opened project '${otherProjectFile.replace(/\\/g, '/')}' (took 1 sec)\n`);
    const differentStatus = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    const differentState = await differentStatus.json() as { uefnRunning: boolean; projectActive: boolean; differentProjectOpen: boolean; openProjectFile: string };
    assert.equal(differentState.uefnRunning, true);
    assert.equal(differentState.projectActive, false);
    assert.equal(differentState.differentProjectOpen, true);
    assert.equal(differentState.openProjectFile, otherProjectFile.replace(/\\/g, '/'));
    fakeUefn.kill();
    await new Promise(resolve => fakeUefn.once('exit', resolve));
    await new Promise(resolve => setTimeout(resolve, 200));
    const closedStatus = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    assert.deepEqual(await closedStatus.json(), {
      success: true,
      uefnRunning: false,
      editorConnected: false,
      projectActive: false,
      differentProjectOpen: false,
      pythonEnabled: false,
      autoConnectorInstalled: false,
      nativeTextureImportAvailable: false,
      bootstrapState: 'not-needed',
    });
    await fetch(`${base}/api/session/shutdown`, { method: 'POST', headers: auth, body: '{}' });
  } finally {
    fakeUefn.kill();
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
