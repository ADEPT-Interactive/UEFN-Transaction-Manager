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
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${path.basename(source)}.${timestamp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.bak`;
  const backupPath = path.join(directory, fileName);
  if (isInside(contentRoot, backupPath)) throw new Error('The backup path is inside the selected project.');
  fs.copyFileSync(source, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}
