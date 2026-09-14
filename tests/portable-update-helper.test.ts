import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPortableUpdatePlan, extractPortableArchive, parsePortableUpdateManifest, sha256File, verifyPortableDownload, writePortableUpdatePlan, type PortableUpdatePlan } from '../electron/portableUpdate.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(repositoryRoot, 'electron', 'portable-update-helper.ps1');
const powershellPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const execFileAsync = promisify(execFile);

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

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function makePortableArchive(root: string, name: string, version: string, includeMarker = true) {
  const portableRoot = path.join(root, `archive source ${name}`, 'UEFN Transaction Manager');
  const managedFiles = ['portable.json', 'UEFN Transaction Manager.exe', 'resources/app/dist-electron/main.cjs'];
  await fs.mkdir(path.join(portableRoot, 'resources', 'app', 'dist-electron'), { recursive: true });
  if (includeMarker) await fs.writeFile(path.join(portableRoot, 'portable.json'), marker(version, managedFiles));
  await fs.writeFile(path.join(portableRoot, 'UEFN Transaction Manager.exe'), `${name}-exe`);
  await fs.writeFile(path.join(portableRoot, 'resources', 'app', 'dist-electron', 'main.cjs'), `${name}-main`);
  const archivePath = path.join(root, `portable archive ${name}.zip`);
  const script = `Compress-Archive -LiteralPath ${quotePowerShell(portableRoot)} -DestinationPath ${quotePowerShell(archivePath)} -CompressionLevel Optimal -Force`;
  await execFileAsync(powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
  return archivePath;
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
  // The helper launches the replacement with the current portable root as its
  // working directory. Move this synthetic sleeper away from that fixture
  // root so slow Windows runners cannot keep `current` locked during cleanup.
  return ['-NoProfile', '-NonInteractive', '-Command', 'Set-Location -LiteralPath $env:WINDIR; [Environment]::CurrentDirectory = $env:WINDIR; Start-Sleep -Seconds 3'];
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

test('portable archive extraction binds literal paths and returns a verified portable inspection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uem-portable-extraction-'"));
  try {
    const archivePath = await makePortableArchive(root, "with spaces ' apostrophe & unicode-東京", '4.3.2');
    const destinationRoot = path.join(root, "destination with spaces ' apostrophe & unicode-東京");
    const { digest, size } = await sha256File(archivePath);
    const manifest = parsePortableUpdateManifest({
      version: '4.3.2',
      filename: path.basename(archivePath),
      sha256: digest,
      size,
    });
    const verified = await verifyPortableDownload({ archivePath, manifest, extractTo: destinationRoot });
    assert.equal(verified.inspection.marker.version, '4.3.2');
    assert.equal(verified.inspection.root, path.join(destinationRoot, 'UEFN Transaction Manager'));
    assert.ok(verified.inspection.files.includes('resources/app/dist-electron/main.cjs'));
    assert.equal(await fs.readFile(path.join(verified.inspection.root, 'UEFN Transaction Manager.exe'), 'utf8'), "with spaces ' apostrophe & unicode-東京-exe");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('portable extraction rejects invalid archives and archives without the portable marker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-extraction-failure-'));
  try {
    const invalidArchive = path.join(root, "invalid archive with spaces ' apostrophe.zip");
    const invalidDestination = path.join(root, "invalid destination with spaces ' apostrophe");
    await fs.writeFile(invalidArchive, 'not a ZIP archive', 'utf8');
    await assert.rejects(() => extractPortableArchive(invalidArchive, invalidDestination), /Expand-Archive|archive|zip/i);

    const missingMarkerArchive = await makePortableArchive(root, "missing marker ' archive", '4.3.2', false);
    await assert.rejects(() => extractPortableArchive(missingMarkerArchive, path.join(root, 'missing marker destination')), /missing a valid portable marker/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('portable verification rejects wrong hash and size before invoking extraction', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uem-portable-integrity-'));
  const archivePath = path.join(root, 'portable.zip');
  const body = Buffer.from('portable integrity fixture');
  try {
    await fs.writeFile(archivePath, body);
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const manifest = parsePortableUpdateManifest({ version: '4.3.2', filename: 'portable.zip', sha256: digest, size: body.length });
    let inspectCalls = 0;
    const inspect = async () => {
      inspectCalls += 1;
      throw new Error('extraction should not run');
    };
    await assert.rejects(() => verifyPortableDownload({ archivePath, manifest: { ...manifest, sha256: '0'.repeat(64) }, extractTo: path.join(root, 'wrong hash'), inspect }), /SHA-256/);
    await assert.rejects(() => verifyPortableDownload({ archivePath, manifest: { ...manifest, size: body.length + 1 }, extractTo: path.join(root, 'wrong size'), inspect }), /byte size/);
    assert.equal(inspectCalls, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('fixed portable pipeline extracts, verifies, replaces, relaunches, and preserves a sentinel', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uem-portable-pipeline-'"));
  const managedFiles = ['portable.json', 'UEFN Transaction Manager.exe', 'resources/app/dist-electron/main.cjs'];
  try {
    const currentRoot = await makePortableRoot(root, "Current Root with spaces ' apostrophe", '4.3.1', managedFiles, 'old');
    await fs.writeFile(path.join(currentRoot, 'user-sentinel.txt'), 'preserve me', 'utf8');
    const archivePath = await makePortableArchive(root, "4.3.2 archive with spaces ' apostrophe", '4.3.2');
    const updateRoot = path.join(root, "update staging with spaces ' apostrophe");
    const { digest, size } = await sha256File(archivePath);
    const manifest = parsePortableUpdateManifest({ version: '4.3.2', filename: path.basename(archivePath), sha256: digest, size });
    const verified = await verifyPortableDownload({ archivePath, manifest, extractTo: path.join(updateRoot, 'extracted') });
    const resultPath = path.join(root, 'pipeline-result.json');
    const result = await runHelper(createPortableUpdatePlan({
      currentRoot,
      stagedRoot: verified.inspection.root,
      processId: 99999999,
      relaunchPath: powershellPath,
      relaunchArguments: testRelaunchArguments(),
      resultPath,
      cleanupRoot: updateRoot,
    }));
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await readResult(resultPath)).success, true);
    assert.equal(await fs.readFile(path.join(currentRoot, 'UEFN Transaction Manager.exe'), 'utf8'), "4.3.2 archive with spaces ' apostrophe-exe");
    assert.equal(await fs.readFile(path.join(currentRoot, 'resources', 'app', 'dist-electron', 'main.cjs'), 'utf8'), "4.3.2 archive with spaces ' apostrophe-main");
    assert.equal(await fs.readFile(path.join(currentRoot, 'user-sentinel.txt'), 'utf8'), 'preserve me');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 3500));
    await fs.rm(root, { recursive: true, force: true });
  }
});
