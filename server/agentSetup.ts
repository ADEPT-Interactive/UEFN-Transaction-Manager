import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SupportedAgentId = 'codex' | 'claude' | 'cursor';

export interface AgentSkillInstallationStatus {
  id: SupportedAgentId;
  label: string;
  targetPath: string;
  installed: boolean;
  upToDate: boolean;
  managed: boolean;
  fileCount: number;
  error?: string;
}

export interface AgentSkillInstallResult extends AgentSkillInstallationStatus {
  success: boolean;
  changed: boolean;
}

interface InstallManifest {
  schemaVersion: 1;
  product: 'uefn-transaction-manager';
  sourceFingerprint: string;
  files: string[];
}

const definitions: Record<SupportedAgentId, { label: string; directory: string }> = {
  codex: { label: 'Codex', directory: '.agents' },
  claude: { label: 'Claude Code', directory: '.claude' },
  cursor: { label: 'Cursor', directory: '.cursor' },
};

function targetPathFor(agent: SupportedAgentId, homeDirectory: string): string {
  return path.join(homeDirectory, definitions[agent].directory, 'skills', 'uefn-transaction-manager');
}

function relativePath(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join('/');
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root) + path.sep;
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== path.resolve(root) && !resolvedCandidate.startsWith(resolvedRoot)) throw new Error('Agent Skill path escaped its owned directory.');
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const entries: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported in the Agent Skill: ${entry.name}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) entries.push(relativePath(root, fullPath));
      else throw new Error(`Unsupported Agent Skill entry: ${entry.name}`);
    }
  };
  visit(root);
  return entries.sort();
}

function fingerprint(root: string, files = listFiles(root)): string {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const fullPath = path.join(root, file);
    assertInside(root, fullPath);
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(fullPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readManifest(targetPath: string): InstallManifest | undefined {
  const manifestPath = path.join(targetPath, '.utm-install.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<InstallManifest>;
    if (parsed.schemaVersion !== 1 || parsed.product !== 'uefn-transaction-manager' || typeof parsed.sourceFingerprint !== 'string' || !Array.isArray(parsed.files) || !parsed.files.every(value => typeof value === 'string')) return undefined;
    return { schemaVersion: 1, product: 'uefn-transaction-manager', sourceFingerprint: parsed.sourceFingerprint, files: parsed.files };
  } catch {
    return undefined;
  }
}

function writeAtomic(filePath: string, content: string | Buffer): void {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, content, { flag: 'wx' });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sourceFiles(sourcePath: string): { files: string[]; fingerprint: string } {
  if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) throw new Error('The packaged UTM Agent Skill is unavailable.');
  const files = listFiles(sourcePath);
  return { files, fingerprint: fingerprint(sourcePath, files) };
}

export function supportedAgentIds(): SupportedAgentId[] {
  return Object.keys(definitions) as SupportedAgentId[];
}

export function agentSkillTargetPath(agent: SupportedAgentId, homeDirectory = os.homedir()): string {
  return targetPathFor(agent, homeDirectory);
}

export function inspectAgentSkill(sourcePath: string, agent: SupportedAgentId, homeDirectory = os.homedir()): AgentSkillInstallationStatus {
  const targetPath = targetPathFor(agent, homeDirectory);
  try {
    const source = sourceFiles(sourcePath);
    const installedFiles = listFiles(targetPath);
    const installed = fs.existsSync(path.join(targetPath, 'SKILL.md'));
    const manifest = readManifest(targetPath);
    const targetFingerprint = installed ? fingerprint(targetPath, installedFiles.filter(file => file !== '.utm-install.json')) : '';
    const managed = Boolean(manifest);
    const upToDate = installed && targetFingerprint === source.fingerprint && Boolean(manifest?.sourceFingerprint === source.fingerprint);
    return { id: agent, label: definitions[agent].label, targetPath, installed, upToDate, managed, fileCount: installedFiles.filter(file => file !== '.utm-install.json').length };
  } catch (error) {
    return { id: agent, label: definitions[agent].label, targetPath, installed: false, upToDate: false, managed: false, fileCount: 0, error: error instanceof Error ? error.message : 'Agent Skill status could not be read.' };
  }
}

export function inspectAllAgentSkills(sourcePath: string, homeDirectory = os.homedir()): AgentSkillInstallationStatus[] {
  return supportedAgentIds().map(agent => inspectAgentSkill(sourcePath, agent, homeDirectory));
}

export function installAgentSkill(sourcePath: string, agent: SupportedAgentId, homeDirectory = os.homedir()): AgentSkillInstallResult {
  const targetPath = targetPathFor(agent, homeDirectory);
  const source = sourceFiles(sourcePath);
  const current = inspectAgentSkill(sourcePath, agent, homeDirectory);
  if (current.error) throw new Error(current.error);
  if (current.upToDate) return { ...current, success: true, changed: false };

  fs.mkdirSync(targetPath, { recursive: true });
  const manifest = readManifest(targetPath);
  const existingFiles = listFiles(targetPath).filter(file => file !== '.utm-install.json');
  const managedFiles = new Set(manifest?.files ?? []);
  const unmanagedConflicts = existingFiles.filter(file => !managedFiles.has(file) && !source.files.includes(file));
  const changedUnmanagedFiles = existingFiles.filter(file => !managedFiles.has(file) && source.files.includes(file)).filter(file => !source.files.includes(file) || !crypto.timingSafeEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(targetPath, file))).digest(), crypto.createHash('sha256').update(fs.readFileSync(path.join(sourcePath, file))).digest()));
  if (unmanagedConflicts.length || changedUnmanagedFiles.length) {
    const names = [...unmanagedConflicts, ...changedUnmanagedFiles].slice(0, 3).join(', ');
    throw new Error(`The ${definitions[agent].label} Agent Skill folder contains files UTM does not own (${names}). Move or back up that folder, then retry.`);
  }

  for (const file of source.files) {
    const destination = path.join(targetPath, file);
    assertInside(targetPath, destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeAtomic(destination, fs.readFileSync(path.join(sourcePath, file)));
  }
  for (const oldFile of managedFiles) {
    if (!source.files.includes(oldFile)) {
      const stalePath = path.join(targetPath, oldFile);
      assertInside(targetPath, stalePath);
      fs.rmSync(stalePath, { force: true });
    }
  }
  writeAtomic(path.join(targetPath, '.utm-install.json'), `${JSON.stringify({ schemaVersion: 1, product: 'uefn-transaction-manager', sourceFingerprint: source.fingerprint, files: source.files }, null, 2)}\n`);
  const result = inspectAgentSkill(sourcePath, agent, homeDirectory);
  if (!result.upToDate) throw new Error(`The ${definitions[agent].label} Agent Skill was written but did not verify as current.`);
  return { ...result, success: true, changed: true };
}
