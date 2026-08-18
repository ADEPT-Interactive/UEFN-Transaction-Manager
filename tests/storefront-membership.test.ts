import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { cleanManagedData, normalizeEntitlement, normalizeStorefrontMembership, parseManagedData } from '../src/services/projectSchema';
import { validateEntireProject } from '../src/services/validator';
import { legacyStorefrontMembership, storefrontOfferOptions } from '../src/services/storefrontMembership';
import { BundleOffer, EntitlementItem, StorefrontMembership } from '../src/types/entitlement';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

const staticBundle: BundleOffer = { ...structuredClone(publicApiBundles[0]), id: 'static-store', verseKey: 'static_store', name: 'Static Store Bundle' };
const dynamicBundle: BundleOffer = { ...structuredClone(publicApiBundles[2]), id: 'dynamic-store', verseKey: 'dynamic_store', name: 'Dynamic Store Bundle' };

function sourceFor(membership: StorefrontMembership, bundles: BundleOffer[] = [staticBundle, dynamicBundle]): string {
  return generateVerseCode(publicApiItems, bundles, publicApiConfig, membership);
}

function publicDeclarationCount(source: string): number {
  return source.split(/\r?\n/).filter(line => line.includes('<public>')).length;
}

test('explicit All Offers membership is exact and excludes unselected offers', () => {
  const membership: StorefrontMembership = {
    allOffers: [{ entitlementId: 'access' }, { bundleId: staticBundle.id }],
    focused: [],
  };
  const source = sourceFor(membership);
  assert.match(source, /ExecuteStorefront\(Player, array\{Phase4PublicApiOffers\.access_pass_offer\{\}, Phase4PublicApiOffers\.static_store_offer\{\}\}, AllOffersStoreTitle\)/);
  assert.doesNotMatch(source, /AllOffersStoreTitle[\s\S]+mystery_item_mobile_offer/);
  assert.doesNotMatch(source, /dynamic_store_offer\{\}/);
  const baseline = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, {
    allOffers: [{ entitlementId: 'access' }, { entitlementId: 'season' }, { entitlementId: 'coins' }, { entitlementId: 'random' }, { entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' }, { bundleId: 'starter' }, { bundleId: 'nested' }],
    focused: publicApiDisplayGroups,
  });
  assert.equal(publicDeclarationCount(baseline), 96);
});

test('alternate offers have independent global and focused membership', () => {
  const membership: StorefrontMembership = {
    allOffers: [{ entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' }],
    focused: [{ id: 'regional', verseKey: 'regional_store', name: 'Regional Store', generateTriggerBinding: false, entries: [{ entitlementId: 'random' }] }],
  };
  const source = sourceFor(membership, []);
  assert.match(source, /ExecuteStorefront\(Player, array\{Phase4PublicApiOffers\.mystery_item_mobile_offer\{\}\}, AllOffersStoreTitle\)/);
  assert.match(source, /ShowRegionalStoreOffers\(Player:player\)<suspends>:void =\n        ExecuteStorefront\(Player, array\{Phase4PublicApiOffers\.mystery_item_offer\{\}\}, RegionalStoreTitle\)/);
  const allStoreBlock = source.slice(source.indexOf('ShowAllOffers(Player:player)'), source.indexOf('ShowRegionalStoreOffers(Player:player)'));
  assert.doesNotMatch(allStoreBlock, /Phase4PublicApiOffers\.mystery_item_offer\{\}/);
});

test('focused storefronts preserve configured order and may share offers', () => {
  const membership: StorefrontMembership = {
    allOffers: [{ entitlementId: 'access' }],
    focused: [
      { id: 'one', verseKey: 'one_store', name: 'One Store', generateTriggerBinding: false, entries: [{ entitlementId: 'random' }, { bundleId: staticBundle.id }] },
      { id: 'two', verseKey: 'two_store', name: 'Two Store', generateTriggerBinding: false, entries: [{ entitlementId: 'random' }] },
    ],
  };
  const source = sourceFor(membership);
  assert.match(source, /ShowOneStoreOffers\(Player:player\)<suspends>:void =\n        ExecuteStorefront\(Player, array\{Phase4PublicApiOffers\.mystery_item_offer\{\}, Phase4PublicApiOffers\.static_store_offer\{\}\}, OneStoreTitle\)/);
  assert.match(source, /ShowTwoStoreOffers\(Player:player\)<suspends>:void =\n        ExecuteStorefront\(Player, array\{Phase4PublicApiOffers\.mystery_item_offer\{\}\}, TwoStoreTitle\)/);
});

test('duplicate membership is normalized once per storefront without changing order', () => {
  const membership: StorefrontMembership = {
    allOffers: [{ entitlementId: 'access' }, { entitlementId: 'access' }, { bundleId: staticBundle.id }],
    focused: [{ id: 'dupes', verseKey: 'dupes_store', name: 'Dupes', generateTriggerBinding: false, entries: [{ bundleId: staticBundle.id }, { bundleId: staticBundle.id }] }],
  };
  const normalized = normalizeStorefrontMembership(membership, publicApiItems, [staticBundle]);
  assert.deepEqual(normalized.membership.allOffers, [{ entitlementId: 'access' }, { bundleId: staticBundle.id }]);
  assert.deepEqual(normalized.membership.focused[0].entries, [{ bundleId: staticBundle.id }]);
  assert.equal(normalized.projectDataDiagnostics.filter(message => /duplicate membership/i.test(message)).length, 2);
  const source = sourceFor(membership, [staticBundle]);
  assert.equal((source.match(/ExecuteStorefront\(Player, array\{[^\n]*static_store_offer\{\}/g) ?? []).length, 2);
});

test('old manifests migrate inferred global membership and remove stale dynamic references', () => {
  const parsed = parseManagedData({
    schemaVersion: 4,
    entitlements: publicApiItems,
    bundles: [staticBundle, dynamicBundle],
    offerDisplayGroups: [{ id: 'old', verseKey: 'old_store', name: 'Old Store', generateTriggerBinding: false, entries: [{ entitlementId: 'random' }, { bundleId: dynamicBundle.id }, { entitlementId: 'missing' }] }],
  });
  assert.deepEqual(parsed.storefrontMembership.allOffers, [
    { entitlementId: 'access' },
    { entitlementId: 'season' },
    { entitlementId: 'coins' },
    { entitlementId: 'random' },
    { entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' },
    { bundleId: staticBundle.id },
  ]);
  assert.deepEqual(parsed.storefrontMembership.focused[0].entries, [{ entitlementId: 'random' }]);
  assert.ok(parsed.projectDataDiagnostics.some(message => /dynamic remaining-quantity bundles/i.test(message)));
  assert.ok(parsed.projectDataDiagnostics.some(message => /no longer exists or was ambiguous/i.test(message)));
});

test('canonical membership round-trips stable references and display-name changes', () => {
  const membership: StorefrontMembership = {
    allOffers: [{ entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' }, { bundleId: staticBundle.id }],
    focused: [{ id: 'regional', verseKey: 'regional_store', name: 'Regional Store', generateTriggerBinding: false, entries: [{ entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' }] }],
  };
  const clean = cleanManagedData(publicApiItems, [staticBundle], membership);
  const parsed = parseManagedData(clean);
  parsed.entitlements[3].name = 'Renamed Mystery Item';
  assert.deepEqual(parsed.storefrontMembership, membership);
  assert.equal(parsed.storefrontMembership.focused[0].entries[0].entitlementId, 'random');
  assert.equal(generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.storefrontMembership).includes('mystery_item_mobile_offer{}'), true);
});

test('empty global and focused storefronts remain valid but warn and generate safe helpers', () => {
  const membership: StorefrontMembership = { allOffers: [], focused: [{ id: 'empty', verseKey: 'empty_store', name: 'Empty Store', generateTriggerBinding: false, entries: [] }] };
  const validItems = publicApiItems.map(normalizeEntitlement);
  const issues = validateEntireProject(validItems, [], publicApiConfig, membership).filter(issue => issue.severity === 'warning');
  assert.ok(issues.some(issue => issue.ruleName === 'all_offers_empty'));
  assert.ok(issues.some(issue => issue.ruleName === 'offer_display_entries_min'));
  const source = sourceFor(membership, []);
  assert.match(source, /ShowAllOffers\(Player:player\)<suspends>:void =\n        Print\("No transaction offers are configured"\)/);
  assert.match(source, /ShowEmptyStoreOffers\(Player:player\)<suspends>:void =\n        Print\("No eligible offers are configured for this storefront"\)/);
});

test('selection options omit dynamic bundles and distinguish primary, alternate, and static bundle labels', () => {
  const options = storefrontOfferOptions(publicApiItems, [staticBundle, dynamicBundle]);
  assert.ok(options.some(option => option.label === 'Mystery Item · Primary Offer'));
  assert.ok(options.some(option => option.label === 'Mystery Item · Mystery Item Mobile'));
  assert.ok(options.some(option => option.label === 'Static Store Bundle'));
  assert.equal(options.some(option => option.label === dynamicBundle.name), false);
});

test('legacy default membership excludes dynamic bundles while retaining historical static offers', () => {
  const membership = legacyStorefrontMembership(publicApiItems, [staticBundle, dynamicBundle]);
  assert.equal(membership.allOffers.some(entry => entry.bundleId === dynamicBundle.id), false);
  assert.equal(membership.allOffers.some(entry => entry.bundleId === staticBundle.id), true);
});
