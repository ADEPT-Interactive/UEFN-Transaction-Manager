import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKETPLACE_CONSTRAINTS } from '../src/constants/marketplaceValidation';
import { parseManagedData } from '../src/services/projectSchema';
import { validateEntireProject, validateEntitlement } from '../src/services/validator';
import { generateVerseCode } from '../src/services/verseGenerator';
import { BundleOffer, EntitlementItem, StorefrontMembership } from '../src/types/entitlement';
import { publicApiBundles, publicApiConfig, publicApiItems } from './public-api-fixture';

const clone = <T>(value: T): T => structuredClone(value);
const rules = (issues: ReturnType<typeof validateEntireProject>): string[] => issues.map(issue => issue.ruleName);

function validItem(overrides: Partial<EntitlementItem> = {}): EntitlementItem {
  return { ...clone(publicApiItems[0]), ...overrides };
}

function validBundle(overrides: Partial<BundleOffer> = {}): BundleOffer {
  return { ...clone(publicApiBundles[0]), ...overrides };
}

test('central Marketplace boundaries are exact and shared by validation', () => {
  const item = validItem();
  for (const price of [MARKETPLACE_CONSTRAINTS.priceMinVBucks, MARKETPLACE_CONSTRAINTS.priceMaxVBucks]) {
    assert.deepEqual(validateEntitlement({ ...clone(item), priceVBucks: price }).filter(issue => issue.severity === 'error'), []);
  }
  for (const price of [MARKETPLACE_CONSTRAINTS.priceMinVBucks - 1, MARKETPLACE_CONSTRAINTS.priceMaxVBucks + 1, 0, -50, 125]) {
    assert.ok(rules(validateEntireProject([{ ...clone(item), priceVBucks: price }], [], publicApiConfig)).includes('price_bounds_and_step'));
  }

  for (const [field, length] of [['name', MARKETPLACE_CONSTRAINTS.nameMaxCharacters], ['shortDescription', MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters], ['description', MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters] as const]) {
    const boundary = { ...clone(item), [field]: 'x'.repeat(length) } as EntitlementItem;
    assert.deepEqual(validateEntitlement(boundary).filter(issue => issue.severity === 'error'), [], `${field} boundary`);
    const over = { ...boundary, [field]: 'x'.repeat(length + 1) } as EntitlementItem;
    assert.ok(rules(validateEntitlement(over)).some(rule => rule.endsWith('length')) || rules(validateEntitlement(over)).includes('description_length'), `${field} over boundary`);
  }
});

test('generated duration and paid-random suffixes count toward final description length', () => {
  const item = validItem({
    description: 'x'.repeat(490),
    durationDescription: 'Lasts 7 days after purchase',
  });
  const durationIssues = validateEntitlement(item);
  assert.ok(durationIssues.some(issue => issue.ruleName === 'description_length'));

  const random = validItem({
    flags: { ...validItem().flags, paidRandomItem: true, paidRandomItemOdds: 'Common: 60%, Rare: 40%' },
    description: 'x'.repeat(500),
  });
  const randomIssues = validateEntitlement(random);
  assert.ok(randomIssues.some(issue => issue.ruleName === 'random_item_description_length'));
  const emptyOdds = { ...random, flags: { ...random.flags, paidRandomItemOdds: '' } };
  assert.equal(validateEntitlement(emptyOdds).some(issue => issue.severity === 'error' && issue.ruleName === 'random_item_description_length'), false);
  assert.ok(validateEntitlement(emptyOdds).some(issue => issue.severity === 'warning' && issue.ruleName === 'paid_random_odds_required'));
  const whitespaceOdds = { ...random, flags: { ...random.flags, paidRandomItemOdds: '   ' } };
  assert.equal(validateEntitlement(whitespaceOdds).some(issue => issue.severity === 'error'), false);
  assert.ok(validateEntitlement(whitespaceOdds).some(issue => issue.severity === 'warning' && issue.ruleName === 'paid_random_odds_required'));

  const bundleWithSuffix = validBundle({ description: 'x'.repeat(490), durationDescription: 'Lasts 7 days' });
  assert.ok(rules(validateEntireProject(publicApiItems, [bundleWithSuffix], publicApiConfig)).includes('description_length'));
  const dynamicWithSuffix = validBundle({ dynamicRemaining: true, description: 'x'.repeat(490), durationDescription: 'Lasts 7 days', items: [{ entitlementId: 'access', quantity: 1 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [dynamicWithSuffix], publicApiConfig)).includes('description_length'));
});

test('primary and alternate offers validate independent prices, metadata, identity, restrictions, and auto-consume', () => {
  const item = validItem({
    itemType: 'consumable', maxCount: 0, autoConsume: true,
    offerRestrictions: { minimumPurchaseAge: -1, blockedCountryCodes: ['ZZ', 'CA', 'CA'], blockedPlatformFamilies: ['Steam', 'Windows', 'Windows'] },
    alternateOffers: [{
      id: 'alternate', verseKey: 'alternate_offer', name: 'Alternate', shortDescription: 'Alternate', description: 'Alternate',
      priceVBucks: 125, iconTexture: 'EntitlementIcons.Alternate', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
    }],
  });
  const issues = validateEntireProject([item], [], publicApiConfig);
  const issueRules = rules(issues);
  assert.ok(issueRules.includes('consumable_maxcount'));
  assert.ok(issueRules.includes('minimum_purchase_age'));
  assert.ok(issueRules.includes('country_code'));
  assert.ok(issueRules.includes('platform_family'));
  assert.ok(issueRules.includes('restriction_duplicate'));
  assert.ok(issueRules.includes('price_bounds_and_step'));
  assert.equal(issues.some(issue => issue.entitlementId === item.id && issue.field === 'alternateOffers.0.description'), false);

  const alternateTooLong = clone(item);
  alternateTooLong.maxCount = 1;
  alternateTooLong.alternateOffers![0].shortDescription = 'x'.repeat(101);
  const alternateIssues = validateEntireProject([alternateTooLong], [], publicApiConfig);
  assert.ok(alternateIssues.some(issue => issue.ruleName === 'short_description_length' && issue.field === 'alternateOffers.0.shortDescription'));
});

test('MaxCount, quantity, and auto-consume rules reject values the generator cannot support', () => {
  const durable = validItem({ itemType: 'durable', maxCount: 2, autoConsume: true });
  const durableRules = rules(validateEntitlement(durable));
  assert.ok(durableRules.includes('durable_maxcount_one'));
  assert.ok(durableRules.includes('durable_not_consumable'));
  assert.ok(rules(validateEntitlement(validItem({ itemType: 'unsupported' as EntitlementItem['itemType'] }))).includes('entitlement_type'));

  for (const maxCount of [0, -1, 1.5, MARKETPLACE_CONSTRAINTS.maxCount + 1]) {
    assert.ok(rules(validateEntitlement(validItem({ itemType: 'consumable', maxCount }))).includes('consumable_maxcount'));
  }
  assert.deepEqual(validateEntitlement(validItem({ itemType: 'consumable', maxCount: MARKETPLACE_CONSTRAINTS.maxCount })).filter(issue => issue.ruleName === 'consumable_maxcount'), []);

  const invalidQuantity = validBundle({ items: [{ entitlementId: publicApiItems[0].id, quantity: 0 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [invalidQuantity], publicApiConfig)).includes('bundle_quantity'));
  const dynamic = validBundle({ dynamicRemaining: true, items: [{ entitlementId: publicApiItems[0].id, quantity: 2 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [dynamic], publicApiConfig)).includes('dynamic_bundle_quantity'));
});

test('bundle validation handles duplicate contents, missing references, cycles, depth, and identifier limits', () => {
  const duplicate = validBundle({ id: 'duplicate', verseKey: 'duplicate_bundle', items: [{ entitlementId: 'access', quantity: 1 }, { entitlementId: 'access', quantity: 1 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [duplicate], publicApiConfig)).includes('bundle_reference_unique'));

  const missing = validBundle({ id: 'missing', verseKey: 'missing_bundle', items: [{ entitlementId: 'does-not-exist', quantity: 1 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [missing], publicApiConfig)).includes('bundle_reference_exists'));

  const cycleA = validBundle({ id: 'cycle-a', verseKey: 'cycle_a', items: [{ bundleId: 'cycle-b', quantity: 1 }] });
  const cycleB = validBundle({ id: 'cycle-b', verseKey: 'cycle_b', items: [{ bundleId: 'cycle-a', quantity: 1 }] });
  assert.ok(rules(validateEntireProject(publicApiItems, [cycleA, cycleB], publicApiConfig)).includes('bundle_cycle'));
  assert.throws(() => generateVerseCode(publicApiItems, [cycleA, cycleB], publicApiConfig), /nested bundle cycle/i);

  const alternateBundle = validBundle({ id: 'alternate-bundle', verseKey: 'alternate_bundle', items: [{ entitlementId: 'random', offerVerseKey: 'random-mobile', quantity: 1 }] });
  const alternateSource = generateVerseCode(publicApiItems, [alternateBundle], publicApiConfig);
  assert.match(alternateSource, /mystery_item_mobile_offer\{\}, 1/);

  const depthBundles: BundleOffer[] = [];
  for (let index = 0; index < MARKETPLACE_CONSTRAINTS.maxNestedBundleDepth + 1; index++) {
    depthBundles.push(validBundle({ id: `depth-${index}`, verseKey: `depth_${index}`, items: index === 0 ? [{ entitlementId: 'access', quantity: 1 }] : [{ bundleId: `depth-${index - 1}`, quantity: 1 }] }));
  }
  assert.ok(rules(validateEntireProject(publicApiItems, depthBundles, publicApiConfig)).includes('bundle_depth'));

  const manyItems = Array.from({ length: MARKETPLACE_CONSTRAINTS.maxDistinctEntitlementIdentifiersPerOffer + 1 }, (_, index) => validItem({ id: `many-${index}`, verseKey: `many_${index}`, name: `Many ${index}` }));
  const manyBundle = validBundle({ id: 'many-bundle', verseKey: 'many_bundle', items: manyItems.map(item => ({ entitlementId: item.id, quantity: 1 })) });
  assert.ok(rules(validateEntireProject(manyItems, [manyBundle], publicApiConfig)).includes('bundle_entitlement_identifier_limit'));
});

test('dynamic bundles remain direct-purchase-only and invalid shapes do not generate a static offer class', () => {
  const dynamic = validBundle({ id: 'dynamic-invalid', verseKey: 'dynamic_invalid', dynamicRemaining: true, items: [{ entitlementId: 'access', quantity: 1 }, { entitlementId: 'season', quantity: 1 }] });
  const membership: StorefrontMembership = { allOffers: [{ bundleId: dynamic.id }], focused: [] };
  const issues = validateEntireProject(publicApiItems, [dynamic], publicApiConfig, membership);
  assert.ok(rules(issues).includes('dynamic_bundle_shape'));
  assert.ok(rules(issues).includes('dynamic_bundle_storefront_unsupported'));
  const source = generateVerseCode(publicApiItems, [dynamic], publicApiConfig, membership);
  assert.doesNotMatch(source, /dynamic_invalid_offer<public> := class\(bundle_offer\)/);
  assert.match(source, /OpenDynamicInvalidPurchase<public>/);
});

test('restriction normalization and generation emit each duplicate restriction once', () => {
  const item = validItem({ offerRestrictions: { minimumPurchaseAge: 0, blockedCountryCodes: ['CA', 'CA'], blockedPlatformFamilies: ['Windows', 'Windows'] } });
  const issues = validateEntireProject([item], [], publicApiConfig);
  assert.equal(issues.filter(issue => issue.ruleName === 'restriction_duplicate').length, 2);
  const source = generateVerseCode([item], [], publicApiConfig);
  assert.equal((source.match(/CountryCode <> "CA"/g) ?? []).length, 1);
  assert.equal((source.match(/PlatformFamily <> "Windows"/g) ?? []).length, 1);
});

test('malformed supported-schema data is loadable, diagnosable, and blocks invalid generation without crashing validation', () => {
  const parsed = parseManagedData({
    schemaVersion: 4,
    entitlements: [{
      id: 'bad', verseKey: 'bad', name: 'Bad', shortDescription: 'Bad', description: 'Bad', priceVBucks: 125,
      itemType: 'unsupported', maxCount: 2, autoConsume: true, iconTexture: 'not a texture',
      offerRestrictions: { minimumPurchaseAge: 100, blockedCountryCodes: ['ZZ'], blockedPlatformFamilies: ['Steam'] },
      flags: { paidRandomItem: false, paidRandomItemOdds: '' }, triggers: {},
    }],
    bundles: [{ id: 'bad-bundle', verseKey: 'bad_bundle', name: 'Bad Bundle', shortDescription: 'Bad', description: 'Bad', priceVBucks: 100, iconTexture: 'EntitlementIcons.Bad', items: [{ bundleId: 'bad-bundle', quantity: 1 }] }],
    storefrontMembership: { allOffers: [{ bundleId: 'missing-bundle' }], focused: [] },
  });
  assert.equal(parsed.entitlements.length, 1);
  assert.equal(parsed.bundles.length, 1);
  assert.doesNotThrow(() => validateEntireProject(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.storefrontMembership));
  const issues = validateEntireProject(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.storefrontMembership);
  assert.ok(issues.some(issue => issue.ruleName === 'price_bounds_and_step'));
  assert.ok(issues.some(issue => issue.ruleName === 'entitlement_type'));
  assert.equal(issues.some(issue => issue.ruleName === 'minimum_purchase_age'), false);
  assert.throws(() => generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.storefrontMembership), /unsupported entitlement type/i);
  assert.ok(issues.some(issue => issue.ruleName === 'bundle_cycle'));
  assert.ok(parsed.projectDataDiagnostics.some(diagnostic => /no longer exists|ambiguous/i.test(diagnostic)));
});
