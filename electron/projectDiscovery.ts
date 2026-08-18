import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import koffi from 'koffi';
import type { ProjectCandidate, ProjectSource } from './contracts.js';

const OPENED_PROJECT_PATTERN = /Successfully opened project '([^']+\.uefnproject)'/gi;
const TITLE_PATTERN = /"title"\s*:\s*"([^"]+)"/i;
const ROOT_PLUGIN_PATTERN = /\{[^{}]*"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"[^{}]*"bIsRoot"\s*:\s*true[^{}]*\}/is;
const PYTHON_ENABLED_PATTERN = /"bEnablePythonForProject"\s*:\s*true/i;
const VALID_MOUNT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CACHE_VERSION = 1;
const MAX_CACHE_PROJECTS = 500;
const MAX_CACHE_ROOTS = 100;
const PROJECT_BATCH_SIZE = 8;
const TARGET_SCAN_DEPTH = 4;
const BROAD_SCAN_DEPTH = 8;
const TARGET_DIRECTORY_BUDGET = 5_000;
const BROAD_DIRECTORY_BUDGET = 25_000;
const DRIVE_SCAN_CONCURRENCY = 2;
const YIELD_AFTER_DIRECTORIES = 8;

const IGNORED_DIRECTORIES = new Set([
  '$recycle.bin', 'appdata', 'binaries', 'build', 'cache', 'config', 'content', 'deriveddatacache',
  'dist', 'dist-electron', 'epicgameslauncher', 'intermediate', 'library', 'node_modules',
  'packages', 'perflogs', 'program files', 'program files (x86)', 'programdata', 'release',
  'plugins', 'saved', 'system volume information', 'temp', 'verse', 'windows', '.git', '.hg', '.idea',
  '.npm', '.nuget', '.pnpm-store', '.urc', '.vs', '__pycache__',
].map(value => value.toLowerCase()));

const TARGETED_DIRECTORY_NAMES = ['UEFN Projects', 'Fortnite Projects', 'Unreal Projects', 'Projects', 'Games'];

export type DiagnosticWriter = (message: string) => void;

interface UefnProcess {
  processId: number;
  windowTitle?: string;
}

export type DriveKind = 'fixed' | 'removable' | 'network' | 'optical' | 'unknown';

export interface DriveInfo {
  root: string;
  kind: DriveKind;
}

export interface DiscoveryCache {
  version: 1;
  projectPaths: string[];
  roots: string[];
  manuallySelectedPaths: string[];
}

export interface DiscoveryStats {
  startedAtUtc: string;
  completedAtUtc: string;
  durationMs: number;
  drivesConsidered: number;
  targetedRoots: number;
  broadRoots: number;
  directoriesVisited: number;
  candidatesFound: number;
  inaccessibleDirectories: number;
  cancelled: boolean;
}

export interface ImmediateDiscoveryResult {
  projects: ProjectCandidate[];
  preferredProjectId: string | null;
  cacheProjectsValidated: number;
  cacheProjectsDiscarded: number;
  durationMs: number;
}

export interface DiscoveryCallbacks {
  onProjects: (projects: ProjectCandidate[]) => void;
  onComplete?: (stats: DiscoveryStats) => void;
}

export interface ProjectDiscoveryOptions {
  cachePath?: string;
  homeDirectory?: string;
  enumerateDrives?: (writeDiagnostic: DiagnosticWriter) => DriveInfo[];
  writeDiagnostic?: DiagnosticWriter;
  backgroundScanEnabled?: boolean;
  broadScanEnabled?: boolean;
  maxTargetDepth?: number;
  maxBroadDepth?: number;
  targetDirectoryBudget?: number;
  broadDirectoryBudget?: number;
}

interface PathSource {
  source: ProjectSource;
  active: boolean;
  manuallySelected?: boolean;
}

interface ScanContext {
  cancelled: () => boolean;
  visitedDirectories: Set<string>;
  directoryBudgets: Map<string, number>;
  stats: DiscoveryStats;
  writeDiagnostic: DiagnosticWriter;
  emittedProjectIds: Set<string>;
  onProjects: (projects: ProjectCandidate[]) => void;
  pendingProjects: ProjectCandidate[];
}

interface ScanRoot {
  root: string;
  driveRoot: string;
}

interface WindowsDriveApi {
  getLogicalDrives: () => number;
  getDriveType: (root: string) => number;
}

function loadWindowsDriveApi(): WindowsDriveApi | null {
  if (process.platform !== 'win32') return null;
  try {
    const kernel32 = koffi.load('kernel32.dll');
    return {
      getLogicalDrives: kernel32.func('uint32_t __stdcall GetLogicalDrives()') as () => number,
      getDriveType: kernel32.func('uint32_t __stdcall GetDriveTypeW(const char16_t *rootPathName)') as (root: string) => number,
    };
  } catch {
    return null;
  }
}

const windowsDriveApi = loadWindowsDriveApi();

export function classifyDriveType(rawType: number): DriveKind {
  if (rawType === 2) return 'removable';
  if (rawType === 3) return 'fixed';
  if (rawType === 4) return 'network';
  if (rawType === 5) return 'optical';
  return 'unknown';
}

export function fixedLocalDrives(drives: DriveInfo[]): DriveInfo[] {
  return drives.filter(drive => drive.kind === 'fixed');
}

export function enumerateLocalDrives(writeDiagnostic: DiagnosticWriter = () => undefined): DriveInfo[] {
  if (process.platform !== 'win32') return [];
  if (!windowsDriveApi) {
    writeDiagnostic('Windows drive enumeration is unavailable; automatic discovery is disabled for this session.');
    return [];
  }
  try {
    const mask = windowsDriveApi.getLogicalDrives();
    const drives: DriveInfo[] = [];
    for (let index = 0; index < 26; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const letter = String.fromCharCode(65 + index);
      const root = `${letter}:\\`;
      drives.push({ root, kind: classifyDriveType(windowsDriveApi.getDriveType(root)) });
    }
    return drives;
  } catch (error) {
    writeDiagnostic(`Windows drive enumeration failed; automatic discovery is disabled for this session: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  values.push(value);
  return values;
}

export function listUefnProcesses(writeDiagnostic: DiagnosticWriter = () => undefined): UefnProcess[] {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync('tasklist.exe', [
      '/FI', 'IMAGENAME eq UnrealEditorFortnite-Win64-Shipping.exe', '/V', '/FO', 'CSV', '/NH',
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return output.split(/\r?\n/).filter(Boolean).map(parseCsvLine).flatMap(columns => {
      const processId = Number(columns[1]);
      if (!Number.isInteger(processId) || processId <= 0) return [];
      const rawTitle = columns[columns.length - 1]?.trim();
      return [{ processId, windowTitle: rawTitle && rawTitle !== 'N/A' ? rawTitle : undefined }];
    });
  } catch (error) {
    writeDiagnostic(`UEFN process discovery was unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function readActiveProjectFromCurrentLog(writeDiagnostic: DiagnosticWriter): string | null {
  const logPath = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UnrealEditorFortnite', 'Saved', 'Logs', 'UnrealEditorFortnite.log');
  if (!fs.existsSync(logPath)) return null;
  try {
    const text = fs.readFileSync(logPath, 'utf8');
    let latest: string | null = null;
    for (const match of text.matchAll(OPENED_PROJECT_PATTERN)) latest = match[1];
    return latest;
  } catch (error) {
    writeDiagnostic(`The current UEFN log could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function cleanRawPath(rawPath: string): string {
  return rawPath.trim().replace(/^"|"$/g, '').replaceAll('/', path.sep);
}

function normalizedPathKey(rawPath: string): string {
  const resolved = path.resolve(cleanRawPath(rawPath));
  return process.platform === 'win32' ? path.win32.normalize(resolved).toLowerCase() : path.normalize(resolved);
}

function canonicalProjectPath(rawPath: string): string {
  return fs.realpathSync.native(path.resolve(cleanRawPath(rawPath)));
}

function driveRootFor(rawPath: string): string | null {
  const parsed = path.win32.parse(rawPath.replaceAll('/', '\\'));
  if (!/^[A-Za-z]:\\$/.test(parsed.root)) return null;
  return parsed.root.toUpperCase();
}

function isAutomaticallyReadablePath(rawPath: string, drives: DriveInfo[]): boolean {
  if (process.platform !== 'win32' || drives.length === 0) return true;
  if (rawPath.replaceAll('/', '\\').startsWith('\\\\')) return false;
  const root = driveRootFor(rawPath);
  if (!root) return false;
  return drives.some(drive => drive.root.toUpperCase() === root && drive.kind === 'fixed');
}

function sourceLabel(source: ProjectSource, isActive: boolean): string {
  if (isActive || source === 'active') return 'Open in UEFN';
  if (source === 'last-opened') return 'Last opened';
  if (source === 'recent') return 'Recent project';
  if (source === 'cached') return 'Known project';
  if (source === 'browse') return 'Selected project';
  return 'Project found';
}

export function readProject(
  rawPath: string,
  source: ProjectSource,
  isActive: boolean,
  uefnProcess: UefnProcess | undefined,
  writeDiagnostic: DiagnosticWriter = () => undefined,
): ProjectCandidate | null {
  try {
    const projectFile = canonicalProjectPath(rawPath);
    if (!projectFile.toLowerCase().endsWith('.uefnproject') || !fs.statSync(projectFile).isFile()) return null;
    const projectDirectory = path.dirname(projectFile);
    const descriptor = fs.readFileSync(projectFile, 'utf8');
    const fallbackName = path.basename(projectFile, path.extname(projectFile));
    const title = TITLE_PATTERN.exec(descriptor)?.[1]?.trim() || fallbackName;
    const rootPlugin = ROOT_PLUGIN_PATTERN.exec(descriptor)?.[1] || fallbackName;
    if (!VALID_MOUNT.test(rootPlugin)) return null;
    const contentDirectory = [
      path.join(projectDirectory, 'Content'),
      path.join(projectDirectory, 'Plugins', rootPlugin, 'Content'),
    ].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
    if (!contentDirectory) return null;
    const canonicalContent = fs.realpathSync.native(contentDirectory);
    const active = Boolean(isActive && uefnProcess);
    return {
      id: crypto.createHash('sha256').update(projectFile.toLowerCase()).digest('hex'),
      projectFile,
      contentDirectory: canonicalContent,
      name: title,
      assetMount: rootPlugin,
      source: active ? 'active' : source,
      sourceLabel: sourceLabel(source, active),
      isActive: active,
      pythonEnabled: PYTHON_ENABLED_PATTERN.test(descriptor),
      lastModifiedUtc: fs.statSync(projectFile).mtime.toISOString(),
      uefnProcessId: active ? uefnProcess!.processId : 0,
      uefnWindowTitle: active ? uefnProcess!.windowTitle : undefined,
    };
  } catch (error) {
    writeDiagnostic(`UEFN project candidate was rejected: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function emptyCache(): DiscoveryCache {
  return { version: 1, projectPaths: [], roots: [], manuallySelectedPaths: [] };
}

export function defaultDiscoveryCachePath(baseDirectory = process.env.LOCALAPPDATA ?? os.tmpdir()): string {
  return path.join(baseDirectory, 'UEFN Entitlement Manager', 'project-discovery.json');
}

function boundedPathList(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const clean = cleanRawPath(value);
    const key = normalizedPathKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

export function readDiscoveryCache(cachePath = defaultDiscoveryCachePath(), writeDiagnostic: DiagnosticWriter = () => undefined): DiscoveryCache {
  try {
    if (!fs.existsSync(cachePath)) return emptyCache();
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) return emptyCache();
    const record = parsed as Partial<DiscoveryCache>;
    return {
      version: 1,
      projectPaths: boundedPathList(record.projectPaths, MAX_CACHE_PROJECTS),
      roots: boundedPathList(record.roots, MAX_CACHE_ROOTS),
      manuallySelectedPaths: boundedPathList(record.manuallySelectedPaths, MAX_CACHE_PROJECTS),
    };
  } catch (error) {
    writeDiagnostic(`Project discovery cache could not be read and will be rebuilt: ${error instanceof Error ? error.message : String(error)}`);
    return emptyCache();
  }
}

export function writeDiscoveryCache(
  cache: DiscoveryCache,
  cachePath = defaultDiscoveryCachePath(),
  writeDiagnostic: DiagnosticWriter = () => undefined,
): boolean {
  const normalized: DiscoveryCache = {
    version: 1,
    projectPaths: boundedPathList(cache.projectPaths, MAX_CACHE_PROJECTS),
    roots: boundedPathList(cache.roots, MAX_CACHE_ROOTS),
    manuallySelectedPaths: boundedPathList(cache.manuallySelectedPaths, MAX_CACHE_PROJECTS),
  };
  const temporaryPath = `${cachePath}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { ['recursive']: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    try {
      fs.renameSync(temporaryPath, cachePath);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(code)) throw error;
      fs.rmSync(cachePath, { force: true });
      fs.renameSync(temporaryPath, cachePath);
    }
    return true;
  } catch (error) {
    writeDiagnostic(`Project discovery cache could not be written: ${error instanceof Error ? error.message : String(error)}`);
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort cleanup */ }
    return false;
  }
}

function addPath(
  paths: Map<string, PathSource>,
  rawPath: string | null,
  source: ProjectSource,
  active: boolean,
  manuallySelected = false,
) {
  if (!rawPath?.trim()) return;
  try {
    const candidate = path.resolve(cleanRawPath(rawPath));
    const key = normalizedPathKey(candidate);
    const priorities: Record<ProjectSource, number> = {
      active: 0, 'last-opened': 1, recent: 2, cached: 3, discovered: 4, browse: 5, 'command-line': 6,
    };
    const existing = paths.get(key);
    if (!existing || active || priorities[source] < priorities[existing.source]) {
      paths.set(key, { source: active ? 'active' : source, active: active || Boolean(existing?.active), manuallySelected: manuallySelected || Boolean(existing?.manuallySelected) });
    }
  } catch {
    // Invalid paths are rejected again by readProject; discovery remains best-effort.
  }
}

function readRecentProjectPaths(writeDiagnostic: DiagnosticWriter): { paths: Map<string, PathSource>; activeProcess?: UefnProcess } {
  const paths = new Map<string, PathSource>();

  const settingsPath = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UnrealEditorFortnite', 'Saved', 'Config', 'WindowsEditor', 'EditorPerProjectUserSettings.ini');
  if (fs.existsSync(settingsPath)) {
    try {
      for (const line of fs.readFileSync(settingsPath, 'utf8').split(/\r?\n/)) {
        if (line.toLowerCase().startsWith('lastprojectfilename=')) addPath(paths, line.slice(line.indexOf('=') + 1), 'last-opened', false);
        else if (line.toLowerCase().startsWith('additionalprojectfiles=')) addPath(paths, line.slice(line.indexOf('=') + 1), 'recent', false);
      }
    } catch (error) {
      writeDiagnostic(`Recent UEFN project settings could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { paths };
}

function sortProjects(projects: ProjectCandidate[]): ProjectCandidate[] {
  const priorities: Record<ProjectSource, number> = {
    active: 0, 'last-opened': 1, recent: 2, cached: 3, discovered: 4, browse: 5, 'command-line': 6,
  };
  return [...projects].sort((left, right) => priorities[left.source] - priorities[right.source]
    || right.lastModifiedUtc.localeCompare(left.lastModifiedUtc)
    || left.name.localeCompare(right.name)
    || left.projectFile.localeCompare(right.projectFile));
}

function projectDirectory(projectFile: string): string {
  return path.dirname(projectFile);
}

function parentDiscoveryRoot(projectFile: string): string | null {
  const directory = projectDirectory(projectFile);
  const parent = path.dirname(directory);
  return parent === directory ? null : parent;
}

function addLearnedRoots(roots: Set<string>, projectFile: string, includeProjectDirectory = false) {
  if (includeProjectDirectory) roots.add(projectDirectory(projectFile));
  const parent = parentDiscoveryRoot(projectFile);
  if (parent && driveRootFor(parent) && normalizedPathKey(parent) !== normalizedPathKey(driveRootFor(parent)!)) roots.add(parent);
}

function isExcludedDirectory(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function isProjectDescriptor(name: string): boolean {
  return name.toLowerCase().endsWith('.uefnproject');
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function flushProjects(context: ScanContext) {
  if (context.pendingProjects.length === 0) return;
  const batch = context.pendingProjects.splice(0, context.pendingProjects.length);
  context.onProjects(batch);
  await yieldToEventLoop();
}

async function scanRoot(
  scanRootInfo: ScanRoot,
  context: ScanContext,
  maxDepth: number,
  directoryBudget: number,
) {
  const pending: Array<{ directory: string; depth: number }> = [{ directory: scanRootInfo.root, depth: 0 }];
  let directoriesSinceYield = 0;
  while (pending.length > 0 && !context.cancelled()) {
    const current = pending.shift()!;
    const budgetKey = scanRootInfo.driveRoot.toLowerCase();
    const used = context.directoryBudgets.get(budgetKey) ?? 0;
    if (used >= directoryBudget) {
      context.writeDiagnostic(`Project discovery stopped the ${scanRootInfo.driveRoot} scan at its ${directoryBudget} directory safety budget.`);
      break;
    }
    context.directoryBudgets.set(budgetKey, used + 1);

    let canonicalDirectory: string;
    try {
      canonicalDirectory = await fsPromises.realpath(current.directory);
    } catch (error) {
      context.stats.inaccessibleDirectories += 1;
      context.writeDiagnostic(`Project discovery skipped ${current.directory}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const canonicalKey = normalizedPathKey(canonicalDirectory);
    if (context.visitedDirectories.has(canonicalKey)) continue;
    context.visitedDirectories.add(canonicalKey);

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(canonicalDirectory, { withFileTypes: true });
    } catch (error) {
      context.stats.inaccessibleDirectories += 1;
      context.writeDiagnostic(`Project discovery could not read ${canonicalDirectory}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    context.stats.directoriesVisited += 1;
    let foundDescriptor = false;
    for (const entry of entries) {
      if (!isProjectDescriptor(entry.name) || !entry.isFile()) continue;
      foundDescriptor = true;
      context.stats.candidatesFound += 1;
      const project = readProject(path.join(canonicalDirectory, entry.name), 'discovered', false, undefined, context.writeDiagnostic);
      if (project && !context.emittedProjectIds.has(project.id)) {
        context.emittedProjectIds.add(project.id);
        context.pendingProjects.push(project);
        if (context.pendingProjects.length >= PROJECT_BATCH_SIZE) await flushProjects(context);
      }
    }
    if (!foundDescriptor && current.depth < maxDepth) {
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || isExcludedDirectory(entry.name)) continue;
        pending.push({ directory: path.join(canonicalDirectory, entry.name), depth: current.depth + 1 });
      }
    }
    directoriesSinceYield += 1;
    if (directoriesSinceYield >= YIELD_AFTER_DIRECTORIES) {
      directoriesSinceYield = 0;
      await flushProjects(context);
    }
  }
  await flushProjects(context);
}

async function runBounded<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>, cancelled: () => boolean) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!cancelled()) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item === undefined) return;
      try {
        await worker(item);
      } catch {
        // A single drive/root must never cancel the remaining workers.
      }
    }
  });
  await Promise.all(workers);
}

export class ProjectDiscovery {
  private readonly cachePath: string;
  private readonly homeDirectory: string;
  private readonly enumerateDrives: (writeDiagnostic: DiagnosticWriter) => DriveInfo[];
  private readonly writeDiagnostic: DiagnosticWriter;
  private readonly backgroundScanEnabled: boolean;
  private readonly broadScanEnabled: boolean;
  private readonly maxTargetDepth: number;
  private readonly maxBroadDepth: number;
  private readonly targetDirectoryBudget: number;
  private readonly broadDirectoryBudget: number;
  private cache: DiscoveryCache;
  private knownRoots = new Set<string>();
  private emittedProjectIds = new Set<string>();
  private cancelled = false;
  private cacheWriteTimer: NodeJS.Timeout | null = null;

  constructor(options: ProjectDiscoveryOptions = {}) {
    this.cachePath = options.cachePath ?? defaultDiscoveryCachePath();
    this.homeDirectory = options.homeDirectory ?? os.homedir();
    this.enumerateDrives = options.enumerateDrives ?? enumerateLocalDrives;
    this.writeDiagnostic = options.writeDiagnostic ?? (() => undefined);
    this.backgroundScanEnabled = options.backgroundScanEnabled ?? true;
    this.broadScanEnabled = options.broadScanEnabled ?? true;
    this.maxTargetDepth = options.maxTargetDepth ?? TARGET_SCAN_DEPTH;
    this.maxBroadDepth = options.maxBroadDepth ?? BROAD_SCAN_DEPTH;
    this.targetDirectoryBudget = options.targetDirectoryBudget ?? TARGET_DIRECTORY_BUDGET;
    this.broadDirectoryBudget = options.broadDirectoryBudget ?? BROAD_DIRECTORY_BUDGET;
    this.cache = readDiscoveryCache(this.cachePath, this.writeDiagnostic);
    for (const root of this.cache.roots) this.knownRoots.add(root);
  }

  loadImmediate(preferredProjectFile?: string): ImmediateDiscoveryResult {
    const started = Date.now();
    this.cancelled = false;
    this.emittedProjectIds.clear();
    const recent = readRecentProjectPaths(this.writeDiagnostic);
    const paths = recent.paths;
    const drives = this.enumerateDrives(this.writeDiagnostic);
    const manualPaths = new Set(this.cache.manuallySelectedPaths.map(normalizedPathKey));
    let validatedCacheProjects = 0;
    let discardedCacheProjects = 0;
    const validCachePaths: string[] = [];
    const deferredCachePaths: string[] = [];

    for (const cachedPath of this.cache.projectPaths) {
      const isManual = manualPaths.has(normalizedPathKey(cachedPath));
      if (!isManual && !isAutomaticallyReadablePath(cachedPath, drives)) {
        deferredCachePaths.push(cachedPath);
        continue;
      }
      addPath(paths, cachedPath, isManual ? 'browse' : 'cached', false, isManual);
    }
    addPath(paths, preferredProjectFile ?? null, 'command-line', false);

    const candidates = new Map<string, ProjectCandidate>();
    let preferredProjectId: string | null = null;
    const activeProcess = recent.activeProcess;
    for (const [rawPath, source] of paths) {
      if (!source.manuallySelected && source.source !== 'command-line' && !isAutomaticallyReadablePath(rawPath, drives)) continue;
      const project = readProject(rawPath, source.source, source.active, source.active ? activeProcess : undefined, this.writeDiagnostic);
      const isCached = source.source === 'cached' || source.source === 'browse' && source.manuallySelected;
      if (isCached) {
        if (project) {
          validatedCacheProjects += 1;
          validCachePaths.push(project.projectFile);
        } else discardedCacheProjects += 1;
      }
      if (!project) continue;
      candidates.set(project.id, project);
      if (preferredProjectFile && normalizedPathKey(project.projectFile) === normalizedPathKey(preferredProjectFile)) preferredProjectId = project.id;
      addLearnedRoots(this.knownRoots, project.projectFile, project.source === 'browse');
      this.emittedProjectIds.add(project.id);
    }

    this.cache.projectPaths = [...validCachePaths, ...deferredCachePaths];
    this.cache.projectPaths = [...new Set(this.cache.projectPaths.map(cleanRawPath))];
    const validCacheKeys = new Set(validCachePaths.map(normalizedPathKey));
    this.cache.manuallySelectedPaths = this.cache.manuallySelectedPaths.filter(cachedPath => validCacheKeys.has(normalizedPathKey(cachedPath)));
    const projectDirectories = new Set([...candidates.values()].map(project => normalizedPathKey(projectDirectory(project.projectFile))));
    this.knownRoots = new Set([...this.knownRoots].filter(root => !projectDirectories.has(normalizedPathKey(root))));
    for (const project of candidates.values()) addLearnedRoots(this.knownRoots, project.projectFile, project.source === 'browse');
    for (const project of candidates.values()) this.rememberProject(project.projectFile, project.source === 'browse');
    this.scheduleCacheWrite();

    const projects = sortProjects([...candidates.values()]);
    this.writeDiagnostic(`Project discovery immediate phase: projects=${projects.length}; cacheValidated=${validatedCacheProjects}; cacheDiscarded=${discardedCacheProjects}; durationMs=${Date.now() - started}`);
    return {
      projects,
      preferredProjectId,
      cacheProjectsValidated: validatedCacheProjects,
      cacheProjectsDiscarded: discardedCacheProjects,
      durationMs: Date.now() - started,
    };
  }

  recordProject(projectFile: string, manuallySelected = false) {
    const project = readProject(projectFile, manuallySelected ? 'browse' : 'cached', false, undefined, this.writeDiagnostic);
    if (!project) return;
    this.rememberProject(project.projectFile, manuallySelected);
    this.scheduleCacheWrite();
  }

  private rememberProject(projectFile: string, manuallySelected: boolean) {
    const clean = cleanRawPath(projectFile);
    const key = normalizedPathKey(clean);
    this.cache.projectPaths = [clean, ...this.cache.projectPaths.filter(value => normalizedPathKey(value) !== key)].slice(0, MAX_CACHE_PROJECTS);
    if (manuallySelected && !this.cache.manuallySelectedPaths.some(value => normalizedPathKey(value) === key)) {
      this.cache.manuallySelectedPaths = [clean, ...this.cache.manuallySelectedPaths].slice(0, MAX_CACHE_PROJECTS);
    }
    addLearnedRoots(this.knownRoots, clean, manuallySelected);
    this.cache.roots = [...this.knownRoots].slice(0, MAX_CACHE_ROOTS);
  }

  private scheduleCacheWrite() {
    if (this.cacheWriteTimer) clearTimeout(this.cacheWriteTimer);
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = null;
      writeDiscoveryCache(this.cache, this.cachePath, this.writeDiagnostic);
    }, 250);
    this.cacheWriteTimer.unref?.();
  }

  private buildTargetRoots(drives: DriveInfo[]): ScanRoot[] {
    const fixed = fixedLocalDrives(drives);
    const fixedRoots = new Map(fixed.map(drive => [drive.root.toUpperCase(), drive.root]));
    const roots = new Map<string, ScanRoot>();
    const addRoot = (rawRoot: string, driveRoot: string | null) => {
      if (!driveRoot || !fixedRoots.has(driveRoot)) return;
      const normalized = normalizedPathKey(rawRoot);
      if (!roots.has(normalized)) roots.set(normalized, { root: rawRoot, driveRoot });
    };

    for (const root of this.knownRoots) addRoot(root, driveRootFor(root));
    for (const drive of fixed) {
      for (const directoryName of TARGETED_DIRECTORY_NAMES) addRoot(path.join(drive.root, directoryName), drive.root.toUpperCase());
      const username = path.basename(this.homeDirectory);
      for (const directoryName of TARGETED_DIRECTORY_NAMES.slice(0, 2)) {
        addRoot(path.join(drive.root, 'Users', username, 'Documents', directoryName), drive.root.toUpperCase());
      }
    }
    return [...roots.values()];
  }

  async start(callbacks: DiscoveryCallbacks): Promise<DiscoveryStats> {
    this.cancelled = false;
    await yieldToEventLoop();
    const startedAt = new Date();
    const stats: DiscoveryStats = {
      startedAtUtc: startedAt.toISOString(),
      completedAtUtc: startedAt.toISOString(),
      durationMs: 0,
      drivesConsidered: 0,
      targetedRoots: 0,
      broadRoots: 0,
      directoriesVisited: 0,
      candidatesFound: 0,
      inaccessibleDirectories: 0,
      cancelled: false,
    };
    if (!this.backgroundScanEnabled) {
      stats.completedAtUtc = new Date().toISOString();
      stats.durationMs = Date.parse(stats.completedAtUtc) - Date.parse(stats.startedAtUtc);
      this.flushCache();
      callbacks.onComplete?.(stats);
      return stats;
    }
    const uefnProcesses = listUefnProcesses(this.writeDiagnostic);
    const activePath = uefnProcesses.length > 0 ? readActiveProjectFromCurrentLog(this.writeDiagnostic) : null;
    if (activePath && !this.cancelled) {
      const activeProject = readProject(activePath, 'active', true, uefnProcesses.sort((left, right) => right.processId - left.processId)[0], this.writeDiagnostic);
      if (activeProject) {
        this.emittedProjectIds.add(activeProject.id);
        this.rememberProject(activeProject.projectFile, false);
        callbacks.onProjects([activeProject]);
      }
    }
    const drives = this.enumerateDrives(this.writeDiagnostic);
    const fixed = fixedLocalDrives(drives);
    stats.drivesConsidered = fixed.length;
    const targetRoots = this.buildTargetRoots(drives);
    stats.targetedRoots = targetRoots.length;
    stats.broadRoots = this.broadScanEnabled ? fixed.length : 0;
    const context: ScanContext = {
      cancelled: () => this.cancelled,
      visitedDirectories: new Set<string>(),
      directoryBudgets: new Map<string, number>(),
      stats,
      writeDiagnostic: this.writeDiagnostic,
      emittedProjectIds: this.emittedProjectIds,
      pendingProjects: [],
      onProjects: batch => {
        const fresh = batch.filter(project => !this.cancelled);
        if (fresh.length === 0) return;
        for (const project of fresh) {
          this.rememberProject(project.projectFile, false);
        }
        this.scheduleCacheWrite();
        callbacks.onProjects(fresh);
      },
    };

    await runBounded(targetRoots, DRIVE_SCAN_CONCURRENCY, root => scanRoot(root, context, this.maxTargetDepth, this.targetDirectoryBudget), context.cancelled);
    if (this.broadScanEnabled && !this.cancelled) {
      const broadRoots: ScanRoot[] = fixed.map(drive => ({ root: drive.root, driveRoot: drive.root.toUpperCase() }));
      await runBounded(broadRoots, DRIVE_SCAN_CONCURRENCY, root => scanRoot(root, context, this.maxBroadDepth, this.broadDirectoryBudget), context.cancelled);
    }
    await flushProjects(context);
    stats.cancelled = this.cancelled;
    stats.completedAtUtc = new Date().toISOString();
    stats.durationMs = Date.parse(stats.completedAtUtc) - Date.parse(stats.startedAtUtc);
    this.flushCache();
    callbacks.onComplete?.(stats);
    return stats;
  }

  cancel() {
    this.cancelled = true;
    this.flushCache();
  }

  flushCache() {
    if (this.cacheWriteTimer) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    writeDiscoveryCache(this.cache, this.cachePath, this.writeDiagnostic);
  }
}

export function discoverProjects(writeDiagnostic: DiagnosticWriter = () => undefined): ProjectCandidate[] {
  return new ProjectDiscovery({ writeDiagnostic }).loadImmediate().projects;
}

export function projectIsOpen(projectFile: string, writeDiagnostic: DiagnosticWriter = () => undefined): UefnProcess | undefined {
  const activePath = readActiveProjectFromCurrentLog(writeDiagnostic);
  if (!activePath) return undefined;
  try {
    if (canonicalProjectPath(activePath).toLowerCase() !== canonicalProjectPath(projectFile).toLowerCase()) return undefined;
    return listUefnProcesses(writeDiagnostic).sort((left, right) => right.processId - left.processId)[0];
  } catch {
    return undefined;
  }
}
