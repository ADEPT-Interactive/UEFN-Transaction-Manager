import { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from '../types/entitlement';
import { cleanManagedData } from './projectSchema';
import { entitlementEditableNames, storefrontEditableName } from './editableBindings';
import { toVerseApiStem } from './verseIdentity';
import { bundleQuantityBehavior, dynamicPriceEnabled, isDynamicBundle } from './dynamicOffers';

export interface IntegrationContract {
  generatorVersion: string;
  managedVerseFile: string;
  generatedDeviceClass: string;
  modules: { info: string; entitlements: string; prices: string; offers: string };
  editableFields: { debugLogging: string; entitlementBindings: Array<Record<string, string>>; storefrontBindings: Array<Record<string, string>> };
  requiredImports: string[];
  runtimeConstraints: string[];
  entitlements: Array<Record<string, unknown>>;
  alternateOffers: Array<Record<string, unknown>>;
  bundles: Array<Record<string, unknown>>;
  storefronts: Array<Record<string, unknown>>;
  examples: string[];
}

function directPurchaseExample(config: ProjectConfig, key: string): string {
  return `using { /Fortnite.com/Devices }\n\nmy_game_device := class(creative_device):\n    @editable\n    Transactions : ${config.deviceClassName} = ${config.deviceClassName}{}\n\nOnOffer(Player:player):void =\n    Transactions.Open${toVerseApiStem(key)}Purchase(Player)`;
}

function entitlementContract(item: EntitlementItem, config: ProjectConfig): Record<string, unknown> {
  const stem = toVerseApiStem(item.verseKey);
  const dynamic = dynamicPriceEnabled(item.dynamicOffer);
  return {
    stableId: item.id,
    verseKey: item.verseKey,
    objectType: item.itemType,
    primaryPurchaseHelper: {
      name: `Open${stem}Purchase`,
      signature: dynamic ? `(Player:player, Options:${stem}RuntimeOptions):void` : '(Player:player):void',
    },
    ownershipHelper: `Has${stem}`,
    countHelper: `Get${stem}Count`,
    grantHelper: `Grant${stem}`,
    consumeHelper: item.itemType === 'consumable' ? `Consume${stem}` : undefined,
    reconciliationHelper: 'ReconcilePlayerEntitlements',
    awaitEvents: {
      granted: `Await${stem}GrantedEvent`,
      removed: `Await${stem}RemovedEvent`,
      reconciled: `Await${stem}ReconciledEvent`,
    },
    editableFields: {
      purchaseTriggers: item.triggers.generateTriggerBinding ? entitlementEditableNames(item.verseKey).purchaseTriggers : undefined,
      purchaseButtons: item.triggers.generateButtonBinding ? entitlementEditableNames(item.verseKey).purchaseButtons : undefined,
    },
    runtimeOptionsType: dynamic ? `${stem}RuntimeOptions` : undefined,
    dynamicOfferFactory: dynamic ? `Make${stem}DynamicOffer` : undefined,
    constraints: item.itemType === 'durable' ? ['Durable ownership is capped at one.'] : [`Consumable quantity must be positive and cannot exceed ${item.maxCount}.`],
  };
}

function alternateContract(parent: EntitlementItem, key: string): Record<string, unknown> {
  const offer = (parent.alternateOffers ?? []).find(candidate => candidate.verseKey === key);
  if (!offer) return { stableId: key, verseKey: key };
  const stem = toVerseApiStem(offer.verseKey);
  const dynamic = dynamicPriceEnabled(offer.dynamicOffer);
  return {
    stableId: offer.id,
    parentStableId: parent.id,
    verseKey: offer.verseKey,
    objectType: 'alternate_offer',
    purchaseHelper: `Open${stem}Purchase`,
    signature: dynamic ? `(Player:player, Options:${stem}RuntimeOptions):void` : '(Player:player):void',
    runtimeOptionsType: dynamic ? `${stem}RuntimeOptions` : undefined,
    dynamicOfferFactory: dynamic ? `Make${stem}DynamicOffer` : undefined,
  };
}

function bundleContract(bundle: BundleOffer): Record<string, unknown> {
  const stem = toVerseApiStem(bundle.verseKey);
  const runtime = isDynamicBundle(bundle) && (dynamicPriceEnabled(bundle.dynamicOffer) || bundle.items.some(entry => bundleQuantityBehavior(bundle, entry) === 'runtime'));
  return {
    stableId: bundle.id,
    verseKey: bundle.verseKey,
    objectType: 'bundle',
    purchaseHelper: `Open${stem}Purchase`,
    signature: runtime ? `(Player:player, Options:${stem}RuntimeOptions):void` : '(Player:player):void',
    runtimeOptionsType: runtime ? `${stem}RuntimeOptions` : undefined,
    dynamicOfferFactory: runtime ? `Make${stem}DynamicOffer` : undefined,
    items: bundle.items,
  };
}

function storefrontContract(group: { id: string; verseKey: string; name: string; entries: unknown[]; generateTriggerBinding: boolean }): Record<string, unknown> {
  const stem = toVerseApiStem(group.verseKey);
  return {
    stableId: group.id,
    verseKey: group.verseKey,
    objectType: 'storefront',
    openHelper: `Open${stem}`,
    showHelper: `Show${stem}Offers`,
    titleSymbol: `${stem}Title`,
    editableFields: group.generateTriggerBinding ? { openTriggers: storefrontEditableName(group.verseKey) } : {},
    entries: group.entries,
  };
}

export function describeIntegrationContract(
  config: ProjectConfig,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  storefrontMembership: StorefrontMembership,
  generatorVersion: string,
): IntegrationContract {
  const clean = cleanManagedData(entitlements, bundles, storefrontMembership, []);
  const currentEntitlements = clean.entitlements;
  const currentBundles = clean.bundles;
  const currentStorefronts = clean.storefrontMembership.focused;
  return {
    generatorVersion,
    managedVerseFile: config.targetVerseFileName,
    generatedDeviceClass: config.deviceClassName,
    modules: {
      info: config.infoModuleName,
      entitlements: config.entitlementsModuleName,
      prices: config.pricesModuleName,
      offers: config.offersModuleName,
    },
    editableFields: {
      debugLogging: 'EnableDebugLogging',
      entitlementBindings: currentEntitlements.map(item => ({
        stableId: item.id,
        ...(item.triggers.generateTriggerBinding ? { purchaseTriggers: entitlementEditableNames(item.verseKey).purchaseTriggers } : {}),
        ...(item.triggers.generateButtonBinding ? { purchaseButtons: entitlementEditableNames(item.verseKey).purchaseButtons } : {}),
      })),
      storefrontBindings: [
        ...(config.generateStorefrontBinding ? [{ stableId: 'all-offers', openButtons: storefrontEditableName('AllOffersStore', 'openButtons') }] : []),
        ...currentStorefronts.filter(group => group.generateTriggerBinding).map(group => ({ stableId: group.id, openTriggers: storefrontEditableName(group.verseKey) })),
      ],
    },
    requiredImports: [
      '/Fortnite.com/Devices',
      '/Fortnite.com/Marketplace',
      '/Fortnite.com/Playspaces',
      '/UnrealEngine.com/Temporary/Diagnostics',
      '/Verse.org/Assets',
      '/Verse.org/Concurrency',
      '/Verse.org/Simulation',
    ],
    runtimeConstraints: [
      'Project Verse owns gameplay and business calculations; the generated file owns transaction plumbing.',
      'Grant and Consume return Marketplace operation status, not gameplay ownership state.',
      'Use delta events or ownership/count helpers for gameplay state.',
      'Runtime price and quantity options must be calculated by external project Verse.',
      'Regeneration replaces the managed file; external Verse must remain outside the managed file.',
    ],
    entitlements: currentEntitlements.map(item => entitlementContract(item, config)),
    alternateOffers: currentEntitlements.flatMap(item => (item.alternateOffers ?? []).map(offer => alternateContract(item, offer.verseKey))),
    bundles: currentBundles.map(bundleContract),
    storefronts: currentStorefronts.map(group => storefrontContract(group)),
    examples: currentEntitlements.length ? [directPurchaseExample(config, currentEntitlements[0].verseKey)] : [],
  };
}
