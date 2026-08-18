import { BundleOffer, EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../src/types/entitlement';

const emptyRestrictions = { blockedCountryCodes: [], blockedPlatformFamilies: [] };

type EntitlementOverrides = Omit<Partial<EntitlementItem>, 'flags' | 'triggers'> & {
  flags?: Partial<EntitlementItem['flags']>;
  triggers?: Partial<EntitlementItem['triggers']>;
};

function entitlement(overrides: EntitlementOverrides): EntitlementItem {
  return {
    id: 'fixture-item',
    verseKey: 'fixture_item',
    name: 'Fixture Item',
    shortDescription: 'Representative public API fixture item.',
    description: 'Generated only to inventory the public API surface.',
    priceVBucks: 100,
    itemType: 'durable',
    maxCount: 1,
    autoConsume: false,
    iconTexture: 'EntitlementIcons.FixtureItem',
    flags: {
      paidRandomItem: false,
      paidRandomItemOdds: '',
      paidArea: false,
      consequentialToGameplay: false,
      ...overrides.flags,
    },
    triggers: {
      generateTriggerBinding: false,
      generateButtonBinding: false,
      generateZoneBinding: false,
      ...overrides.triggers,
    },
    ...overrides,
  };
}

export const publicApiConfig: ProjectConfig = {
  contentFolderPath: 'C:\\UEFN\\Phase4PublicApiFixture\\Content',
  targetVerseFileName: 'phase4_public_api_fixture.verse',
  assetFolderName: 'EntitlementIcons',
  deviceClassName: 'phase4_public_api_device',
  infoModuleName: 'Phase4PublicApiInfo',
  entitlementsModuleName: 'Phase4PublicApiEntitlements',
  pricesModuleName: 'Phase4PublicApiPrices',
  offersModuleName: 'Phase4PublicApiOffers',
  autoBackup: false,
  enableVerseWorkflowServer: true,
  generateStorefrontBinding: true,
  storefrontButtonDeviceName: 'Phase4StorefrontButtons',
  allowAutomaticZonePrompts: false,
};

export const publicApiItems: EntitlementItem[] = [
  entitlement({
    id: 'access', verseKey: 'access_pass', name: 'Access Pass', priceVBucks: 500,
    iconTexture: 'EntitlementIcons.AccessPass',
    flags: { paidArea: true, consequentialToGameplay: true },
    offerRestrictions: { minimumPurchaseAge: 13, blockedCountryCodes: ['CA'], blockedPlatformFamilies: ['Android'] },
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'AccessPassTriggers', generateButtonBinding: true, buttonDeviceName: 'AccessPassButtons', generateZoneBinding: true, mutatorZoneName: 'AccessPassZones' },
  }),
  entitlement({
    id: 'season', verseKey: 'season_pass', name: 'Season Pass', priceVBucks: 1000,
    iconTexture: 'EntitlementIcons.SeasonPass',
    triggers: { generateTriggerBinding: false, generateButtonBinding: true, buttonDeviceName: 'SeasonPassButtons' },
  }),
  entitlement({
    id: 'coins', verseKey: 'coin_pack', name: 'Coin Pack', priceVBucks: 100,
    itemType: 'consumable', maxCount: 25, iconTexture: 'EntitlementIcons.CoinPack',
    triggers: { generateTriggerBinding: true, triggerDeviceName: 'CoinPackTriggers' },
  }),
  entitlement({
    id: 'random', verseKey: 'mystery_item', name: 'Mystery Item', priceVBucks: 150,
    itemType: 'consumable', maxCount: 10, autoConsume: true, iconTexture: 'EntitlementIcons.MysteryItem',
    flags: { paidRandomItem: true, paidRandomItemOdds: 'Common: 75%, Rare: 25%', consequentialToGameplay: true },
    triggers: { generateTriggerBinding: false, generateButtonBinding: true, buttonDeviceName: 'MysteryItemButtons', generateZoneBinding: true, mutatorZoneName: 'MysteryItemZones' },
    alternateOffers: [{
      id: 'random-mobile', verseKey: 'mystery_item_mobile', name: 'Mystery Item Mobile',
      shortDescription: 'The mobile storefront variant.', description: 'The same disclosed random item for mobile.',
      priceVBucks: 150, iconTexture: 'EntitlementIcons.MysteryItem', restrictions: emptyRestrictions,
    }],
  }),
];

export const publicApiBundles: BundleOffer[] = [
  {
    id: 'starter', verseKey: 'starter_bundle', name: 'Starter Bundle', shortDescription: 'Access and coins together.',
    description: 'A static mixed bundle.', priceVBucks: 550, iconTexture: 'EntitlementIcons.StarterBundle',
    restrictions: { minimumPurchaseAge: 13, blockedCountryCodes: [], blockedPlatformFamilies: ['Windows'] },
    items: [{ entitlementId: 'access', quantity: 1 }, { entitlementId: 'coins', quantity: 5 }],
  },
  {
    id: 'nested', verseKey: 'nested_bundle', name: 'Nested Bundle', shortDescription: 'A nested bundle with a random item.',
    description: 'A static bundle that exercises nested references.', priceVBucks: 700, iconTexture: 'EntitlementIcons.NestedBundle',
    items: [{ bundleId: 'starter', quantity: 1 }, { entitlementId: 'random', quantity: 1 }],
  },
  {
    id: 'dynamic', verseKey: 'dynamic_bundle', name: 'Dynamic Bundle', shortDescription: 'A remaining-quantity bundle.',
    description: 'A dynamic bundle used to exercise its generated offer type and purchase path.', priceVBucks: 150,
    iconTexture: 'EntitlementIcons.DynamicBundle', dynamicRemaining: true,
    items: [{ entitlementId: 'random', quantity: 1 }],
  },
];

export const publicApiDisplayGroups: OfferDisplayGroup[] = [
  {
    id: 'coin-store', verseKey: 'coin_store', name: 'Coin Store', generateTriggerBinding: true,
    triggerDeviceName: 'CoinStoreTriggers', entries: [{ entitlementId: 'coins' }, { entitlementId: 'random', offerVerseKey: 'mystery_item_mobile' }],
  },
  {
    id: 'bundle-store', verseKey: 'bundle_store', name: 'Bundle Store', generateTriggerBinding: false,
    entries: [{ bundleId: 'nested' }, { bundleId: 'dynamic' }],
  },
];
