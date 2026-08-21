import { AlternateOffer, BundleOffer, BundleOfferItem, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup, OfferRestrictions, ProjectConfig, StorefrontMembership } from '../types/entitlement';
import { cleanManagedData, normalizeBundle, normalizeEntitlement, normalizeOfferDisplayGroup, normalizeStorefrontMembership } from './projectSchema';
import { MANIFEST_BEGIN, MANIFEST_END } from './verseParser';
import { toVerseApiStem } from './verseIdentity';
import { generatedOfferDescription, MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { legacyStorefrontMembership, resolveStorefrontEntry } from './storefrontMembership';
import {
  EDITABLE_CATEGORY_LABELS,
  EDITABLE_METADATA_SYMBOLS,
  editableMetadataSymbol,
  entitlementEditableNames,
  storefrontEditableName,
} from './editableBindings';

const DEBUG_EDITABLE_KEY = 'EnableDebugLogging';

const UEM_LOG_CHANNEL = 'UEMLogChannel';

function escapeVerseString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function canonicalizeManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeManifestValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalizeManifestValue(entry)]));
  }
  return value;
}

function manifestLines(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  storefrontMembership: StorefrontMembership,
  retiredVerseKeys: string[],
): string {
  const encoded = encodeBase64Utf8(JSON.stringify(canonicalizeManifestValue(cleanManagedData(entitlements, bundles, storefrontMembership, retiredVerseKeys))));
  const chunks = encoded.match(/.{1,100}/g) ?? [];
  return `${MANIFEST_BEGIN}\n${chunks.map(chunk => `# UEM_DATA ${chunk}`).join('\n')}\n${MANIFEST_END}\n\n`;
}

function displayedDescription(description: string, durationDescription = '', odds = ''): string {
  return generatedOfferDescription(description, durationDescription, odds);
}

type EditableDescriptor = {
  key: string;
  displayName: string;
  propertyName: string;
  type: string;
  role: 'purchaseTriggers' | 'purchaseButtons' | 'openTriggers' | 'openButtons';
  tooltip: string;
  rootCategory: 'entitlements' | 'storefronts';
};

function editableCategorySymbol(key: string): string {
  return editableMetadataSymbol(key, 'Category');
}

function editableDescriptors(
  entitlements: EntitlementItem[],
  config: ProjectConfig,
  offerDisplayGroups: OfferDisplayGroup[],
): EditableDescriptor[] {
  const descriptors: EditableDescriptor[] = [];
  for (const item of entitlements) {
    const names = entitlementEditableNames(item.verseKey);
    if (item.triggers.generateTriggerBinding) descriptors.push({
      key: item.verseKey,
      displayName: item.name || item.verseKey,
      propertyName: names.purchaseTriggers,
      type: '[]trigger_device',
      role: 'purchaseTriggers',
      tooltip: `Activating an assigned Trigger device opens Epic's purchase interface for ${item.name || item.verseKey}. Use it only with a deliberate player purchase interaction.`,
      rootCategory: 'entitlements',
    });
    if (item.triggers.generateButtonBinding) descriptors.push({
      key: item.verseKey,
      displayName: item.name || item.verseKey,
      propertyName: names.purchaseButtons,
      type: '[]button_device',
      role: 'purchaseButtons',
      tooltip: `Interacting with an assigned Button device opens Epic's purchase interface for ${item.name || item.verseKey}.`,
      rootCategory: 'entitlements',
    });
  }
  if (config.generateStorefrontBinding) descriptors.push({
    key: 'AllOffersStore',
    displayName: 'All Offers',
    propertyName: storefrontEditableName('AllOffersStore', 'openButtons'),
    type: '[]button_device',
    role: 'openButtons',
    tooltip: 'Interacting with an assigned Button device opens the all-offers storefront.',
    rootCategory: 'storefronts',
  });
  for (const group of offerDisplayGroups) {
    if (group.generateTriggerBinding) descriptors.push({
      key: group.verseKey,
      displayName: group.name || group.verseKey,
      propertyName: storefrontEditableName(group.verseKey),
      type: '[]trigger_device',
      role: 'openTriggers',
      tooltip: `Activating an assigned Trigger device opens the ${group.name || group.verseKey} storefront. Use it with a deliberate player interaction.`,
      rootCategory: 'storefronts',
    });
  }
  return descriptors;
}

function editableMetadataLines(descriptors: EditableDescriptor[]): string[] {
  const messages = new Map<string, string>();
  const add = (symbol: string, value: string) => { if (!messages.has(symbol)) messages.set(symbol, value); };
  add(EDITABLE_METADATA_SYMBOLS.debugCategory, EDITABLE_CATEGORY_LABELS.debug);
  add(editableMetadataSymbol(DEBUG_EDITABLE_KEY, 'ToolTip'), 'Enable additional UEM runtime diagnostics in the Verse log.');
  const roleSymbols: Record<EditableDescriptor['role'], string> = {
    purchaseTriggers: EDITABLE_METADATA_SYMBOLS.purchaseTriggersCategory,
    purchaseButtons: EDITABLE_METADATA_SYMBOLS.purchaseButtonsCategory,
    openTriggers: EDITABLE_METADATA_SYMBOLS.openTriggersCategory,
    openButtons: EDITABLE_METADATA_SYMBOLS.openButtonsCategory,
  };
  const roleLabels: Record<EditableDescriptor['role'], string> = {
    purchaseTriggers: EDITABLE_CATEGORY_LABELS.purchaseTriggers,
    purchaseButtons: EDITABLE_CATEGORY_LABELS.purchaseButtons,
    openTriggers: EDITABLE_CATEGORY_LABELS.openTriggers,
    openButtons: EDITABLE_CATEGORY_LABELS.openButtons,
  };
  const rootSymbols = {
    entitlements: EDITABLE_METADATA_SYMBOLS.entitlementsCategory,
    storefronts: EDITABLE_METADATA_SYMBOLS.storefrontsCategory,
  } as const;
  const rootLabels = {
    entitlements: EDITABLE_CATEGORY_LABELS.entitlements,
    storefronts: EDITABLE_CATEGORY_LABELS.storefronts,
  } as const;
  for (const descriptor of descriptors) {
    add(rootSymbols[descriptor.rootCategory], rootLabels[descriptor.rootCategory]);
    add(editableCategorySymbol(descriptor.key), descriptor.displayName);
    add(roleSymbols[descriptor.role], roleLabels[descriptor.role]);
    add(editableMetadataSymbol(descriptor.key, `${descriptor.role}ToolTip`), descriptor.tooltip);
  }
  return [
    '# Generated editable metadata for the UEFN Details panel.',
    ...Array.from(messages.entries(), ([symbol, value]) => `${symbol}<localizes>:message = "${escapeVerseString(value)}"`),
    '',
  ];
}

function editableAttributeLines(descriptor: EditableDescriptor): string[] {
  const roleCategories: Record<EditableDescriptor['role'], string> = {
    purchaseTriggers: EDITABLE_METADATA_SYMBOLS.purchaseTriggersCategory,
    purchaseButtons: EDITABLE_METADATA_SYMBOLS.purchaseButtonsCategory,
    openTriggers: EDITABLE_METADATA_SYMBOLS.openTriggersCategory,
    openButtons: EDITABLE_METADATA_SYMBOLS.openButtonsCategory,
  };
  return [
    '    @editable:',
    `        ToolTip := ${editableMetadataSymbol(descriptor.key, `${descriptor.role}ToolTip`)}`,
    `        Categories := array{${descriptor.rootCategory === 'entitlements' ? EDITABLE_METADATA_SYMBOLS.entitlementsCategory : EDITABLE_METADATA_SYMBOLS.storefrontsCategory}, ${editableCategorySymbol(descriptor.key)}, ${roleCategories[descriptor.role]}}`,
    `    ${descriptor.propertyName} : ${descriptor.type} = array{}`,
  ];
}

function metadataModule(key: string, name: string, description: string, shortDescription: string, durationDescription = '', odds = ''): string {
  const moduleName = toVerseApiStem(key);
  return [
    `    ${moduleName}<public> := module:`,
    `        Name<public><localizes>:message = "${escapeVerseString(name)}"`,
    `        Description<public><localizes>:message = "${escapeVerseString(displayedDescription(description, durationDescription, odds))}"`,
    `        ShortDescription<public><localizes>:message = "${escapeVerseString(shortDescription)}"`,
    '',
  ].join('\n');
}

function debugEditableLines(): string[] {
  return [
    '    # Runtime Diagnostics',
    '    @editable:',
    `        ToolTip := ${editableMetadataSymbol(DEBUG_EDITABLE_KEY, 'ToolTip')}`,
    `        Categories := array{${EDITABLE_METADATA_SYMBOLS.debugCategory}}`,
    `    ${DEBUG_EDITABLE_KEY}:logic = false`,
  ];
}

function restrictionLines(restrictions: OfferRestrictions | undefined): string {
  const blockedCountryCodes = [...new Set(restrictions?.blockedCountryCodes ?? [])];
  const blockedPlatformFamilies = [...new Set(restrictions?.blockedPlatformFamilies ?? [])];
  const hasConfiguredRestrictions = Boolean(
    restrictions && (
      restrictions.minimumPurchaseAge !== undefined
      || blockedCountryCodes.length > 0
      || blockedPlatformFamilies.length > 0
    ),
  );
  if (!hasConfiguredRestrictions) return '';

  const lines: string[] = [];
  for (const country of blockedCountryCodes) lines.push(`            CountryCode <> "${escapeVerseString(country)}"`);
  for (const platform of blockedPlatformFamilies) lines.push(`            PlatformFamily <> "${escapeVerseString(platform)}"`);
  lines.push(`            return ${restrictions?.minimumPurchaseAge ?? 0}`);
  return [
    '        GetMinPurchaseAge<override>(CountryCode:string, SubdivisionCode:string, PlatformFamily:string)<decides><computes>:int =',
    ...lines,
    '',
  ].join('\n');
}

function oddsForItem(item: EntitlementItem): string {
  return item.flags.paidRandomItem ? item.flags.paidRandomItemOdds.trim() : '';
}

function offerClass(
  key: string,
  metadataKey: string,
  entitlementKey: string,
  priceModule: string,
  priceKey: string,
  iconTexture: string,
  restrictions: OfferRestrictions | undefined,
): string {
  const restriction = restrictionLines(restrictions);
  return [
    `    ${key}_offer<public> := class(entitlement_offer):`,
    `        var Name<override>:message = ${metadataKey}.Name`,
    `        var Description<override>:message = ${metadataKey}.Description`,
    `        var ShortDescription<override>:message = ${metadataKey}.ShortDescription`,
    `        var Icon<override>:texture = ${iconTexture}`,
    `        EntitlementType<override>:concrete_subtype(entitlement) = ${entitlementKey}_entitlement`,
    `        Price<override>:price_dimension = MakePriceVBucks(${priceModule}.${priceKey})`,
    restriction,
    '',
  ].filter(Boolean).join('\n');
}

type GeneratedBundleOffer = {
  key: string;
  metadataKey: string;
  iconTexture: string;
  priceReference: string;
  restrictions?: OfferRestrictions;
};

function generatedBundleOffer(
  bundle: BundleOffer,
  infoModule: string,
  priceModule: string,
): GeneratedBundleOffer {
  return {
    key: bundle.verseKey,
    metadataKey: `${infoModule}.${toVerseApiStem(bundle.verseKey)}`,
    iconTexture: bundle.iconTexture,
    priceReference: `${priceModule}.${bundle.verseKey}_price`,
    restrictions: bundle.restrictions,
  };
}

function bundleOfferClass(
  source: GeneratedBundleOffer,
  contents: string,
  suffix = '',
): string {
  const classKey = `${source.key}${suffix}`;
  return [
    `    ${classKey}_offer<public> := class(bundle_offer):`,
    `        var Name<override>:message = ${source.metadataKey}.Name`,
    `        var Description<override>:message = ${source.metadataKey}.Description`,
    `        var ShortDescription<override>:message = ${source.metadataKey}.ShortDescription`,
    `        var Icon<override>:texture = ${source.iconTexture}`,
    `        Offers<override>:[]tuple(offer, int) = ${contents}`,
    `        Price<override>:price_dimension = MakePriceVBucks(${source.priceReference})`,
    restrictionLines(source.restrictions),
    '',
  ].filter(Boolean).join('\n');
}

function dynamicRemainingEntry(bundle: BundleOffer): BundleOfferItem | undefined {
  if (!bundle.dynamicRemaining || bundle.items.length !== 1) return undefined;
  const entry = bundle.items[0];
  if (!entry?.entitlementId || entry.bundleId || entry.quantity !== 1) return undefined;
  return entry;
}

function assertRenderableConfiguration(entitlements: EntitlementItem[], bundles: BundleOffer[]): void {
  for (const item of entitlements) {
    if (item.itemType !== 'durable' && item.itemType !== 'consumable') {
      throw new Error(`Cannot generate Verse: ${item.name || item.verseKey} has an unsupported entitlement type. Fix it in Validation.`);
    }
    if (!Number.isInteger(item.priceVBucks)
      || item.priceVBucks < MARKETPLACE_CONSTRAINTS.priceMinVBucks
      || item.priceVBucks > MARKETPLACE_CONSTRAINTS.priceMaxVBucks
      || item.priceVBucks % MARKETPLACE_CONSTRAINTS.priceStepVBucks !== 0) {
      throw new Error(`Cannot generate Verse: ${item.name || item.verseKey} has an invalid V-Bucks price. Fix it in Validation.`);
    }
    if (item.itemType === 'durable' && (item.maxCount !== 1 || item.autoConsume)) {
      throw new Error(`Cannot generate Verse: ${item.name || item.verseKey} has an invalid durable MaxCount or auto-consume setting. Fix it in Validation.`);
    }
    if (item.itemType === 'consumable' && (!Number.isSafeInteger(item.maxCount) || item.maxCount < MARKETPLACE_CONSTRAINTS.maxCountMin || item.maxCount > MARKETPLACE_CONSTRAINTS.maxCount)) {
      throw new Error(`Cannot generate Verse: ${item.name || item.verseKey} has an invalid consumable MaxCount. Fix it in Validation.`);
    }
  }
  const entitlementById = new Set(entitlements.map(item => item.id));
  const bundleById = new Map(bundles.map(bundle => [bundle.id, bundle]));
  if (entitlementById.size !== entitlements.length || bundleById.size !== bundles.length) {
    throw new Error('Cannot generate Verse: project records contain duplicate stable identifiers. Fix the duplicate records in Validation.');
  }
  for (const bundle of bundles) {
    if (bundle.dynamicRemaining && !dynamicRemainingEntry(bundle)) continue;
    for (const [index, entry] of bundle.items.entries()) {
      const hasEntitlement = Boolean(entry.entitlementId && entitlementById.has(entry.entitlementId));
      const nestedBundle = entry.bundleId ? bundleById.get(entry.bundleId) : undefined;
      if (hasEntitlement === Boolean(nestedBundle) || (!hasEntitlement && !nestedBundle)) {
        throw new Error(`Cannot generate Verse: ${bundle.name || bundle.verseKey} has an unresolved bundle reference at entry ${index + 1}. Fix the bundle contents in Validation.`);
      }
      if (nestedBundle?.dynamicRemaining && !dynamicRemainingEntry(nestedBundle)) {
        throw new Error(`Cannot generate Verse: ${bundle.name || bundle.verseKey} references the invalid dynamic bundle ${nestedBundle.name || nestedBundle.verseKey}. Fix the dynamic bundle in Validation.`);
      }
      if (entry.offerVerseKey && hasEntitlement) {
        const item = entitlements.find(candidate => candidate.id === entry.entitlementId);
        const reference = entry.offerVerseKey.toLowerCase();
        const validVariant = item?.verseKey.toLowerCase() === reference
          || item?.alternateOffers?.some(offer => offer.verseKey.toLowerCase() === reference || offer.id.toLowerCase() === reference);
        if (!validVariant) throw new Error(`Cannot generate Verse: ${bundle.name || bundle.verseKey} references a missing offer variant at entry ${index + 1}. Fix the bundle contents in Validation.`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (bundle: BundleOffer): void => {
    if (visiting.has(bundle.id)) throw new Error(`Cannot generate Verse: nested bundle cycle includes ${bundle.name || bundle.verseKey}. Fix the bundle cycle in Validation.`);
    if (visited.has(bundle.id)) return;
    visiting.add(bundle.id);
    for (const entry of bundle.items) {
      const nested = entry.bundleId ? bundleById.get(entry.bundleId) : undefined;
      if (nested) visit(nested);
    }
    visiting.delete(bundle.id);
    visited.add(bundle.id);
  };
  bundles.forEach(visit);
}

function resolveBundleEntry(entry: BundleOfferItem, entitlements: EntitlementItem[], bundles: BundleOffer[]): string {
  if (entry.bundleId) {
    const nested = bundles.find(bundle => bundle.id === entry.bundleId);
    return `${nested?.verseKey ?? 'invalid'}_offer{}`;
  }
  const item = entitlements.find(candidate => candidate.id === entry.entitlementId);
  const reference = entry.offerVerseKey?.toLowerCase();
  const alternate = reference ? item?.alternateOffers?.find(offer => offer.verseKey.toLowerCase() === reference || offer.id.toLowerCase() === reference) : undefined;
  const primary = reference && item?.verseKey.toLowerCase() === reference ? item.verseKey : undefined;
  const offerKey = alternate?.verseKey || primary || (entry.offerVerseKey ? entry.offerVerseKey : item?.verseKey) || 'invalid';
  return `${offerKey}_offer{}`;
}

function storefrontReferences(entries: OfferDisplayEntry[], entitlements: EntitlementItem[], bundles: BundleOffer[], offersModule: string): string[] {
  const references: string[] = [];
  for (const entry of entries) {
    const resolved = resolveStorefrontEntry(entry, entitlements, bundles);
    if (!resolved || (resolved.kind === 'bundle' && resolved.bundle.dynamicRemaining)) continue;
    references.push(`${offersModule}.${resolved.offerVerseKey}_offer{}`);
  }
  return references;
}

function paidRandomDisclosuresForBundle(bundle: BundleOffer, entitlements: EntitlementItem[], bundles: BundleOffer[], visited = new Set<string>()): string[] {
  if (visited.has(bundle.id)) return [];
  const next = new Set(visited).add(bundle.id);
  const disclosures: string[] = [];
  for (const entry of bundle.items) {
    const item = entry.entitlementId ? entitlements.find(candidate => candidate.id === entry.entitlementId) : undefined;
    const odds = item?.flags.paidRandomItem ? item.flags.paidRandomItemOdds.trim() : '';
    if (item?.flags.paidRandomItem && odds) disclosures.push(`${item.name}: ${odds}`);
    const nested = entry.bundleId ? bundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if (nested) disclosures.push(...paidRandomDisclosuresForBundle(nested, entitlements, bundles, next));
  }
  return [...new Set(disclosures)];
}

/**
 * Direct Marketplace offers carry paid-random classification on their
 * entitlement metadata, and Epic applies the relevant Purchase API rules.
 * UEM does not generate creator-authored random redemption/use logic, so a
 * paid-random check belongs at that future redemption boundary, not here.
 */
export function generateVerseCode(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[] = [],
  config: ProjectConfig,
  storefrontInput: StorefrontMembership | OfferDisplayGroup[] = [],
  retiredVerseKeys: string[] = [],
): string {
  // Keep direct generation and parse -> regenerate output identical even when
  // callers provide older or partially populated managed-data shapes.
  entitlements = entitlements.map(normalizeEntitlement);
  bundles = bundles.map(normalizeBundle);
  const storefrontMembership = Array.isArray(storefrontInput)
    ? legacyStorefrontMembership(entitlements, bundles, storefrontInput.map(normalizeOfferDisplayGroup))
    : normalizeStorefrontMembership(storefrontInput, entitlements, bundles).membership;
  assertRenderableConfiguration(entitlements, bundles);
  const offerDisplayGroups = storefrontMembership.focused;
  const infoModule = config.infoModuleName;
  const entModule = config.entitlementsModuleName;
  const priceModule = config.pricesModuleName;
  const offersModule = config.offersModuleName;
  const deviceClass = config.deviceClassName;
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(
    `# ${config.targetVerseFileName}`,
    '# Generated and managed by ADEPT Interactive UEFN Entitlement Manager. Do not edit manually.',
    '# Configure through UEM and integrate from your own Verse using the generated public API; regeneration may replace this file.',
    '',
    manifestLines(entitlements, bundles, storefrontMembership, retiredVerseKeys),
    'using { /Fortnite.com/Devices }',
    'using { /Fortnite.com/Marketplace }',
    'using { /Fortnite.com/Playspaces }',
    'using { /UnrealEngine.com/Temporary/Diagnostics }',
    'using { /Verse.org/Assets }',
    'using { /Verse.org/Concurrency }',
    'using { /Verse.org/Simulation }',
    '',
    `${UEM_LOG_CHANNEL} := class(log_channel){}`,
    '',
    `${config.assetFolderName}<public> := module {}`,
    '',
    `${infoModule}<public> := module:`,
  );

  for (const item of entitlements) {
    push(metadataModule(item.verseKey, item.name, item.description, item.shortDescription, item.durationDescription ?? '', oddsForItem(item)));
    for (const alternate of item.alternateOffers ?? []) {
      push(metadataModule(alternate.verseKey, alternate.name, alternate.description, alternate.shortDescription, alternate.durationDescription ?? '', oddsForItem(item)));
    }
  }
  for (const bundle of bundles) {
    const bundleOdds = paidRandomDisclosuresForBundle(bundle, entitlements, bundles).join('; ');
    push(metadataModule(bundle.verseKey, bundle.name, bundle.description, bundle.shortDescription, bundle.durationDescription ?? '', bundleOdds));
  }

  push(`${entModule}<public> := module:`, `    using { ${infoModule} }`, '', '    basic_entitlement<public> := class<abstract><castable>(entitlement){}', '');
  for (const item of entitlements) {
    const metadataKey = toVerseApiStem(item.verseKey);
    push(
      `    ${item.verseKey}_entitlement<public> := class<concrete>(basic_entitlement):`,
      `        var Name<override>:message = ${metadataKey}.Name`,
      `        var Description<override>:message = ${metadataKey}.Description`,
      `        var ShortDescription<override>:message = ${metadataKey}.ShortDescription`,
      `        var Icon<override>:texture = ${item.iconTexture}`,
      `        PaidRandomItem<override>:logic = ${item.flags.paidRandomItem}`,
      `        PaidArea<override>:logic = ${item.flags.paidArea}`,
      `        Consumable<override>:logic = ${item.itemType === 'consumable'}`,
      `        MaxCount<override>:int = ${item.itemType === 'durable' ? 1 : item.maxCount}`,
      `        ConsequentialToGameplay<override>:logic = ${item.flags.consequentialToGameplay}`,
      '',
    );
  }

  push(`${priceModule}<public> := module:`);
  for (const item of entitlements) {
    push(`    ${item.verseKey}_price<public>:float = ${item.priceVBucks.toFixed(1)}`);
    for (const alternate of item.alternateOffers ?? []) push(`    ${alternate.verseKey}_price<public>:float = ${alternate.priceVBucks.toFixed(1)}`);
  }
  for (const bundle of bundles) push(`    ${bundle.verseKey}_price<public>:float = ${bundle.priceVBucks.toFixed(1)}`);
  push('');

  push(`${offersModule}<public> := module:`, `    using { ${infoModule} }`, `    using { ${entModule} }`, `    using { ${priceModule} }`, '');
  for (const item of entitlements) {
    push(offerClass(item.verseKey, `${infoModule}.${toVerseApiStem(item.verseKey)}`, item.verseKey, priceModule, `${item.verseKey}_price`, item.iconTexture, item.offerRestrictions));
    for (const alternate of item.alternateOffers ?? []) {
      push(offerClass(alternate.verseKey, `${infoModule}.${toVerseApiStem(alternate.verseKey)}`, item.verseKey, priceModule, `${alternate.verseKey}_price`, alternate.iconTexture, alternate.restrictions));
    }
  }
  for (const bundle of bundles) {
    if (bundle.dynamicRemaining && !dynamicRemainingEntry(bundle)) continue;
    const bundleSource = generatedBundleOffer(bundle, infoModule, priceModule);
    const entries = bundle.items.map(entry => `(${resolveBundleEntry(entry, entitlements, bundles)}, ${entry.quantity})`).join(', ');
    push(bundleOfferClass(bundleSource, `array{${entries}}`));
    if (dynamicRemainingEntry(bundle)) {
      push(
        bundleOfferClass(bundleSource, 'array{}', '_dynamic'),
      );
    }
  }

  const editableFields = editableDescriptors(entitlements, config, offerDisplayGroups);
  push(...editableMetadataLines(editableFields));
  push(`${deviceClass} := class(creative_device):`, '');
  push(...debugEditableLines(), '');
  if (editableFields.some(field => field.rootCategory === 'entitlements')) push('    # Entitlement Purchase Bindings');
  for (const field of editableFields.filter(candidate => candidate.rootCategory === 'entitlements')) push(...editableAttributeLines(field), '');
  if (editableFields.some(field => field.rootCategory === 'storefronts')) push('    # Storefront Bindings');
  for (const field of editableFields.filter(candidate => candidate.rootCategory === 'storefronts')) push(...editableAttributeLines(field), '');
  const allOffersStoreButtons = storefrontEditableName('AllOffersStore', 'openButtons');

  push(
    '    var EntitlementChangeSubscriptions:[player]?cancelable = map{}',
    '    var PlayerJoinSubscription:?cancelable = false',
    '    var PlayerLeftSubscription:?cancelable = false',
    '    var DeviceSubscriptions:[]cancelable = array{}',
    '    var MarketplaceUIInFlight:[player]logic = map{}',
    `    UEMLogger:log = log{Channel := ${UEM_LOG_CHANNEL}}`,
    '',
  );
  push(
    '    LogDebug(Message:string):void =',
    '        if (EnableDebugLogging?):',
    '            UEMLogger.Print("[UEM][Debug] " + Message, ?Level := log_level.Debug)',
    '',
    '    LogWarning(Message:string):void =',
    '        UEMLogger.Print("[UEM][Warning] " + Message, ?Level := log_level.Warning)',
    '',
    '    LogError(Message:string):void =',
    '        UEMLogger.Print("[UEM][Error] " + Message, ?Level := log_level.Error)',
    '',
  );
  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    push(
      `    ${pascal}_GrantedSignal:event(tuple(player, int)) = event(tuple(player, int)){}`,
      `    ${pascal}_RemovedSignal:event(tuple(player, int)) = event(tuple(player, int)){}`,
      `    ${pascal}_ReconciledSignal:event(tuple(player, int)) = event(tuple(player, int)){}`,
      `    Await${pascal}GrantedEvent<public>()<suspends>:tuple(player, int) = ${pascal}_GrantedSignal.Await()`,
      `    Await${pascal}RemovedEvent<public>()<suspends>:tuple(player, int) = ${pascal}_RemovedSignal.Await()`,
      `    Await${pascal}ReconciledEvent<public>()<suspends>:tuple(player, int) = ${pascal}_ReconciledSignal.Await()`,
    );
  }
  push('');

  push(
    '    OnBegin<override>()<suspends>:void =',
    '        LogDebug("Device lifecycle started.")',
    '        JoinSubscription := GetPlayspace().PlayerAddedEvent().Subscribe(OnPlayerAdded)',
    '        set PlayerJoinSubscription = option{JoinSubscription}',
    '        LeftSubscription := GetPlayspace().PlayerRemovedEvent().Subscribe(OnPlayerRemoved)',
    '        set PlayerLeftSubscription = option{LeftSubscription}',
    '        for (Player : GetPlayspace().GetPlayers()):',
    '            OnPlayerAdded(Player)',
  );
  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const names = entitlementEditableNames(item.verseKey);
    if (item.triggers.generateTriggerBinding) push(`        for (Trigger : ${names.purchaseTriggers}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${pascal}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
    if (item.triggers.generateButtonBinding) push(`        for (Button : ${names.purchaseButtons}):`, `            Subscription := Button.InteractedWithEvent.Subscribe(On${pascal}ButtonInteracted)`, '            set DeviceSubscriptions += array{Subscription}');
  }
  if (config.generateStorefrontBinding) push(`        for (Button : ${allOffersStoreButtons}):`, '            Subscription := Button.InteractedWithEvent.Subscribe(OnStorefrontButtonInteracted)', '            set DeviceSubscriptions += array{Subscription}');
  for (const group of offerDisplayGroups) {
    if (group.generateTriggerBinding) push(`        for (Trigger : ${storefrontEditableName(group.verseKey)}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${toVerseApiStem(group.verseKey)}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
  }
  push('');

  push(
    '    OnEnd<override>():void =',
    '        LogDebug("Device lifecycle ended.")',
    '        if (Subscription := PlayerJoinSubscription?):',
    '            Subscription.Cancel()',
    '        if (Subscription := PlayerLeftSubscription?):',
    '            Subscription.Cancel()',
    '        for (PlayerKey -> MaybeSubscription : EntitlementChangeSubscriptions):',
    '            if (Subscription := MaybeSubscription?):',
    '                Subscription.Cancel()',
    '        for (Subscription : DeviceSubscriptions):',
    '            Subscription.Cancel()',
    '',
    '    OnPlayerAdded(Player:player):void =',
    '        LogDebug("Player added; reconciling entitlements.")',
    '        RemovePlayerSubscription(Player)',
    `        Subscription := GetEntitlementsChangedEvent(Player, ${entModule}.basic_entitlement).Subscribe(OnEntitlementsChanged)`,
    '        if (set EntitlementChangeSubscriptions[Player] = option{Subscription}):',
    '            LogDebug("Entitlement listener registered.")',
    '        spawn{ReconcilePlayerEntitlements(Player)}',
    '',
    '    OnPlayerRemoved(Player:player):void =',
    '        LogDebug("Player removed; releasing runtime state.")',
    '        RemovePlayerSubscription(Player)',
    '        ReleaseMarketplaceUI(Player)',
    '',
    '    RemovePlayerSubscription(Player:player):void =',
    '        if (Subscription := EntitlementChangeSubscriptions[Player]?):',
    '            Subscription.Cancel()',
    '        var RemainingSubscriptions:[player]?cancelable = map{}',
    '        for (Key -> Value : EntitlementChangeSubscriptions, Key <> Player):',
    '            set RemainingSubscriptions = ConcatenateMaps(RemainingSubscriptions, map{Key => Value})',
    '        set EntitlementChangeSubscriptions = RemainingSubscriptions',
    '',
    '    TryAcquireMarketplaceUI(Player:player):logic =',
    '        if (Active := MarketplaceUIInFlight[Player], Active?):',
    '            LogDebug("Marketplace UI request already active for this player.")',
    '            return false',
    '        if (set MarketplaceUIInFlight[Player] = true):',
    '            return true',
    '        LogError("Unable to start Marketplace UI; in-flight state could not be recorded.")',
    '        false',
    '',
    '    ReleaseMarketplaceUI(Player:player):void =',
    '        var RemainingMarketplaceUI:[player]logic = map{}',
    '        for (Key -> Value : MarketplaceUIInFlight, Key <> Player):',
    '            set RemainingMarketplaceUI = ConcatenateMaps(RemainingMarketplaceUI, map{Key => Value})',
    '        set MarketplaceUIInFlight = RemainingMarketplaceUI',
    '',
    '    OnEntitlementsChanged(Player:player, Changes:[]entitlement_change(entitlement)):void =',
    '        for (EntitlementChange : Changes, ChangedEntitlement := EntitlementChange.Entitlement):',
    '            if (EntitlementChange.Change > 0):',
  );
  for (const item of entitlements) {
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toVerseApiStem(item.verseKey)}Grant(Player, EntitlementChange.Change)`);
  }
  push('            else if (EntitlementChange.Change < 0):');
  for (const item of entitlements) {
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toVerseApiStem(item.verseKey)}Removal(Player, 0 - EntitlementChange.Change)`);
  }
  push('');

  push(
    '    # Managed implementation. Await the generated entitlement delta notifications from your own Verse to apply gameplay effects.',
    '    # Do not edit these handlers; regeneration may replace the managed implementation.',
    '',
  );

  push(
    '    # Grant and Consume return the native Marketplace operation result; true does not mean gameplay state has already been processed.',
    '    # Direct grants bypass offer disclosures and the purchase flow. Use them only for deliberate free grants.',
    '    # Apply gameplay changes from the generated entitlement delta events or current-state query helpers in external Verse.',
    '',
  );

  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const printableName = escapeVerseString(item.name);
    push(
      `    Process${pascal}Grant(Player:player, Quantity:int):void =`,
      `        LogDebug("Granted ${printableName} x{Quantity}.")`,
      `        ${pascal}_GrantedSignal.Signal((Player, Quantity))`,
      ...(item.itemType === 'consumable' && item.autoConsume
        ? [`        spawn{AutoConsume${pascal}(Player, Quantity)}`]
        : []),
      '',
      `    Process${pascal}Removal(Player:player, Quantity:int):void =`,
      `        LogDebug("${item.itemType === 'durable' ? 'Ownership removed for' : 'Inventory decreased for'} ${printableName} x{Quantity}; reconcile saved state.")`,
      `        ${pascal}_RemovedSignal.Signal((Player, Quantity))`,
      '',
    );
    if (item.itemType === 'consumable') {
      push(
        `    Consume${pascal}<public>(Player:player, Quantity:int)<suspends>:logic =`,
        '        if (Quantity > 0):',
        `            Result := ConsumeEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
        '            if (not Result?):',
        `                LogError("Consume${pascal} returned false for ${printableName}.")`,
        '            return Result',
        `        LogWarning("Consume${pascal} called with a non-positive quantity.")`,
        '        return false',
        '',
      );
      if (item.autoConsume) {
        push(
          `    # Auto-consume intentionally discards Consume${pascal}'s operation result; the public helper logs failures before returning it.`,
          `    AutoConsume${pascal}(Player:player, Quantity:int)<suspends>:void =`,
          `        Consume${pascal}(Player, Quantity)`,
          '',
        );
      }
    }
    push(
      `    Grant${pascal}<public>(Player:player, Quantity:int)<suspends>:logic =`,
      '        if (Quantity > 0):',
      `            Result := GrantEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
      '            if (not Result?):',
      `                LogError("Grant${pascal} returned false for ${printableName}.")`,
      '            return Result',
      `        LogWarning("Grant${pascal} called with a non-positive quantity.")`,
      '        return false',
      '',
    );
  }

  for (const item of entitlements) {
      const pascal = toVerseApiStem(item.verseKey);
      push(
        `    Get${pascal}Count<public>(Player:player)<suspends>:int =`,
        `        Purchases := GetPurchasedEntitlements(Player, ${entModule}.${item.verseKey}_entitlement)`,
        '        if (Purchase := Purchases[0]):',
        '            return Purchase(1)',
        '        0',
        '',
        `    Has${pascal}<public>(Player:player)<suspends>:logic =`,
        `        OwnedCount := Get${pascal}Count(Player)`,
        '        if (OwnedCount > 0):',
        '            return true',
        '        false',
        '',
      );
  }

  push(
    '    ExecutePurchase(Player:player, OfferToBuy:offer, OfferLabel:string)<suspends>:void =',
    '        LogDebug("Opening purchase for {OfferLabel}.")',
    '        WasPurchased := BuyOffer(Player, OfferToBuy)',
    '        if (not WasPurchased?):',
    '            LogDebug("Purchase was not completed for {OfferLabel}.")',
    '        ReleaseMarketplaceUI(Player)',
    '',
    '    ExecuteStorefront(Player:player, OffersToShow:[]offer, Title:message)<suspends>:void =',
    '        LogDebug("Opening storefront.")',
    '        ShowOffersDialog(Player, OffersToShow, ?Title := Title)',
    '        LogDebug("Storefront closed.")',
    '        ReleaseMarketplaceUI(Player)',
    '',
  );

  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const printableName = escapeVerseString(item.name);
    const purchaseEntryName = `Open${pascal}Purchase`;
    if (item.triggers.generateTriggerBinding) {
      push(
        `    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`,
        `        LogDebug("${pascal} purchase trigger callback received.")`,
        `        if (Agent := MaybeAgent?):`,
        `            if (Player := player[Agent]):`,
        `                ${purchaseEntryName}(Player)`,
        '            else:',
        `                LogDebug("${pascal} purchase trigger did not resolve to a player.")`,
        '        else:',
        `            LogDebug("${pascal} purchase trigger had no agent.")`,
        '',
      );
    }
    if (item.triggers.generateButtonBinding) {
      push(
        `    On${pascal}ButtonInteracted(Agent:agent):void =`,
        `        LogDebug("${pascal} purchase button interaction received.")`,
        `        if (Player := player[Agent]):`,
        `            ${purchaseEntryName}(Player)`,
        '        else:',
        `            LogDebug("${pascal} purchase button did not resolve to a player.")`,
        '',
      );
    }
    push(
      `    ${purchaseEntryName}<public>(Player:player):void =`,
      '        Acquired := TryAcquireMarketplaceUI(Player)',
      '        if (Acquired?):',
      `            spawn{ExecutePurchase(Player, ${offersModule}.${item.verseKey}_offer{}, "${printableName}")}`,
      '',
    );
    for (const alternate of item.alternateOffers ?? []) {
      const altPascal = toVerseApiStem(alternate.verseKey);
      push(
        `    Open${altPascal}Purchase<public>(Player:player):void =`,
        '        Acquired := TryAcquireMarketplaceUI(Player)',
        '        if (Acquired?):',
        `            spawn{ExecutePurchase(Player, ${offersModule}.${alternate.verseKey}_offer{}, "${escapeVerseString(alternate.name)}")}`,
        '',
      );
    }
  }

  for (const bundle of bundles) {
    const pascal = toVerseApiStem(bundle.verseKey);
    const printableName = escapeVerseString(bundle.name);
    const dynamicEntry = dynamicRemainingEntry(bundle);
    const purchaseEntryName = `Open${pascal}Purchase`;
    const dynamicItem = dynamicEntry ? entitlements.find(candidate => candidate.id === dynamicEntry.entitlementId) : undefined;
    if (dynamicEntry && dynamicItem) {
      const entry = dynamicEntry;
      const offerReference = `${offersModule}.${resolveBundleEntry(entry, entitlements, bundles)}`;
      push(
        `    ${purchaseEntryName}<public>(Player:player):void =`,
        '        Acquired := TryAcquireMarketplaceUI(Player)',
        '        if (Acquired?):',
        `            spawn{ExecuteDynamicPurchase${pascal}(Player)}`,
        '',
        `    ExecuteDynamicPurchase${pascal}(Player:player)<suspends>:void =`,
        `        Purchases := GetPurchasedEntitlements(Player, ${entModule}.${dynamicItem.verseKey}_entitlement)`,
        '        var OwnedCount:int = 0',
        '        if (Purchase := Purchases[0]):',
        '            set OwnedCount = Purchase(1)',
        `        MaxCount := ${entModule}.${dynamicItem.verseKey}_entitlement{}.MaxCount`,
        '        var RemainingCount:int = MaxCount - OwnedCount',
        '        if (RemainingCount < 0):',
        '            set RemainingCount = 0',
        '        if (RemainingCount > 0):',
        `            DynamicOffer := ${offersModule}.${bundle.verseKey}_dynamic_offer{Offers := array{(${offerReference}, RemainingCount)}}`,
        `            ExecutePurchase(Player, DynamicOffer, "${printableName}")`,
        '        else:',
        `            LogDebug("${printableName} has no remaining quantity.")`,
        '            ReleaseMarketplaceUI(Player)',
        '',
      );
    } else if (bundle.dynamicRemaining) {
      push(
        `    ${purchaseEntryName}<public>(Player:player):void =`,
        '        Acquired := TryAcquireMarketplaceUI(Player)',
        '        if (Acquired?):',
        `            LogError("${escapeVerseString(bundle.name)} has an invalid dynamic remaining configuration.")`,
        '            ReleaseMarketplaceUI(Player)',
        '',
      );
    } else {
      push(
        `    ${purchaseEntryName}<public>(Player:player):void =`,
        '        Acquired := TryAcquireMarketplaceUI(Player)',
        '        if (Acquired?):',
        `            spawn{ExecutePurchase(Player, ${offersModule}.${bundle.verseKey}_offer{}, "${printableName}")}`,
        '',
      );
    }
  }

  const allOffers = storefrontReferences(storefrontMembership.allOffers, entitlements, bundles, offersModule);
  push('    AllOffersStoreTitle<localizes>:message = "All Offers"', '');
  push('    ShowAllOffers(Player:player)<suspends>:void =');
  if (allOffers.length) push(`        ExecuteStorefront(Player, array{${allOffers.join(', ')}}, AllOffersStoreTitle)`);
  else push('        LogWarning("No transaction offers are configured.")', '        ReleaseMarketplaceUI(Player)');
  push(
    '',
    '    OpenAllOffersStore<public>(Player:player):void =',
    '        Acquired := TryAcquireMarketplaceUI(Player)',
    '        if (Acquired?):',
    '            spawn{ShowAllOffers(Player)}',
    '',
  );
  if (config.generateStorefrontBinding) push(
    '    OnStorefrontButtonInteracted(Agent:agent):void =',
    '        LogDebug("All Offers storefront button interaction received.")',
    '        if (Player := player[Agent]):',
    '            OpenAllOffersStore(Player)',
    '        else:',
    '            LogDebug("All Offers storefront button did not resolve to a player.")',
    '',
  );

  for (const group of offerDisplayGroups) {
    const pascal = toVerseApiStem(group.verseKey);
    const references = storefrontReferences(group.entries, entitlements, bundles, offersModule);
    push(
      `    ${pascal}Title<localizes>:message = "${escapeVerseString(group.name)}"`,
      '',
      `    Show${pascal}Offers(Player:player)<suspends>:void =`,
      ...(references.length
        ? [`        ExecuteStorefront(Player, array{${references.join(', ')}}, ${pascal}Title)`]
        : [`        LogWarning("No eligible offers are configured for the ${escapeVerseString(group.name)} storefront.")`, '        ReleaseMarketplaceUI(Player)']),
      '',
      `    Open${pascal}<public>(Player:player):void =`,
      '        Acquired := TryAcquireMarketplaceUI(Player)',
      '        if (Acquired?):',
      `            spawn{Show${pascal}Offers(Player)}`,
      '',
    );
    if (group.generateTriggerBinding) push(
      `    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`,
      `        LogDebug("${pascal} storefront trigger callback received.")`,
      '        if (Agent := MaybeAgent?):',
      '            if (Player := player[Agent]):',
      `                Open${pascal}(Player)`,
      '            else:',
      `                LogDebug("${pascal} storefront trigger did not resolve to a player.")`,
      '        else:',
      `            LogDebug("${pascal} storefront trigger had no agent.")`,
      '',
    );
  }

  push(
    '    # Batch reconciliation uses the UEM-owned derived base so one Marketplace query covers every managed type.',
    '    # Each concrete subtype is classified locally; missing types remain at zero and still signal their event.',
    '    ReconcilePlayerEntitlements(Player:player)<suspends>:void =',
    '        LogDebug("Reconciliation started for player.")',
  );
  if (entitlements.length > 0) {
    for (const item of entitlements) {
      const pascal = toVerseApiStem(item.verseKey);
      push(`        var ${pascal}OwnedCount:int = 0`);
    }
    push(
      `        Purchases := GetPurchasedEntitlements(Player, ${entModule}.basic_entitlement)`,
      '        for (Purchase : Purchases):',
    );
    for (const item of entitlements) {
      const pascal = toVerseApiStem(item.verseKey);
      push(
        `            if (${entModule}.${item.verseKey}_entitlement[Purchase(0)]):`,
        `                set ${pascal}OwnedCount = ${pascal}OwnedCount + Purchase(1)`,
      );
    }
    for (const item of entitlements) {
      const pascal = toVerseApiStem(item.verseKey);
      push(`        ${pascal}_ReconciledSignal.Signal((Player, ${pascal}OwnedCount))`);
    }
  }
  push('        LogDebug("Reconciliation completed for player.")', '');

  return lines.join('\n');
}
