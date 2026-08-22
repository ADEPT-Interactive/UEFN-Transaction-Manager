import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPortableUpdatePlan, writePortableUpdatePlan, type PortableUpdatePlan } from '../electron/portableUpdate.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(repositoryRoot, 'electron', 'portable-update-helper.ps1');
const powershellPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function marker(version: string, managedFiles: string[]) {
  return JSON.stringify({ distribution: 'portable', version, schemaVersion: 1, managedFiles }, null, 2);
}

async function makePortableRoot(root: string, name: string, version: string, managedFiles: string[], prefix: string) {
  const portableRoot = path.join(root, name);
  await fs.mkdir(path.join(portableRoot, 'resources', 'app', 'dist-electron'), { recursive: true });
  await fs.writeFile(path.join(portableRoot, 'portable.json'), marker(version, managedFiles));
  await fs.writeFile(path.join(portableRoot, 'UEFN Transaction Manager.exe'), `${prefix}-exe`);
  await fs.writeFile(path.join(portableRoot, 'resources', 'app', 'dist-electron', 'main.cjs'), `${prefix}-main`);
  return portableRoot;
}

async function runHelper(plan: PortableUpdatePlan) {
  const planPath = path.join(String(plan.cleanupRoot), `plan-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await writePortableUpdatePlan(planPath, plan);
  return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, '-PlanPath', planPath], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
}

function testRelaunchArguments() {
  return ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 3'];
}

async function readResult(resultPath: string) {
  return JSON.parse((await fs.readFile(resultPath, 'utf8')).replace(/^\uFEFF/, '')) as { success: boolean; message: string };
}

test('portable helper swaps only managed files and preserves neighboring files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-helper-success-'));
  const managedFiles = ['portable.json', 'UEFN Transaction Manager.exe', 'resources/app/dist-electron/main.cjs'];
  try {
    const currentRoot = await makePortableRoot(root, 'current', '4.1.0', managedFiles, 'old');
    const stagedRoot = await makePortableRoot(root, 'staged', '4.2.0', managedFiles, 'new');
    await fs.writeFile(path.join(currentRoot, 'keep-me.txt'), 'user neighbor');
    const resultPath = path.join(root, 'success-result.json');
    const result = await runHelper(createPortableUpdatePlan({ currentRoot, stagedRoot, processId: 99999999, relaunchPath: powershellPath, relaunchArguments: testRelaunchArguments(), resultPath, cleanupRoot: stagedRoot }));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual((await readResult(resultPath)).success, true);
    assert.equal(await fs.readFile(path.join(currentRoot, 'UEFN Transaction Manager.exe'), 'utf8'), 'new-exe');
    assert.equal(await fs.readFile(path.join(currentRoot, 'resources', 'app', 'dist-electron', 'main.cjs'), 'utf8'), 'new-main');
    assert.equal(await fs.readFile(path.join(currentRoot, 'keep-me.txt'), 'utf8'), 'user neighbor');
    await assert.rejects(() => fs.stat(stagedRoot), /ENOENT/);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 3500));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('portable helper rolls back when a staged file would overwrite an unmanaged neighbor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-helper-rollback-'));
  const managedFiles = ['portable.json', 'UEFN Transaction Manager.exe', 'resources/app/dist-electron/main.cjs'];
  try {
    const currentRoot = await makePortableRoot(root, 'current', '4.1.0', managedFiles, 'old');
    const stagedRoot = await makePortableRoot(root, 'staged', '4.2.0', [...managedFiles, 'user-owned.txt'], 'new');
    await fs.writeFile(path.join(currentRoot, 'user-owned.txt'), 'must survive');
    const resultPath = path.join(root, 'rollback-result.json');
    const result = await runHelper(createPortableUpdatePlan({ currentRoot, stagedRoot, processId: 99999999, relaunchPath: powershellPath, relaunchArguments: testRelaunchArguments(), resultPath, cleanupRoot: stagedRoot }));
    assert.equal(result.code, 0, result.stderr);
    const report = await readResult(resultPath);
    assert.equal(report.success, false);
    assert.match(report.message, /unmanaged file/i);
    assert.equal(await fs.readFile(path.join(currentRoot, 'UEFN Transaction Manager.exe'), 'utf8'), 'old-exe');
    assert.equal(await fs.readFile(path.join(currentRoot, 'resources', 'app', 'dist-electron', 'main.cjs'), 'utf8'), 'old-main');
    assert.equal(await fs.readFile(path.join(currentRoot, 'user-owned.txt'), 'utf8'), 'must survive');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 3500));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('portable helper reports a locked-file failure without stranding the old copy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-helper-locked-'));
  const managedFiles = ['portable.json', 'UEFN Transaction Manager.exe', 'resources/app/dist-electron/main.cjs'];
  let lockProcess: ReturnType<typeof spawn> | undefined;
  try {
    const currentRoot = await makePortableRoot(root, 'current', '4.1.0', managedFiles, 'old');
    const stagedRoot = await makePortableRoot(root, 'staged', '4.2.0', managedFiles, 'new');
    const lockedFile = path.join(currentRoot, 'UEFN Transaction Manager.exe');
    const escaped = lockedFile.replace(/'/g, "''");
    const lockScript = `$s=[IO.File]::Open('${escaped}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); Start-Sleep -Seconds 12`;
    lockProcess = spawn(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', lockScript], { windowsHide: true });
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(lockProcess.exitCode, null, 'The lock process exited before the replacement attempt.');
    const resultPath = path.join(root, 'locked-result.json');
    const result = await runHelper(createPortableUpdatePlan({ currentRoot, stagedRoot, processId: 99999999, relaunchPath: powershellPath, relaunchArguments: testRelaunchArguments(), resultPath, cleanupRoot: stagedRoot }));
    assert.equal(result.code, 0, result.stderr);
    const report = await readResult(resultPath);
    assert.equal(report.success, false);
    lockProcess.kill();
    lockProcess = undefined;
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await fs.readFile(lockedFile, 'utf8'), 'old-exe');
  } finally {
    lockProcess?.kill();
    await new Promise(resolve => setTimeout(resolve, 3500));
    await fs.rm(root, { recursive: true, force: true });
  }
});
