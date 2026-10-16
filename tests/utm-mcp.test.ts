import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CatalogSession, defaultProjectConfig } from '../src/services/catalogSession';
import { UTMcpHost } from '../server/utmMcp';
import {
  FLASHLIGHT_TAG_IDENTITY_OPERATIONS,
  FLASHLIGHT_TAG_MODULE_CONFIGURATION,
  FLASHLIGHT_TAG_PARITY,
  flashlightTagCatalog,
} from './fixtures/flashlight-tag-identity-fixture';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 19101));
    });
  });
}

function makeCatalog() {
  const config = defaultProjectConfig('C:/Demo/Content');
  return new CatalogSession({ config, entitlements: [], bundles: [], storefrontMembership: { allOffers: [], focused: [] }, retiredVerseKeys: [], projectDataDiagnostics: [] });
}

async function mcpJson(response: Response): Promise<any> {
  const text = await response.text();
  try { return JSON.parse(text); } catch {
    const dataLine = text.split(/\r?\n/).find(line => line.startsWith('data: '));
    if (!dataLine) throw new Error(`MCP response was not JSON: ${text}`);
    return JSON.parse(dataLine.slice(6));
  }
}

function requestWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: host, 'Content-Type': 'application/json', 'Content-Length': '0' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

test('UTM MCP uses unauthenticated local Streamable HTTP with clear identity and tool surface', async () => {
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: { editorConnected: false }, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'b'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  try {
    const localNoAuth = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: `127.0.0.1:${port}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(localNoAuth.status, 200);
    assert.equal(await requestWithHost(port, `192.0.2.1:${port}`), 403);
    const badHost = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'http://evil.example' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(badHost.status, 403);
    const initialize = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: `127.0.0.1:${port}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const initialized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
    assert.equal(initialized.status, 202);
    const listed = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    assert.equal(listed.status, 200);
    const listBody = await mcpJson(listed) as { result: { tools: Array<{ name: string }> } };
    const names = listBody.result.tools.map(tool => tool.name);
    assert.equal(names.length, 28);
    assert.ok(names.includes('preflight_operation'));
    assert.ok(names.includes('begin_activity'));
    assert.ok(names.includes('get_activity_status'));
    assert.ok(names.includes('get_catalog_snapshot'));
    assert.ok(names.includes('apply_catalog_patch'));
    assert.ok(names.includes('validate_migration_parity'));
    assert.ok(names.includes('adopt_icon'));
    assert.ok(names.includes('save_catalog'));
    const snapshot = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_catalog_snapshot', arguments: {} } }) });
    assert.equal(snapshot.status, 200);
    assert.match(JSON.stringify(await mcpJson(snapshot)), /"revision":"1"/);
  } finally {
    await host.stop();
  }
});

test('UTM MCP is consumable through the official local Streamable HTTP client', async () => {
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'c'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const client = new Client({ name: 'phase29-test-client', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'utm-mcp');
    assert.equal(client.getServerVersion()?.version, '4.3.0');
    assert.equal(client.getServerVersion()?.title, 'UEFN Transaction Manager');
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 28);
    const snapshot = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(snapshot), /"revision":"1"/);
    const context = await client.callTool({ name: 'get_project_context', arguments: {} });
    assert.match(JSON.stringify(context), /"projectName":"Demo"/);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await host.stop();
  }
});

test('UTM MCP preserves the dashboard-side process when its configured port is unavailable', async () => {
  const port = await freePort();
  const makeHost = () => new UTMcpHost({
    version: '4.3.0',
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'd'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  const first = makeHost();
  const second = makeHost();
  await first.start(port);
  try {
    await assert.rejects(() => second.start(port));
    assert.equal(first.running, true);
  } finally {
    await second.stop();
    await first.stop();
  }
});

test('UTM MCP mutations enforce revisions and expose structured conflicts without partial writes', async () => {
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'e'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const client = new Client({ name: 'phase29-mutation-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  try {
    await client.connect(transport);
    const blockedWithoutPreflight = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Blocked Offer', shortDescription: 'Blocked offer', description: 'Blocked offer' } } });
    assert.equal(blockedWithoutPreflight.isError, true);
    assert.match(JSON.stringify(blockedWithoutPreflight), /preflightToken/);
    const unchanged = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(unchanged), /"revision":"1"/);
    assert.doesNotMatch(JSON.stringify(unchanged), /Blocked Offer/);
    await client.callTool({ name: 'get_project_context', arguments: {} });

    const preflight = await client.callTool({ name: 'preflight_operation', arguments: {
      operation: 'catalog-only-migration',
      mode: 'catalog-only',
      approval: { approved: true, confirmation: 'Synthetic test approval for catalog-only mutation.' },
    } });
    assert.equal(preflight.isError, undefined);
    const preflightPayload = JSON.parse((preflight.content?.[0] as { text: string }).text) as { ready: boolean; safeToMutate: boolean; preflightToken: string };
    assert.equal(preflightPayload.ready, true);
    assert.equal(preflightPayload.safeToMutate, true);
    assert.ok(preflightPayload.preflightToken);
    const activity = await client.callTool({ name: 'begin_activity', arguments: { operation: 'catalog-only-migration', mode: 'mutating', phase: 'Applying synthetic catalog mutation', preflightToken: preflightPayload.preflightToken } });
    assert.equal(activity.isError, undefined);
    const activityPayload = JSON.parse((activity.content?.[0] as { text: string }).text) as { activityId: string; activity: { label: string } };
    assert.equal(activityPayload.activity.label, 'Agent is modifying your UTM catalog');
    const mutationContext = { preflightToken: preflightPayload.preflightToken, activityId: activityPayload.activityId };
    const created = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Agent Offer', shortDescription: 'Agent offer', description: 'Agent offer' }, ...mutationContext } });
    assert.equal(created.isError, undefined);
    const conflict = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Stale Offer' }, ...mutationContext } });
    assert.equal(conflict.isError, true);
    assert.match(JSON.stringify(conflict), /CATALOG_REVISION_CONFLICT/);
    const snapshot = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(snapshot), /"revision":"2"/);
    assert.match(JSON.stringify(snapshot), /Agent Offer/);
    assert.doesNotMatch(JSON.stringify(snapshot), /Stale Offer/);
    const activityStatus = await client.callTool({ name: 'get_activity_status', arguments: {} });
    assert.match(JSON.stringify(activityStatus), /Agent is modifying your UTM catalog/);
    const ended = await client.callTool({ name: 'end_activity', arguments: { activityId: activityPayload.activityId, status: 'success', outcome: 'Synthetic mutation verified.' } });
    assert.equal(ended.isError, undefined);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await host.stop();
  }
});

test('full existing-project migration is a zero-mutation blocker when Unreal MCP is unavailable', async () => {
  const catalog = makeCatalog();
  const port = await freePort();
  let adoptCalls = 0;
  let saveCalls = 0;
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog,
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Flashlight Tag', projectFile: 'C:/UEFN/Flashlight Tag/Flashlight Tag.uefnproject', projectRoot: 'C:/UEFN/Flashlight Tag', contentRoot: 'C:/UEFN/Flashlight Tag/Content', assetMount: '/FlashlightTag', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: { editorConnected: true }, nativeTextureAdoptionAvailable: true, managedFileOwned: true, catalogInitialization: 'initialized' }),
    adoptIcon: async () => { adoptCalls += 1; return { success: false, error: 'not used' }; },
    saveCatalog: async () => { saveCalls += 1; return { success: true, contentHash: 'h'.repeat(64), fileName: 'managed_transactions.verse' }; },
  });
  const client = new Client({ name: 'flashlight-zero-mutation-test', version: '1.0.0' });
  try {
    await host.start(port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    await client.callTool({ name: 'get_project_context', arguments: {} });
    const preflight = await client.callTool({ name: 'preflight_operation', arguments: { operation: 'full-existing-project-migration' } });
    assert.equal(preflight.isError, true);
    const report = JSON.parse((preflight.content?.[0] as { text: string }).text) as { ready: boolean; safeToMutate: boolean; blockers: Array<{ code: string }> };
    assert.equal(report.ready, false);
    assert.equal(report.safeToMutate, false);
    assert.ok(report.blockers.some(blocker => blocker.code === 'UNREAL_MCP_UNAVAILABLE'));
    assert.equal('preflightToken' in report, false);

    const attemptedMutation = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Must Not Exist' } } });
    assert.equal(attemptedMutation.isError, true);
    assert.match(JSON.stringify(attemptedMutation), /preflightToken/);
    const attemptedPatch = await client.callTool({ name: 'apply_catalog_patch', arguments: { expectedRevision: '1', dryRun: false, operations: [{ type: 'create_entitlement', data: { name: 'Must Not Exist Either' } }] } });
    assert.equal(attemptedPatch.isError, true);
    assert.match(JSON.stringify(attemptedPatch), /OPERATION_PREFLIGHT_REQUIRED/);
    const attemptedSave = await client.callTool({ name: 'save_catalog', arguments: { expectedRevision: '1' } });
    assert.equal(attemptedSave.isError, true);
    assert.match(JSON.stringify(attemptedSave), /preflightToken/);
    const attemptedIcon = await client.callTool({ name: 'adopt_icon', arguments: { expectedRevision: '1', target: { kind: 'primary', id: 'missing' }, sourceAssetPath: '/FlashlightTag/EntitlementIcons/Icon.Icon' } });
    assert.equal(attemptedIcon.isError, true);
    assert.match(JSON.stringify(attemptedIcon), /preflightToken/);
    assert.equal(adoptCalls, 0);
    assert.equal(saveCalls, 0);
    const snapshot = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(snapshot), /"revision":"1"/);
    assert.doesNotMatch(JSON.stringify(snapshot), /Must Not Exist/);
    assert.doesNotMatch(JSON.stringify(snapshot), /Must Not Exist Either/);
  } finally {
    await client.close().catch(() => undefined);
    await host.stop();
  }
});

test('migration patches preserve unmatched existing UTM records unless deletion is authorized', async () => {
  const catalog = makeCatalog();
  const existing = catalog.mutate({ type: 'create_entitlement', data: { id: 'existing-utm', name: 'Existing UTM entitlement' } }, '1');
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog,
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'f'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  const client = new Client({ name: 'migration-policy-test', version: '1.0.0' });
  try {
    await host.start(port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const blocked = await client.callTool({ name: 'apply_catalog_patch', arguments: { expectedRevision: existing.snapshot.revision, dryRun: true, migration: { preserveUnmatchedExisting: true }, operations: [{ type: 'delete_entitlement', entitlementId: 'existing-utm' }] } });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /preserve existing UTM records/i);
    assert.equal(catalog.currentRevision, existing.snapshot.revision);
    assert.equal(catalog.snapshot().entitlements.some(item => item.id === 'existing-utm'), true);
  } finally {
    await client.close().catch(() => undefined);
    await host.stop();
  }
});

test('existing-project migration patches require a pre-apply parity table', async () => {
  const catalog = makeCatalog();
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.0',
    catalog,
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'g'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  const client = new Client({ name: 'migration-parity-required-test', version: '1.0.0' });
  try {
    await host.start(port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const blocked = await client.callTool({ name: 'apply_catalog_patch', arguments: {
      expectedRevision: '1', dryRun: true,
      migration: { mode: 'existing-project', preserveUnmatchedExisting: true },
      operations: [{ type: 'create_entitlement', data: { id: 'legacy-item', name: 'Legacy Item' } }],
    } });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /MIGRATION_PARITY_REQUIRED/);
    assert.equal(catalog.currentRevision, '1');
    const validation = await client.callTool({ name: 'validate_migration_parity', arguments: { entries: [] } });
    assert.equal(validation.isError, true);
    assert.match(JSON.stringify(validation), /one parity row/i);
  } finally {
    await client.close().catch(() => undefined);
    await host.stop();
  }
});

test('official UTM MCP client exposes Flashlight Tag identity parity and atomic adoption evidence', async () => {
  const port = await freePort();
  const host = new UTMcpHost({
    version: '4.3.7',
    catalog: new CatalogSession(flashlightTagCatalog()),
    getProjectContext: () => ({
      productVersion: '4.3.7',
      projectName: 'Flashlight Tag',
      projectFile: 'C:/fixture-projects/FlashlightTag01/FlashlightTag01.uefnproject',
      projectRoot: 'C:/fixture-projects/FlashlightTag01',
      contentRoot: 'C:/fixture-projects/FlashlightTag01/Plugins/FlashlightTag01/Content',
      assetMount: '/FlashlightTag01',
      targetManagedVerseFile: 'managed_transactions.verse',
      configuredIconFolder: 'EntitlementIcons',
      editorConnection: { editorConnected: true },
      nativeTextureAdoptionAvailable: true,
      managedFileOwned: true,
      catalogInitialization: 'initialized',
    }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'i'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  const client = new Client({ name: 'flashlight-identity-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  try {
    await host.start(port);
    await client.connect(transport);
    const context = await client.callTool({ name: 'get_project_context', arguments: {} });
    assert.match(JSON.stringify(context), /Flashlight Tag/);
    const parity = await client.callTool({ name: 'validate_migration_parity', arguments: { entries: FLASHLIGHT_TAG_PARITY, operations: FLASHLIGHT_TAG_IDENTITY_OPERATIONS } });
    assert.equal(parity.isError, undefined, JSON.stringify(parity));
    assert.match(JSON.stringify(parity), /"confirmed":true/);
    const patch = await client.callTool({ name: 'apply_catalog_patch', arguments: {
      expectedRevision: '1',
      dryRun: true,
      operations: FLASHLIGHT_TAG_IDENTITY_OPERATIONS,
      migration: { mode: 'existing-project', preserveUnmatchedExisting: true, parity: FLASHLIGHT_TAG_PARITY, moduleConfiguration: FLASHLIGHT_TAG_MODULE_CONFIGURATION },
    } });
    assert.equal(patch.isError, undefined, JSON.stringify(patch));
    const patchText = JSON.stringify(patch);
    assert.match(patchText, /CATALOG|identityEvidence/);
    assert.match(patchText, /"operationResults"/);
    assert.match(patchText, /"requested"/);
    assert.match(patchText, /"effective"/);
    const snapshot = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(snapshot), /"revision":"1"/);
    assert.match(JSON.stringify(snapshot), /premium_power_pass/);
    assert.doesNotMatch(JSON.stringify(snapshot), /"revision":"2"/);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await host.stop();
  }
});


test('a first-time client discovers and completes ordinary catalog work without Epic or migration approval', async () => {
  const port = await freePort();
  const catalog = makeCatalog();
  let saves = 0;
  let nativeCalls = 0;
  const host = new UTMcpHost({
    version: 'first-use-test', catalog,
    getProjectContext: () => ({ productVersion: 'first-use-test', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: { editorConnected: false }, nativeTextureAdoptionAvailable: false, managedFileOwned: true, catalogInitialization: 'initialized' }),
    adoptIcon: async () => { nativeCalls += 1; return { success: false, error: 'Epic must not be required for this operation' }; },
    saveCatalog: async () => { saves += 1; return { success: true, contentHash: 'a'.repeat(64), fileName: 'managed_transactions.verse' }; },
  });
  const client = new Client({ name: 'first-time-client', version: '1' });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
  };
  try {
    await host.start(port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    assert.match(client.getInstructions() ?? '', /describe_operation_contract/);
    const guide = await call('describe_operation_contract');
    const tools = await client.listTools();
    const preflightSchema = tools.tools.find(tool => tool.name === 'preflight_operation')!.inputSchema as { properties: { operation: { enum: string[] } } };
    assert.deepEqual(guide.operations.map((entry: { operation: string }) => entry.operation), preflightSchema.properties.operation.enum, 'the guide and live schema must agree');
    const edit = guide.operations.find((entry: { operation: string }) => entry.operation === 'catalog-edit');
    assert.deepEqual(edit.externalCapabilities, []);
    assert.deepEqual(edit.mutationDomains, ['catalog', 'save']);
    const discovery = await call('begin_activity', { operation: edit.operation, mode: 'read-only' });
    const context = await call('get_project_context');
    const original = await call('get_catalog_snapshot');
    const identity = { projectName: context.projectName, projectFile: context.projectFile, projectRoot: context.projectRoot, contentRoot: context.contentRoot, assetMount: context.assetMount };
    const preflight = await call('preflight_operation', { operation: edit.operation, requestedProject: identity });
    assert.equal(preflight.externalEvidence, 'not-required');
    await call('end_activity', { activityId: discovery.activityId, status: 'success' });
    const activity = await call('begin_activity', { operation: edit.operation, mode: 'mutating', preflightToken: preflight.preflightToken });
    const auth = { preflightToken: preflight.preflightToken, activityId: activity.activityId };
    await call('apply_catalog_patch', { operations: [{ type: 'create_entitlement', id: 'preview-pass', data: { name: 'Access Pass', shortDescription: 'Access', description: 'A test pass', itemType: 'durable', maxCount: 1, priceVBucks: 100 } }], migration: { mode: 'new-catalog' }, expectedRevision: original.revision, dryRun: true });
    assert.equal((await call('get_catalog_snapshot')).revision, original.revision, 'preview must not mutate');
    const created = await call('create_entitlement', { data: { name: 'Access Pass', shortDescription: 'Access', description: 'A test pass', itemType: 'durable', maxCount: 1, priceVBucks: 100 }, expectedRevision: original.revision, ...auth });
    const item = created.snapshot.entitlements[0];
    assert.ok(item.id && item.verseKey);
    assert.equal(created.snapshot.dirty, true);
    assert.equal(saves, 0, 'mutating a draft must not save');
    const updated = await call('update_entitlement', { entitlementId: item.id, data: { priceVBucks: 150 }, expectedRevision: created.snapshot.revision, ...auth });
    assert.equal(updated.snapshot.entitlements[0].id, item.id);
    assert.equal(updated.snapshot.entitlements[0].description, item.description);
    assert.equal(updated.snapshot.entitlements[0].priceVBucks, 150);
    await call('validate_catalog');
    await call('save_catalog', { expectedRevision: updated.snapshot.revision, ...auth });
    const saved = await call('get_catalog_snapshot');
    assert.equal(saved.dirty, false);
    assert.equal(saved.revision, saved.savedRevision);
    assert.equal(saves, 1);
    assert.equal(nativeCalls, 0);
    await call('end_activity', { activityId: activity.activityId, status: 'success' });
    assert.equal((await call('get_activity_status')).active, false, 'discovery must not be left active');
  } finally { await client.close().catch(() => {}); await host.stop(); }
});


test('ordinary catalog scope cannot bypass migration gates and approved partial migration needs no Epic server', async () => {
  const port = await freePort();
  const catalog = new CatalogSession(flashlightTagCatalog());
  let saves = 0;
  const host = new UTMcpHost({ version: 'scope-test', catalog,
    getProjectContext: () => ({ productVersion: 'scope-test', projectName: 'Flashlight Tag', projectFile: 'C:/fixture-projects/FlashlightTag01/FlashlightTag01.uefnproject', contentRoot: 'C:/fixture-projects/FlashlightTag01/Plugins/FlashlightTag01/Content', assetMount: '/FlashlightTag01', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false, managedFileOwned: true, catalogInitialization: 'initialized' }),
    adoptIcon: async () => { throw new Error('Partial migration must not adopt native icons'); },
    saveCatalog: async () => { saves += 1; return { success: true, contentHash: 'b'.repeat(64) }; },
  });
  const client = new Client({ name: 'partial-first-client', version: '1' });
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const payload = (result: Awaited<ReturnType<typeof call>>) => JSON.parse((result.content as Array<{ text: string }>)[0].text);
  try {
    await host.start(port); await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    await call('get_project_context');
    const before = payload(await call('get_catalog_snapshot'));
    const patch = { dryRun: false, expectedRevision: before.revision, operations: FLASHLIGHT_TAG_IDENTITY_OPERATIONS, migration: { mode: 'existing-project', parity: FLASHLIGHT_TAG_PARITY, moduleConfiguration: FLASHLIGHT_TAG_MODULE_CONFIGURATION } };
    const ordinary = payload(await call('preflight_operation', { operation: 'catalog-edit' }));
    const ordinaryActivity = payload(await call('begin_activity', { operation: 'catalog-edit', mode: 'mutating', preflightToken: ordinary.preflightToken }));
    const bypass = await call('apply_catalog_patch', { ...patch, preflightToken: ordinary.preflightToken, activityId: ordinaryActivity.activityId });
    assert.equal(bypass.isError, true);
    assert.match(JSON.stringify(bypass), /OPERATION_PREFLIGHT_SCOPE/);
    assert.deepEqual(payload(await call('get_catalog_snapshot')), before);
    await call('end_activity', { activityId: ordinaryActivity.activityId, status: 'cancelled' });
    const preflight = payload(await call('preflight_operation', { operation: 'catalog-only-migration', mode: 'catalog-only', approval: { approved: true, confirmation: 'User explicitly requested partial catalog import; external integration remains unverified.' } }));
    assert.equal(preflight.ready, true);
    assert.equal(preflight.externalEvidence, 'not-required');
    const activity = payload(await call('begin_activity', { operation: 'catalog-only-migration', mode: 'mutating', preflightToken: preflight.preflightToken }));
    const imported = await call('apply_catalog_patch', { ...patch, preflightToken: preflight.preflightToken, activityId: activity.activityId });
    assert.equal(imported.isError, undefined, JSON.stringify(imported));
    const snapshot = payload(imported).snapshot;
    const saved = await call('save_catalog', { expectedRevision: snapshot.revision, preflightToken: preflight.preflightToken, activityId: activity.activityId });
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    assert.equal(saves, 1);
    await call('end_activity', { activityId: activity.activityId, status: 'success' });
    const full = await call('preflight_operation', { operation: 'full-existing-project-migration' });
    assert.equal(full.isError, true);
    assert.match(JSON.stringify(full), /UNREAL_MCP_UNAVAILABLE/);
  } finally { await client.close().catch(() => {}); await host.stop(); }
});
