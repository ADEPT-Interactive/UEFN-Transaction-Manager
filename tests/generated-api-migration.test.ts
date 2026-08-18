import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { cleanManagedData, parseManagedData } from '../src/services/projectSchema';
import { parseVerseCode } from '../src/services/verseParser';
import { toVerseApiStem } from '../src/services/verseIdentity';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

function publicDeclarationCount(source: string): number {
  return source.split(/\r?\n/).filter(line => line.includes('<public>')).length;
}

test('canonical API stems derive from stable keys, including numeric segments', () => {
  assert.equal(toVerseApiStem('durable_entitlement'), 'DurableEntitlement');
  assert.equal(toVerseApiStem('starter_bundle_2'), 'StarterBundle2');
  assert.equal(toVerseApiStem('item_123_coins'), 'Item123Coins');
  assert.equal(toVerseApiStem('__'), 'Item');
});

test('clean, old-schema, and temporary-metadata projects converge on one canonical output', () => {
  const logicalItems = structuredClone(publicApiItems);
  const logicalBundles = structuredClone(publicApiBundles);
  const logicalGroups = structuredClone(publicApiDisplayGroups);
  const clean = parseManagedData({ schemaVersion: 4, entitlements: logicalItems, bundles: logicalBundles, offerDisplayGroups: logicalGroups });
  const oldManifest = parseManagedData({ schemaVersion: 2, entitlements: logicalItems, bundles: logicalBundles, offerDisplayGroups: logicalGroups });
  const temporaryManifest = parseManagedData({
    schemaVersion: 4,
    entitlements: logicalItems.map(item => ({ ...item, purchaseEventName: 'OldPurchasedEvent', restoreOnJoin: true })),
    bundles: logicalBundles,
    offerDisplayGroups: logicalGroups,
    generatedApiVersion: 2,
    legacyApiCompatibility: true,
    legacyApiDiagnostics: ['obsolete metadata'],
  });

  const expected = generateVerseCode(clean.entitlements, clean.bundles, publicApiConfig, clean.offerDisplayGroups, clean.retiredVerseKeys);
  assert.equal(generateVerseCode(oldManifest.entitlements, oldManifest.bundles, publicApiConfig, oldManifest.offerDisplayGroups, oldManifest.retiredVerseKeys), expected);
  assert.equal(generateVerseCode(temporaryManifest.entitlements, temporaryManifest.bundles, publicApiConfig, temporaryManifest.offerDisplayGroups, temporaryManifest.retiredVerseKeys), expected);
  assert.equal(publicDeclarationCount(expected), 96);
  assert.deepEqual(temporaryManifest.projectDataDiagnostics, []);
  assert.equal('purchaseEventName' in temporaryManifest.entitlements[0], false);
  assert.equal('restoreOnJoin' in temporaryManifest.entitlements[0], false);

  const cleaned = cleanManagedData(temporaryManifest.entitlements, temporaryManifest.bundles, temporaryManifest.offerDisplayGroups, temporaryManifest.retiredVerseKeys);
  assert.equal('generatedApiVersion' in cleaned, false);
  assert.equal('legacyApiCompatibility' in cleaned, false);
  assert.equal('legacyApiDiagnostics' in cleaned, false);
  assert.equal('purchaseEventName' in cleaned.entitlements[0], false);
});

test('generated files reopen into the same canonical API without compatibility state', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  const parsed = parseVerseCode(source);
  assert.equal(parsed.managed, true);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.projectDataDiagnostics.length, 0);
  assert.equal(publicDeclarationCount(generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.offerDisplayGroups, parsed.retiredVerseKeys)), 96);
  assert.doesNotMatch(source, /PromptBuy|ShowStorefront|OpenStorefront|OwnershipVerifiedEvent|QuantityDecreasedEvent|PurchaseEvent/);
});

test('valid historical stable keys and retired keys remain intact across supported schemas', () => {
  for (const schemaVersion of [2, 3, 4] as const) {
    const legacyItem = structuredClone(publicApiItems[0]);
    legacyItem.verseKey = 'starter_bundle2213124124';
    legacyItem.name = 'Renamed after migration';
    const parsed = parseManagedData({ schemaVersion, entitlements: [legacyItem], bundles: [], retiredVerseKeys: ['old_entitlement_key'] });
    assert.equal(parsed.entitlements[0].verseKey, 'starter_bundle2213124124');
    assert.deepEqual(parsed.retiredVerseKeys, ['old_entitlement_key']);
    assert.match(generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, [], parsed.retiredVerseKeys), /StarterBundle2213124124_GrantedEvent<public>/);
    assert.doesNotMatch(generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, [], parsed.retiredVerseKeys), /StarterBundle2213124124_2_GrantedEvent/);
  }
});

test('invalid project keys retain meaningful repair diagnostics without compatibility warnings', () => {
  const raw = structuredClone(publicApiItems[0]);
  raw.verseKey = 'class';
  const repaired = parseManagedData({ schemaVersion: 4, entitlements: [raw], bundles: [] });
  assert.notEqual(repaired.entitlements[0].verseKey, 'class');
  assert.ok(repaired.projectDataDiagnostics.some(message => /invalid or reserved/i.test(message)));
  assert.equal(repaired.projectDataDiagnostics.some(message => /API|purchase/i.test(message)), false);
});
