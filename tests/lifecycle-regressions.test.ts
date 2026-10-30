import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { BootstrapPolicy } from '../electron/bootstrapPolicy.js';
import { pruneLogDirectory } from '../electron/logRetention.js';
import { connectorBootstrapCommand } from '../electron/connectorBootstrap.js';
import { tryDuckyBootstrap } from '../electron/duckyBootstrap.js';
import { isExpectedNavigationAbort, SerializedAsyncOperation } from '../electron/navigation.js';
import { createProjectBackup, listProjectBackups, MAX_BACKUPS_PER_FILE, projectBackupDirectory, resolveProjectBackup } from '../shared/projectBackups.js';
import { isConnectorHeartbeatFresh, isProjectReadinessFresh, parseUefnProjectLifecycleLog, retainKnownRunningProcess } from '../shared/editorLifecycle.js';
import { deriveEditorConnectionState } from '../shared/editorState.js';
import { projectPythonEnablementState, projectPythonIsEnabled } from '../shared/pythonEnablement.js';

const read = (filePath: string) => fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

test('Python eligibility follows project and per-user switches without reopening UTM', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utm-python-switches-'));
  const file = path.join(root, 'Demo.uefnproject');
  const ini = path.join(root, 'UnrealEditorFortnite', 'Saved', 'Config', 'WindowsEditor', 'EditorPerProjectUserSettings.ini');
  const projectId = '3eed3c4c-4aad-e017-d3c5-1a8ad8cd3d66';
  const descriptor = (enabled: boolean) => JSON.stringify({ bindings: { projectId }, dataSets: { experimental: { pythonExperimental: { bEnablePythonForProject: enabled } } } });
  try {
    fs.writeFileSync(file, descriptor(true));
    assert.equal(projectPythonIsEnabled(file, false, root), true);
    fs.mkdirSync(path.dirname(ini), { recursive: true });
    fs.writeFileSync(ini, `EnablePythonLocallyPerProject=((aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, True),(${projectId}, False))`);
    assert.equal(projectPythonIsEnabled(file, true, root), false);
    assert.equal(projectPythonEnablementState(file, true, root), 'local-disabled');
    fs.writeFileSync(ini, `EnablePythonLocallyPerProject=((${projectId.toUpperCase()}, True))`);
    assert.equal(projectPythonIsEnabled(file, false, root), true);
    fs.writeFileSync(file, descriptor(false));
    assert.equal(projectPythonIsEnabled(file, true, root), false);
    assert.equal(projectPythonEnablementState(file, true, root), 'project-disabled');
    fs.writeFileSync(file, descriptor(true));
    assert.equal(projectPythonIsEnabled(file, false, root), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('late Python runtime or Ducky availability recovers after a bounded cooldown', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:/Projects/Commerce.uefnproject', processId: 42 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  for (const now of [4_000, 6_000, 11_000]) assert.equal(policy.observe({ now, project, connectorAlive: false, editorConnected: false }).kind, 'attempt');
  for (const now of [16_000, 20_000, 45_999]) assert.equal(policy.observe({ now, project, connectorAlive: false, editorConnected: false }).kind, 'exhausted');
  const recovered = policy.observe({ now: 46_000, project, connectorAlive: false, editorConnected: false });
  assert.equal(recovered.kind, 'attempt');
  if (recovered.kind === 'attempt') assert.equal(recovered.attemptNumber, 1);
  assert.equal(policy.observe({ now: 46_001, project, connectorAlive: true, editorConnected: true }).kind, 'connected');
  assert.equal(policy.observe({ now: 90_000, project, connectorAlive: true, editorConnected: true }).kind, 'connected');
});

test('optional Ducky attachment validates live identity before loading application code', async () => {
  let health = { status: 'ok', commands: ['execute_python'], tick_age_sec: 0.1, busy: false };
  const commands: Array<{ command: string; params: { code: string } }> = [];
  let stderr = '';
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') { response.end(JSON.stringify(health)); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    commands.push(JSON.parse(body));
    response.end(JSON.stringify({ success: true, result: { result: { attached: !stderr }, stderr } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const source = { scriptPath: path.resolve("UTM app's", 'uefn_auto_connector.py'), contentRoot: path.resolve('project', 'Content'), assetMount: '/Commerce/' };
  try {
    assert.equal(await tryDuckyBootstrap(source, 42, undefined, port), true);
    assert.equal(commands[0].command, 'execute_python');
    const code = commands[0].params.code;
    assert.match(code, /assert os\.getpid\(\) == 42/);
    assert.match(code, /get_project_root_asset_directory/);
    assert.match(code, /get_plugin_content_dir\("Commerce"\)/);
    assert.ok(code.indexOf('UTM project Content root mismatch') < code.indexOf('runpy.run_path('));
    assert.match(code, /run_name='utm_connector_bootstrap'/);
    for (const change of [{ busy: true }, { tick_age_sec: 20 }, { commands: [] }]) {
      const previous = health;
      health = { ...health, ...change };
      assert.equal(await tryDuckyBootstrap(source, 42, undefined, port), false);
      health = previous;
    }
    assert.equal(commands.length, 1);
    stderr = 'UTM project Content root mismatch';
    assert.equal(await tryDuckyBootstrap(source, 42, undefined, port), false);
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await tryDuckyBootstrap(source, 42, aborted.signal, port), false);
    assert.equal(commands.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

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

test('42.20 lifecycle wording is parsed without weakening the connector gate', () => {
  const project = 'D:/UEFN Projects/Example Project/Example Project.uefnproject';
  const lifecycle = parseUefnProjectLifecycleLog([
    'LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit',
    `LogValkyrie: Opening project '${project}'`,
  ].join('\n'));
  assert.equal(lifecycle.projectOpening, true);
  assert.equal(lifecycle.openingProject, project);
  assert.equal(deriveEditorConnectionState({
    uefnRunning: true,
    projectOpening: true,
    exactProjectOpen: true,
    differentProjectOpen: false,
    pythonEnabled: true,
    connectorAlive: true,
    projectReady: true,
    editorConnected: true,
    freshExactConnector: true,
  }), 'connected');
  assert.equal(deriveEditorConnectionState({
    uefnRunning: true,
    projectOpening: true,
    exactProjectOpen: true,
    differentProjectOpen: false,
    pythonEnabled: true,
    connectorAlive: true,
    projectReady: true,
    editorConnected: true,
    freshExactConnector: false,
  }), 'project-opening');
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

test('bootstrap uses the application script even when project Python is rewritten or quarantined', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "utm bootstrap's-"));
  try {
    fs.writeFileSync(path.join(root, 'uefn_auto_connector.py'), '# application connector');
    const projectPython = path.join(root, 'project', 'Content', 'Python');
    fs.mkdirSync(projectPython, { recursive: true });
    const init = path.join(projectPython, 'init_unreal.py');
    fs.writeFileSync(init, '# Ducky managed init\n');
    const expected = `py "${path.join(root, 'uefn_auto_connector.py').replaceAll('\\', '/')}"`;
    assert.equal(connectorBootstrapCommand(root), expected);
    assert.equal(connectorBootstrapCommand(root, 'python'), `__import__("runpy").run_path(${JSON.stringify(path.join(root, 'uefn_auto_connector.py').replaceAll('\\', '/'))}, run_name="__main__")`);
    fs.writeFileSync(init, '# Ducky refresh replaced all startup text\n');
    assert.equal(connectorBootstrapCommand(root), expected);
    assert.equal(fs.readFileSync(init, 'utf8'), '# Ducky refresh replaced all startup text\n');
    assert.deepEqual(fs.readdirSync(projectPython), ['init_unreal.py']);
    fs.rmSync(path.join(root, 'uefn_auto_connector.py'));
    assert.equal(connectorBootstrapCommand(root), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const bridge = read('electron/bridgeSession.ts');
  assert.match(bridge, /connectorBootstrapCommand\(appRoot\)/);
  assert.doesNotMatch(bridge, /init_unreal\.py|copyFileSync|UEM_AUTO_CONNECTOR_BEGIN/);
  assert.doesNotMatch(bridge, /py import uefn_auto_connector/);
});

test('successful recovery restores a bounded retry budget for the same project and PID', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:/Projects/Commerce.uefnproject', processId: 42 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  for (const now of [4_000, 6_000, 11_000]) assert.equal(policy.observe({ now, project, connectorAlive: false, editorConnected: false }).kind, 'attempt');
  assert.equal(policy.observe({ now: 16_000, project, connectorAlive: false, editorConnected: false }).kind, 'exhausted');
  assert.equal(policy.observe({ now: 17_000, project, connectorAlive: true, editorConnected: true }).kind, 'connected');
  const recovery = policy.observe({ now: 26_000, project, connectorAlive: false, editorConnected: false });
  assert.equal(recovery.kind, 'attempt');
  if (recovery.kind === 'attempt') assert.equal(recovery.attemptNumber, 1);
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

test('an editor restart can replace the pinned PID only with completed project and OS process evidence', () => {
  const server = read('server/index.ts');
  assert.match(server, /editorSession.processId !== expectedEditorProcessId/);
  assert.match(server, /!processIdIsRunning\(expectedEditorProcessId\) && configuredProjectFile && openedProject && pathsEqual\(openedProject, configuredProjectFile\)/);
  assert.match(server, /IMAGENAME eq UnrealEditorFortnite-Win64-Shipping.exe/);
  assert.match(server, /if \(!verifiedReplacement\) return res.status\(409\)/);
  assert.match(server, /expectedEditorProcessId = req.body.processId/);
});

test('connection retry stays within the trusted current desktop session', () => {
  const main = read('electron/main.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('uem:editor:reconnect'"), main.indexOf("ipcMain.handle('uem:launcher:get-state'"));
  assert.match(handler, /assertTrustedSender\(event\)/);
  assert.match(handler, /mode !== 'dashboard'/);
  assert.match(handler, /bridgeSession.retryEditorConnection\(\)/);
  assert.doesNotMatch(handler, /scriptPath|projectFile|rawCommand/);
  assert.match(read('electron/bridgeSession.ts'), /if \(this.bootstrapExhaustionReported\) return/);
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

test('only the first attempt budget may type into the UEFN window; recovery cycles stay focus-free', () => {
  const policy = new BootstrapPolicy();
  const project = { projectFile: 'C:/Projects/Commerce.uefnproject', processId: 42 };
  policy.observe({ now: 0, project, connectorAlive: false, editorConnected: false });
  for (const now of [4_000, 6_000, 11_000]) {
    const decision = policy.observe({ now, project, connectorAlive: false, editorConnected: false });
    assert.equal(decision.kind, 'attempt');
    if (decision.kind === 'attempt') assert.equal(decision.allowForegroundInput, true);
  }
  assert.equal(policy.observe({ now: 16_000, project, connectorAlive: false, editorConnected: false }).kind, 'exhausted');
  const recovery = policy.observe({ now: 46_000, project, connectorAlive: false, editorConnected: false });
  assert.equal(recovery.kind, 'attempt');
  if (recovery.kind === 'attempt') assert.equal(recovery.allowForegroundInput, false);
  // A manual retry resets the policy and re-enables one foreground budget.
  policy.reset();
  policy.observe({ now: 50_000, project, connectorAlive: false, editorConnected: false });
  const manual = policy.observe({ now: 54_000, project, connectorAlive: false, editorConnected: false });
  assert.equal(manual.kind, 'attempt');
  if (manual.kind === 'attempt') assert.equal(manual.allowForegroundInput, true);
});

test('log retention removes only old per-launch logs and rotates the shared bridge log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-log-retention-'));
  try {
    const now = Date.now();
    const old = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const write = (name: string, content = 'x', mtime?: Date) => {
      const file = path.join(root, name);
      fs.writeFileSync(file, content);
      if (mtime) fs.utimesSync(file, mtime, mtime);
      return file;
    };
    write('electron-main-100.log', 'x', old);
    write('bridge-startup-5000.log', 'x', old);
    write('desktop-shell-7.log', 'x', old);
    const current = write('electron-main-200.log', 'x', old);
    write('electron-main-300.log');
    write('unrelated-notes.log', 'x', old);
    write('bridge.log', 'y'.repeat(2048));
    const result = pruneLogDirectory(root, { now, keep: new Set([current]), maxRotatedLogBytes: 1024 });
    assert.equal(result.removed, 3);
    assert.deepEqual(result.rotated, ['bridge.log']);
    assert.deepEqual(fs.readdirSync(root).sort(), ['bridge.log.1', 'electron-main-200.log', 'electron-main-300.log', 'unrelated-notes.log']);
    assert.deepEqual(pruneLogDirectory(path.join(root, 'missing')), { removed: 0, rotated: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backups keep only the newest few per file and never touch unrelated files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-backup-retention-'));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(root, 'LocalAppData');
  const content = path.join(root, 'Project', 'Content');
  const projectFile = path.join(root, 'Project', 'Project.uefnproject');
  const managed = path.join(content, 'managed_transactions.verse');
  const manual = path.join(content, 'manual.verse');
  fs.mkdirSync(content, { recursive: true });
  try {
    const directory = projectBackupDirectory(content, projectFile);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'init_unreal.py.2026-09-15T02-31-26-262Z.35020.b1610212.bak'), 'legacy');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'owner file');
    fs.writeFileSync(manual, 'manual');
    createProjectBackup(manual, content, projectFile);
    for (let version = 1; version <= MAX_BACKUPS_PER_FILE + 3; version += 1) {
      fs.writeFileSync(managed, `version ${version}`);
      createProjectBackup(managed, content, projectFile);
    }
    const kept = listProjectBackups(content, projectFile, 'managed_transactions.verse');
    assert.equal(kept.length, MAX_BACKUPS_PER_FILE);
    assert.equal(fs.readFileSync(resolveProjectBackup(content, projectFile, kept[0].name).filePath, 'utf8'), `version ${MAX_BACKUPS_PER_FILE + 3}`);
    assert.equal(listProjectBackups(content, projectFile, 'manual.verse').length, 1);
    assert.ok(fs.existsSync(path.join(directory, 'notes.txt')));
    assert.ok(fs.existsSync(path.join(directory, 'init_unreal.py.2026-09-15T02-31-26-262Z.35020.b1610212.bak')));
    for (const name of [path.join('..', 'notes.txt'), 'notes.txt', `../${kept[0].name}`, 42]) assert.throws(() => resolveProjectBackup(content, projectFile, name));
    // Saving the same bytes again (Compile saves first) must not push older versions out.
    const repeated = createProjectBackup(managed, content, projectFile);
    assert.equal(path.basename(repeated), kept[0].name);
    assert.deepEqual(listProjectBackups(content, projectFile, 'managed_transactions.verse').map(entry => entry.name), kept.map(entry => entry.name));
    fs.writeFileSync(managed, 'version after a repeat');
    const changed = createProjectBackup(managed, content, projectFile);
    assert.equal(listProjectBackups(content, projectFile, 'managed_transactions.verse')[0].name, path.basename(changed));
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
