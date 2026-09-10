import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BootstrapPolicy } from '../electron/bootstrapPolicy.js';
import { isExpectedNavigationAbort, SerializedAsyncOperation } from '../electron/navigation.js';
import { createProjectBackup, projectBackupDirectory } from '../shared/projectBackups.js';
import { isConnectorHeartbeatFresh, isProjectReadinessFresh, parseUefnProjectLifecycleLog, retainKnownRunningProcess } from '../shared/editorLifecycle.js';
import { deriveEditorConnectionState } from '../shared/editorState.js';

const read = (filePath: string) => fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

test('stable connector heartbeat keeps a ready project connected', () => {
  const report = { projectReady: true, reportedAt: 10_000, processId: 42 };
  assert.equal(isConnectorHeartbeatFresh(report, 17_900, true), true);
  assert.equal(isProjectReadinessFresh(report, 17_900, true), true);
});

test('heartbeat jitter remains connected when the next report is current', () => {
  const report = { projectReady: true, reportedAt: 20_000, processId: 42 };
  assert.equal(isConnectorHeartbeatFresh(report, 27_999, true), true);
  assert.equal(isConnectorHeartbeatFresh({ ...report, reportedAt: 28_100 }, 28_101, true), true);
});

test('a genuinely stale connector heartbeat disconnects', () => {
  assert.equal(isConnectorHeartbeatFresh({ projectReady: true, reportedAt: 1_000, processId: 42 }, 9_001, true), false);
  assert.equal(isProjectReadinessFresh({ projectReady: true, reportedAt: 1_000, processId: 42 }, 9_001, true), false);
});

test('a dead connector process disconnects even with a fresh report', () => {
  assert.equal(isConnectorHeartbeatFresh({ projectReady: true, reportedAt: 10_000, processId: 42 }, 10_100, false), false);
});

test('project close and browser readiness remain fail-closed', () => {
  assert.equal(isProjectReadinessFresh(undefined, 10_100, false), false);
  assert.equal(isProjectReadinessFresh({ projectReady: false, reportedAt: 10_000, processId: 42 }, 10_100, true), false);
});

test('a successful project open is revoked by a later return to the UEFN browser', () => {
  const project = 'C:/Projects/UEM_Demo/UEM_Demo.uefnproject';
  const lifecycle = parseUefnProjectLifecycleLog([
    'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit',
    `Successfully opened project '${project}'`,
    'LogValkyrieRequestManagerEditor: Current project was closed - destroying the valkyrie beacon',
    'LogValkyrie: Display: Successfully closed 1 project(s)',
  ].join('\n'));
  assert.equal(lifecycle.openedProject, undefined);
  assert.ok(lifecycle.closedPosition > lifecycle.openedPosition);
});

test('a new project open after close becomes authoritative again', () => {
  const first = 'C:/Projects/TaB/TaB.uefnproject';
  const second = 'C:/Projects/UEM_Demo/UEM_Demo.uefnproject';
  const lifecycle = parseUefnProjectLifecycleLog([
    'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit',
    `Successfully opened project '${first}'`,
    'LogValkyrie: Display: Successfully closed 1 project(s)',
    `Successfully opened project '${second}'`,
  ].join('\n'));
  assert.equal(lifecycle.openedProject, second);
});

test('project opening is distinct from a completed exact project open', () => {
  const first = 'C:/Projects/TaB/TaB.uefnproject';
  const second = 'C:/Projects/UEM_Demo/UEM_Demo.uefnproject';
  const opening = parseUefnProjectLifecycleLog([
    'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit',
    `Successfully opened project '${first}'`,
    `Opening project '${second}'`,
  ].join('\n'));
  assert.equal(opening.projectOpening, true);
  assert.equal(opening.openingProject, second);
  assert.equal(opening.openedProject, undefined);
  assert.equal(deriveEditorConnectionState({ uefnRunning: true, projectOpening: true, exactProjectOpen: false, differentProjectOpen: false, pythonEnabled: true, connectorAlive: false, projectReady: false, editorConnected: false }), 'project-opening');

  const completed = parseUefnProjectLifecycleLog([
    'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit',
    `Opening project '${second}'`,
    `Successfully opened project '${second}'`,
  ].join('\n'));
  assert.equal(completed.projectOpening, false);
  assert.equal(completed.openedProject, second);
});

test('exact identity and Python readiness are separate connection facts', () => {
  assert.equal(deriveEditorConnectionState({ uefnRunning: true, projectOpening: false, exactProjectOpen: true, differentProjectOpen: false, pythonEnabled: false, connectorAlive: false, projectReady: false, editorConnected: false }), 'python-required');
  assert.equal(deriveEditorConnectionState({ uefnRunning: true, projectOpening: false, exactProjectOpen: true, differentProjectOpen: false, pythonEnabled: true, connectorAlive: false, projectReady: false, editorConnected: false }), 'connector-waiting');
});

test('a verified reconnect restores the exact project readiness state', () => {
  const report = { projectReady: true, reportedAt: 30_000, processId: 84 };
  assert.equal(isProjectReadinessFresh(report, 30_500, true), true);
});

test('already-open matching project receives a deterministic bootstrap attempt after grace', () => {
  const policy = new BootstrapPolicy();
  const first = policy.observe({ now: 0, project: { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 }, connectorAlive: false, editorConnected: false });
  assert.equal(first.kind, 'waiting');
  const attempt = policy.observe({ now: 4_000, project: { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 }, connectorAlive: false, editorConnected: false });
  assert.equal(attempt.kind, 'attempt');
  if (attempt.kind === 'attempt') assert.equal(attempt.attemptNumber, 1);
});

test('known-invalid py import bootstrap command is not emitted', () => {
  const bridge = read('electron/bridgeSession.ts');
  assert.match(bridge, /import uefn_auto_connector; uefn_auto_connector\.install\(\)/);
  assert.doesNotMatch(bridge, /py import uefn_auto_connector/);
});

test('bootstrap retries are bounded for one project and PID identity', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  assert.equal(policy.observe({ now: 4_000, project, connectorAlive: false, editorConnected: false }).kind, 'attempt');
  assert.equal(policy.observe({ now: 6_000, project, connectorAlive: false, editorConnected: false }).kind, 'attempt');
  assert.equal(policy.observe({ now: 11_000, project, connectorAlive: false, editorConnected: false }).kind, 'attempt');
  assert.equal(policy.observe({ now: 16_000, project, connectorAlive: false, editorConnected: false }).kind, 'exhausted');
  assert.equal(policy.observe({ now: 16_001, project, connectorAlive: false, editorConnected: false }).kind, 'exhausted');
});

test('a successful connector heartbeat stops bootstrap commands', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  assert.equal(policy.observe({ now: 1_000, project, connectorAlive: true, editorConnected: false }).kind, 'waiting');
  assert.equal(policy.observe({ now: 1_100, project, connectorAlive: true, editorConnected: true }).kind, 'connected');
  assert.equal(policy.observe({ now: 1_200, project, connectorAlive: true, editorConnected: false }).kind, 'waiting');
});

test('project switching resets bootstrap identity and attempt count', () => {
  const policy = new BootstrapPolicy();
  const projectA = { projectFile: 'C:\\Projects\\TaB.uefnproject', processId: 101 };
  const projectB = { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 };
  policy.observe({ now: 0, project: projectA, connectorAlive: false, editorConnected: false });
  policy.observe({ now: 4_000, project: projectA, connectorAlive: false, editorConnected: false });
  const switched = policy.observe({ now: 5_000, project: projectB, connectorAlive: false, editorConnected: false });
  assert.equal(switched.kind, 'waiting');
  assert.equal(switched.reason, 'project-startup-grace');
  const next = policy.observe({ now: 9_000, project: projectB, connectorAlive: false, editorConnected: false });
  assert.equal(next.kind, 'attempt');
  if (next.kind === 'attempt') assert.equal(next.attemptNumber, 1);
});

test('Python enablement transition resets bounded bootstrap attempts', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:\\Projects\\UEM_Demo.uefnproject', processId: 101 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  policy.observe({ now: 4_000, project, connectorAlive: false, editorConnected: false });
  policy.reset();
  const afterEnablement = policy.observe({ now: 4_000, project, connectorAlive: false, editorConnected: false });
  assert.equal(afterEnablement.kind, 'waiting');
  assert.equal(afterEnablement.reason, 'project-startup-grace');
});

test('only the active exact navigation target can contain ERR_ABORTED', () => {
  const expected = { generation: 7, targetUrl: 'uem-launcher://app/index.html' };
  assert.equal(isExpectedNavigationAbort({ expected, code: -3, url: expected.targetUrl }), true);
  assert.equal(isExpectedNavigationAbort({ expected, error: Object.assign(new Error('navigation failed'), { code: 'ERR_ABORTED' }), url: expected.targetUrl }), true);
  assert.equal(isExpectedNavigationAbort({ expected: null, code: -3, url: expected.targetUrl }), false);
  assert.equal(isExpectedNavigationAbort({ expected, code: -3, url: 'http://127.0.0.1:1234/' }), false);
  assert.equal(isExpectedNavigationAbort({ expected, code: -2, url: expected.targetUrl }), false);
});

test('project switch lifecycle actions share one in-flight operation', async () => {
  const operation = new SerializedAsyncOperation();
  let executions = 0;
  const first = operation.run(async () => { executions += 1; await new Promise(resolve => setTimeout(resolve, 20)); });
  const second = operation.run(async () => { executions += 1; });
  assert.equal(first, second);
  await first;
  assert.equal(executions, 1);
  await operation.run(async () => { executions += 1; });
  assert.equal(executions, 2);
});

test('project switching uses a validated replacement window and rollback boundary', () => {
  const main = read('electron/main.ts');
  assert.match(main, /createMainWindow\(\{ candidate: true, showWhenReady: false \}\)/);
  assert.match(main, /Launcher candidate validated before bridge teardown/);
  assert.match(main, /Retiring dashboard window destroyed/);
  assert.match(main, /current dashboard retained/);
  assert.match(main, /Late IPC from retiring dashboard rejected/);
  assert.match(main, /function acceptTrustedEvent/);
  assert.match(main, /acceptTrustedEvent\(event, 'uem:window:dirty'\)/);
  assert.match(main, /acceptTrustedEvent\(event, 'uem:window:action'\)/);
  assert.doesNotMatch(main, /Navigation recovery retry started/);
});

test('background retries do not focus the UTM window', () => {
  const native = read('electron/nativeWindows.ts');
  assert.doesNotMatch(native, /managerWindow\.focus/);
  assert.match(native, /GetForegroundWindow/);
});

test('foreground ownership is captured before the one-time UEFN interaction', () => {
  const native = read('electron/nativeWindows.ts');
  assert.match(native, /const originalForegroundWindow = GetForegroundWindow/);
  assert.match(native, /SetForegroundWindow\(originalForegroundWindow\)/);
});

test('failed bootstrap attempts cannot create a focus trampoline', () => {
  const native = read('electron/nativeWindows.ts');
  assert.doesNotMatch(native, /BrowserWindow/);
  assert.doesNotMatch(native, /\.focus\(\)/);
});

test('project identity includes both project path and UEFN PID', () => {
  const policy = new BootstrapPolicy();
  const first = policy.observe({ now: 0, project: { projectFile: 'C:\\Projects\\TaB.uefnproject', processId: 101 }, connectorAlive: false, editorConnected: false });
  const second = policy.observe({ now: 1_000, project: { projectFile: 'C:\\Projects\\TaB.uefnproject', processId: 202 }, connectorAlive: false, editorConnected: false });
  assert.equal(first.kind, 'waiting');
  assert.equal(second.kind, 'waiting');
  assert.equal(second.reason, 'project-startup-grace');
});

test('stale project A cannot be treated as project B by the server contract', () => {
  const server = read('server/index.ts');
  assert.match(server, /req\.body\.assetMount !== configuredAssetMount/);
  assert.match(server, /reporting UEFN editor project file does not match/);
});

test('project B becomes authoritative only after its own heartbeat', () => {
  const reportB = { projectReady: true, reportedAt: 40_000, processId: 202 };
  assert.equal(isProjectReadinessFresh(reportB, 40_100, true), true);
  assert.equal(isProjectReadinessFresh({ ...reportB, processId: 101 }, 40_100, false), false);
});

test('UTM compile prefers the current editor-session PID after a UEFN restart', () => {
  const server = read('server/index.ts');
  assert.match(server, /preferredProcessId: \(editorSession\?\.processId \?\? launchedUefnProcessId\)/);
});

test('compile preflight remains tied to stable matching project readiness', () => {
  const server = read('server/index.ts');
  assert.match(server, /if \(!editorSessionIsFresh\(\)\)/);
  assert.match(server, /Open the linked project in UEFN before compiling/);
});

test('active connector installation is idempotent across repeated startup imports', () => {
  const connector = read('uefn_auto_connector.py');
  assert.match(connector, /already monitoring; retained the existing worker/);
  assert.match(connector, /previous_stop = getattr\(unreal, "_uem_auto_connector_stop_event"/);
  assert.match(connector, /unregister_slate_post_tick_callback/);
});

test('old Content-local backup directories are not part of the final write paths', () => {
  const source = `${read('electron/bridgeSession.ts')}\n${read('server/index.ts')}`;
  assert.doesNotMatch(source, /\.uem-backups/);
  assert.doesNotMatch(source, /path\.join\(contentRoot, '\.backups'\)/);
});

test('project backup helper refuses an outside source and chooses a path outside Content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-lifecycle-backup-'));
  const source = path.join(root, 'Content', 'manual.verse');
  const outside = path.join(root, 'outside.verse');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'source');
  fs.writeFileSync(outside, 'outside');
  try {
    const directory = projectBackupDirectory(path.dirname(source), path.join(root, 'Project.uefnproject'));
    assert.equal(path.relative(path.dirname(source), directory).startsWith('..'), true);
    const backup = createProjectBackup(source, path.dirname(source), path.join(root, 'Project.uefnproject'));
    assert.equal(fs.readFileSync(backup, 'utf8'), 'source');
    assert.throws(() => createProjectBackup(outside, path.dirname(source), path.join(root, 'Project.uefnproject')));
    fs.rmSync(path.dirname(backup), { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup file names are non-compilable snapshots outside the project tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-lifecycle-backup-name-'));
  const source = path.join(root, 'Content', 'managed_transactions.verse');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'managed');
  try {
    const backup = createProjectBackup(source, path.dirname(source), path.join(root, 'Project.uefnproject'));
    assert.match(path.basename(backup), /\.verse\.[^/\\]+\.bak$/);
    assert.equal(path.relative(path.dirname(source), backup).startsWith('..'), true);
    fs.rmSync(path.dirname(backup), { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a transient process-probe error retains a recently verified live PID only briefly', () => {
  assert.equal(retainKnownRunningProcess(true, 50_000, 54_999), true);
  assert.equal(retainKnownRunningProcess(true, 50_000, 55_001), false);
  assert.equal(retainKnownRunningProcess(false, 50_000, 50_001), false);
});

test('recent explicit integer typing remains in the generated Verse consumption state', () => {
  const generator = read('src/services/verseGenerator.ts');
  assert.match(generator, /var RequestedRemaining:int/);
  assert.match(generator, /var BufferedMatched:int/);
});
