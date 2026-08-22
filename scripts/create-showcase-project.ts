import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import fixture from '../docs/showcase/showcase-project.json';
import { parseManagedData } from '../src/services/projectSchema';
import { generateVerseCode } from '../src/services/verseGenerator';
import type { ProjectConfig } from '../src/types/entitlement';

const rootArgument = process.argv.find((argument, index) => argument === '--output' && process.argv[index + 1])
  ? process.argv[process.argv.indexOf('--output') + 1]
  : process.env.UEM_SHOWCASE_OUTPUT ?? path.join(os.tmpdir(), 'uem-phase28-showcase');
const root = path.resolve(rootArgument.replaceAll('"', ''));
const contentRoot = path.join(root, 'Content');
const iconRoot = path.join(contentRoot, 'EntitlementIcons');
const config: ProjectConfig = {
  contentFolderPath: contentRoot,
  targetVerseFileName: 'managed_transactions.verse',
  assetFolderName: 'EntitlementIcons',
  deviceClassName: 'showcase_transactions_device',
  infoModuleName: 'ShowcaseEntitlementInfo',
  entitlementsModuleName: 'ShowcaseEntitlements',
  pricesModuleName: 'ShowcaseTransactionPrices',
  offersModuleName: 'ShowcaseOffers',
  autoBackup: true,
  enableVerseWorkflowServer: true,
  generateStorefrontBinding: true,
};

const iconSources: Record<string, string> = {
  AccessPass: 'access-pass.svg',
  EmberCoins: 'ember-coins.svg',
  MysteryCache: 'mystery-cache.svg',
  EventBundle: 'event-bundle.svg',
  SeasonToken: 'ember-coins.svg',
  BuilderKit: 'access-pass.svg',
  StarterBundle: 'event-bundle.svg',
};

await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(iconRoot, { recursive: true });
await fs.writeFile(path.join(root, 'Showcase.uefnproject'), JSON.stringify({ title: 'ADEPT Showcase Dataset', plugins: [{ name: 'Showcase', bIsRoot: true }], bEnablePythonForProject: true }, null, 2));
const launcherProjects = [
  ['CommerceLab', 'ADEPT Commerce Lab', 'CommerceLab'],
  ['SeasonalStore', 'Seasonal Storefront', 'SeasonalStore'],
  ['CreatorSandbox', 'Creator Sandbox', 'CreatorSandbox'],
] as const;
for (const [folder, title, mount] of launcherProjects) {
  const projectRoot = path.join(root, 'launcher-projects', folder);
  await fs.mkdir(path.join(projectRoot, 'Content'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, `${folder}.uefnproject`), JSON.stringify({ title, plugins: [{ name: mount, bIsRoot: true }], bEnablePythonForProject: true }, null, 2));
}
const parsed = parseManagedData(JSON.parse(JSON.stringify(fixture).replaceAll('ShowcaseIcons', 'EntitlementIcons')));
await fs.writeFile(path.join(contentRoot, config.targetVerseFileName), generateVerseCode(parsed.entitlements, parsed.bundles, config, parsed.storefrontMembership, parsed.retiredVerseKeys));
for (const [assetName, sourceName] of Object.entries(iconSources)) {
  const source = await fs.readFile(path.join('docs', 'showcase', 'icons', sourceName));
  await sharp(source).png().resize(256, 256, { fit: 'contain' }).toFile(path.join(iconRoot, `${assetName}.png`));
}
console.log(path.join(root, 'Showcase.uefnproject'));
