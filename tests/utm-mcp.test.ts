import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CatalogSession, defaultProjectConfig } from '../src/services/catalogSession';
import { UTMcpHost } from '../server/utmMcp';

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

function requestWithHost(port: number, host: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: host, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '0' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

test('UTM MCP uses authenticated Streamable HTTP with clear identity and tool surface', async () => {
  const port = await freePort();
  const token = 'test-token-'.padEnd(48, 'x');
  const host = new UTMcpHost({
    version: '4.3.0',
    token,
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: { editorConnected: false }, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'b'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  try {
    const unauthorized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: `127.0.0.1:${port}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(unauthorized.status, 401);
    assert.equal(await requestWithHost(port, `192.0.2.1:${port}`, token), 403);
    const badHost = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'http://evil.example', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(badHost.status, 403);
    const initialize = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId);
    const initialized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
    assert.equal(initialized.status, 202);
    const listed = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    assert.equal(listed.status, 200);
    const listBody = await mcpJson(listed) as { result: { tools: Array<{ name: string }> } };
    const names = listBody.result.tools.map(tool => tool.name);
    assert.equal(names.length, 20);
    assert.ok(names.includes('get_catalog_snapshot'));
    assert.ok(names.includes('apply_catalog_patch'));
    assert.ok(names.includes('adopt_icon'));
    assert.ok(names.includes('save_catalog'));
    const snapshot = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}`, 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_catalog_snapshot', arguments: {} } }) });
    assert.equal(snapshot.status, 200);
    assert.match(JSON.stringify(await mcpJson(snapshot)), /"revision":"1"/);
  } finally {
    await host.stop();
  }
});

test('UTM MCP is consumable through the official Streamable HTTP client', async () => {
  const port = await freePort();
  const token = 'official-client-token-'.padEnd(48, 'y');
  const host = new UTMcpHost({
    version: '4.3.0',
    token,
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'c'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const client = new Client({ name: 'phase29-test-client', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'utm-mcp');
    assert.equal(client.getServerVersion()?.version, '4.3.0');
    assert.equal(client.getServerVersion()?.title, 'UEFN Transaction Manager');
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 20);
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
    token: 'port-conflict-token-'.padEnd(48, 'z'),
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
  const token = 'mutation-token-'.padEnd(48, 'm');
  const host = new UTMcpHost({
    version: '4.3.0',
    token,
    catalog: makeCatalog(),
    getProjectContext: () => ({ productVersion: '4.3.0', projectName: 'Demo', projectFile: 'C:/Demo/Demo.uefnproject', contentRoot: 'C:/Demo/Content', assetMount: '/Demo', targetManagedVerseFile: 'managed_transactions.verse', configuredIconFolder: 'EntitlementIcons', editorConnection: {}, nativeTextureAdoptionAvailable: false }),
    adoptIcon: async () => ({ success: false, error: 'not used' }),
    saveCatalog: async () => ({ success: true, contentHash: 'e'.repeat(64), fileName: 'managed_transactions.verse' }),
  });
  await host.start(port);
  const client = new Client({ name: 'phase29-mutation-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  try {
    await client.connect(transport);
    const created = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Agent Offer', shortDescription: 'Agent offer', description: 'Agent offer' } } });
    assert.equal(created.isError, undefined);
    const conflict = await client.callTool({ name: 'create_entitlement', arguments: { expectedRevision: '1', data: { name: 'Stale Offer' } } });
    assert.equal(conflict.isError, true);
    assert.match(JSON.stringify(conflict), /CATALOG_REVISION_CONFLICT/);
    const snapshot = await client.callTool({ name: 'get_catalog_snapshot', arguments: {} });
    assert.match(JSON.stringify(snapshot), /"revision":"2"/);
    assert.match(JSON.stringify(snapshot), /Agent Offer/);
    assert.doesNotMatch(JSON.stringify(snapshot), /Stale Offer/);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await host.stop();
  }
});
