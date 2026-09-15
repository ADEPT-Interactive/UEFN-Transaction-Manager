import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogSession, defaultProjectConfig } from '../src/services/catalogSession';
import { generateVerseCode } from '../src/services/verseGenerator';
import { parseVerseCode } from '../src/services/verseParser';
import { validateMigrationParityTable } from '../src/services/migrationParity';
import {
  FLASHLIGHT_TAG_CONFIG,
  FLASHLIGHT_TAG_ENTITLEMENTS,
  FLASHLIGHT_TAG_IDENTITY_OPERATIONS,
  FLASHLIGHT_TAG_MODULE_CONFIGURATION,
  FLASHLIGHT_TAG_PARITY,
  FLASHLIGHT_TAG_STOREFRONTS,
  flashlightTagCatalog,
} from './fixtures/flashlight-tag-identity-fixture';

type AdoptionResult = {
  identityEvidence?: {
    identityChanged: boolean;
    requested: { paths: Record<string, string | undefined> };
    effective: { paths: Record<string, string | undefined> };
  };
};

test('Flashlight Tag identity fixture proves the migration parity table covers every adopted record', () => {
  const report = validateMigrationParityTable(FLASHLIGHT_TAG_PARITY, FLASHLIGHT_TAG_IDENTITY_OPERATIONS, true);
  assert.equal(report.valid, true, JSON.stringify(report, null, 2));
  assert.equal(report.confirmed, true);
  assert.equal(report.entries, FLASHLIGHT_TAG_ENTITLEMENTS.length + FLASHLIGHT_TAG_STOREFRONTS.length);
});

test('existing-project identity adoption is atomic, dry-run visible, and preserves Flashlight Tag public paths', () => {
  const catalog = new CatalogSession(flashlightTagCatalog());
  const dryRun = catalog.applyPatch(FLASHLIGHT_TAG_IDENTITY_OPERATIONS, '1', true, {
    existingProject: true,
    moduleConfiguration: FLASHLIGHT_TAG_MODULE_CONFIGURATION,
  });
  assert.equal(catalog.snapshot().revision, '1');
  assert.equal(dryRun.snapshot.revision, '1');
  assert.equal(dryRun.operationResults.length, 10);
  for (const result of dryRun.operationResults as AdoptionResult[]) {
    assert.equal(result.identityEvidence?.identityChanged, false);
    assert.deepEqual(result.identityEvidence?.requested.paths, result.identityEvidence?.effective.paths);
  }
  assert.equal(dryRun.snapshot.config.entitlementsModuleName, 'Entitlements');
  assert.ok(dryRun.snapshot.retiredVerseKeys.includes('premium_power_pass'));
  assert.ok(dryRun.snapshot.retiredVerseKeys.includes('item_100_coins'));
  assert.equal(dryRun.snapshot.entitlements.find(item => item.id === 'power_pass')?.verseKey, 'power_pass');

  const applied = catalog.applyPatch(FLASHLIGHT_TAG_IDENTITY_OPERATIONS, '1', false, {
    existingProject: true,
    moduleConfiguration: FLASHLIGHT_TAG_MODULE_CONFIGURATION,
  });
  assert.equal(applied.snapshot.revision, '2');
  assert.equal(applied.snapshot.config.entitlementsModuleName, 'Entitlements');
  assert.equal(applied.snapshot.entitlements.find(item => item.id === 'power_pass')?.verseKey, 'power_pass');
  assert.equal(applied.snapshot.entitlements.find(item => item.id === 'coins_100')?.verseKey, 'coins_100');
  assert.deepEqual(applied.snapshot.storefrontMembership.focused.map(group => group.id), ['coin_shop', 'not_enough_currency']);

  const code = generateVerseCode(
    applied.snapshot.entitlements,
    applied.snapshot.bundles,
    applied.snapshot.config,
    applied.snapshot.storefrontMembership,
    applied.snapshot.retiredVerseKeys,
  );
  assert.match(code, /Entitlements<public> := module:/);
  assert.match(code, /power_pass_entitlement<public>/);
  assert.match(code, /PremiumPowerPass_GrantedSignal/);
  assert.match(code, /AwaitItem100CoinsConsumedEvent/);
  assert.match(code, /premium_power_pass_price<public>/);
  assert.match(code, /premium_power_pass_offer<public>/);
  assert.match(code, /CoinShopTitle<localizes>/);
  assert.match(code, /OpenCoinShop<public>/);
  assert.match(code, /ManagedOffers\.premium_power_pass_offer\{\}/);
  assert.match(code, /EntitlementIcons\.item_100_coins_Icon/);

  const reopened = parseVerseCode(code);
  assert.equal(reopened.managed, true);
  assert.equal(reopened.error, undefined);
  assert.deepEqual(reopened.generatedModuleConfiguration, {
    assetFolderName: 'EntitlementIcons',
    deviceClassName: 'managed_transactions_device',
    infoModuleName: 'ManagedEntitlementInfo',
    entitlementsModuleName: 'Entitlements',
    pricesModuleName: 'ManagedTransactionPrices',
    offersModuleName: 'ManagedOffers',
  });
  const restartConfig = defaultProjectConfig(FLASHLIGHT_TAG_CONFIG.contentFolderPath, reopened.generatedModuleConfiguration);
  assert.equal(restartConfig.entitlementsModuleName, 'Entitlements');
  assert.equal(restartConfig.deviceClassName, 'managed_transactions_device');
  assert.equal(generateVerseCode(reopened.entitlements, reopened.bundles, restartConfig, reopened.storefrontMembership, reopened.retiredVerseKeys), code);
  const regenerated = generateVerseCode(reopened.entitlements, reopened.bundles, FLASHLIGHT_TAG_CONFIG, reopened.storefrontMembership, reopened.retiredVerseKeys);
  assert.equal(regenerated, code);
});

test('identity adoption rejects new-catalog use and never changes a draft on mismatch', () => {
  const catalog = new CatalogSession(flashlightTagCatalog());
  assert.throws(() => catalog.applyPatch(FLASHLIGHT_TAG_IDENTITY_OPERATIONS.slice(0, 1), '1', true), error => {
    assert.equal((error as { code?: string }).code, 'CATALOG_IDENTITY_IMPORT_REQUIRED');
    return true;
  });
  assert.equal(catalog.snapshot().revision, '1');
  assert.equal(catalog.snapshot().entitlements[0].verseKey, 'premium_power_pass');

  const collision = FLASHLIGHT_TAG_IDENTITY_OPERATIONS.map(operation => ({ ...operation }));
  collision[0] = { ...collision[0], publicIdentity: { ...(collision[0].publicIdentity as Record<string, unknown>), apiStem: 'SeekerPass' } };
  assert.throws(() => catalog.applyPatch(collision.slice(0, 2), '1', true, { existingProject: true, moduleConfiguration: FLASHLIGHT_TAG_MODULE_CONFIGURATION }), error => {
    assert.equal((error as { code?: string }).code, 'CATALOG_PUBLIC_IDENTITY_CONFLICT');
    return true;
  });
  assert.equal(catalog.snapshot().revision, '1');
});
