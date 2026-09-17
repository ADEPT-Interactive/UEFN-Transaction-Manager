import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP port assigned.'));
      listener.close(() => resolve(address.port));
    });
  });
}

test('fresh exact ready connector outranks stale 42.20 opening text while incomplete identity stays fail-closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-editor-precedence-'));
  const projectDirectory = path.join(root, 'Project');
  const contentRoot = path.join(projectDirectory, 'Content');
  const projectFile = path.join(projectDirectory, 'Project.uefnproject');
  const localAppData = path.join(root, 'LocalAppData');
  const logDirectory = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Logs');
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify({ fileVersion: 15, title: 'Project', bEnablePythonForProject: true }));
  fs.writeFileSync(path.join(logDirectory, 'UnrealEditorFortnite.log'), `LogValkyrie: Opening project '${projectFile.replaceAll('\\', '/')}'\n`);
  const port = await freePort();
  const token = 'editor-precedence-token-'.padEnd(48, 'x');
  const editorToken = 'editor-precedence-editor-'.padEnd(48, 'x');
  const fakeUefn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 20000)'], { stdio: 'ignore' });
  const bridge = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      UEM_TEST_MODE: '1',
      UEM_TEST_NO_GLOBAL_UEFN_PROBE: '1',
      LOCALAPPDATA: localAppData,
      PORT: String(port),
      UEM_SESSION_TOKEN: token,
      UEM_EDITOR_TOKEN: editorToken,
      UEM_CONTENT_ROOT: contentRoot,
      UEM_ASSET_MOUNT: '/Project',
      UEM_PROJECT_FILE: projectFile,
      UEM_PROJECT_PYTHON_ENABLED: '1',
      UEM_UEFN_PROCESS_ID: String(fakeUefn.pid),
      UEM_IDLE_TIMEOUT_MS: '60000',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // The bridge may still be binding its loopback listener.
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const statusHeaders = { 'X-UEM-Token': token };
    const initial = await (await fetch(`${base}/api/editor/status`, { headers: statusHeaders })).json() as { connectionState: string; projectOpening: boolean; editorConnected: boolean; freshExactConnector: boolean };
    assert.equal(initial.projectOpening, true, JSON.stringify(initial));
    assert.equal(initial.editorConnected, false);
    assert.equal(initial.freshExactConnector, false);

    const wrongProject = await fetch(`${base}/api/editor/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken },
      body: JSON.stringify({ contentRoot, assetMount: '/Project', projectFile: path.join(projectDirectory, 'Other.uefnproject'), projectReady: true, processId: fakeUefn.pid }),
    });
    assert.equal(wrongProject.status, 409);

    const notReady = await fetch(`${base}/api/editor/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken },
      body: JSON.stringify({ contentRoot, assetMount: '/Project', projectFile, projectReady: false, processId: fakeUefn.pid }),
    });
    assert.equal(notReady.status, 200);
    const incomplete = await (await fetch(`${base}/api/editor/status`, { headers: statusHeaders })).json() as { connectionState: string; projectOpening: boolean; editorConnected: boolean; freshExactConnector: boolean };
    assert.equal(incomplete.projectOpening, true);
    assert.equal(incomplete.editorConnected, false);
    assert.equal(incomplete.freshExactConnector, false);

    const ready = await fetch(`${base}/api/editor/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-UEM-Editor-Token': editorToken },
      body: JSON.stringify({ contentRoot, assetMount: '/Project', projectFile, projectReady: true, processId: fakeUefn.pid }),
    });
    assert.equal(ready.status, 200);
    const connected = await (await fetch(`${base}/api/editor/status`, { headers: statusHeaders })).json() as { connectionState: string; projectOpening: boolean; editorConnected: boolean; freshExactConnector: boolean };
    assert.equal(connected.connectionState, 'connected');
    assert.equal(connected.projectOpening, false);
    assert.equal(connected.editorConnected, true);
    assert.equal(connected.freshExactConnector, true);
  } finally {
    bridge.kill();
    fakeUefn.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
