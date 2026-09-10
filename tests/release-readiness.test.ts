import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { CatalogDomainError, CatalogSession, defaultProjectConfig, type CatalogDocument } from '../src/services/catalogSession';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UTMcpHost } from '../server/utmMcp';

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The test UEFN process did not exit after termination.')), 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function freePort(): Promise<number> {
  const server = await import('node:net').then(({ createServer }) => createServer().listen(0, '127.0.0.1'));
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP port assigned.'));
      server.close(() => resolve(address.port));
    });
  });
}

function catalogDocument(root: string): CatalogDocument {
  return {
    config: defaultProjectConfig(root),
    entitlements: [{
      id: 'ent-1', verseKey: 'offer', name: 'Offer', shortDescription: 'Offer', description: 'Offer', priceVBucks: 100,
      itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.UTM_PlaceholderIcon',
      flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
      triggers: { generateTriggerBinding: true, generateButtonBinding: false },
    }],
    bundles: [],
    storefrontMembership: { allOffers: [{ entitlementId: 'ent-1' }], focused: [] },
    retiredVerseKeys: [],
    projectDataDiagnostics: [],
  };
}

interface BridgeHandle {
  root: string;
  contentRoot: string;
  projectFile: string;
  token: string;
  editorToken: string;
  base: string;
  fakeUefn: ChildProcess;
  server: ChildProcess;
  request: (route: string, init?: RequestInit) => Promise<{ status: number; body: any }>;
  connectEditor: () => Promise<{ status: number; body: any }>;
  setPythonEnabled: (enabled: boolean) => void;
  close: () => Promise<void>;
}

async function startBridge(options: { pythonEnabled: boolean; openedProject?: 'same' | 'different'; projectEvidence?: 'opened' | 'selected-only'; initialized?: boolean; assetPresent?: boolean }): Promise<BridgeHandle> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-release-readiness-'));
  const projectDirectory = path.join(root, 'ReadinessProject');
  const contentRoot = path.join(projectDirectory, 'Content');
  const projectFile = path.join(projectDirectory, 'ReadinessProject.uefnproject');
  const localAppData = path.join(root, 'LocalAppData');
  const logDirectory = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Logs');
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify({ fileVersion: 15, title: 'Readiness Project', plugins: [{ name: 'ReadinessProject', bIsRoot: true }], bEnablePythonForProject: options.pythonEnabled }));
  const openedProject = options.openedProject === 'different' ? path.join(root, 'OtherProject', 'OtherProject.uefnproject') : projectFile;
  const normalizedOpenedProject = openedProject.replace(/\\/g, '/');
  const projectLog = options.projectEvidence === 'selected-only'
    ? `[Test] LogValkyrieProjectBrowser: Selected Project (Direct): {\n  "path": "${normalizedOpenedProject}"\n}\n`
    : `[Test] LogValkyrieProjectBrowser: Selected Project (Direct): {\n  "path": "${normalizedOpenedProject}"\n}\nSuccessfully opened project '${normalizedOpenedProject}'\n`;
  fs.writeFileSync(path.join(logDirectory, 'UnrealEditorFortnite.log'), projectLog);
  if (options.initialized) {
    const document = catalogDocument(contentRoot);
    fs.writeFileSync(path.join(contentRoot, document.config.targetVerseFileName), generateVerseCode(document.entitlements, document.bundles, document.config, document.storefrontMembership, document.retiredVerseKeys));
    if (options.assetPresent) {
      fs.mkdirSync(path.join(contentRoot, 'EntitlementIcons'), { recursive: true });
      fs.writeFileSync(path.join(contentRoot, 'EntitlementIcons', 'UTM_PlaceholderIcon.uasset'), 'confirmed test package');
    }
  }
  const port = await freePort();
  const token = 'release-readiness-token-'.padEnd(48, 'x');
  const editorToken = 'release-readiness-editor-'.padEnd(48, 'x');
  const fakeUefn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });
  const server = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: { ...process.env, LOCALAPPDATA: localAppData, UEM_AGENT_HOME: path.join(root, 'agent-home'), PORT: String(port), UEM_SESSION_TOKEN: token, UEM_EDITOR_TOKEN: editorToken, UEM_CONTENT_ROOT: contentRoot, UEM_ASSET_MOUNT: '/ReadinessProject', UEM_PROJECT_FILE: projectFile, UEM_UEFN_PROCESS_ID: String(fakeUefn.pid), UEM_IDLE_TIMEOUT_MS: '60000' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${route}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-UEM-Token': token, ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* startup */ }
    await sleep(50);
  }
  const connectEditor = (projectReady = true) => request('/api/editor/session', { method: 'POST', headers: { 'X-UEM-Editor-Token': editorToken }, body: JSON.stringify({ contentRoot, assetMount: '/ReadinessProject', projectReady, processId: fakeUefn.pid }) });
  return {
    root, contentRoot, projectFile, token, editorToken, base, fakeUefn, server, request, connectEditor,
    setPythonEnabled: (enabled: boolean) => fs.writeFileSync(projectFile, JSON.stringify({ fileVersion: 15, title: 'Readiness Project', plugins: [{ name: 'ReadinessProject', bIsRoot: true }], bEnablePythonForProject: enabled })),
    close: async () => {
      fakeUefn.kill();
      server.kill();
      await sleep(100);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function openCatalog(bridge: BridgeHandle) {
  return bridge.request('/api/catalog/open', { method: 'POST', body: JSON.stringify({}) });
}

async function createOffer(bridge: BridgeHandle, revision: string) {
  return bridge.request('/api/catalog/mutate', { method: 'POST', body: JSON.stringify({ expectedRevision: revision, operation: { type: 'create_entitlement', data: { name: 'Readiness Offer', shortDescription: 'Readiness offer', description: 'Readiness offer for release checks' } } }) });
}

async function resolveImport(bridge: BridgeHandle, createPackage: boolean, outcome: 'success' | 'failure' = 'success'): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const next = await bridge.request('/api/texture/import/next', { headers: { 'X-UEM-Editor-Token': bridge.editorToken } });
    if (next.body.job) {
      const job = next.body.job as { jobId: string };
      const objectPath = '/ReadinessProject/EntitlementIcons/UTM_PlaceholderIcon.UTM_PlaceholderIcon';
      if (createPackage) {
        fs.mkdirSync(path.join(bridge.contentRoot, 'EntitlementIcons'), { recursive: true });
        fs.writeFileSync(path.join(bridge.contentRoot, 'EntitlementIcons', 'UTM_PlaceholderIcon.uasset'), 'confirmed test package');
      }
      await bridge.request(`/api/texture/import/${job.jobId}/result`, { method: 'POST', headers: { 'X-UEM-Editor-Token': bridge.editorToken }, body: JSON.stringify(outcome === 'success' ? { success: true, destinationPath: '/ReadinessProject/EntitlementIcons', assetObjectPath: objectPath } : { success: false, error: 'simulated UEFN import failure' }) });
      return;
    }
    await sleep(50);
  }
  throw new Error('The test editor bridge did not receive an import job.');
}

test('Case A: closed UEFN blocks first mutation without creating managed Verse', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    const opened = await openCatalog(bridge);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'PROJECT_NOT_READY');
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case A2: project-browser selection does not count as an open editor project', async () => {
  const bridge = await startBridge({ pythonEnabled: true, projectEvidence: 'selected-only' });
  try {
    const opened = await openCatalog(bridge);
    const editorStatus = await bridge.request('/api/editor/status');
    assert.equal(editorStatus.body.projectActive, false);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'PROJECT_NOT_READY');
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case A3: returning to the project browser revokes editor readiness but preserves identity', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const ready = await bridge.request('/api/editor/status');
    assert.equal(ready.body.editorConnected, true);
    assert.equal(ready.body.projectActive, true);
    await bridge.connectEditor(false);
    const browser = await bridge.request('/api/editor/status');
    assert.equal(browser.body.uefnRunning, true);
    assert.equal(browser.body.projectActive, true);
    assert.equal(browser.body.exactProjectOpen, true);
    assert.equal(browser.body.connectionState, 'project-readiness-waiting');
    assert.equal(browser.body.editorConnected, false);
    assert.equal(browser.body.nativeTextureImportAvailable, false);
  } finally { await bridge.close(); }
});

test('Case B: Python-disabled first setup is blocked before mutation', async () => {
  const bridge = await startBridge({ pythonEnabled: false });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const opened = await openCatalog(bridge);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    assert.equal(result.status, 409);
    assert.match(result.body.error, /Python Editor Scripting/i);
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case B2: Python enablement is detected without restarting the bridge', async () => {
  const bridge = await startBridge({ pythonEnabled: false });
  try {
    const before = await bridge.request('/api/editor/status');
    assert.equal(before.body.exactProjectOpen, true);
    assert.equal(before.body.projectActive, true);
    assert.equal(before.body.connectionState, 'python-required');
    bridge.setPythonEnabled(true);
    let after = await bridge.request('/api/editor/status');
    for (let attempt = 0; attempt < 10 && after.body.connectionState !== 'connector-waiting'; attempt += 1) {
      await sleep(25);
      after = await bridge.request('/api/editor/status');
    }
    assert.equal(after.body.pythonEnabled, true);
    assert.equal(after.body.connectionState, 'connector-waiting');
    assert.equal(after.body.exactProjectOpen, true);
    assert.equal(after.body.editorConnected, false);
  } finally { await bridge.close(); }
});

test('Case C: ready first setup provisions and confirms the exact placeholder before save', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const opened = await openCatalog(bridge);
    const worker = resolveImport(bridge, true);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    await worker;
    assert.equal(result.status, 200);
    assert.equal(result.body.catalog.entitlements[0].iconTexture, 'EntitlementIcons.UTM_PlaceholderIcon');
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
    const saved = await bridge.request('/api/catalog/save', { method: 'POST', body: JSON.stringify({ expectedRevision: result.body.catalog.revision }) });
    assert.equal(saved.status, 200);
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), true);
  } finally { await bridge.close(); }
});

test('Case D: a reported import without the exact package fails closed', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const opened = await openCatalog(bridge);
    const worker = resolveImport(bridge, false);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    await worker;
    assert.equal(result.status, 409);
    assert.match(result.body.error, /exact project asset package|Texture2D/i);
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case E: a different open project blocks first setup', async () => {
  const bridge = await startBridge({ pythonEnabled: true, openedProject: 'different' });
  try {
    const editorStatus = await bridge.request('/api/editor/status');
    assert.equal(editorStatus.body.projectActive, false);
    const opened = await openCatalog(bridge);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    assert.equal(result.status, 409);
    assert.match(result.body.error, /open the selected project|verified editor connector/i);
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case F: initialized projects can save catalog-only edits offline when assets exist', async () => {
  const bridge = await startBridge({ pythonEnabled: false, initialized: true, assetPresent: true });
  try {
    const opened = await openCatalog(bridge);
    const id = opened.body.catalog.entitlements[0].id;
    const mutated = await bridge.request('/api/catalog/mutate', { method: 'POST', body: JSON.stringify({ expectedRevision: opened.body.catalog.revision, operation: { type: 'update_entitlement', entitlementId: id, data: { name: 'Offline edit' } } }) });
    assert.equal(mutated.status, 200);
    const saved = await bridge.request('/api/catalog/save', { method: 'POST', body: JSON.stringify({ expectedRevision: mutated.body.catalog.revision }) });
    assert.equal(saved.status, 200);
  } finally { await bridge.close(); }
});

test('Case F2: healthy connected projects remain ordinary connected without runtime-readiness gating', async () => {
  const bridge = await startBridge({ pythonEnabled: true, initialized: true, assetPresent: true });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const editorStatus = await bridge.request('/api/editor/status');
    assert.equal(editorStatus.body.editorConnected, true);
    assert.equal(editorStatus.body.projectActive, true);
    assert.equal(Object.prototype.hasOwnProperty.call(editorStatus.body, 'transactionSetup'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(editorStatus.body, 'utmRuntimeReady'), false);

    const opened = await openCatalog(bridge);
    const id = opened.body.catalog.entitlements[0].id;
    const mutated = await bridge.request('/api/catalog/mutate', { method: 'POST', body: JSON.stringify({ expectedRevision: opened.body.catalog.revision, operation: { type: 'update_entitlement', entitlementId: id, data: { name: 'Connected edit' } } }) });
    assert.equal(mutated.status, 200);
  } finally { await bridge.close(); }
});

test('Case G: initialized projects with a missing referenced asset are blocked offline', async () => {
  const bridge = await startBridge({ pythonEnabled: false, initialized: true, assetPresent: false });
  try {
    const opened = await openCatalog(bridge);
    const id = opened.body.catalog.entitlements[0].id;
    const mutated = await bridge.request('/api/catalog/mutate', { method: 'POST', body: JSON.stringify({ expectedRevision: opened.body.catalog.revision, operation: { type: 'update_entitlement', entitlementId: id, data: { name: 'Must block' } } }) });
    assert.equal(mutated.status, 409);
    assert.match(mutated.body.error, /missing from the selected project|Texture2D/i);
  } finally { await bridge.close(); }
});

test('Case H: disconnect between mutation and first save leaves the managed file absent', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    assert.equal((await bridge.connectEditor()).status, 200);
    const opened = await openCatalog(bridge);
    const worker = resolveImport(bridge, true);
    const result = await createOffer(bridge, opened.body.catalog.revision);
    await worker;
    assert.equal(result.status, 200);
    bridge.fakeUefn.kill();
    await waitForProcessExit(bridge.fakeUefn);
    await sleep(1_000);
    const saved = await bridge.request('/api/catalog/save', { method: 'POST', body: JSON.stringify({ expectedRevision: result.body.catalog.revision }) });
    assert.equal(saved.status, 409);
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});

test('Case I: MCP mutation runs the same readiness preflight before changing the draft', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-mcp-readiness-'));
  const catalog = new CatalogSession(catalogDocument(root));
  let checks = 0;
  const host = new UTMcpHost({
    version: '4.3.0', catalog,
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Readiness', projectFile: '', contentRoot: root, assetMount: '/ReadinessProject', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false, managedFileOwned: true }),
    adoptIcon: async () => ({ success: false, error: 'unused' }),
    saveCatalog: async () => ({ success: false, error: 'unused' }),
    assertCatalogReady: async () => { checks += 1; throw new CatalogDomainError('PROJECT_NOT_READY', 'first setup is not ready'); },
  });
  const port = await freePort();
  const client = new Client({ name: 'readiness-test', version: '1.0.0' });
  try {
    await host.start(port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const result = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Blocked MCP offer' } } });
    assert.equal(result.isError, true);
    assert.equal(checks, 1);
    assert.equal(catalog.currentRevision, '1');
  } finally {
    await client.close().catch(() => undefined);
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Case J: migration/catalog replacement also requires first-run readiness', async () => {
  const bridge = await startBridge({ pythonEnabled: true });
  try {
    const opened = await openCatalog(bridge);
    const document = catalogDocument(bridge.contentRoot);
    const replacement = await bridge.request('/api/catalog/replace', { method: 'POST', body: JSON.stringify({ expectedRevision: opened.body.catalog.revision, catalog: document }) });
    assert.equal(replacement.status, 409);
    assert.equal(replacement.body.code, 'PROJECT_NOT_READY');
    assert.equal(fs.existsSync(path.join(bridge.contentRoot, 'managed_transactions.verse')), false);
  } finally { await bridge.close(); }
});
