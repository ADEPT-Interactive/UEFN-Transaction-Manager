import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyDriveType,
  fixedLocalDrives,
  ProjectDiscovery,
  readDiscoveryCache,
  writeDiscoveryCache,
} from '../electron/projectDiscovery.js';

function makeProject(root: string, name: string, title = name) {
  const projectDirectory = path.join(root, name);
  const contentDirectory = path.join(projectDirectory, 'Plugins', name, 'Content');
  fs.mkdirSync(contentDirectory, { recursive: true });
  const projectFile = path.join(projectDirectory, `${name}.uefnproject`);
  fs.writeFileSync(projectFile, JSON.stringify({ title, plugins: [{ name, bIsRoot: true }], bEnablePythonForProject: true }));
  return projectFile;
}

function withTestLocalAppData<T>(root: string, callback: (root: string) => T): T {
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    return callback(root);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
  }
}

test('drive classification includes fixed volumes and excludes removable, optical, and network volumes', () => {
  assert.equal(classifyDriveType(0), 'unknown');
  assert.equal(classifyDriveType(2), 'removable');
  assert.equal(classifyDriveType(3), 'fixed');
  assert.equal(classifyDriveType(4), 'network');
  assert.equal(classifyDriveType(5), 'optical');
  assert.deepEqual(fixedLocalDrives([
    { root: 'C:\\', kind: 'fixed' },
    { root: 'D:\\', kind: 'network' },
    { root: 'E:\\', kind: 'fixed' },
    { root: 'F:\\', kind: 'removable' },
  ]).map(drive => drive.root), ['C:\\', 'E:\\']);
});

test('discovery cache round trips paths, roots, and manual selections atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-cache-'));
  try {
    const cachePath = path.join(root, 'state', 'project-discovery.json');
    const cache = {
      version: 1 as const,
      projectPaths: [path.join(root, 'One.uefnproject'), path.join(root, 'one.uefnproject')],
      roots: [path.join(root, 'Projects')],
      manuallySelectedPaths: [path.join(root, 'One.uefnproject')],
    };
    assert.equal(writeDiscoveryCache(cache, cachePath), true);
    assert.deepEqual(readDiscoveryCache(cachePath), {
      version: 1,
      projectPaths: [path.join(root, 'One.uefnproject')],
      roots: [path.join(root, 'Projects')],
      manuallySelectedPaths: [path.join(root, 'One.uefnproject')],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid cached projects appear immediately while stale cached paths are discarded', () => withTestLocalAppData(fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-immediate-')), localAppData => {
  try {
    const projectFile = makeProject(localAppData, 'CachedProject', 'Cached project');
    const cachePath = path.join(localAppData, 'project-discovery.json');
    writeDiscoveryCache({
      version: 1,
      projectPaths: [projectFile, path.join(localAppData, 'Missing', 'Missing.uefnproject')],
      roots: [],
      manuallySelectedPaths: [],
    }, cachePath);
    const discovery = new ProjectDiscovery({ cachePath, homeDirectory: localAppData, enumerateDrives: () => [], broadScanEnabled: false });
    const result = discovery.loadImmediate();
    assert.deepEqual(result.projects.map(project => project.name), ['Cached project']);
    assert.equal(result.cacheProjectsValidated, 1);
    assert.equal(result.cacheProjectsDiscarded, 1);
    discovery.flushCache();
    assert.deepEqual(readDiscoveryCache(cachePath).projectPaths, [projectFile]);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}));

test('manual project selection is cached and returned on the next immediate load', () => withTestLocalAppData(fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-manual-')), localAppData => {
  try {
    const projectFile = makeProject(localAppData, 'ManualProject');
    const cachePath = path.join(localAppData, 'project-discovery.json');
    const first = new ProjectDiscovery({ cachePath, homeDirectory: localAppData, enumerateDrives: () => [], broadScanEnabled: false });
    first.recordProject(projectFile, true);
    first.flushCache();
    const second = new ProjectDiscovery({ cachePath, homeDirectory: localAppData, enumerateDrives: () => [], broadScanEnabled: false });
    const result = second.loadImmediate();
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].source, 'browse');
    assert.equal(result.projects[0].sourceLabel, 'Selected project');
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}));

test('targeted and broad discovery deliver new projects incrementally and deduplicate paths', async () => withTestLocalAppData(fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-progressive-')), async localAppData => {
  try {
    const driveRoot = path.join(localAppData, 'D-drive');
    const projectFile = makeProject(path.join(driveRoot, 'Projects', 'Nested'), 'ProgressiveProject', 'Progressive project');
    const cachePath = path.join(localAppData, 'project-discovery.json');
    const discovery = new ProjectDiscovery({
      cachePath,
      homeDirectory: localAppData,
      enumerateDrives: () => [{ root: driveRoot, kind: 'fixed' }],
      broadScanEnabled: true,
      maxTargetDepth: 4,
      maxBroadDepth: 8,
    });
    assert.equal(discovery.loadImmediate().projects.length, 0);
    const events: string[] = [];
    const batches: string[][] = [];
    const stats = await discovery.start({
      onProjects: projects => { events.push('projects'); batches.push(projects.map(project => project.projectFile)); },
      onComplete: () => events.push('complete'),
    });
    assert.equal(stats.cancelled, false);
    assert.equal(batches.flat().filter(candidate => candidate.toLowerCase() === projectFile.toLowerCase()).length, 1);
    assert.ok(events.indexOf('projects') >= 0 && events.indexOf('projects') < events.indexOf('complete'));
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}));

test('a disappearing drive is isolated from a healthy fixed drive', async () => withTestLocalAppData(fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-drive-loss-')), async localAppData => {
  try {
    const goneDrive = path.join(localAppData, 'Gone-drive');
    const healthyDrive = path.join(localAppData, 'Healthy-drive');
    const projectFile = makeProject(healthyDrive, 'HealthyProject');
    const cachePath = path.join(localAppData, 'project-discovery.json');
    const discovery = new ProjectDiscovery({
      cachePath,
      homeDirectory: localAppData,
      enumerateDrives: () => [{ root: goneDrive, kind: 'fixed' }, { root: healthyDrive, kind: 'fixed' }],
      broadScanEnabled: true,
    });
    const found: string[] = [];
    const stats = await discovery.start({ onProjects: projects => found.push(...projects.map(project => project.projectFile)) });
    assert.equal(stats.cancelled, false);
    assert.ok(stats.inaccessibleDirectories >= 1);
    assert.equal(found.filter(candidate => candidate.toLowerCase() === projectFile.toLowerCase()).length, 1);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}));

test('excluded trees do not yield projects and cancellation is reported without aborting cache cleanup', async () => withTestLocalAppData(fs.mkdtempSync(path.join(os.tmpdir(), 'uem-discovery-safety-')), async localAppData => {
  try {
    const driveRoot = path.join(localAppData, 'E-drive');
    makeProject(path.join(driveRoot, 'node_modules', 'hidden'), 'ExcludedProject');
    const cachePath = path.join(localAppData, 'project-discovery.json');
    const discovery = new ProjectDiscovery({
      cachePath,
      homeDirectory: localAppData,
      enumerateDrives: () => [{ root: driveRoot, kind: 'fixed' }],
      broadScanEnabled: true,
      maxBroadDepth: 8,
    });
    const immediate = discovery.loadImmediate();
    assert.equal(immediate.projects.length, 0);
    const promise = discovery.start({ onProjects: () => assert.fail('Excluded project was discovered') });
    discovery.cancel();
    const stats = await promise;
    assert.equal(stats.cancelled, true);
    assert.ok(fs.existsSync(cachePath));
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}));
