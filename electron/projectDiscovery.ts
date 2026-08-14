import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCandidate, ProjectSource } from './contracts.js';

const OPENED_PROJECT_PATTERN = /Successfully opened project '([^']+\.uefnproject)'/gi;
const TITLE_PATTERN = /"title"\s*:\s*"([^"]+)"/i;
const ROOT_PLUGIN_PATTERN = /\{[^{}]*"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"[^{}]*"bIsRoot"\s*:\s*true[^{}]*\}/is;
const PYTHON_ENABLED_PATTERN = /"bEnablePythonForProject"\s*:\s*true/i;
const VALID_MOUNT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IGNORED_DIRECTORIES = new Set([
  '.git', '.urc', '.vs', 'Binaries', 'Build', 'Config', 'Content', 'DerivedDataCache',
  'Intermediate', 'Plugins', 'Saved', 'Verse', 'node_modules',
].map(value => value.toLowerCase()));

export type DiagnosticWriter = (message: string) => void;

interface UefnProcess {
  processId: number;
  windowTitle?: string;
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

function canonicalProjectPath(rawPath: string): string {
  const fullPath = path.resolve(rawPath.trim().replace(/^"|"$/g, '').replaceAll('/', path.sep));
  return fs.realpathSync.native(fullPath);
}

function sourceLabel(source: ProjectSource, isActive: boolean): string {
  if (isActive) return 'Open in UEFN';
  if (source === 'last-opened') return 'Last opened';
  if (source === 'recent') return 'Recent project';
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

function addPath(paths: Map<string, { source: ProjectSource; active: boolean }>, rawPath: string | null, source: ProjectSource, active: boolean) {
  if (!rawPath?.trim()) return;
  try {
    const candidate = path.resolve(rawPath.trim().replace(/^"|"$/g, '').replaceAll('/', path.sep));
    const key = candidate.toLowerCase();
    const priorities: Record<ProjectSource, number> = { active: 0, 'last-opened': 1, recent: 2, discovered: 3, browse: 4, 'command-line': 5 };
    const existing = paths.get(key);
    if (!existing || active || priorities[source] < priorities[existing.source]) paths.set(key, { source: active ? 'active' : source, active: active || Boolean(existing?.active) });
  } catch {
    // Invalid paths are rejected again by readProject; discovery remains best-effort.
  }
}

function discoverUnder(paths: Map<string, { source: ProjectSource; active: boolean }>, root: string, writeDiagnostic: DiagnosticWriter) {
  if (!fs.existsSync(root)) return;
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift()!;
    try {
      const entries = fs.readdirSync(current.directory, { withFileTypes: true });
      const descriptors = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.uefnproject'));
      for (const descriptor of descriptors) addPath(paths, path.join(current.directory, descriptor.name), 'discovered', false);
      if (descriptors.length > 0 || current.depth >= 4) continue;
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        pending.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }
    } catch (error) {
      writeDiagnostic(`Project discovery under ${current.directory} was incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function discoverProjects(writeDiagnostic: DiagnosticWriter = () => undefined): ProjectCandidate[] {
  const paths = new Map<string, { source: ProjectSource; active: boolean }>();
  const uefnProcesses = listUefnProcesses(writeDiagnostic);
  const activePath = uefnProcesses.length > 0 ? readActiveProjectFromCurrentLog(writeDiagnostic) : null;
  addPath(paths, activePath, 'active', true);

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

  discoverUnder(paths, path.join(os.homedir(), 'Documents', 'UEFN Projects'), writeDiagnostic);
  discoverUnder(paths, path.join(os.homedir(), 'Documents', 'Fortnite Projects'), writeDiagnostic);
  const activeProcess = uefnProcesses.sort((left, right) => right.processId - left.processId)[0];
  const priorities: Record<ProjectSource, number> = { active: 0, 'last-opened': 1, recent: 2, discovered: 3, browse: 4, 'command-line': 5 };
  return [...paths.entries()].flatMap(([projectFile, entry]) => {
    const project = readProject(projectFile, entry.source, entry.active, entry.active ? activeProcess : undefined, writeDiagnostic);
    return project ? [project] : [];
  }).sort((left, right) => priorities[left.source] - priorities[right.source]
    || right.lastModifiedUtc.localeCompare(left.lastModifiedUtc)
    || left.name.localeCompare(right.name));
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
