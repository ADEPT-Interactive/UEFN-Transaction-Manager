import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { parseVerseCode } from '../src/services/verseParser';
import { normalizeEntitlement, parseManagedData } from '../src/services/projectSchema';
import { toPascalCase, validateEntireProject } from '../src/services/validator';
import { duplicateEntitlement } from '../src/services/duplicateEntitlement';
import { COUNTRY_CODE_OPTIONS, EPIC_PLATFORM_FAMILIES } from '../src/constants/offerRestrictions';
import { DEFAULT_PRESETS } from '../src/constants/presets';
import { BundleOffer, EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../src/types/entitlement';

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

test('generated Verse embeds a lossless managed manifest', () => {
  const source = generateVerseCode(items, bundles, config);
  const parsed = parseVerseCode(source);
  assert.equal(parsed.managed, true);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.entitlements)), JSON.parse(JSON.stringify(items)));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.bundles)), JSON.parse(JSON.stringify(bundles)));
});

test('generated device uses authoritative deltas, lifecycle cleanup, and purchase restrictions', () => {
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
  assert.match(source, /RestrictDirectPromptsToPurchase\[Player\]/);
  assert.match(source, /RestrictPaidRandomItems\[Player\]/);
  assert.match(source, /Odds: Common: 75%, Rare: 25%/);
  assert.match(source, /else if \(set PurchaseInFlight\[Player\] = true\):/);
  assert.match(source, /ClearPurchaseInFlight\(Player\)/);
  assert.doesNotMatch(source, /BeginPurchase\(Player\)/);
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
  assert.match(source, /PromptBuyStarterBundle<public>/);
  assert.match(source, /ShowOffersDialog\(Player, array\{ManagedOffers\.vip_pass_offer\{\}, ManagedOffers\.mystery_crate_offer\{\}, ManagedOffers\.starter_bundle_offer\{\}\}, \?Title := AllOffersStoreTitle\)/);
  assert.match(source, /Starter Bundle.*Odds: Mystery Crate: Common: 75%, Rare: 25%/s);
  assert.match(source, /VipPassOwnershipVerifiedEvent\.Signal\(Player\)/);
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
  assert.match(source, /CountryCode <> "CN"\n        PlatformFamily <> "Android"\n        13/);
  assert.match(source, /CountryCode <> "US"\n        PlatformFamily <> "Windows"\n        18/);
  assert.doesNotMatch(source, /\breturn\s+(?:0|\d+)/);
  assert.match(source, /VipPassEntitlementGrantedEvent<public>:event\(tuple\(player, int\)\)/);
  assert.match(source, /GrantVipPass<public>/);
  assert.match(source, /ConsumeMysteryCrate<public>/);
  assert.match(source, /vip_pass_mobile_offer<public>/);
  assert.match(source, /StorefrontButtons : \[\]button_device/);
  assert.match(source, /Shop zone entered; use a deliberate shop interaction/);
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
  assert.match(source, /ShowCoinStore<public>\(Player:player\)<suspends>:void/);
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
  assert.doesNotMatch(source, /Direct purchase prompts are restricted for this player"\),?\r?\n\s*Print\("Direct purchase prompts are restricted for this player/);
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
