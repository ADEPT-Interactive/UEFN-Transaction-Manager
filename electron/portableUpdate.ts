import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareSemver } from '../src/services/update.js';
import type { PortableMarker } from './distributionMode.js';

const execFileAsync = promisify(execFile);
const portableExecutableName = 'UEFN Transaction Manager.exe';

export interface PortableUpdateManifest {
  version: string;
  filename: string;
  sha256: string;
  size?: number;
  path?: string;
  notes?: string;
}

export interface PortableArchiveInspection {
  root: string;
  executablePath: string;
  marker: PortableMarker;
  files: string[];
}

export interface VerifiedPortableUpdate {
  archivePath: string;
  manifest: PortableUpdateManifest;
  inspection: PortableArchiveInspection;
}

export function parsePortableUpdateManifest(value: unknown): PortableUpdateManifest {
  if (!value || typeof value !== 'object') throw new Error('Portable update metadata is not an object.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string' || typeof candidate.filename !== 'string' || typeof candidate.sha256 !== 'string') throw new Error('Portable update metadata must declare version, filename, and sha256.');
  if (!candidate.filename || candidate.filename.includes('/') || candidate.filename.includes('\\') || candidate.filename === '.' || candidate.filename === '..') throw new Error('Portable update metadata contains an unsafe filename.');
  compareSemver(candidate.version, '0.0.0');
  if (!/^[a-f0-9]{64}$/i.test(candidate.sha256)) throw new Error('Portable update metadata contains an invalid SHA-256 digest.');
  if (candidate.size !== undefined && (!Number.isInteger(candidate.size) || Number(candidate.size) < 1)) throw new Error('Portable update metadata contains an invalid byte size.');
  if (candidate.path !== undefined && typeof candidate.path !== 'string') throw new Error('Portable update metadata contains an invalid path.');
  return {
    version: candidate.version,
    filename: candidate.filename,
    sha256: candidate.sha256.toLowerCase(),
    ...(candidate.size === undefined ? {} : { size: Number(candidate.size) }),
    ...(candidate.path === undefined ? {} : { path: candidate.path }),
    ...(typeof candidate.notes === 'string' ? { notes: candidate.notes } : {}),
  };
}

export function portableUpdateUrl(feedRoot: string, manifest: PortableUpdateManifest): string {
  const relative = manifest.path ?? manifest.filename;
  if (!relative || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '')) throw new Error('Portable update metadata contains an unsafe archive path.');
  return new URL(relative, feedRoot.endsWith('/') ? feedRoot : `${feedRoot}/`).toString();
}

export async function sha256File(filePath: string): Promise<{ digest: string; size: number }> {
  const hash = crypto.createHash('sha256');
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => { hash.update(chunk); size += chunk.length; });
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return { digest: hash.digest('hex'), size };
}

async function runPowerShell(script: string, args: string[]) {
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  await visit(root);
  return output.sort();
}

export async function extractPortableArchive(archivePath: string, destinationRoot: string): Promise<PortableArchiveInspection> {
  await fsp.mkdir(destinationRoot, { recursive: true });
  const script = `$archive = $args[0]; $destination = $args[1]; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force`;
  await runPowerShell(script, [archivePath, destinationRoot]);
  const candidates = [destinationRoot, ...(await fsp.readdir(destinationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(destinationRoot, entry.name))];
  for (const root of candidates) {
    const markerPath = path.join(root, 'portable.json');
    const executablePath = path.join(root, portableExecutableName);
    if (!fs.existsSync(markerPath) || !fs.existsSync(executablePath)) continue;
    let marker: PortableMarker;
    try { marker = JSON.parse(await fsp.readFile(markerPath, 'utf8')) as PortableMarker; } catch { continue; }
    if (marker.distribution !== 'portable' || marker.schemaVersion !== 1 || !Array.isArray(marker.managedFiles) || !marker.managedFiles.includes('portable.json')) continue;
    const files = await listFiles(root);
    if (!files.includes('resources/app/dist-electron/main.cjs')) continue;
    return { root, executablePath, marker, files };
  }
  throw new Error('The downloaded archive is missing a valid portable marker or UTM executable.');
}

export async function verifyPortableDownload(input: {
  archivePath: string;
  manifest: PortableUpdateManifest;
  extractTo: string;
  inspect?: (archivePath: string, destinationRoot: string) => Promise<PortableArchiveInspection>;
}): Promise<VerifiedPortableUpdate> {
  const { digest, size } = await sha256File(input.archivePath);
  if (digest !== input.manifest.sha256) throw new Error('The portable update SHA-256 does not match its metadata.');
  if (input.manifest.size !== undefined && size !== input.manifest.size) throw new Error('The portable update byte size does not match its metadata.');
  const inspection = await (input.inspect ?? extractPortableArchive)(input.archivePath, input.extractTo);
  if (inspection.marker.version !== input.manifest.version) throw new Error('The portable archive marker version does not match its metadata.');
  if (inspection.marker.distribution !== 'portable' || !inspection.marker.managedFiles.includes('portable.json')) throw new Error('The downloaded archive marker is incomplete.');
  return { archivePath: input.archivePath, manifest: input.manifest, inspection };
}

export interface PortableUpdatePlan {
  currentRoot: string;
  stagedRoot: string;
  processId: number;
  relaunchPath: string;
  relaunchArguments?: string[];
  resultPath: string;
  cleanupRoot: string;
}

export function createPortableUpdatePlan(input: Omit<PortableUpdatePlan, 'resultPath' | 'cleanupRoot'> & { resultPath?: string; cleanupRoot?: string }): PortableUpdatePlan {
  return {
    ...input,
    resultPath: input.resultPath ?? path.join(os.tmpdir(), `uem-portable-update-result-${process.pid}-${Date.now()}.json`),
    cleanupRoot: input.cleanupRoot ?? path.dirname(input.stagedRoot),
  };
}

export async function writePortableUpdatePlan(planPath: string, plan: PortableUpdatePlan): Promise<void> {
  await fsp.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
}

export { portableExecutableName };
