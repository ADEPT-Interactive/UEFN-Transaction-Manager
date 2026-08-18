import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { normalizeBundle, normalizeEntitlement, parseManagedData } from '../src/services/projectSchema';
import { parseVerseCode } from '../src/services/verseParser';
import { toVerseApiStem } from '../src/services/verseIdentity';
import { validateEntireProject } from '../src/services/validator';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

const apiV1 = { generatedApiVersion: 1 as const };
const apiV2 = { generatedApiVersion: 2 as const };
const migratedApiV2 = { generatedApiVersion: 2 as const, legacyApiCompatibility: true };

function publicDeclarationCount(source: string): number {
  return source.split(/\r?\n/).filter(line => line.includes('<public>')).length;
}

test('canonical API stems derive from stable keys, including numeric segments', () => {
  assert.equal(toVerseApiStem('durable_entitlement'), 'DurableEntitlement');
  assert.equal(toVerseApiStem('starter_bundle_2'), 'StarterBundle2');
  assert.equal(toVerseApiStem('item_123_coins'), 'Item123Coins');
  assert.equal(toVerseApiStem('__'), 'Item');
});

test('new API-v2 output exposes canonical events, ownership queries, purchase, and storefront names', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], apiV2);
  assert.equal(publicDeclarationCount(source), 96);
  for (const stem of ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem']) {
    assert.match(source, new RegExp(`${stem}_GrantedEvent<public>:event\\(tuple\\(player, int\\)\\)`));
    assert.match(source, new RegExp(`${stem}_RemovedEvent<public>:event\\(tuple\\(player, int\\)\\)`));
    assert.match(source, new RegExp(`${stem}_ReconciledEvent<public>:event\\(tuple\\(player, int\\)\\)`));
    assert.match(source, new RegExp(`Get${stem}Count<public>\\(Player:player\\)<suspends>:int`));
    assert.match(source, new RegExp(`Has${stem}<public>\\(Player:player\\)<suspends>:logic`));
    assert.doesNotMatch(source, new RegExp(`\\n\\s+${stem}(?:Entitlement|Ownership|Quantity|Purchase).*<public>`));
  }
  assert.match(source, /OpenAccessPassPurchase<public>\(Player:player\):void =/);
  assert.doesNotMatch(source, /PromptBuyAccessPass<public>/);
  assert.match(source, /OpenAllOffersStore<public>\(Player:player\):void =/);
  assert.match(source, /OpenCoinStore<public>\(Player:player\):void =/);
  assert.doesNotMatch(source, /ShowStorefront<public>/);
  assert.doesNotMatch(source, /ShowCoinStore<public>/);
  assert.match(source, /OnAccessPassButtonInteracted[\s\S]+OpenAccessPassPurchase\(Player\)/);
});

test('canonical event semantics collapse redundant legacy families', () => {
  const source = generateVerseCode(publicApiItems, [], publicApiConfig, [], [], apiV2);
  assert.match(source, /ProcessAccessPassGrant\([\s\S]+AccessPass_GrantedEvent\.Signal\(\(Player, Quantity\)\)/);
  assert.match(source, /ProcessAccessPassRemoval\([\s\S]+AccessPass_RemovedEvent\.Signal\(\(Player, Quantity\)\)/);
  assert.match(source, /ReconcilePlayerEntitlements[\s\S]+AccessPass_ReconciledEvent\.Signal\(\(Player, AccessPassOwnedCount\)\)/);
  assert.doesNotMatch(source, /PurchasedEvent/);
  assert.doesNotMatch(source, /QuantityDecreasedEvent/);
  assert.doesNotMatch(source, /OwnershipVerifiedEvent/);
});

test('migrated API-v2 output dual-signals reproducible v1 events and wraps old purchase helpers', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], migratedApiV2);
  assert.equal(publicDeclarationCount(source), 129);
  assert.match(source, /GrantAccessPass<public>\(Player:player, Quantity:int\)<suspends>:logic/);
  assert.match(source, /ConsumeCoinPack<public>\(Player:player, Quantity:int\)<suspends>:logic/);
  assert.match(source, /AccessPass_GrantedEvent<public>/);
  assert.match(source, /GetAccessPassCount<public>\(Player:player\)<suspends>:int/);
  assert.match(source, /HasAccessPass<public>\(Player:player\)<suspends>:logic/);
  assert.match(source, /AccessPassEntitlementGrantedEvent<public>/);
  assert.match(source, /AccessPassPurchaseEvent<public>/);
  assert.match(source, /AccessPass_GrantedEvent\.Signal\(\(Player, Quantity\)\)/);
  assert.match(source, /AccessPassEntitlementGrantedEvent\.Signal\(\(Player, Quantity\)\)/);
  assert.match(source, /AccessPassPurchaseEvent\.Signal\(Player\)/);
  assert.match(source, /PromptBuyAccessPass<public>\(Player:player\):void =\n        OpenAccessPassPurchase\(Player\)/);
  assert.match(source, /OpenAllOffersStore<public>\(Player:player\):void/);
  assert.match(source, /OpenStorefront<public>\(Player:player\):void =\n        OpenAllOffersStore\(Player\)/);
  assert.match(source, /ShowStorefront<public>\(Player:player\)<suspends>:void =\n        ShowAllOffers\(Player\)/);
  assert.match(source, /ShowCoinStore<public>\(Player:player\)<suspends>:void =\n        ShowCoinStoreOffers\(Player\)/);
  assert.equal((source.match(/ProcessAccessPassGrant\(Player:player, Quantity:int\):void =/g) ?? []).length, 1);
  assert.equal((source.match(/GrantAccessPass<public>/g) ?? []).length, 1);
  assert.doesNotMatch(source, /GrantAccessPassLegacy|LegacyGrantAccessPass/);
});

test('API-version parsing defaults old manifests to v1 and migration is idempotent', () => {
  const oldManifest = parseManagedData({ schemaVersion: 4, entitlements: publicApiItems, bundles: publicApiBundles });
  assert.equal(oldManifest.generatedApiVersion, 1);
  assert.equal(oldManifest.legacyApiCompatibility, true);

  const cleanSource = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], apiV2);
  const cleanParsed = parseVerseCode(cleanSource);
  assert.equal(cleanParsed.generatedApiVersion, 2);
  assert.equal(cleanParsed.legacyApiCompatibility, false);

  const migratedSource = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], migratedApiV2);
  const migratedParsed = parseVerseCode(migratedSource);
  assert.equal(migratedParsed.generatedApiVersion, 2);
  assert.equal(migratedParsed.legacyApiCompatibility, true);
  const regenerated = generateVerseCode(migratedParsed.entitlements, migratedParsed.bundles, publicApiConfig, migratedParsed.offerDisplayGroups, migratedParsed.retiredVerseKeys, {
    generatedApiVersion: migratedParsed.generatedApiVersion,
    legacyApiCompatibility: migratedParsed.legacyApiCompatibility,
    legacyApiDiagnostics: migratedParsed.legacyApiDiagnostics,
  });
  assert.equal(regenerated, migratedSource);

  const renamed = structuredClone(publicApiItems);
  renamed[0].name = 'Renamed Access Offer';
  const renamedSource = generateVerseCode(renamed, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], apiV2);
  assert.match(renamedSource, /AccessPass_GrantedEvent<public>/);
  assert.match(renamedSource, /GetAccessPassCount<public>/);
  assert.doesNotMatch(renamedSource, /GetRenamedAccessOfferCount<public>/);
  assert.doesNotMatch(renamedSource, /RenamedAccessOffer_GrantedEvent<public>/);
});

test('legacy timestamp-style keys and retired keys remain deterministic across supported schemas', () => {
  for (const schemaVersion of [2, 3, 4] as const) {
    const legacyItem = structuredClone(publicApiItems[0]);
    legacyItem.verseKey = 'durable_entitlement_1712345678';
    legacyItem.name = 'Renamed after migration';
    const parsed = parseManagedData({
      schemaVersion,
      entitlements: [legacyItem],
      bundles: [],
      retiredVerseKeys: ['old_entitlement_key'],
    });
    assert.equal(parsed.generatedApiVersion, 1);
    assert.equal(parsed.legacyApiCompatibility, true);
    assert.equal(parsed.entitlements[0].verseKey, 'durable_entitlement_1712345678');
    assert.deepEqual(parsed.retiredVerseKeys, ['old_entitlement_key']);
    const source = generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, [], parsed.retiredVerseKeys, migratedApiV2);
    assert.match(source, /DurableEntitlement1712345678_GrantedEvent<public>/);
    assert.match(source, /GetDurableEntitlement1712345678Count<public>/);
    assert.doesNotMatch(source, /DurableEntitlement1712345678_2_GrantedEvent/);
    assert.doesNotMatch(source, /GetDurableEntitlement1712345678_2Count<public>/);
  }
});

test('legacy key repairs carry a non-blocking compatibility diagnostic', () => {
  const parsed = parseManagedData({
    schemaVersion: 4,
    entitlements: [structuredClone(publicApiItems[0])],
    bundles: [],
    generatedApiVersion: 1,
  });
  const raw = structuredClone(publicApiItems[0]);
  raw.verseKey = 'class';
  const repaired = parseManagedData({ schemaVersion: 4, entitlements: [raw], bundles: [] });
  assert.equal(parsed.legacyApiDiagnostics.length, 0);
  assert.equal(repaired.generatedApiVersion, 1);
  assert.ok(repaired.legacyApiDiagnostics.some(message => /invalid or reserved/i.test(message)));
  assert.notEqual(repaired.entitlements[0].verseKey, 'class');

  const missingPurchaseEvent = structuredClone(publicApiItems[0]);
  missingPurchaseEvent.purchaseEventName = '';
  const missingEventResult = parseManagedData({ schemaVersion: 4, entitlements: [missingPurchaseEvent], bundles: [] });
  assert.ok(missingEventResult.legacyApiDiagnostics.some(message => /no persisted purchaseEventName/i.test(message)));
  const migrated = generateVerseCode(repaired.entitlements, repaired.bundles, publicApiConfig, [], repaired.retiredVerseKeys, {
    generatedApiVersion: 2,
    legacyApiCompatibility: true,
    legacyApiDiagnostics: repaired.legacyApiDiagnostics,
  });
  assert.match(migrated, /# Legacy API migration diagnostics are preserved in the manifest for developer review\./);
});

test('v2 validation reserves canonical storefront members and detects stem collisions', () => {
  const collidingGroups = structuredClone(publicApiDisplayGroups);
  collidingGroups[1].verseKey = 'coin__store';
  const issues = validateEntireProject(publicApiItems.map(normalizeEntitlement), publicApiBundles.map(normalizeBundle), publicApiConfig, collidingGroups, [], apiV2);
  assert.ok(issues.some(issue => issue.ruleName === 'generated_symbol_unique'));
  assert.ok(issues.some(issue => issue.ruleName === 'device_member_unique'));
});

test('explicit API v1 output remains available as the historical baseline', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], apiV1);
  assert.equal(publicDeclarationCount(source), 100);
  assert.match(source, /PromptBuyAccessPass<public>/);
  assert.match(source, /AccessPassEntitlementGrantedEvent<public>/);
  assert.match(source, /ShowStorefront<public>/);
  assert.doesNotMatch(source, /AccessPass_GrantedEvent<public>/);
  assert.doesNotMatch(source, /GetAccessPassCount<public>|HasAccessPass<public>/);
  assert.match(source, /AccessPassPurchases := GetPurchasedEntitlements\(Player, Phase4PublicApiEntitlements\.access_pass_entitlement\)/);
});
