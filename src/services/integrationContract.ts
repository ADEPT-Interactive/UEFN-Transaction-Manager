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

function directPurchaseExample(config: ProjectConfig, key: string, runtimeFields: string[] = []): string {
  const stem = toVerseApiStem(key);
  const runtimeValues = runtimeFields.map(field => field === 'PriceVBucks'
    ? '    RuntimePrice := CalculatePriceForPlayer(Player)'
    : `    Runtime${field} := Calculate${field}ForPlayer(Player)`);
  const options = runtimeFields.map(field => `${field} := ${field === 'PriceVBucks' ? 'RuntimePrice' : `Runtime${field}`}`).join(', ');
  const optionLines = runtimeFields.length
    ? `${runtimeValues.join('\n')}\n    Options := ${config.offersModuleName}.${stem}RuntimeOptions{${options}}\n`
    : '';
  const call = runtimeFields.length
    ? `Transactions.Open${stem}Purchase(Player, Options)`
    : `Transactions.Open${stem}Purchase(Player)`;
  return `using { /Fortnite.com/Devices }\n\nmy_game_device := class(creative_device):\n    @editable\n    Transactions : ${config.deviceClassName} = ${config.deviceClassName}{}\n\nOnOffer(Player:player):void =\n${optionLines}    ${call}`;
}

function runtimeFactoryContract(stem: string, config: ProjectConfig): Record<string, string> {
  const runtimeOptionsType = `${config.offersModuleName}.${stem}RuntimeOptions`;
  return {
    dynamicOfferFactory: `${config.offersModuleName}.Make${stem}DynamicOffer`,
    dynamicOfferFactorySignature: `(Options:${runtimeOptionsType})<transacts>:?offer`,
    dynamicOfferFactoryRole: 'Lower-level generated-offer construction API; use the guarded device purchase helper for normal purchases.',
  };
}

function entitlementContract(item: EntitlementItem, config: ProjectConfig): Record<string, unknown> {
  const stem = toVerseApiStem(item.verseKey);
  const dynamic = dynamicPriceEnabled(item.dynamicOffer);
  const runtimeOptionsType = `${config.offersModuleName}.${stem}RuntimeOptions`;
  return {
    stableId: item.id,
    verseKey: item.verseKey,
    objectType: item.itemType,
    primaryPurchaseHelper: {
      name: `Open${stem}Purchase`,
      signature: dynamic ? `(Player:player, Options:${runtimeOptionsType}):void` : '(Player:player):void',
    },
    ownershipHelper: `Has${stem}`,
    countHelper: `Get${stem}Count`,
    grantHelper: `Grant${stem}`,
    consumeHelper: item.itemType === 'consumable' ? `Consume${stem}` : undefined,
    reconciliationHelper: `Await${stem}ReconciledEvent`,
    ownershipLifecycle: item.itemType === 'durable'
      ? {
        initialState: `Await${stem}ReconciledEvent, then Has${stem} or Get${stem}Count for the project-owned mirror.`,
        liveState: `Persistent Await${stem}GrantedEvent loop updates the mirror immediately in the same session.`,
        lossState: `Await${stem}RemovedEvent updates the mirror when ownership loss is supported and semantically relevant.`,
        reconciliationIsNotSubscription: 'The reconciliation notification establishes initial truth; the persistent delta listener keeps it current.',
      }
      : undefined,
    awaitEvents: {
      granted: `Await${stem}GrantedEvent`,
      removed: `Await${stem}RemovedEvent`,
      reconciled: `Await${stem}ReconciledEvent`,
      ...(item.itemType === 'consumable' ? { consumed: `Await${stem}ConsumedEvent` } : {}),
    },
    editableFields: {
      purchaseTriggers: item.triggers.generateTriggerBinding ? entitlementEditableNames(item.verseKey).purchaseTriggers : undefined,
      purchaseButtons: item.triggers.generateButtonBinding ? entitlementEditableNames(item.verseKey).purchaseButtons : undefined,
      successTriggers: item.triggers.generateSuccessTriggerBinding ? entitlementEditableNames(item.verseKey).successTriggers : undefined,
    },
    runtimeOptionsType: dynamic ? runtimeOptionsType : undefined,
    runtimeOptionsFields: dynamic ? ['PriceVBucks'] : undefined,
    ...(dynamic ? runtimeFactoryContract(stem, config) : {}),
    constraints: item.itemType === 'durable' ? ['Durable ownership is capped at one.'] : [`Consumable quantity must be positive and cannot exceed ${item.maxCount}.`],
  };
}

function alternateContract(parent: EntitlementItem, key: string, config: ProjectConfig): Record<string, unknown> {
  const offer = (parent.alternateOffers ?? []).find(candidate => candidate.verseKey === key);
  if (!offer) return { stableId: key, verseKey: key };
  const stem = toVerseApiStem(offer.verseKey);
  const dynamic = dynamicPriceEnabled(offer.dynamicOffer);
  const runtimeOptionsType = `${config.offersModuleName}.${stem}RuntimeOptions`;
  return {
    stableId: offer.id,
    parentStableId: parent.id,
    verseKey: offer.verseKey,
    objectType: 'alternate_offer',
    purchaseHelper: `Open${stem}Purchase`,
    signature: dynamic ? `(Player:player, Options:${runtimeOptionsType}):void` : '(Player:player):void',
    runtimeOptionsType: dynamic ? runtimeOptionsType : undefined,
    runtimeOptionsFields: dynamic ? ['PriceVBucks'] : undefined,
    ...(dynamic ? runtimeFactoryContract(stem, config) : {}),
  };
}

function bundleRuntimeFields(bundle: BundleOffer, entitlements: EntitlementItem[], bundles: BundleOffer[]): string[] {
  const fields: string[] = [];
  if (dynamicPriceEnabled(bundle.dynamicOffer)) fields.push('PriceVBucks');
  for (const entry of bundle.items) {
    if (bundleQuantityBehavior(bundle, entry) !== 'runtime') continue;
    const key = entry.entitlementId
      ? entitlements.find(item => item.id === entry.entitlementId)?.verseKey ?? entry.entitlementId
      : entry.bundleId
        ? bundles.find(candidate => candidate.id === entry.bundleId)?.verseKey ?? entry.bundleId
        : 'entry';
    fields.push(`${toVerseApiStem(key)}Quantity`);
  }
  return fields;
}

function bundleContract(bundle: BundleOffer, config: ProjectConfig, entitlements: EntitlementItem[], bundles: BundleOffer[]): Record<string, unknown> {
  const stem = toVerseApiStem(bundle.verseKey);
  const runtimeFields = bundleRuntimeFields(bundle, entitlements, bundles);
  const runtime = isDynamicBundle(bundle) && runtimeFields.length > 0;
  const runtimeOptionsType = `${config.offersModuleName}.${stem}RuntimeOptions`;
  return {
    stableId: bundle.id,
    verseKey: bundle.verseKey,
    objectType: 'bundle',
    purchaseHelper: `Open${stem}Purchase`,
    signature: runtime ? `(Player:player, Options:${runtimeOptionsType}):void` : '(Player:player):void',
    runtimeOptionsType: runtime ? runtimeOptionsType : undefined,
    runtimeOptionsFields: runtime ? runtimeFields : undefined,
    ...(runtime ? runtimeFactoryContract(stem, config) : {}),
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
        ...(item.triggers.generateSuccessTriggerBinding ? { successTriggers: entitlementEditableNames(item.verseKey).successTriggers } : {}),
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
      'Use Granted/Removed or ownership/count helpers for inventory state; use the consumable Consumed event for effects that represent successful use.',
      'The Consumed event is emitted only for the matched portion of an authoritative negative entitlement delta correlated to a generated Consume helper intent; Removed is not proof of explicit consumption.',
      'Immediate-use legacy transactions must be mapped to consumable autoConsume and their gameplay consequence must wait for the Consumed event.',
      'Reconciliation establishes initial truth; generated delta events keep current truth current.',
      'For every gameplay-affecting durable with mirrored project state, initialize from reconciliation and maintain a persistent Await<Stem>GrantedEvent path for same-session acquisition; a join-only cache is incomplete.',
      'When ownership loss is supported and relevant, use the generated Await<Stem>RemovedEvent path; do not invent removal semantics.',
      'Do not treat durable Granted as a consumable use boundary or consumable Consumed as a durable ownership boundary.',
      'Runtime price and quantity options must be calculated by external project Verse.',
      'Regeneration replaces the managed file; external Verse must remain outside the managed file.',
    ],
    entitlements: currentEntitlements.map(item => entitlementContract(item, config)),
    alternateOffers: currentEntitlements.flatMap(item => (item.alternateOffers ?? []).map(offer => alternateContract(item, offer.verseKey, config))),
    bundles: currentBundles.map(bundle => bundleContract(bundle, config, currentEntitlements, currentBundles)),
    storefronts: currentStorefronts.map(group => storefrontContract(group)),
    examples: [
      ...(currentEntitlements.length ? [directPurchaseExample(config, currentEntitlements[0].verseKey)] : []),
      ...currentEntitlements.filter(item => dynamicPriceEnabled(item.dynamicOffer)).slice(0, 1)
        .map(item => directPurchaseExample(config, item.verseKey, ['PriceVBucks'])),
      ...currentEntitlements.flatMap(item => (item.alternateOffers ?? [])
        .filter(offer => dynamicPriceEnabled(offer.dynamicOffer)).slice(0, 1)
        .map(offer => directPurchaseExample(config, offer.verseKey, ['PriceVBucks']))),
      ...currentBundles.filter(bundle => bundleRuntimeFields(bundle, currentEntitlements, currentBundles).length > 0)
        .map(bundle => directPurchaseExample(config, bundle.verseKey, bundleRuntimeFields(bundle, currentEntitlements, currentBundles))),
    ],
  };
}
