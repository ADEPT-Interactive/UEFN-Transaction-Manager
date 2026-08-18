import { EntitlementItem } from '../types/entitlement';

export interface PresetDefinition extends Partial<EntitlementItem> {
  presetTitle: string;
  presetDescription: string;
  presetExample: string;
}

// These keys identify the starter catalog shipped before presets became opt-in.
// Keep them separate from the current category names so existing untouched
// starter data can still be cleared without preserving the old examples.
export const LEGACY_STARTER_PRESET_KEYS = [
  'vip_pass',
  'strength_boost_10',
  'double_money',
  'mystery_crate',
  'bag_expansion_10',
] as const;

export const DEFAULT_PRESETS: PresetDefinition[] = [
  {
    presetTitle: 'Durable entitlement',
    presetDescription: 'Durable, limited to one per player, restored on join, with an offer Trigger array ready to assign.',
    presetExample: 'VIP Pass',
    name: 'Durable Entitlement', verseKey: 'durable_entitlement', shortDescription: 'A persistent entitlement for this island.',
    description: 'Grants a persistent entitlement defined by the game integration.', priceVBucks: 100,
    itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.DurableEntitlement',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: false },
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
  },
  {
    presetTitle: 'Consumable entitlement',
    presetDescription: 'Consumable, allows up to 10 per player, and includes an offer Trigger array. Your game decides when to consume it.',
    presetExample: 'Health Potion Pack',
    name: 'Consumable Entitlement', verseKey: 'consumable_entitlement', shortDescription: 'A repeatable entitlement for this island.',
    description: 'Provides a consumable entitlement whose use is handled by the game integration.', priceVBucks: 100,
    itemType: 'consumable', maxCount: 10, autoConsume: false, iconTexture: 'EntitlementIcons.ConsumableEntitlement',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: false },
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
  },
  {
    presetTitle: 'Time-limited entitlement',
    presetDescription: 'Durable, limited to one per player, restored on join, with a duration disclosure ready to customize.',
    presetExample: '30-Day VIP Access',
    name: 'Time-Limited Entitlement', verseKey: 'time_limited_entitlement', shortDescription: 'An entitlement available for a defined duration.',
    description: 'Grants a time-limited entitlement defined by the game integration.', priceVBucks: 100,
    itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.TimeLimitedEntitlement',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: false },
    durationDescription: 'Define the player-facing duration in the game integration.',
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
  },
  {
    presetTitle: 'Paid random item',
    presetDescription: 'Consumable, limited to one per player, with an optional UEM odds disclosure field.',
    presetExample: 'Mystery Crate',
    name: 'Paid Random Item', verseKey: 'paid_random_item', shortDescription: 'A paid entitlement with randomized outcomes.',
    description: 'Provides a paid random item with outcomes disclosed to players.', priceVBucks: 100,
    itemType: 'consumable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.PaidRandomItem',
    flags: { paidRandomItem: true, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: false },
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
  },
  {
    presetTitle: 'Access entitlement',
    presetDescription: 'Durable, limited to one per player, restored on join, with paid-area access enabled.',
    presetExample: 'VIP Area Pass',
    name: 'Access Entitlement', verseKey: 'access_entitlement', shortDescription: 'An entitlement associated with restricted access.',
    description: 'Grants access to an area or feature defined by the game integration.', priceVBucks: 100,
    itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture: 'EntitlementIcons.AccessEntitlement',
    flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: true, consequentialToGameplay: false },
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateZoneBinding: false },
  },
];
