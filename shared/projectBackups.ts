import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function normalized(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(normalized(root), normalized(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function backupRootOutsideProject(contentRoot: string): string {
  const projectRoot = normalized(contentRoot);
  const candidates = [process.env.LOCALAPPDATA, os.tmpdir()].filter((candidate): candidate is string => Boolean(candidate));
  const parent = candidates.find(candidate => !isInside(projectRoot, candidate));
  if (!parent) throw new Error('No private backup location outside the selected project is available.');
  return path.join(parent, 'UEFN Entitlement Manager', 'backups');
}

export function projectBackupDirectory(contentRoot: string, projectFile?: string): string {
  const identity = normalized(projectFile || contentRoot);
  const projectKey = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const directory = path.join(backupRootOutsideProject(contentRoot), projectKey);
  if (isInside(contentRoot, directory)) throw new Error('The calculated backup directory is inside the selected project.');
  return directory;
}

export function createProjectBackup(sourcePath: string, contentRoot: string, projectFile?: string): string {
  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('The existing project file could not be backed up.');
  if (!isInside(contentRoot, source)) throw new Error('The backup source is outside the selected project Content root.');

  const directory = projectBackupDirectory(contentRoot, projectFile);
  fs.mkdirSync(directory, { recursive: true });
  // Repeated saves of unchanged content must not push real history out of the retention window.
  const newest = listBackupsInDirectory(directory, path.basename(source))[0];
  if (newest && newest.size === fs.statSync(source).size) {
    const newestPath = path.join(directory, newest.name);
    if (fs.readFileSync(newestPath).equals(fs.readFileSync(source))) return newestPath;
  }
  // Strictly newer than the last backup so newest-first order never depends on the random suffix.
  const createdAt = Math.max(Date.now(), newest ? Date.parse(newest.createdAt) + 1 : 0);
  const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  const fileName = `${path.basename(source)}.${timestamp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.bak`;
  const backupPath = path.join(directory, fileName);
  if (isInside(contentRoot, backupPath)) throw new Error('The backup path is inside the selected project.');
  fs.copyFileSync(source, backupPath, fs.constants.COPYFILE_EXCL);
  pruneProjectBackups(directory, path.basename(source));
  return backupPath;
}

/** Backups kept per source file. Older ones are removed after each new backup. */
export const MAX_BACKUPS_PER_FILE = 5;

// <source>.<ISO timestamp with - for : and .>.<pid>.<8 hex>.bak, exactly as createProjectBackup writes them.
const BACKUP_NAME_PATTERN = /^(.+\.verse)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.\d+\.[0-9a-f]{8}\.bak$/i;

export interface ProjectBackupEntry {
  name: string;
  sourceFileName: string;
  createdAt: string;
  size: number;
}

function parseBackupName(name: string): { sourceFileName: string; createdAt: string } | null {
  const match = BACKUP_NAME_PATTERN.exec(name);
  if (!match) return null;
  const [, sourceFileName, stamp] = match;
  const createdAt = `${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(14, 16)}:${stamp.slice(17, 19)}.${stamp.slice(20, 23)}Z`;
  return Number.isFinite(Date.parse(createdAt)) ? { sourceFileName, createdAt } : null;
}

/** Backups UTM created in this directory, newest first. Unrecognized files are ignored. */
export function listBackupsInDirectory(directory: string, sourceFileName?: string): ProjectBackupEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups: ProjectBackupEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseBackupName(entry.name);
    if (!parsed || (sourceFileName && parsed.sourceFileName.toLowerCase() !== sourceFileName.toLowerCase())) continue;
    try {
      backups.push({ name: entry.name, ...parsed, size: fs.statSync(path.join(directory, entry.name)).size });
    } catch {
      // A backup removed while listing is simply skipped.
    }
  }
  return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.name.localeCompare(left.name));
}

export function pruneProjectBackups(directory: string, sourceFileName: string, keep = MAX_BACKUPS_PER_FILE): number {
  let removed = 0;
  for (const stale of listBackupsInDirectory(directory, sourceFileName).slice(keep)) {
    try {
      fs.rmSync(path.join(directory, stale.name), { force: true });
      removed += 1;
    } catch {
      // Retry on the next backup.
    }
  }
  return removed;
}

export function listProjectBackups(contentRoot: string, projectFile: string | undefined, sourceFileName: string): ProjectBackupEntry[] {
  return listBackupsInDirectory(projectBackupDirectory(contentRoot, projectFile), sourceFileName);
}

/** Resolve a backup by its listed name; rejects anything that is not a UTM backup in this project's directory. */
export function resolveProjectBackup(contentRoot: string, projectFile: string | undefined, name: unknown): { filePath: string; entry: ProjectBackupEntry } {
  if (typeof name !== 'string' || name !== path.basename(name) || !parseBackupName(name)) throw new Error('Choose a backup from the list.');
  const directory = projectBackupDirectory(contentRoot, projectFile);
  const entry = listBackupsInDirectory(directory).find(candidate => candidate.name === name);
  if (!entry) throw new Error('That backup no longer exists.');
  return { filePath: path.join(directory, name), entry };
}
