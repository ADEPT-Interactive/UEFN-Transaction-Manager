import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertExistingPathInsideRoot } from './security';

const PREVIEW_ROOT_NAME = '.uem-icon-previews';
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ProjectIconPreview {
  assetFolderName: string;
  assetName: string;
  verseAssetPath: string;
  assetObjectPath?: string;
}

function validateComponent(value: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`${label} is not a valid project icon identifier.`);
  return value;
}

function previewRoot(contentRoot: string): string {
  const root = path.join(contentRoot, PREVIEW_ROOT_NAME);
  if (fs.existsSync(root)) assertExistingPathInsideRoot(contentRoot, root);
  return root;
}

function previewDirectory(contentRoot: string, assetFolderName: string): string {
  validateComponent(assetFolderName, 'Asset folder');
  const root = previewRoot(contentRoot);
  const directory = path.join(root, assetFolderName);
  if (fs.existsSync(directory)) assertExistingPathInsideRoot(contentRoot, directory);
  return directory;
}

function previewFile(contentRoot: string, assetFolderName: string, assetName: string): string {
  validateComponent(assetFolderName, 'Asset folder');
  validateComponent(assetName, 'Asset name');
  const directory = previewDirectory(contentRoot, assetFolderName);
  const filePath = path.join(directory, `${assetName}.png`);
  if (fs.existsSync(filePath)) assertExistingPathInsideRoot(contentRoot, filePath);
  return filePath;
}

function legacyPreviewFile(contentRoot: string, assetFolderName: string, assetName: string): string {
  validateComponent(assetFolderName, 'Asset folder');
  validateComponent(assetName, 'Asset name');
  const directory = path.join(contentRoot, assetFolderName);
  const filePath = path.join(directory, `${assetName}.png`);
  if (fs.existsSync(filePath)) assertExistingPathInsideRoot(contentRoot, filePath);
  return filePath;
}

export function persistProjectIconPreview(
  contentRoot: string,
  assetFolderName: string,
  assetName: string,
  pngBuffer: Buffer,
  assetObjectPath?: string,
): ProjectIconPreview {
  const directory = previewDirectory(contentRoot, assetFolderName);
  fs.mkdirSync(directory, { recursive: true });
  assertExistingPathInsideRoot(contentRoot, directory);

  const filePath = previewFile(contentRoot, assetFolderName, assetName);
  const temporaryPath = path.join(directory, `.${assetName}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temporaryPath, pngBuffer, { flag: 'wx' });
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  fs.renameSync(temporaryPath, filePath);

  const metadata: ProjectIconPreview = {
    assetFolderName,
    assetName,
    verseAssetPath: `${assetFolderName}.${assetName}`,
    ...(assetObjectPath ? { assetObjectPath } : {}),
  };
  const metadataPath = path.join(directory, `${assetName}.json`);
  const metadataTemporaryPath = path.join(directory, `.${assetName}.${crypto.randomBytes(8).toString('hex')}.json.tmp`);
  fs.writeFileSync(metadataTemporaryPath, JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx' });
  if (fs.existsSync(metadataPath)) fs.rmSync(metadataPath);
  fs.renameSync(metadataTemporaryPath, metadataPath);
  return metadata;
}

export function listProjectIconPreviews(contentRoot: string, assetFolderName: string): ProjectIconPreview[] {
  const previews = new Map<string, ProjectIconPreview>();
  const directory = previewDirectory(contentRoot, assetFolderName);
  if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
    assertExistingPathInsideRoot(contentRoot, directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;
      const assetName = entry.name.slice(0, -4);
      validateComponent(assetName, 'Preview asset');
      const metadataPath = path.join(directory, `${assetName}.json`);
      let metadata: Partial<ProjectIconPreview> = {};
      try {
        if (fs.existsSync(metadataPath)) metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Partial<ProjectIconPreview>;
      } catch {
        metadata = {};
      }
      previews.set(assetName, {
        assetFolderName,
        assetName,
        verseAssetPath: `${assetFolderName}.${assetName}`,
        ...(typeof metadata.assetObjectPath === 'string' ? { assetObjectPath: metadata.assetObjectPath } : {}),
      });
    }
  }

  // Older builds placed the source PNG beside the native asset. Keep those
  // projects visible while new imports use the hidden preview cache above.
  const legacyDirectory = path.join(contentRoot, assetFolderName);
  if (fs.existsSync(legacyDirectory) && fs.statSync(legacyDirectory).isDirectory()) {
    assertExistingPathInsideRoot(contentRoot, legacyDirectory);
    for (const entry of fs.readdirSync(legacyDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;
      const assetName = entry.name.slice(0, -4);
      validateComponent(assetName, 'Project icon');
      if (!previews.has(assetName)) previews.set(assetName, { assetFolderName, assetName, verseAssetPath: `${assetFolderName}.${assetName}` });
    }
  }
  return [...previews.values()];
}

export function resolveProjectIconPreview(contentRoot: string, assetFolderName: string, assetName: string): string {
  const filePath = previewFile(contentRoot, assetFolderName, assetName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    assertExistingPathInsideRoot(contentRoot, filePath);
    return filePath;
  }
  const legacyFilePath = legacyPreviewFile(contentRoot, assetFolderName, assetName);
  if (!fs.existsSync(legacyFilePath) || !fs.statSync(legacyFilePath).isFile()) throw new Error('Project icon preview was not found.');
  assertExistingPathInsideRoot(contentRoot, legacyFilePath);
  return legacyFilePath;
}

export { PREVIEW_ROOT_NAME };
