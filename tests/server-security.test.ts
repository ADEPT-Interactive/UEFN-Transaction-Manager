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
    env: { ...process.env, LOCALAPPDATA: path.join(root, 'LocalAppData'), PORT: String(port), UEM_SESSION_TOKEN: token, UEM_EDITOR_TOKEN: editorToken, UEM_CONTENT_ROOT: root, UEM_ASSET_MOUNT: '/SecurityTest', UEM_IDLE_TIMEOUT_MS: '60000' },
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
    const initialAgentStatus = await fetch(`${base}/api/agent-integration/status`, { headers: { 'X-UEM-Token': token } });
    const initialAgentBody = await initialAgentStatus.json() as { running: boolean; port: number; endpoint: string };
    assert.equal(typeof initialAgentBody.running, 'boolean');
    assert.equal(initialAgentBody.port, 8001);
    assert.equal(initialAgentBody.endpoint, 'http://127.0.0.1:8001/mcp');
    const mcpPort = await freePort();
    const configureAgent = await fetch(`${base}/api/agent-integration/config`, { method: 'POST', headers: auth, body: JSON.stringify({ port: mcpPort }) });
    assert.equal(configureAgent.status, 200);
    const configuredBody = await configureAgent.json() as { status: { running: boolean; port: number } };
    assert.equal(configuredBody.status.running, true);
    assert.equal(configuredBody.status.port, mcpPort);
    const mcpEndpoint = `http://127.0.0.1:${mcpPort}/mcp`;
    const mcpInitialize = await fetch(mcpEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'server-security-test', version: '1' } } }) });
    assert.equal(mcpInitialize.status, 200);
    const copiedConfig = await fetch(`${base}/api/agent-integration/copy-config`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(copiedConfig.status, 200);
    assert.deepEqual((await copiedConfig.json()).config.mcpServers['utm-mcp'], { type: 'http', url: mcpEndpoint });
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const traversal = await fetch(`${base}/api/verse/load`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: '..\\README.md' }) });
    assert.equal(traversal.status, 400);

    const reservedManagedSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', content: 'first', createBackup: true, expectedHash: null }) });
    assert.equal(reservedManagedSave.status, 409);
    const firstSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'manual.verse', content: 'first', createBackup: true, expectedHash: null }) });
    assert.equal(firstSave.status, 200);
    const firstHash = ((await firstSave.json()) as { contentHash: string }).contentHash;
    const secondSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'manual.verse', content: 'second', createBackup: true, expectedHash: firstHash }) });
    assert.equal(secondSave.status, 200);
    const secondHash = ((await secondSave.json()) as { contentHash: string }).contentHash;
    assert.equal(fs.readFileSync(path.join(root, 'manual.verse'), 'utf8'), 'second');
    assert.equal(fs.readdirSync(path.join(root, '.backups')).length, 1);

    const staleSave = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'manual.verse', content: 'lost update', createBackup: true, expectedHash: firstHash }) });
    assert.equal(staleSave.status, 409);
    assert.equal(fs.readFileSync(path.join(root, 'manual.verse'), 'utf8'), 'second');
    assert.equal(fs.readdirSync(path.join(root, '.backups')).length, 1);

    const compileWithoutEditorIdentity = await fetch(`${base}/api/verse/compile`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'managed_transactions.verse', expectedHash: secondHash }) });
    assert.equal(compileWithoutEditorIdentity.status, 409);
    const statusWithoutEditorIdentity = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    assert.equal(statusWithoutEditorIdentity.status, 200);
    assert.equal((await statusWithoutEditorIdentity.json()).editorConnected, false);
    const mismatchedEditorIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/AnotherProject', processId: process.pid }) });
    assert.equal(mismatchedEditorIdentity.status, 409);
    const wrongRoot = path.join(root, 'DifferentContent');
    fs.mkdirSync(wrongRoot);
    const wrongRootIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: wrongRoot, assetMount: '/SecurityTest', processId: process.pid }) });
    assert.equal(wrongRootIdentity.status, 409);
    const deadUefn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });
    deadUefn.kill();
    await new Promise<void>(resolve => deadUefn.once('exit', () => resolve()));
    const deadProcessIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/SecurityTest', processId: deadUefn.pid }) });
    assert.equal(deadProcessIdentity.status, 409);
    const matchingEditorIdentity = await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/SecurityTest', processId: process.pid }) });
    assert.equal(matchingEditorIdentity.status, 200);
    const statusWithEditorIdentity = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    const editorStateWithIdentity = await statusWithEditorIdentity.json() as { editorConnected: boolean; projectActive: boolean };
    assert.equal(editorStateWithIdentity.projectActive, true);
    assert.equal(editorStateWithIdentity.editorConnected, true);
    await new Promise(resolve => setTimeout(resolve, 5100));
    const staleEditorStatus = await fetch(`${base}/api/editor/status`, { headers: { 'X-UEM-Token': token } });
    const staleEditorState = await staleEditorStatus.json() as { editorConnected: boolean; projectActive: boolean };
    assert.equal(staleEditorState.projectActive, false);
    assert.equal(staleEditorState.editorConnected, false);
    assert.equal((await (await fetch(`${base}/api/editor/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot: root, assetMount: '/SecurityTest', processId: process.pid }) })).json()).success, true);

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

test('guided agent setup installs only the UTM skill, avoids environment inheritance, and records real MCP verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-agent-setup-'));
  const agentHome = path.join(root, 'agent-home');
  const port = await freePort();
  const mcpPort = await freePort();
  const localAppData = path.join(root, 'LocalAppData');
  const agentStateRoot = path.join(localAppData, 'UEFN Entitlement Manager');
  fs.mkdirSync(agentStateRoot, { recursive: true });
  fs.writeFileSync(path.join(agentStateRoot, 'agent-integration.json'), JSON.stringify({ enabled: true, port: mcpPort, token: 'legacy-state-that-must-be-ignored' }));
  const token = 'agent-setup-ui-token-'.padEnd(48, 'x');
  const editorToken = 'agent-setup-editor-token-'.padEnd(48, 'x');
  const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, LOCALAPPDATA: localAppData, UEM_AGENT_HOME: agentHome, PORT: String(port), UEM_SESSION_TOKEN: token, UEM_EDITOR_TOKEN: editorToken, UEM_CONTENT_ROOT: root, UEM_ASSET_MOUNT: '/AgentSetupTest', UEM_IDLE_TIMEOUT_MS: '60000' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Content-Type': 'application/json', 'X-UEM-Token': token };
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const initial = await (await fetch(`${base}/api/agent-integration/status`, { headers: auth })).json() as { skillInstallations: Array<{ id: string; installed: boolean }>; configuration: { available: boolean } };
    assert.equal(initial.skillInstallations.length, 3);
    assert.equal(initial.skillInstallations.every(item => !item.installed), true);
    assert.equal(initial.configuration.available, true);

    const setupResponse = await fetch(`${base}/api/agent-integration/setup`, { method: 'POST', headers: auth, body: JSON.stringify({ agent: 'codex' }) });
    assert.equal(setupResponse.status, 200);
    const setup = await setupResponse.json() as { config: { mcpServers: { 'utm-mcp': { type: string; url: string } } }; skill: { upToDate: boolean }; restartRequired: boolean; status: { running: boolean; configuration: { mode: string; restartRequired: boolean } } };
    assert.equal(setup.skill.upToDate, true);
    assert.equal(setup.status.running, true);
    assert.equal(setup.status.configuration.mode, 'loopback-url');
    assert.equal(setup.status.configuration.restartRequired, true);
    assert.equal(setup.restartRequired, true);
    assert.deepEqual(setup.config.mcpServers['utm-mcp'], { type: 'http', url: `http://127.0.0.1:${mcpPort}/mcp` });
    assert.ok(fs.existsSync(path.join(agentHome, '.agents', 'skills', 'uefn-transaction-manager', 'SKILL.md')));

    const mcpUrl = setup.status.running ? (await (await fetch(`${base}/api/agent-integration/status`, { headers: auth })).json() as { endpoint: string }).endpoint : '';
    const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const initialize = await fetch(mcpUrl, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'guided-setup-test', version: '1' } } }) });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const verified = await fetch(mcpUrl, { method: 'POST', headers: { ...mcpHeaders, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_project_context', arguments: {} } }) });
    assert.equal(verified.status, 200);
    const finalStatus = await (await fetch(`${base}/api/agent-integration/status`, { headers: auth })).json() as { clientConnection: { state: string; clientName?: string }; configuration: { restartRequired: boolean } };
    assert.equal(finalStatus.clientConnection.state, 'verified');
    assert.equal(finalStatus.clientConnection.clientName, 'guided-setup-test');
    assert.equal(finalStatus.configuration.restartRequired, false);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
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
    const saved = await fetch(`${base}/api/verse/save`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'manual.verse', content: '# standalone compile preflight', expectedHash: null }) });
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
    const compile = await fetch(`${base}/api/verse/compile`, { method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'manual.verse', expectedHash: contentHash }) });
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
    const closedState = await closedStatus.json() as { success: boolean; uefnRunning: boolean; editorConnected: boolean; projectActive: boolean; differentProjectOpen: boolean; openProjectFile?: string; pythonEnabled: boolean; autoConnectorInstalled: boolean; nativeTextureImportAvailable: boolean; bootstrapState: string };
    assert.equal(closedState.success, true);
    assert.equal(closedState.editorConnected, false);
    assert.equal(closedState.projectActive, false);
    assert.equal(closedState.differentProjectOpen, closedState.uefnRunning);
    assert.equal(closedState.openProjectFile, closedState.uefnRunning ? otherProjectFile.replace(/\\/g, '/') : undefined);
    assert.equal(closedState.pythonEnabled, false);
    assert.equal(closedState.autoConnectorInstalled, false);
    assert.equal(closedState.nativeTextureImportAvailable, false);
    assert.equal(closedState.bootstrapState, 'not-needed');
    await fetch(`${base}/api/session/shutdown`, { method: 'POST', headers: auth, body: '{}' });
  } finally {
    fakeUefn.kill();
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
