import fs from 'node:fs';
import path from 'node:path';
import type { BundleOffer, EntitlementItem, ProjectConfig } from '../src/types/entitlement';
import type { CatalogDocument } from '../src/services/catalogSession';

export interface ManagedAssetReference {
  expression: string;
  objectPath: string;
  packagePath: string;
}

const VERSE_ASSET_EXPRESSION = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const OBJECT_PATH = /^\/([A-Za-z_][A-Za-z0-9_]*)(?:\/([A-Za-z_][A-Za-z0-9_]*))*\.([A-Za-z_][A-Za-z0-9_]*)$/;

function iconExpressions(document: CatalogDocument): string[] {
  const expressions: string[] = [];
  const addEntitlement = (item: EntitlementItem) => {
    expressions.push(item.iconTexture);
    for (const alternate of item.alternateOffers ?? []) expressions.push(alternate.iconTexture);
  };
  for (const item of document.entitlements) addEntitlement(item);
  for (const bundle of document.bundles as BundleOffer[]) expressions.push(bundle.iconTexture);
  return expressions;
}

export function assetObjectPathFromVerseExpression(expression: string, assetMount: string): string | null {
  if (!VERSE_ASSET_EXPRESSION.test(expression) || !/^\/[A-Za-z_][A-Za-z0-9_]*$/.test(assetMount)) return null;
  const segments = expression.split('.');
  const assetName = segments.at(-1)!;
  return `/${assetMount.slice(1)}/${segments.join('/')}.${assetName}`;
}

export function assetPackagePathFromObjectPath(contentRoot: string, objectPath: string, assetMount: string): string | null {
  const match = OBJECT_PATH.exec(objectPath);
  if (!match || match[1] !== assetMount.slice(1)) return null;
  const segments = objectPath.slice(1, objectPath.lastIndexOf('.')).split('/');
  const assetName = segments.at(-1);
  if (!assetName) return null;
  const packagePath = path.resolve(contentRoot, ...segments.slice(1, -1), `${assetName}.uasset`);
  const root = path.resolve(contentRoot);
  if (packagePath !== root && !packagePath.startsWith(`${root}${path.sep}`)) return null;
  return packagePath;
}

export function collectManagedAssetReferences(document: CatalogDocument, assetMount: string): ManagedAssetReference[] {
  const unique = new Map<string, ManagedAssetReference>();
  for (const expression of iconExpressions(document)) {
    const objectPath = assetObjectPathFromVerseExpression(expression, assetMount);
    if (!objectPath || unique.has(objectPath)) continue;
    const packagePath = assetPackagePathFromObjectPath(document.config.contentFolderPath, objectPath, assetMount);
    if (!packagePath) continue;
    unique.set(objectPath, { expression, objectPath, packagePath });
  }
  return [...unique.values()];
}

export function missingManagedAssetReferences(document: CatalogDocument, assetMount: string): ManagedAssetReference[] {
  return collectManagedAssetReferences(document, assetMount).filter(reference => !fs.existsSync(reference.packagePath));
}

export function managedAssetPathForReference(reference: ManagedAssetReference): string {
  return reference.objectPath;
}

export function managedFilePath(contentRoot: string, config: ProjectConfig): string {
  return path.resolve(contentRoot, config.targetVerseFileName);
}
