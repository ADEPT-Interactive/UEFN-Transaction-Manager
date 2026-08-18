import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  compileVerseProject,
  discoverVerseCompiler,
  projectPathsMatch,
  resolveWorkflowEndpoint,
  type CompilerDiscoverySystem,
} from '../server/workflowClient';

function fakeSystem(overrides: Partial<CompilerDiscoverySystem> = {}): CompilerDiscoverySystem {
  return {
    listUefnProcesses: async () => [{ processId: 10 }],
    listLoopbackListeners: async () => [{ host: '127.0.0.1', port: 31962, processId: 10 }],
    readActiveProjectFile: async () => 'D:/UEFN Projects/My Project/My Project.uefnproject',
    ...overrides,
  };
}

function frame(body: unknown): Buffer {
  const content = Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, 'ascii'), content]);
}

async function mockWorkflowServer(port = 0, response: unknown = { seq: 1, type: 2, command: 'compileProject', result: { numErrors: 0, numWarnings: 0, messages: [] } }) {
  const server = net.createServer(socket => {
    socket.on('data', () => socket.write(frame(response)));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, endpoint: { host: '127.0.0.1', port: address.port } };
}

test('ordinary endpoint resolution requires an explicit local override', () => {
  assert.throws(() => resolveWorkflowEndpoint({}), /automatic UEFN discovery/);
  assert.deepEqual(resolveWorkflowEndpoint({ UEM_VERSE_COMPILER_ENDPOINT: '127.0.0.1:31962' }), { host: '127.0.0.1', port: 31962 });
  assert.deepEqual(resolveWorkflowEndpoint({ UEM_VERSE_COMPILER_ENDPOINT: '[::1]:31962' }), { host: '::1', port: 31962 });
});

test('legacy endpoint variables remain local-only test overrides', () => {
  assert.deepEqual(resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_HOST: 'localhost', UEM_VERSE_WORKFLOW_PORT: '1972' }), { host: 'localhost', port: 1972 });
  assert.throws(() => resolveWorkflowEndpoint({ UEM_VERSE_COMPILER_ENDPOINT: 'http://192.168.1.4:1962' }), /local loopback/);
  assert.throws(() => resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_HOST: ' ', UEM_VERSE_WORKFLOW_PORT: 'nope' }), /must not be empty/);
  assert.throws(() => resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_PORT: '70000' }), /valid TCP port/);
});

test('discovery matches project paths across drives, separators, case, spaces, Unicode, and apostrophes', () => {
  assert.equal(projectPathsMatch("D:\\UEFN Projects\\Café's Project\\Island.uefnproject", "d:/uefn projects/café's project/island.uefnproject"), true);
  assert.equal(projectPathsMatch('C:/One/Island.uefnproject', 'D:/One/Island.uefnproject'), false);
});

test('discovery returns a structured unavailable result without UEFN', async () => {
  const result = await discoverVerseCompiler({ system: fakeSystem({ listUefnProcesses: async () => [], listLoopbackListeners: async () => [] }) });
  assert.equal(result.status, 'uefn-not-running');
  assert.deepEqual(result.sessions, []);
});

test('discovery selects a process-owned listener and does not scan unrelated processes', async () => {
  const result = await discoverVerseCompiler({ projectFile: 'D:/UEFN Projects/My Project/My Project.uefnproject', system: fakeSystem({ listLoopbackListeners: async () => [
    { host: '127.0.0.1', port: 31962, processId: 11 },
    { host: '127.0.0.1', port: 1962, processId: 10 },
    { host: '0.0.0.0', port: 1962, processId: 10 },
  ] }) });
  assert.equal(result.sessions[0]?.port, 1962);
  assert.equal(result.sessions[0]?.processId, 10);
});

test('discovery rejects project mismatches and ambiguous UEFN processes', async () => {
  const mismatch = await discoverVerseCompiler({ projectFile: 'C:/Other/Other.uefnproject', system: fakeSystem() });
  assert.equal(mismatch.status, 'project-mismatch');
  const perProcessMatch = await discoverVerseCompiler({ projectFile: 'D:/UEFN Projects/My Project/My Project.uefnproject', system: fakeSystem({ readActiveProjectFile: async () => 'C:/Other/Other.uefnproject', listUefnProcesses: async () => [{ processId: 10, projectFile: 'D:/UEFN Projects/My Project/My Project.uefnproject' }] }) });
  assert.equal(perProcessMatch.sessions[0]?.processId, 10);
  const ambiguous = await discoverVerseCompiler({ system: fakeSystem({ listUefnProcesses: async () => [{ processId: 10 }, { processId: 11 }] }) });
  assert.equal(ambiguous.status, 'multiple-sessions-ambiguous');
});

test('the same compiler client works with the historical port and an alternate port', async t => {
  for (const port of [1962, 31962]) {
    let mock: Awaited<ReturnType<typeof mockWorkflowServer>>;
    try { mock = await mockWorkflowServer(port); }
    catch (error) {
      if (port === 1962 && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') { t.diagnostic('1962 is occupied by a live UEFN session; the live compatibility probe covers this port.'); continue; }
      throw error;
    }
    t.after(() => mock.server.close());
    const result = await compileVerseProject({ endpoint: mock.endpoint, timeoutMs: 1000 });
    assert.equal(result.success, true, `port ${port}`);
    assert.equal(result.status, 'compiled');
  }
});

test('compile result preserves warnings, errors, and normalized diagnostic fields', async t => {
  const mock = await mockWorkflowServer(0, { seq: 1, type: 2, command: 'compileProject', result: { numErrors: 1, numWarnings: 1, messages: [{ severity: 'error', message: 'Bad syntax', file: 'D:/UEFN Projects/My Project/main.verse', line: 7, column: 3, code: 'V001' }] } });
  t.after(() => mock.server.close());
  const result = await compileVerseProject({ endpoint: mock.endpoint, timeoutMs: 1000 });
  assert.equal(result.success, false);
  assert.equal(result.connected, true);
  assert.equal(result.numErrors, 1);
  assert.deepEqual(result.diagnostics, [{ severity: 'error', message: 'Bad syntax', file: 'D:/UEFN Projects/My Project/main.verse', line: 7, column: 3, code: 'V001' }]);
});

test('malformed protocol responses are transport failures, not clean compiles', async t => {
  const server = net.createServer(socket => socket.on('data', () => socket.write(Buffer.from('not framed'))));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => server.close());
  const result = await compileVerseProject({ endpoint: { host: '127.0.0.1', port: address.port }, timeoutMs: 1000 });
  assert.equal(result.success, false);
  assert.equal(result.status, 'compile-request-failed');
});

test('a stale session is invalidated and rediscovered after a connection failure', async t => {
  const stale = await mockWorkflowServer();
  await new Promise<void>(resolve => stale.server.close(() => resolve()));
  const live = await mockWorkflowServer();
  t.after(() => live.server.close());
  let discoveryCalls = 0;
  const result = await compileVerseProject({
    timeoutMs: 1000,
    system: fakeSystem({
      listLoopbackListeners: async () => {
        discoveryCalls += 1;
        return [{ host: '127.0.0.1', port: discoveryCalls === 1 ? stale.endpoint.port : live.endpoint.port, processId: 10 }];
      },
      readActiveProjectFile: async () => undefined,
    }),
  });
  assert.equal(result.success, true);
  assert.ok(discoveryCalls >= 2);
});
