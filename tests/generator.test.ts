import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { parseVerseCode } from '../src/services/verseParser';
import { normalizeEntitlement, parseManagedData } from '../src/services/projectSchema';
import { toPascalCase, validateEntireProject } from '../src/services/validator';
import { duplicateEntitlement } from '../src/services/duplicateEntitlement';
import { COUNTRY_CODE_OPTIONS, EPIC_PLATFORM_FAMILIES } from '../src/constants/offerRestrictions';
import { DEFAULT_PRESETS } from '../src/constants/presets';
import { BundleOffer, EntitlementItem, OfferDisplayGroup, OfferRestrictions, ProjectConfig } from '../src/types/entitlement';

const config: ProjectConfig = {
  contentFolderPath: 'C:\\UEFN\\Project\\Content', targetVerseFileName: 'managed_transactions.verse',
  assetFolderName: 'EntitlementIcons', deviceClassName: 'managed_transactions_device',
  infoModuleName: 'ManagedEntitlementInfo', entitlementsModuleName: 'ManagedEntitlements',
  pricesModuleName: 'ManagedTransactionPrices', offersModuleName: 'ManagedOffers',
  autoBackup: true, enableVerseWorkflowServer: true,
  generateStorefrontBinding: true, storefrontButtonDeviceName: 'TransactionStorefrontButtons',
};

const items: EntitlementItem[] = [
  {
    id: 'vip', verseKey: 'vip_pass', name: 'VIP "Pass"', shortDescription: 'Permanent VIP access.',
    description: 'Unlocks VIP access.', priceVBucks: 500, itemType: 'durable', maxCount: 1,
    autoConsume: false, iconTexture: 'EntitlementIcons.Icon_VIP',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: true, consequentialToGameplay: true },
    purchaseEventName: 'VipPassPurchasedEvent', restoreOnJoin: true,
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'VipPassOfferTriggers', generateButtonBinding: true, buttonDeviceName: 'VipPassButtons', generateZoneBinding: true, mutatorZoneName: 'VipPassZones' },
  },
  {
    id: 'crate', verseKey: 'mystery_crate', name: 'Mystery Crate', shortDescription: 'One disclosed random reward.',
    description: 'Contains one reward.', priceVBucks: 100, itemType: 'consumable', maxCount: 10,
    autoConsume: true, iconTexture: 'EntitlementIcons.MysteryCrate',
    flags: { paidRandomItem: true, paidRandomItemOdds: 'Common: 75%, Rare: 25%', paidArea: false, consequentialToGameplay: true },
    purchaseEventName: 'MysteryCratePurchasedEvent', restoreOnJoin: false,
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'MysteryCrateOfferTriggers', generateButtonBinding: false, generateZoneBinding: false },
  },
];

const bundles: BundleOffer[] = [{
  id: 'starter', verseKey: 'starter_bundle', name: 'Starter Bundle', shortDescription: 'VIP access and one crate.',
  description: 'Two offers sold together.', priceVBucks: 550, iconTexture: 'EntitlementIcons.StarterBundle',
  items: [{ entitlementId: 'vip', quantity: 1 }, { entitlementId: 'crate', quantity: 1 }],
}];

const paidRandomRestrictionName = ['Restrict', 'PaidRandom', 'Items'].join('');

function offerClassBlock(source: string, generatedOfferKey: string): string {
  const marker = `    ${generatedOfferKey}<public> := class`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Generated offer class not found: ${generatedOfferKey}`);
  const remainder = source.slice(start + marker.length);
  const nextTopLevelLine = remainder.search(/\n {4}\S/);
  return source.slice(start, start + marker.length + (nextTopLevelLine < 0 ? remainder.length : nextTopLevelLine));
}

function restrictionMethod(source: string, generatedOfferKey: string): string | undefined {
  const block = offerClassBlock(source, generatedOfferKey);
  const marker = '        GetMinPurchaseAge<override>';
  const start = block.indexOf(marker);
  if (start < 0) return undefined;
  const end = block.indexOf('\n\n', start);
  return block.slice(start, end < 0 ? block.length : end).replace(/\n$/, '');
}

function metadataDescription(source: string, key: string): string {
  const marker = `    ${toPascalCase(key)}<public> := module:`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Generated metadata module not found: ${key}`);
  const remainder = source.slice(start + marker.length);
  const nextModule = remainder.search(/\n {4}\S/);
  const block = remainder.slice(0, nextModule < 0 ? remainder.length : nextModule);
  return block.split('\n').find(line => line.includes('Description<public><localizes>')) ?? '';
}

function expectedRestrictionMethod(restrictions: OfferRestrictions): string {
  return [
    '        GetMinPurchaseAge<override>(CountryCode:string, SubdivisionCode:string, PlatformFamily:string)<decides><computes>:int =',
    ...restrictions.blockedCountryCodes.map(country => `            CountryCode <> "${country}"`),
    ...restrictions.blockedPlatformFamilies.map(platform => `            PlatformFamily <> "${platform}"`),
    `            return ${restrictions.minimumPurchaseAge ?? 0}`,
  ].join('\n');
}

test('generated Verse embeds a lossless managed manifest', () => {
  const source = generateVerseCode(items, bundles, config);
  const parsed = parseVerseCode(source);
  assert.equal(parsed.managed, true);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.entitlements)), JSON.parse(JSON.stringify(items)));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.bundles)), JSON.parse(JSON.stringify(bundles)));
});

test('generated device uses authoritative deltas, lifecycle cleanup, and transaction flows', () => {
  const source = generateVerseCode(items, bundles, config);
  assert.match(source, /EntitlementIcons<public> := module \{\}/);
  assert.match(source, /EntitlementChange\.Change > 0/);
  assert.match(source, /ProcessVipPassGrant\(Player, EntitlementChange\.Change\)/);
  assert.doesNotMatch(source, /EntitlementChange\.Quantity/);
  assert.match(source, /PlayerRemovedEvent\(\)\.Subscribe/);
  assert.match(source, /OnEnd<override>\(\):void/);
  assert.match(source, /Subscription\.Cancel\(\)/);
  assert.match(source, /DeviceSubscriptions:\[\]cancelable/);
  assert.match(source, /VipPassOfferTriggers : \[\]trigger_device/);
  assert.match(source, /TriggeredEvent\.Subscribe\(OnVipPassTriggerActivated\)/);
  assert.match(source, /OnVipPassTriggerActivated\(MaybeAgent:\?agent\):void/);
  assert.match(source, /PaidRandomItem<override>:logic = true/);
  assert.equal(source.includes(paidRandomRestrictionName), false);
  assert.match(source, /Odds: Common: 75%, Rare: 25%/);
  assert.match(source, /else if \(set PurchaseInFlight\[Player\] = true\):/);
  assert.match(source, /ClearPurchaseInFlight\(Player\)/);
  assert.doesNotMatch(source, /BeginPurchase\(Player\)/);
});

test('voluntary purchase flows are not guarded by creator-messaging restrictions', () => {
  const directPromptRestrictionName = ['Restrict', 'DirectPrompts', 'ToPurchase'].join('');
  const regularSource = generateVerseCode([items[0]], [], { ...config, generateStorefrontBinding: false });
  const mixedSource = generateVerseCode(items, bundles, config);

  for (const source of [regularSource, mixedSource]) {
    assert.equal(source.includes(directPromptRestrictionName), false);
  }
  assert.match(regularSource, /OpenVipPassPurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(mixedSource, /OpenMysteryCratePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.equal(mixedSource.includes(paidRandomRestrictionName), false);
  assert.match(regularSource, /WasPurchased := BuyOffer\(Player, ManagedOffers\.vip_pass_offer\{\}\)/);
  assert.match(mixedSource, /ShowOffersDialog\(Player, array\{ManagedOffers\.vip_pass_offer\{\}, ManagedOffers\.mystery_crate_offer\{\}, ManagedOffers\.starter_bundle_offer\{\}\}, \?Title := AllOffersStoreTitle\)/);
});

test('paid-random metadata, not a manual guard, covers every generated Marketplace purchase path', () => {
  const random = structuredClone(items[1]);
  random.alternateOffers = [{
    id: 'crate-mobile', verseKey: 'mystery_crate_mobile', name: 'Mystery Crate Mobile',
    shortDescription: 'One disclosed random reward on mobile.', description: 'Contains one reward.',
    priceVBucks: 100, iconTexture: 'EntitlementIcons.MysteryCrate',
    restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];
  const nonRandomBundle: BundleOffer = {
    ...bundles[0], id: 'vip-only', verseKey: 'vip_only_bundle', name: 'VIP Only Bundle',
    items: [{ entitlementId: 'vip', quantity: 1 }],
  };
  const multiRandomBundle: BundleOffer = {
    ...bundles[0], id: 'random-multi', verseKey: 'random_multi_bundle', name: 'Random Multi Bundle',
    items: [{ entitlementId: 'vip', quantity: 1 }, { entitlementId: 'crate', quantity: 1 }],
  };
  const dynamicRandomBundle: BundleOffer = {
    ...bundles[0], id: 'dynamic-random', verseKey: 'dynamic_random_bundle', name: 'Dynamic Random Bundle',
    dynamicRemaining: true, items: [{ entitlementId: 'crate', quantity: 1 }],
  };
  const source = generateVerseCode(
    [items[0], random],
    [nonRandomBundle, multiRandomBundle, dynamicRandomBundle],
    config,
    [{
      id: 'random-store', verseKey: 'random_store', name: 'Random Store', generateTriggerBinding: false,
      entries: [{ entitlementId: 'crate' }, { bundleId: 'random-multi' }],
    }],
  );

  assert.equal(source.includes(paidRandomRestrictionName), false);
  assert.match(source, /vip_pass_entitlement<public> := class<concrete>/);
  assert.match(source, /PaidRandomItem<override>:logic = true/);
  assert.match(source, /OpenMysteryCratePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(source, /OpenMysteryCrateMobilePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(source, /OpenVipOnlyBundlePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(source, /OpenRandomMultiBundlePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(source, /OpenDynamicRandomBundlePurchase<public>\(Player:player\):void =\n        if \(Active := PurchaseInFlight\[Player\], Active\?\):/);
  assert.match(source, /WasPurchased := BuyOffer\(Player, DynamicOffer\)/);
  assert.match(source, /ShowOffersDialog\(Player, array\{ManagedOffers\.vip_pass_offer\{\}, ManagedOffers\.mystery_crate_offer\{\}, ManagedOffers\.mystery_crate_mobile_offer\{\}, ManagedOffers\.vip_only_bundle_offer\{\}, ManagedOffers\.random_multi_bundle_offer\{\}, ManagedOffers\.dynamic_random_bundle_offer\{\}\}, \?Title := AllOffersStoreTitle\)/);
  assert.match(source, /ShowRandomStoreOffers\(Player:player\)<suspends>:void =\n        ShowOffersDialog\(Player, array\{ManagedOffers\.mystery_crate_offer\{\}, ManagedOffers\.random_multi_bundle_offer\{\}\}, \?Title := RandomStoreTitle\)/);
  assert.match(source, /ConsumeMysteryCrate<public>/);
});

test('empty paid-random odds remain optional for direct offer descriptions', () => {
  const random = structuredClone(items[1]);
  random.flags.paidRandomItemOdds = '';
  random.description = 'x'.repeat(500);
  const source = generateVerseCode([random], [], config);

  assert.doesNotMatch(source, /Odds:/);
  const issues = validateEntireProject([random], [], config);
  assert.equal(issues.some(issue => issue.ruleName === 'random_item_description_length'), false);
  assert.deepEqual(issues.filter(issue => issue.severity === 'error'), []);
});

test('only actual odds values are appended across direct, alternate, and bundle descriptions', () => {
  const regularA = structuredClone(items[0]);
  regularA.id = 'regular-a';
  regularA.verseKey = 'regular_a';
  regularA.name = 'Regular A';
  regularA.purchaseEventName = 'RegularAEvent';
  regularA.triggers.triggerDeviceName = 'RegularAOfferTriggers';
  const regularB = structuredClone(regularA);
  regularB.id = 'regular-b';
  regularB.verseKey = 'regular_b';
  regularB.name = 'Regular B';
  regularB.purchaseEventName = 'RegularBEvent';
  regularB.triggers.triggerDeviceName = 'RegularBOfferTriggers';

  const supplied = structuredClone(items[1]);
  supplied.id = 'random-supplied';
  supplied.verseKey = 'random_supplied';
  supplied.name = 'Random Supplied';
  supplied.purchaseEventName = 'RandomSuppliedEvent';
  supplied.triggers.triggerDeviceName = 'RandomSuppliedOfferTriggers';
  supplied.alternateOffers = [{
    id: 'random-supplied-alt', verseKey: 'random_supplied_alt', name: 'Random Supplied Alt',
    shortDescription: 'Alternate disclosed random reward.', description: 'Contains one reward.',
    priceVBucks: 100, iconTexture: 'EntitlementIcons.MysteryCrate',
    restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];

  const empty = structuredClone(supplied);
  empty.id = 'random-empty';
  empty.verseKey = 'random_empty';
  empty.name = 'Random Empty';
  empty.purchaseEventName = 'RandomEmptyEvent';
  empty.triggers.triggerDeviceName = 'RandomEmptyOfferTriggers';
  empty.flags.paidRandomItemOdds = '';
  empty.alternateOffers = [{
    id: 'random-empty-alt', verseKey: 'random_empty_alt', name: 'Random Empty Alt',
    shortDescription: 'Alternate random reward.', description: 'Contains one reward.',
    priceVBucks: 100, iconTexture: 'EntitlementIcons.MysteryCrate',
    restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];

  const noRandomBundle: BundleOffer = {
    ...bundles[0], id: 'no-random', verseKey: 'no_random_bundle', name: 'No Random Bundle',
    items: [{ entitlementId: regularA.id, quantity: 1 }, { entitlementId: regularB.id, quantity: 1 }],
  };
  const suppliedBundle: BundleOffer = {
    ...bundles[0], id: 'supplied-bundle', verseKey: 'supplied_bundle', name: 'Supplied Bundle',
    items: [{ entitlementId: supplied.id, quantity: 1 }, { entitlementId: regularA.id, quantity: 1 }],
  };
  const emptyBundle: BundleOffer = {
    ...bundles[0], id: 'empty-bundle', verseKey: 'empty_bundle', name: 'Empty Bundle',
    items: [{ entitlementId: empty.id, quantity: 1 }, { entitlementId: regularB.id, quantity: 1 }],
  };
  const mixedBundle: BundleOffer = {
    ...bundles[0], id: 'mixed-bundle', verseKey: 'mixed_bundle', name: 'Mixed Bundle',
    items: [{ entitlementId: supplied.id, quantity: 1 }, { entitlementId: empty.id, quantity: 1 }],
  };
  const source = generateVerseCode(
    [regularA, regularB, supplied, empty],
    [noRandomBundle, suppliedBundle, emptyBundle, mixedBundle],
    config,
  );

  assert.doesNotMatch(metadataDescription(source, regularA.verseKey), /Odds:/);
  assert.match(metadataDescription(source, supplied.verseKey), /Odds: Common: 75%, Rare: 25%/);
  assert.doesNotMatch(metadataDescription(source, empty.verseKey), /Odds:/);
  assert.match(metadataDescription(source, 'random_supplied_alt'), /Odds: Common: 75%, Rare: 25%/);
  assert.doesNotMatch(metadataDescription(source, 'random_empty_alt'), /Odds:/);
  assert.doesNotMatch(metadataDescription(source, noRandomBundle.verseKey), /Odds:/);
  assert.match(metadataDescription(source, suppliedBundle.verseKey), /Odds: Random Supplied: Common: 75%, Rare: 25%/);
  assert.doesNotMatch(metadataDescription(source, emptyBundle.verseKey), /Odds:/);
  assert.match(metadataDescription(source, mixedBundle.verseKey), /Odds: Random Supplied: Common: 75%, Rare: 25%/);
  assert.doesNotMatch(metadataDescription(source, mixedBundle.verseKey), /Random Empty:/);

  const suppliedLongAlternate = structuredClone(supplied);
  suppliedLongAlternate.alternateOffers![0].description = 'x'.repeat(500);
  const suppliedAlternateIssues = validateEntireProject([suppliedLongAlternate], [], config);
  assert.ok(suppliedAlternateIssues.some(issue => issue.ruleName === 'random_item_description_length' && issue.field === 'alternateOffers.0.description'));
  const emptyLongAlternate = structuredClone(empty);
  emptyLongAlternate.alternateOffers![0].description = 'x'.repeat(500);
  const emptyAlternateIssues = validateEntireProject([emptyLongAlternate], [], config);
  assert.equal(emptyAlternateIssues.some(issue => issue.ruleName === 'random_item_description_length'), false);
});

test('saved paid-random odds survive manifest reopen and regeneration for old and current schemas', () => {
  const supplied = structuredClone(items[1]);
  supplied.id = 'saved-supplied';
  supplied.verseKey = 'saved_supplied';
  supplied.purchaseEventName = 'SavedSuppliedEvent';
  supplied.triggers.triggerDeviceName = 'SavedSuppliedOfferTriggers';
  const empty = structuredClone(items[1]);
  empty.id = 'saved-empty';
  empty.verseKey = 'saved_empty';
  empty.purchaseEventName = 'SavedEmptyEvent';
  empty.triggers.triggerDeviceName = 'SavedEmptyOfferTriggers';
  empty.flags.paidRandomItemOdds = '';

  const source = generateVerseCode([supplied, empty], [], config);
  const reopened = parseVerseCode(source);
  assert.equal(reopened.managed, true);
  assert.equal(reopened.entitlements.find(item => item.id === supplied.id)?.flags.paidRandomItemOdds, supplied.flags.paidRandomItemOdds);
  assert.equal(reopened.entitlements.find(item => item.id === empty.id)?.flags.paidRandomItemOdds, '');
  assert.deepEqual(validateEntireProject(reopened.entitlements, reopened.bundles, config).filter(issue => issue.severity === 'error'), []);

  for (const schemaVersion of [2, 3, 4] as const) {
    const parsed = parseManagedData({ schemaVersion, entitlements: [supplied, empty], bundles: [] });
    assert.equal(parsed.entitlements[0].flags.paidRandomItemOdds, supplied.flags.paidRandomItemOdds);
    assert.equal(parsed.entitlements[1].flags.paidRandomItemOdds, '');
    const regenerated = generateVerseCode(parsed.entitlements, parsed.bundles, config);
    assert.match(metadataDescription(regenerated, supplied.verseKey), /Odds: Common: 75%, Rare: 25%/);
    assert.doesNotMatch(metadataDescription(regenerated, empty.verseKey), /Odds:/);
  }
});

test('missing trigger settings migrate to the default offer trigger binding', () => {
  const normalized = normalizeEntitlement({ ...items[0], triggers: { generateButtonBinding: false, generateZoneBinding: false } }, 0);
  assert.equal(normalized.triggers.generateTriggerBinding, true);
  assert.equal(normalized.triggers.triggerDeviceName, 'vip_pass_OfferTriggers');
});

test('bundle metadata and offer references are generated', () => {
  const source = generateVerseCode(items, bundles, config);
  assert.match(source, /StarterBundle<public> := module:/);
  assert.match(source, /starter_bundle_offer<public> := class\(bundle_offer\):/);
  assert.match(source, /\(vip_pass_offer\{\}, 1\)/);
  assert.match(source, /\(mystery_crate_offer\{\}, 1\)/);
  assert.match(source, /OpenStarterBundlePurchase<public>/);
  assert.match(source, /ShowOffersDialog\(Player, array\{ManagedOffers\.vip_pass_offer\{\}, ManagedOffers\.mystery_crate_offer\{\}, ManagedOffers\.starter_bundle_offer\{\}\}, \?Title := AllOffersStoreTitle\)/);
  assert.match(source, /Starter Bundle.*Odds: Mystery Crate: Common: 75%, Rare: 25%/s);
  assert.doesNotMatch(source, /VipPassOwnershipVerifiedEvent/);
});

test('unmanaged Verse is refused rather than guessed', () => {
  const parsed = parseVerseCode('example := class(creative_device):');
  assert.equal(parsed.managed, false);
  assert.equal(parsed.entitlements.length, 0);
  assert.match(parsed.error ?? '', /left untouched/i);
});

test('project validator covers schema, identifiers, offers, and config', () => {
  assert.deepEqual(validateEntireProject(items, bundles, config).filter(issue => issue.severity === 'error'), []);
  const invalid = structuredClone(items);
  invalid[0].priceVBucks = 125;
  invalid[1].flags.paidRandomItemOdds = 'Rare rewards available';
  const rules = validateEntireProject(invalid, bundles, config).map(issue => issue.ruleName);
  assert.ok(rules.includes('price_bounds_and_step'));
  assert.equal(rules.includes('random_item_odds'), false);
});

test('new marketplace safeguards and public helpers are generated', () => {
  const featureItems = structuredClone(items);
  const featureBundles = structuredClone(bundles);
  featureItems[0].offerRestrictions = { minimumPurchaseAge: 13, blockedCountryCodes: ['CN'], blockedPlatformFamilies: ['Android'] };
  featureBundles[0].restrictions = { minimumPurchaseAge: 18, blockedCountryCodes: ['US'], blockedPlatformFamilies: ['Windows'] };
  featureItems[0].durationDescription = 'Lasts 7 days after purchase';
  featureItems[0].alternateOffers = [{
    id: 'vip-alt', verseKey: 'vip_pass_mobile', name: 'VIP Mobile', shortDescription: 'Mobile VIP access.', description: 'VIP access for mobile.', priceVBucks: 400,
    iconTexture: 'EntitlementIcons.Icon_VIP', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];
  const featureConfig = { ...config, generateStorefrontBinding: true, storefrontButtonDeviceName: 'StorefrontButtons' };
  const source = generateVerseCode(featureItems, featureBundles, featureConfig);
  assert.match(source, /ShowOffersDialog\(Player/);
  assert.match(source, /GetMinPurchaseAge<override>/);
  assert.equal(restrictionMethod(source, 'vip_pass_offer'), expectedRestrictionMethod(featureItems[0].offerRestrictions!));
  assert.equal(restrictionMethod(source, 'starter_bundle_offer'), expectedRestrictionMethod(featureBundles[0].restrictions!));
  assert.equal(restrictionMethod(source, 'vip_pass_mobile_offer'), undefined);
  assert.match(source, /VipPass_GrantedEvent<public>:event\(tuple\(player, int\)\)/);
  assert.match(source, /GrantVipPass<public>/);
  assert.match(source, /ConsumeMysteryCrate<public>/);
  assert.match(source, /vip_pass_mobile_offer<public>/);
  assert.match(source, /StorefrontButtons : \[\]button_device/);
  assert.match(source, /Shop zone entered; use a deliberate shop interaction/);
});

test('GetMinPurchaseAge emits every configured restriction with a return and omits no-op overrides', () => {
  const cases: Array<{ name: string; restrictions?: OfferRestrictions }> = [
    { name: 'country only', restrictions: { blockedCountryCodes: ['CG'], blockedPlatformFamilies: [] } },
    { name: 'platform only', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: ['Xbox'] } },
    { name: 'minimum age only', restrictions: { minimumPurchaseAge: 19, blockedCountryCodes: [], blockedPlatformFamilies: [] } },
    { name: 'country and minimum age', restrictions: { minimumPurchaseAge: 13, blockedCountryCodes: ['CN'], blockedPlatformFamilies: [] } },
    { name: 'platform and minimum age', restrictions: { minimumPurchaseAge: 16, blockedCountryCodes: [], blockedPlatformFamilies: ['Android'] } },
    { name: 'country and platform', restrictions: { blockedCountryCodes: ['IR'], blockedPlatformFamilies: ['Windows'] } },
    { name: 'country platform and minimum age', restrictions: { minimumPurchaseAge: 18, blockedCountryCodes: ['US', 'CA', 'GB'], blockedPlatformFamilies: ['Windows', 'Xbox', 'PlayStation'] } },
    { name: 'minimum age zero with country and platform', restrictions: { minimumPurchaseAge: 0, blockedCountryCodes: ['CC'], blockedPlatformFamilies: ['Nintendo'] } },
    { name: 'no restrictions' },
    { name: 'empty restrictions object', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] } },
  ];

  for (const testCase of cases) {
    const item = structuredClone(items[0]);
    if (testCase.restrictions) item.offerRestrictions = testCase.restrictions;
    const source = generateVerseCode([item], [], { ...config, generateStorefrontBinding: false });
    const method = restrictionMethod(source, 'vip_pass_offer');

    if (!testCase.restrictions || (testCase.restrictions.blockedCountryCodes.length === 0 && testCase.restrictions.blockedPlatformFamilies.length === 0 && testCase.restrictions.minimumPurchaseAge === undefined)) {
      assert.equal(method, undefined, testCase.name);
      continue;
    }

    assert.equal(method, expectedRestrictionMethod(testCase.restrictions), testCase.name);
    assert.doesNotMatch(method!, /\n(?! {12})\S/);
    assert.doesNotMatch(source, /GetMinPurchaseAge<override>[^\n]*\n(?:CountryCode|PlatformFamily|return)/);
  }
});

test('GetMinPurchaseAge generation is consistent for alternate, static bundle, and dynamic bundle offers', () => {
  const restrictedItem = structuredClone(items[0]);
  restrictedItem.offerRestrictions = { minimumPurchaseAge: 12, blockedCountryCodes: ['CA'], blockedPlatformFamilies: ['Android'] };
  restrictedItem.alternateOffers = [{
    id: 'vip-restricted-alt', verseKey: 'vip_restricted_alt', name: 'VIP Restricted', shortDescription: 'Restricted VIP.', description: 'Restricted VIP access.',
    priceVBucks: 400, iconTexture: 'EntitlementIcons.Icon_VIP', restrictions: { minimumPurchaseAge: 15, blockedCountryCodes: ['GB'], blockedPlatformFamilies: ['iOS'] },
  }, {
    id: 'vip-open-alt', verseKey: 'vip_open_alt', name: 'VIP Open', shortDescription: 'Open VIP.', description: 'Open VIP access.',
    priceVBucks: 450, iconTexture: 'EntitlementIcons.Icon_VIP', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];
  const restrictedBundle = { ...bundles[0], restrictions: { minimumPurchaseAge: 0, blockedCountryCodes: ['IR'], blockedPlatformFamilies: ['Xbox'] } };
  const dynamicBundle = { ...restrictedBundle, id: 'dynamic-restricted', verseKey: 'dynamic_restricted', dynamicRemaining: true, items: [{ entitlementId: 'crate', quantity: 1 }] };
  const source = generateVerseCode([restrictedItem, items[1]], [restrictedBundle, dynamicBundle], { ...config, generateStorefrontBinding: false });

  assert.equal(restrictionMethod(source, 'vip_pass_offer'), expectedRestrictionMethod(restrictedItem.offerRestrictions));
  assert.equal(restrictionMethod(source, 'vip_restricted_alt_offer'), expectedRestrictionMethod(restrictedItem.alternateOffers[0].restrictions));
  assert.equal(restrictionMethod(source, 'vip_open_alt_offer'), undefined);
  assert.equal(restrictionMethod(source, 'starter_bundle_offer'), expectedRestrictionMethod(restrictedBundle.restrictions));
  assert.equal(restrictionMethod(source, 'dynamic_restricted_offer'), expectedRestrictionMethod(dynamicBundle.restrictions!));
  assert.equal(restrictionMethod(source, 'dynamic_restricted_dynamic_offer'), expectedRestrictionMethod(dynamicBundle.restrictions!));

  for (const generatedOfferKey of ['vip_pass_offer', 'vip_restricted_alt_offer', 'starter_bundle_offer', 'dynamic_restricted_offer', 'dynamic_restricted_dynamic_offer']) {
    assert.doesNotMatch(restrictionMethod(source, generatedOfferKey)!, /GetMinPurchaseAge<override>[^\n]*\n(?:CountryCode|PlatformFamily|return)/);
  }
});

test('validator does not inspect paid random disclosure format', () => {
  const randomOnly = structuredClone(items);
  randomOnly[1].flags.paidRandomItemOdds = 'Outcome table supplied by the game UI';
  const issues = validateEntireProject(randomOnly, bundles, config);
  assert.equal(issues.some(issue => issue.ruleName === 'random_item_odds'), false);
  assert.deepEqual(issues.filter(issue => issue.severity === 'error'), []);
});

test('validator still reports restricted copy and Pascal symbol collisions', () => {
  const invalid = structuredClone(items);
  invalid[0].name = 'XP Booster';
  invalid[1].flags.paidRandomItemOdds = 'Common: 60%, Rare: 30%';
  invalid[1].verseKey = 'vip__pass';
  const rules = validateEntireProject(invalid, bundles, config).map(issue => issue.ruleName);
  assert.ok(rules.includes('restricted_monetization_term'));
  assert.ok(rules.includes('generated_symbol_unique'));
  const termIssue = validateEntireProject(invalid, bundles, config).find(issue => issue.ruleName === 'restricted_monetization_term');
  assert.equal(termIssue?.severity, 'warning');
  assert.equal(toPascalCase('vip__pass'), 'VipPass');
});

test('moderation word checking flags common risk categories without blocking creation', () => {
  const flagged = structuredClone(items);
  flagged[0].name = 'F.u.c.k Casino Pass';
  flagged[0].shortDescription = 'Join my Discord for a cash prize.';
  flagged[0].description = 'Includes sexual gore, cocaine, and a guaranteed win.';

  const issues = validateEntireProject(flagged, bundles, config);
  const moderationIssues = issues.filter(issue => issue.ruleName.startsWith('moderation_'));
  const moderationRules = moderationIssues.map(issue => issue.ruleName);

  assert.ok(moderationRules.includes('moderation_profanity'));
  assert.ok(moderationRules.includes('moderation_sexual_content'));
  assert.ok(moderationRules.includes('moderation_violence_or_self_harm'));
  assert.ok(moderationRules.includes('moderation_drugs_or_alcohol'));
  assert.ok(moderationRules.includes('moderation_gambling'));
  assert.ok(moderationRules.includes('moderation_deceptive_or_real_world_value'));
  assert.ok(moderationRules.includes('moderation_external_contact'));
  assert.ok(moderationIssues.every(issue => issue.severity === 'warning'));
  assert.ok(moderationIssues.every(issue => /does not block entitlement creation/i.test(issue.message)));
  assert.deepEqual(issues.filter(issue => issue.severity === 'error'), []);
});

test('moderation word checking deduplicates categories and respects word boundaries', () => {
  const reviewed = structuredClone(items);
  reviewed[0].name = 'Classic Assignment';
  reviewed[0].description = 'A class assignment with no player-facing profanity.';
  let issues = validateEntireProject(reviewed, bundles, config);
  assert.equal(issues.some(issue => issue.ruleName === 'moderation_profanity'), false);

  reviewed[0].description = 'Sh1t and bullshit are both present.';
  issues = validateEntireProject(reviewed, bundles, config);
  assert.equal(issues.filter(issue => issue.ruleName === 'moderation_profanity').length, 1);
});

test('starter presets are broad entitlement categories rather than gameplay examples', () => {
  assert.deepEqual(DEFAULT_PRESETS.map(preset => preset.presetTitle), [
    'Durable entitlement',
    'Consumable entitlement',
    'Time-limited entitlement',
    'Paid random item',
    'Access entitlement',
  ]);
  assert.ok(DEFAULT_PRESETS.every(preset => !/strength|cash|backpack|crate|vip/i.test(`${preset.name} ${preset.presetDescription}`)));
  assert.equal(DEFAULT_PRESETS.find(preset => preset.flags?.paidRandomItem)?.flags?.paidRandomItemOdds, '');
});

test('restriction pickers use the complete ISO country set and official Epic platform IDs', () => {
  assert.equal(COUNTRY_CODE_OPTIONS.length, 249);
  assert.deepEqual(EPIC_PLATFORM_FAMILIES, ['Android', 'iOS', 'macOS', 'Nintendo', 'PlayStation', 'Windows', 'Xbox', 'Luna', 'GeForceNow']);
  const invalid = structuredClone(items);
  invalid[0].offerRestrictions = { blockedCountryCodes: ['ZZ'], blockedPlatformFamilies: ['Steam'] };
  const rules = validateEntireProject(invalid, bundles, config).map(issue => issue.ruleName);
  assert.ok(rules.includes('country_code'));
  assert.ok(rules.includes('platform_family'));
});

test('dynamic remaining bundles are represented and validated', () => {
  const dynamic: BundleOffer = { ...bundles[0], id: 'dynamic', verseKey: 'dynamic_bundle', dynamicRemaining: true, items: [{ entitlementId: 'crate', quantity: 1 }] };
  const source = generateVerseCode(items, [dynamic], config);
  assert.match(source, /dynamic_bundle_dynamic_offer<public>/);
  assert.equal(restrictionMethod(source, 'dynamic_bundle_offer'), undefined);
  assert.equal(restrictionMethod(source, 'dynamic_bundle_dynamic_offer'), undefined);
  assert.match(source, /RemainingCount := 10 - OwnedCount/);
  assert.deepEqual(validateEntireProject(items, [dynamic], config).filter(issue => issue.severity === 'error'), []);
});

test('nested bundles carry paid-random disclosures through every containing offer', () => {
  const randomBundle: BundleOffer = { ...bundles[0], id: 'random-child', verseKey: 'random_child', items: [{ entitlementId: 'crate', quantity: 1 }, { entitlementId: 'vip', quantity: 1 }] };
  const parent: BundleOffer = { ...bundles[0], id: 'random-parent', verseKey: 'random_parent', name: 'Parent Bundle', description: 'Contains the child bundle.', items: [{ bundleId: 'random-child', quantity: 1 }, { entitlementId: 'crate', quantity: 1 }] };
  const source = generateVerseCode(items, [randomBundle, parent], config);
  assert.ok(source.includes('Description<public><localizes>:message = "Contains the child bundle.\\nOdds: Mystery Crate: Common: 75%, Rare: 25%"'));
  assert.deepEqual(validateEntireProject(items, [randomBundle, parent], config).filter(issue => issue.severity === 'error'), []);
});

test('managed imports accept supported schemas and reject ambiguous or future data', () => {
  for (const schemaVersion of [2, 3, 4]) {
    const parsed = parseManagedData({ schemaVersion, entitlements: items, bundles });
    assert.equal(parsed.entitlements.length, 2);
    assert.equal(parsed.bundles.length, 1);
    assert.deepEqual(parsed.offerDisplayGroups, []);
  }
  assert.throws(() => parseManagedData({ entitlements: items, bundles }), /schemaVersion/);
  assert.throws(() => parseManagedData({ schemaVersion: 999, entitlements: items, bundles }), /schemaVersion/);
});

test('focused offer displays generate titled storefronts without becoming bundles', () => {
  const groups: OfferDisplayGroup[] = [{
    id: 'coin-store', verseKey: 'coin_store', name: 'Coin Store', generateTriggerBinding: true,
    triggerDeviceName: 'CoinStoreTriggers', entries: [{ entitlementId: 'vip' }, { bundleId: 'starter' }],
  }];
  const source = generateVerseCode(items, bundles, config, groups);
  assert.match(source, /CoinStoreTriggers : \[\]trigger_device/);
  assert.doesNotMatch(source, /ShowCoinStore<public>\(Player:player\)<suspends>:void/);
  assert.match(source, /ShowCoinStoreOffers\(Player:player\)<suspends>:void/);
  assert.match(source, /ShowOffersDialog\(Player, array\{ManagedOffers\.vip_pass_offer\{\}, ManagedOffers\.starter_bundle_offer\{\}\}, \?Title := CoinStoreTitle\)/);
  assert.match(source, /OpenCoinStore<public>\(Player:player\):void/);
  assert.match(source, /TriggeredEvent\.Subscribe\(OnCoinStoreTriggerActivated\)/);
  assert.doesNotMatch(source, /OnCoinStoreStoreTriggerActivated/);
  assert.doesNotMatch(source, /coin_store_offer<public> := class\(bundle_offer\)/);
  assert.deepEqual(validateEntireProject(items, bundles, config, groups).filter(issue => issue.severity === 'error'), []);
  const parsed = parseVerseCode(source);
  assert.deepEqual(parsed.offerDisplayGroups, groups);
});

test('duplicating a configured offer regenerates every global identity and compiles once per path', () => {
  const configured = structuredClone(items[0]);
  configured.offerRestrictions = { minimumPurchaseAge: 13, blockedCountryCodes: ['CA'], blockedPlatformFamilies: ['Android'] };
  configured.alternateOffers = [{
    id: 'vip-mobile', verseKey: 'vip_mobile', name: 'VIP Mobile', shortDescription: 'Mobile VIP.',
    description: 'Mobile-specific VIP offer.', priceVBucks: 400, iconTexture: 'EntitlementIcons.Icon_VIP',
    restrictions: { blockedCountryCodes: ['US'], blockedPlatformFamilies: ['Windows'] },
  }];
  configured.triggers = { generateTriggerBinding: true, triggerDeviceName: 'VipTriggers', generateButtonBinding: true, buttonDeviceName: 'VipButtons', generateZoneBinding: true, mutatorZoneName: 'VipZones' };
  let id = 0;
  const copy = duplicateEntitlement(configured, [configured, items[1]], bundles, () => `id-${++id}`);

  assert.notEqual(copy.id, configured.id);
  assert.notEqual(copy.verseKey, configured.verseKey);
  assert.notEqual(copy.purchaseEventName, configured.purchaseEventName);
  assert.notEqual(copy.alternateOffers![0].id, configured.alternateOffers[0].id);
  assert.notEqual(copy.alternateOffers![0].verseKey, configured.alternateOffers[0].verseKey);
  assert.notEqual(copy.triggers.triggerDeviceName, configured.triggers.triggerDeviceName);
  assert.notEqual(copy.triggers.buttonDeviceName, configured.triggers.buttonDeviceName);
  assert.notEqual(copy.triggers.mutatorZoneName, configured.triggers.mutatorZoneName);
  assert.notEqual(copy.alternateOffers![0].restrictions.blockedCountryCodes, configured.alternateOffers[0].restrictions.blockedCountryCodes);

  const complete = [configured, items[1], copy];
  assert.deepEqual(validateEntireProject(complete, bundles, config).filter(issue => issue.severity === 'error'), []);
  const source = generateVerseCode(complete, bundles, config);
  assert.match(source, new RegExp(`${copy.alternateOffers![0].verseKey}_offer<public>`));
});

test('validator rejects offer keys and alternate IDs reused anywhere in the project', () => {
  const invalid = structuredClone(items);
  invalid[0].alternateOffers = [{
    id: 'shared-id', verseKey: 'shared_offer', name: 'Shared A', shortDescription: 'A', description: 'A', priceVBucks: 100,
    iconTexture: 'EntitlementIcons.Icon_VIP', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];
  invalid[1].alternateOffers = [{
    id: 'shared-id', verseKey: 'shared_offer', name: 'Shared B', shortDescription: 'B', description: 'B', priceVBucks: 100,
    iconTexture: 'EntitlementIcons.MysteryCrate', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
  }];
  const rules = validateEntireProject(invalid, bundles, config).map(issue => issue.ruleName);
  assert.ok(rules.includes('offer_identifier_unique'));
  assert.ok(rules.includes('alternate_offer_id_unique'));
});
