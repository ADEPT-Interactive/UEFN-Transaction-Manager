import type { CatalogPatchOperation, CatalogDocument } from '../../src/services/catalogSession';
import { defaultProjectConfig } from '../../src/services/catalogSession';
import type { EntitlementItem, OfferDisplayGroup, ProjectConfig, PublicIdentityOverrides } from '../../src/types/entitlement';
import { derivePublicIdentity, type DerivedPublicIdentity } from '../../src/services/publicIdentity';
import type { MigrationParityEntry } from '../../src/services/migrationParity';

export const FLASHLIGHT_TAG_PROJECT_ROOT = 'C:/Users/brann/Documents/UEFN Projects/FlashlightTag01';

export const FLASHLIGHT_TAG_MODULE_CONFIGURATION: NonNullable<Parameters<typeof defaultProjectConfig>[1]> = {
  deviceClassName: 'managed_transactions_device',
  infoModuleName: 'ManagedEntitlementInfo',
  entitlementsModuleName: 'Entitlements',
  pricesModuleName: 'ManagedTransactionPrices',
  offersModuleName: 'ManagedOffers',
};

export const FLASHLIGHT_TAG_CONFIG: ProjectConfig = defaultProjectConfig(
  `${FLASHLIGHT_TAG_PROJECT_ROOT}/Plugins/FlashlightTag01/Content`,
  FLASHLIGHT_TAG_MODULE_CONFIGURATION,
);

const identity = (apiStem: string, metadataStem: string, entitlementStem: string, priceStem: string, offerStem: string): PublicIdentityOverrides => ({
  apiStem,
  metadataStem,
  entitlementStem,
  priceStem,
  offerStem,
});

export const FLASHLIGHT_TAG_PUBLIC_IDENTITIES: Record<string, PublicIdentityOverrides> = {
  power_pass: identity('PremiumPowerPass', 'PremiumPowerPass', 'power_pass', 'premium_power_pass', 'premium_power_pass'),
  seeker_pass: identity('SeekerPass', 'SeekerPass', 'seeker_pass', 'seeker_pass', 'seeker_pass'),
  coins_100: identity('Item100Coins', 'Item100Coins', 'coins_100', 'item_100_coins', 'item_100_coins'),
  coins_500: identity('Item500Coins', 'Item500Coins', 'coins_500', 'item_500_coins', 'item_500_coins'),
  coins_1000: identity('Item1000Coins', 'Item1000Coins', 'coins_1000', 'item_1000_coins', 'item_1000_coins'),
  coins_5000: identity('Item5000Coins', 'Item5000Coins', 'coins_5000', 'item_5000_coins', 'item_5000_coins'),
  coins_10000: identity('Item10000Coins', 'Item10000Coins', 'coins_10000', 'item_10000_coins', 'item_10000_coins'),
  'ent-c64e6ca8-c1d8-4fe4-bfc4-923e81e1aad7': identity('DurableEntitlement', 'DurableEntitlement', 'durable_entitlement', 'durable_entitlement', 'durable_entitlement'),
  coin_shop: { apiStem: 'CoinShop' },
  not_enough_currency: { apiStem: 'NotEnoughCurrency' },
};

function baseItem(
  id: string,
  verseKey: string,
  name: string,
  shortDescription: string,
  description: string,
  priceVBucks: number,
  itemType: 'durable' | 'consumable',
  autoConsume: boolean,
  iconTexture: string,
  flags: EntitlementItem['flags'],
  durationDescription?: string,
): EntitlementItem {
  return {
    id,
    verseKey,
    name,
    shortDescription,
    description,
    priceVBucks,
    itemType,
    maxCount: 1,
    autoConsume,
    iconTexture,
    flags,
    ...(durationDescription ? { durationDescription } : {}),
    ...(id === 'seeker_pass' || id === 'ent-c64e6ca8-c1d8-4fe4-bfc4-923e81e1aad7' ? { alternateOffers: [] } : {}),
    triggers: {
      generateTriggerBinding: id === 'seeker_pass' || id === 'ent-c64e6ca8-c1d8-4fe4-bfc4-923e81e1aad7',
      generateButtonBinding: false,
      generateSuccessTriggerBinding: id === 'seeker_pass' || id === 'ent-c64e6ca8-c1d8-4fe4-bfc4-923e81e1aad7',
    },
  };
}

const ordinaryDurableFlags: EntitlementItem['flags'] = {
  paidRandomItem: false,
  paidRandomItemOdds: '',
  paidArea: false,
  consequentialToGameplay: true,
};

const seekerFlags: EntitlementItem['flags'] = { ...ordinaryDurableFlags, paidRandomItem: true };

export const FLASHLIGHT_TAG_ENTITLEMENTS: EntitlementItem[] = [
  baseItem('power_pass', 'premium_power_pass', '⭐ Premium Power Pass', '🔥 Unlocks Unlimited Use of All Powers', '🔥 Permanent Unlimited Access to All Powers\n💯 Access to all Current and Future Hider/Seeker Powers\n⭐ Equip Powers for Zero Gold', 300, 'durable', false, 'EntitlementIcons.premium_power_pass_Icon', ordinaryDurableFlags, 'Permanent; no expiration.'),
  baseItem('seeker_pass', 'seeker_pass', '🔦 Seeker Pass', '🔥 Lets you Double your Chances of Becoming Seeker', '🔥 Lets you Double your Chances of Becoming Seeker', 200, 'durable', false, 'EntitlementIcons.seeker_pass_Icon', seekerFlags),
  baseItem('coins_100', 'item_100_coins', '💰 100 Coins', '💰 100 Coins', '💰 100 Coins', 50, 'consumable', true, 'EntitlementIcons.item_100_coins_Icon', ordinaryDurableFlags),
  baseItem('coins_500', 'item_500_coins', '💰 500 Coins', '💰 500 Coins', '💰 500 Coins', 150, 'consumable', true, 'EntitlementIcons.item_500_coins_Icon', ordinaryDurableFlags),
  baseItem('coins_1000', 'item_1000_coins', '💰 1000 Coins', '💰 1000 Coins', '💰 1000 Coins', 250, 'consumable', true, 'EntitlementIcons.item_1000_coins_Icon', ordinaryDurableFlags),
  baseItem('coins_5000', 'item_5000_coins', '🤑 5000 Coins', '🤑 5000 Coins', '🤑 5000 Coins', 1000, 'consumable', true, 'EntitlementIcons.item_5000_coins_Icon', ordinaryDurableFlags),
  baseItem('coins_10000', 'item_10000_coins', '🤑 10000 Coins', '🤑 10000 Coins', '🤑 10000 Coins', 1500, 'consumable', true, 'EntitlementIcons.item_10000_coins_Icon', ordinaryDurableFlags),
  baseItem('ent-c64e6ca8-c1d8-4fe4-bfc4-923e81e1aad7', 'durable_entitlement', 'Durable Entitlement', 'A persistent entitlement for this island.', 'Grants a persistent entitlement defined by the game integration.', 100, 'durable', false, 'EntitlementIcons.UTM_PlaceholderIcon', ordinaryDurableFlags),
];

export const FLASHLIGHT_TAG_STOREFRONTS: OfferDisplayGroup[] = [
  {
    id: 'coin_shop',
    verseKey: 'coin_shop',
    name: 'Coin Shop',
    entries: [
      { entitlementId: 'coins_100' },
      { entitlementId: 'coins_500' },
      { entitlementId: 'coins_1000' },
      { entitlementId: 'coins_5000' },
      { entitlementId: 'coins_10000' },
    ],
    generateTriggerBinding: false,
  },
  {
    id: 'not_enough_currency',
    verseKey: 'not_enough_currency',
    name: 'Not Enough Currency',
    entries: [
      { entitlementId: 'coins_100' },
      { entitlementId: 'coins_500' },
      { entitlementId: 'coins_1000' },
      { entitlementId: 'coins_5000' },
      { entitlementId: 'coins_10000' },
      { entitlementId: 'power_pass' },
    ],
    generateTriggerBinding: false,
  },
];

export function flashlightTagCatalog(): CatalogDocument {
  return JSON.parse(JSON.stringify({
    config: defaultProjectConfig(FLASHLIGHT_TAG_CONFIG.contentFolderPath),
    entitlements: FLASHLIGHT_TAG_ENTITLEMENTS,
    bundles: [],
    storefrontMembership: { allOffers: FLASHLIGHT_TAG_ENTITLEMENTS.map(item => ({ entitlementId: item.id })), focused: FLASHLIGHT_TAG_STOREFRONTS },
    retiredVerseKeys: [],
    projectDataDiagnostics: [],
  })) as CatalogDocument;
}

function parityIdentity(record: { id: string; verseKey: string; publicIdentity?: PublicIdentityOverrides }, kind: 'entitlement' | 'storefront'): DerivedPublicIdentity {
  return derivePublicIdentity(record, FLASHLIGHT_TAG_CONFIG, kind);
}

function runtimePropagation(item: EntitlementItem): MigrationParityEntry['runtimePropagation'] {
  if (item.itemType === 'consumable') {
    const stem = FLASHLIGHT_TAG_PUBLIC_IDENTITIES[item.id]?.apiStem ?? item.verseKey;
    return {
      legacy: { initialState: { source: `ReconcilePlayerEntitlements`, mode: 'reconciliation' }, liveChange: { source: `Await${stem}ConsumedEvent`, mode: 'persistent-consumed-event' }, externalState: { description: 'Currency balance is updated after successful consumed event.', mode: 'event-driven' } },
      proposed: { initialState: { source: 'ReconcilePlayerEntitlements', mode: 'reconciliation' }, liveChange: { source: `Await${stem}ConsumedEvent`, mode: 'persistent-consumed-event' }, externalState: { description: 'Currency balance is updated after successful consumed event.', mode: 'event-driven' } },
    };
  }
  const stem = FLASHLIGHT_TAG_PUBLIC_IDENTITIES[item.id]?.apiStem ?? item.verseKey;
  return {
    legacy: { initialState: { source: 'ReconcilePlayerEntitlements', mode: 'reconciliation' }, liveChange: { source: `Await${stem}GrantedEvent and Await${stem}RemovedEvent`, mode: 'persistent-granted-and-removed-events' }, externalState: { description: 'Gameplay ownership mirror is updated from authoritative entitlement events.', mode: 'mirrored' } },
    proposed: { initialState: { source: 'ReconcilePlayerEntitlements', mode: 'reconciliation' }, liveChange: { source: `Await${stem}GrantedEvent and Await${stem}RemovedEvent`, mode: 'persistent-granted-and-removed-events' }, externalState: { description: 'Gameplay ownership mirror is updated from authoritative entitlement events.', mode: 'mirrored' } },
  };
}

function parityEntryForItem(item: EntitlementItem): MigrationParityEntry {
  const publicIdentity = parityIdentity({ ...item, verseKey: item.id === 'power_pass' ? 'power_pass' : item.id === 'coins_100' ? 'coins_100' : item.id === 'coins_500' ? 'coins_500' : item.id === 'coins_1000' ? 'coins_1000' : item.id === 'coins_5000' ? 'coins_5000' : item.id === 'coins_10000' ? 'coins_10000' : item.id === 'seeker_pass' ? 'seeker_pass' : 'durable_entitlement', publicIdentity: FLASHLIGHT_TAG_PUBLIC_IDENTITIES[item.id] }, 'entitlement');
  const identityPair = { legacy: publicIdentity, proposed: publicIdentity };
  return {
    legacySourceIdentity: `FlashlightTag01.${item.id}`,
    proposedId: item.id,
    kind: 'entitlement',
    status: 'confirmed',
    name: { legacy: item.name, proposed: item.name },
    description: { legacy: item.description, proposed: item.description },
    shortDescription: { legacy: item.shortDescription, proposed: item.shortDescription },
    itemType: { legacy: item.itemType, proposed: item.itemType },
    maxCount: { legacy: item.maxCount, proposed: item.maxCount },
    immediateConsume: { legacy: item.itemType === 'consumable', proposed: item.itemType === 'consumable' },
    autoConsume: { legacy: item.autoConsume, proposed: item.autoConsume },
    priceVBucks: { legacy: item.priceVBucks, proposed: item.priceVBucks },
    restrictions: { legacy: null, proposed: null },
    iconSource: { legacy: item.iconTexture, proposed: item.iconTexture },
    gameplayConsequence: { legacy: item.itemType === 'consumable' ? 'Add currency after successful consumed event.' : 'Maintain gameplay ownership mirror from authoritative entitlement events.', proposed: item.itemType === 'consumable' ? 'Add currency after successful consumed event.' : 'Maintain gameplay ownership mirror from authoritative entitlement events.' },
    consequenceBoundary: { legacy: item.itemType === 'consumable' ? 'successful-consumption' : 'grant', proposed: item.itemType === 'consumable' ? 'successful-consumption' : 'grant' },
    repeatedPurchaseBehavior: { legacy: item.itemType === 'consumable' ? 'Repeatable inventory grant with auto-consume.' : 'Durable ownership is capped at one.', proposed: item.itemType === 'consumable' ? 'Repeatable inventory grant with auto-consume.' : 'Durable ownership is capped at one.' },
    relationships: { legacy: 'No bundle or alternate relationship.', proposed: 'No bundle or alternate relationship.' },
    publicIdentity: identityPair,
    runtimePropagation: runtimePropagation(item),
  };
}

function storefrontParity(group: OfferDisplayGroup): MigrationParityEntry {
  const publicIdentity = parityIdentity({ ...group, publicIdentity: FLASHLIGHT_TAG_PUBLIC_IDENTITIES[group.id] }, 'storefront');
  return {
    legacySourceIdentity: `FlashlightTag01.${group.id}`,
    proposedId: group.id,
    kind: 'storefront',
    status: 'confirmed',
    name: { legacy: group.name, proposed: group.name },
    description: { legacy: group.name, proposed: group.name },
    shortDescription: { legacy: group.name, proposed: group.name },
    itemType: { legacy: 'durable', proposed: 'durable' },
    maxCount: { legacy: 1, proposed: 1 },
    immediateConsume: { legacy: false, proposed: false },
    autoConsume: { legacy: false, proposed: false },
    priceVBucks: { legacy: 0, proposed: 0 },
    restrictions: { legacy: null, proposed: null },
    iconSource: { legacy: 'none', proposed: 'none' },
    gameplayConsequence: { legacy: 'Storefront composition only.', proposed: 'Storefront composition only.' },
    consequenceBoundary: { legacy: 'other', proposed: 'other' },
    repeatedPurchaseBehavior: { legacy: 'Not applicable.', proposed: 'Not applicable.' },
    relationships: { legacy: 'References the exact configured offers in order.', proposed: 'References the exact configured offers in order.' },
    publicIdentity: { legacy: publicIdentity, proposed: publicIdentity },
    runtimePropagation: { legacy: { initialState: { source: 'none', mode: 'none' }, liveChange: { source: 'none', mode: 'none' }, externalState: { description: 'No external gameplay state.', mode: 'none' } }, proposed: { initialState: { source: 'none', mode: 'none' }, liveChange: { source: 'none', mode: 'none' }, externalState: { description: 'No external gameplay state.', mode: 'none' } } },
  };
}

export const FLASHLIGHT_TAG_PARITY: MigrationParityEntry[] = [
  ...FLASHLIGHT_TAG_ENTITLEMENTS.map(parityEntryForItem),
  ...FLASHLIGHT_TAG_STOREFRONTS.map(storefrontParity),
];

export const FLASHLIGHT_TAG_IDENTITY_OPERATIONS: CatalogPatchOperation[] = [
  ...FLASHLIGHT_TAG_ENTITLEMENTS.map(item => ({ type: 'adopt_existing_identity', kind: 'entitlement', targetId: item.id, verseKey: item.id === 'power_pass' ? 'power_pass' : item.id === 'coins_100' ? 'coins_100' : item.id === 'coins_500' ? 'coins_500' : item.id === 'coins_1000' ? 'coins_1000' : item.id === 'coins_5000' ? 'coins_5000' : item.id === 'coins_10000' ? 'coins_10000' : item.id === 'seeker_pass' ? 'seeker_pass' : 'durable_entitlement', publicIdentity: FLASHLIGHT_TAG_PUBLIC_IDENTITIES[item.id] })),
  ...FLASHLIGHT_TAG_STOREFRONTS.map(group => ({ type: 'adopt_existing_identity', kind: 'storefront', targetId: group.id, verseKey: group.verseKey, publicIdentity: FLASHLIGHT_TAG_PUBLIC_IDENTITIES[group.id] })),
];
