import { AlternateOffer, BundleOffer, EntitlementItem, OfferDisplayGroup, OfferRestrictions, ProjectConfig } from '../types/entitlement';
import {
  createVerseKeyAllocator,
  isValidVerseIdentifier,
  normalizeRetiredVerseKeys,
  sanitizeVerseIdentifier,
} from './verseIdentity';
import {
  entitlementEditableNames,
  storefrontEditableName,
} from './editableBindings';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const booleanValue = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : [];

const normalizeStringArray = (value: unknown, uppercase = false): string[] =>
  stringArray(value).map(entry => entry.trim()).filter(Boolean).map(entry => uppercase ? entry.toUpperCase() : entry);

export function normalizeOfferRestrictions(value: unknown): OfferRestrictions {
  const record = isRecord(value) ? value : {};
  const age = numberValue(record.minimumPurchaseAge, Number.NaN);
  return {
    minimumPurchaseAge: Number.isInteger(age) && age >= 0 && age <= 99 ? age : undefined,
    blockedCountryCodes: normalizeStringArray(record.blockedCountryCodes, true),
    blockedPlatformFamilies: normalizeStringArray(record.blockedPlatformFamilies),
  };
}

function normalizeAlternateOffer(value: unknown, parentKey: string, index: number): AlternateOffer {
  if (!isRecord(value)) throw new Error(`Alternate offer ${index + 1} for ${parentKey} must be an object.`);
  const rawKey = stringValue(value.verseKey);
  const verseKey = rawKey || sanitizeVerseIdentifier(`${parentKey}_alternate_${index + 1}`);
  return {
    id: stringValue(value.id, `offer-${parentKey}-${index}`),
    verseKey,
    name: stringValue(value.name, verseKey),
    shortDescription: stringValue(value.shortDescription),
    description: stringValue(value.description),
    ...(value.durationDescription !== undefined ? { durationDescription: stringValue(value.durationDescription) } : {}),
    priceVBucks: numberValue(value.priceVBucks, 100),
    iconTexture: stringValue(value.iconTexture, `EntitlementIcons.${verseKey}`),
    restrictions: normalizeOfferRestrictions(value.restrictions),
  };
}

export function stripTransientImages<T extends EntitlementItem | BundleOffer>(item: T): T {
  const { iconImageData: _iconImageData, ...rest } = item;
  return rest as T;
}

export function normalizeEntitlement(value: unknown, index: number): EntitlementItem {
  if (!isRecord(value)) throw new Error(`Entitlement ${index + 1} must be an object.`);

  const rawKey = stringValue(value.verseKey);
  const fallbackName = stringValue(value.name, `Item ${index + 1}`);
  const verseKey = rawKey || sanitizeVerseIdentifier(fallbackName);
  const flags = isRecord(value.flags) ? value.flags : {};
  const triggers = isRecord(value.triggers) ? value.triggers : {};
  const itemType = value.itemType === 'consumable' ? 'consumable' : 'durable';

  return {
    id: stringValue(value.id, `ent-${verseKey}-${index}`),
    verseKey,
    name: stringValue(value.name, verseKey),
    shortDescription: stringValue(value.shortDescription),
    description: stringValue(value.description),
    priceVBucks: numberValue(value.priceVBucks, 100),
    itemType,
    maxCount: itemType === 'durable' ? 1 : numberValue(value.maxCount, 1),
    autoConsume: itemType === 'consumable' && booleanValue(value.autoConsume),
    iconTexture: stringValue(value.iconTexture, `EntitlementIcons.${verseKey}`),
    iconImageData: stringValue(value.iconImageData) || undefined,
    iconFileName: stringValue(value.iconFileName) || undefined,
    flags: {
      paidRandomItem: booleanValue(flags.paidRandomItem),
      paidRandomItemOdds: stringValue(flags.paidRandomItemOdds),
      paidArea: booleanValue(flags.paidArea),
      consequentialToGameplay: booleanValue(flags.consequentialToGameplay, true),
    },
    ...(value.durationDescription !== undefined ? { durationDescription: stringValue(value.durationDescription) } : {}),
    ...(value.offerRestrictions !== undefined ? { offerRestrictions: normalizeOfferRestrictions(value.offerRestrictions) } : {}),
    ...(Array.isArray(value.alternateOffers)
      ? { alternateOffers: value.alternateOffers.map((entry, offerIndex) => normalizeAlternateOffer(entry, verseKey, offerIndex)) }
      : {}),
    triggers: {
      // Trigger devices are the default, low-code way to open each offer.
      // Editable property identifiers are derived from the stable Verse key by
      // the generator and are intentionally not persisted as user input.
      generateTriggerBinding: booleanValue(triggers.generateTriggerBinding, true),
      generateButtonBinding: booleanValue(triggers.generateButtonBinding),
      generateZoneBinding: booleanValue(triggers.generateZoneBinding),
    },
  };
}

export function normalizeBundle(value: unknown, index: number): BundleOffer {
  if (!isRecord(value)) throw new Error(`Bundle ${index + 1} must be an object.`);
  const items = Array.isArray(value.items)
    ? value.items.map((entry, itemIndex) => {
        if (!isRecord(entry)) throw new Error(`Bundle ${index + 1}, item ${itemIndex + 1} must be an object.`);
        return {
          entitlementId: stringValue(entry.entitlementId) || undefined,
          bundleId: stringValue(entry.bundleId) || undefined,
          offerVerseKey: stringValue(entry.offerVerseKey) || undefined,
          quantity: numberValue(entry.quantity, 1),
        };
      })
    : [];

  const rawKey = stringValue(value.verseKey);
  const verseKey = rawKey || sanitizeVerseIdentifier(stringValue(value.name, `Bundle ${index + 1}`));
  return {
    id: stringValue(value.id, `bundle-${verseKey}-${index}`),
    verseKey,
    name: stringValue(value.name, verseKey),
    shortDescription: stringValue(value.shortDescription),
    description: stringValue(value.description),
    priceVBucks: numberValue(value.priceVBucks, 100),
    iconTexture: stringValue(value.iconTexture, `EntitlementIcons.${verseKey}`),
    iconImageData: stringValue(value.iconImageData) || undefined,
    ...(value.durationDescription !== undefined ? { durationDescription: stringValue(value.durationDescription) } : {}),
    ...(value.restrictions !== undefined ? { restrictions: normalizeOfferRestrictions(value.restrictions) } : {}),
    ...(value.dynamicRemaining !== undefined ? { dynamicRemaining: booleanValue(value.dynamicRemaining) } : {}),
    items,
  };
}

export function normalizeOfferDisplayGroup(value: unknown, index: number): OfferDisplayGroup {
  if (!isRecord(value)) throw new Error(`Offer display group ${index + 1} must be an object.`);
  const rawKey = stringValue(value.verseKey);
  const verseKey = rawKey || sanitizeVerseIdentifier(stringValue(value.name, `Offer Store ${index + 1}`));
  const entries = Array.isArray(value.entries) ? value.entries.map((entry, entryIndex) => {
    if (!isRecord(entry)) throw new Error(`Offer display group ${index + 1}, entry ${entryIndex + 1} must be an object.`);
    const entitlementId = stringValue(entry.entitlementId);
    const bundleId = stringValue(entry.bundleId);
    const offerVerseKey = stringValue(entry.offerVerseKey);
    return {
      ...(entitlementId ? { entitlementId } : {}),
      ...(bundleId ? { bundleId } : {}),
      ...(offerVerseKey ? { offerVerseKey } : {}),
    };
  }) : [];
  return {
    id: stringValue(value.id, `store-${verseKey}-${index}`),
    verseKey,
    name: stringValue(value.name, verseKey),
    entries,
    generateTriggerBinding: booleanValue(value.generateTriggerBinding, true),
  };
}

function legacyEditableNameDiagnostics(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const diagnostics: string[] = [];
  const add = (objectLabel: string, oldName: unknown, canonicalName: string) => {
    if (typeof oldName !== 'string' || !oldName.trim() || oldName === canonicalName) return;
    diagnostics.push(`Legacy editable name "${oldName}" for ${objectLabel} is ignored. UEM now generates "${canonicalName}" from the stable Verse key; existing UEFN assignments may need to be reassigned after regeneration.`);
  };

  if (Array.isArray(value.entitlements)) {
    value.entitlements.forEach((rawItem, index) => {
      if (!isRecord(rawItem)) return;
      const item = normalizeEntitlement(rawItem, index);
      const names = entitlementEditableNames(item.verseKey);
      const triggers = isRecord(rawItem.triggers) ? rawItem.triggers : {};
      const label = item.name || item.verseKey || `entitlement ${index + 1}`;
      add(`${label} purchase triggers`, triggers.triggerDeviceName, names.purchaseTriggers);
      add(`${label} purchase buttons`, triggers.buttonDeviceName, names.purchaseButtons);
      add(`${label} purchase zones`, triggers.mutatorZoneName, names.purchaseZones);
    });
  }
  if (Array.isArray(value.offerDisplayGroups)) {
    value.offerDisplayGroups.forEach((rawGroup, index) => {
      if (!isRecord(rawGroup)) return;
      const group = normalizeOfferDisplayGroup(rawGroup, index);
      add(`${group.name || group.verseKey} storefront triggers`, rawGroup.triggerDeviceName, storefrontEditableName(group.verseKey));
    });
  }
  return diagnostics;
}

interface RepairedManagedData {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  offerDisplayGroups: OfferDisplayGroup[];
  projectDataDiagnostics: string[];
}

function repairProjectVerseKeys(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  offerDisplayGroups: OfferDisplayGroup[],
  retiredVerseKeys: string[] = [],
): RepairedManagedData {
  const allocator = createVerseKeyAllocator([], retiredVerseKeys);
  const alternateReplacements = new Map<string, string>();
  const projectDataDiagnostics: string[] = [];

  const preserveOrRepair = (currentKey: string, displayName: string, fallbackName: string): string => {
    if (isValidVerseIdentifier(currentKey) && allocator.reserveExisting(currentKey)) return currentKey;
    if (currentKey && isValidVerseIdentifier(currentKey)) {
      projectDataDiagnostics.push(`Verse key "${currentKey}" for ${fallbackName} was duplicated and repaired. Review the repaired project data before saving.`);
    } else {
      projectDataDiagnostics.push(`Verse key "${currentKey || '(missing)'}" for ${fallbackName} was invalid or reserved and repaired. Review the repaired project data before saving.`);
    }
    return allocator.allocate(displayName || fallbackName);
  };

  const repairedEntitlements = entitlements.map((item, index) => {
    const previousKey = item.verseKey;
    const verseKey = preserveOrRepair(previousKey, item.name, `Item ${index + 1}`);
    return { ...item, verseKey };
  });

  for (const item of repairedEntitlements) {
    const repairedAlternates = (item.alternateOffers ?? []).map((offer, index) => {
      const previousKey = offer.verseKey;
      const canPreserve = isValidVerseIdentifier(previousKey) && allocator.reserveExisting(previousKey);
      const verseKey = canPreserve
        ? previousKey
        : allocator.allocateAlternate(item.verseKey);
      if (!canPreserve) {
        projectDataDiagnostics.push(`Verse key "${previousKey || '(missing)'}" for alternate offer ${index + 1} of "${item.name || item.verseKey}" was invalid, reserved, or already assigned and repaired. Review the repaired project data before saving.`);
      }
      if (previousKey && previousKey !== verseKey && !isValidVerseIdentifier(previousKey)) {
        const replacementKey = `${item.id}\u0000${previousKey.toLowerCase()}`;
        if (!alternateReplacements.has(replacementKey)) alternateReplacements.set(replacementKey, verseKey);
      }
      return { ...offer, verseKey };
    });
    if (item.alternateOffers !== undefined) item.alternateOffers = repairedAlternates;
  }

  const repairedBundles = bundles.map((bundle, index) => ({
    ...bundle,
    verseKey: preserveOrRepair(bundle.verseKey, bundle.name, `Bundle ${index + 1}`),
  }));
  const repairedOfferDisplayGroups = offerDisplayGroups.map((group, index) => ({
    ...group,
    verseKey: preserveOrRepair(group.verseKey, group.name, `Offer Store ${index + 1}`),
  }));

  const repairOfferReference = <T extends { entitlementId?: string; offerVerseKey?: string }>(entry: T): T => {
    if (!entry.entitlementId || !entry.offerVerseKey) return entry;
    const replacement = alternateReplacements.get(`${entry.entitlementId}\u0000${entry.offerVerseKey.toLowerCase()}`);
    return replacement ? { ...entry, offerVerseKey: replacement } : entry;
  };

  for (const bundle of repairedBundles) bundle.items = bundle.items.map(repairOfferReference);
  for (const group of repairedOfferDisplayGroups) group.entries = group.entries.map(repairOfferReference);

  return { entitlements: repairedEntitlements, bundles: repairedBundles, offerDisplayGroups: repairedOfferDisplayGroups, projectDataDiagnostics };
}

export function parseManagedData(value: unknown): {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  offerDisplayGroups: OfferDisplayGroup[];
  retiredVerseKeys: string[];
  projectDataDiagnostics: string[];
} {
  if (!isRecord(value)) throw new Error('Preset must contain a JSON object.');
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    throw new Error('Preset schemaVersion must be 2, 3, or 4. Future, missing, and unsupported schemas are not imported.');
  }
  if (!Array.isArray(value.entitlements)) throw new Error('Preset must contain an entitlements array.');
  if (value.bundles !== undefined && !Array.isArray(value.bundles)) throw new Error('Preset bundles must be an array.');
  if (value.offerDisplayGroups !== undefined && !Array.isArray(value.offerDisplayGroups)) throw new Error('Preset offerDisplayGroups must be an array.');

  const entitlements = (value.entitlements as unknown[]).map(normalizeEntitlement);
  const bundles = (value.bundles ?? []).map(normalizeBundle);
  const offerDisplayGroups = (value.offerDisplayGroups ?? []).map(normalizeOfferDisplayGroup);
  const repaired = repairProjectVerseKeys(
    entitlements,
    bundles,
    offerDisplayGroups,
    normalizeRetiredVerseKeys(value.retiredVerseKeys),
  );
  return {
    ...repaired,
    retiredVerseKeys: normalizeRetiredVerseKeys(value.retiredVerseKeys),
    projectDataDiagnostics: [...new Set([...legacyEditableNameDiagnostics(value), ...repaired.projectDataDiagnostics])],
  };
}

export function normalizeProjectConfig(value: unknown, fallback: ProjectConfig): ProjectConfig {
  if (!isRecord(value)) return fallback;
  return {
    ...fallback,
    targetVerseFileName: stringValue(value.targetVerseFileName, fallback.targetVerseFileName),
    assetFolderName: stringValue(value.assetFolderName, fallback.assetFolderName),
    deviceClassName: stringValue(value.deviceClassName, fallback.deviceClassName),
    infoModuleName: stringValue(value.infoModuleName, fallback.infoModuleName),
    entitlementsModuleName: stringValue(value.entitlementsModuleName, fallback.entitlementsModuleName),
    pricesModuleName: stringValue(value.pricesModuleName, fallback.pricesModuleName),
    offersModuleName: stringValue(value.offersModuleName, fallback.offersModuleName),
    autoBackup: booleanValue(value.autoBackup, fallback.autoBackup),
    enableVerseWorkflowServer: booleanValue(value.enableVerseWorkflowServer, fallback.enableVerseWorkflowServer),
    generateStorefrontBinding: booleanValue(value.generateStorefrontBinding, fallback.generateStorefrontBinding),
    allowAutomaticZonePrompts: booleanValue(value.allowAutomaticZonePrompts, fallback.allowAutomaticZonePrompts),
    // The active launcher-provided root is authoritative; presets cannot redirect disk access.
    contentFolderPath: fallback.contentFolderPath,
  };
}

export function parseStoredArray(value: string | null, kind: 'entitlements' | 'bundles' | 'offerDisplayGroups') {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Stored ${kind} data is not an array.`);
  const repaired = repairProjectVerseKeys(
    kind === 'entitlements' ? parsed.map(normalizeEntitlement) : [],
    kind === 'bundles' ? parsed.map(normalizeBundle) : [],
    kind === 'offerDisplayGroups' ? parsed.map(normalizeOfferDisplayGroup) : [],
  );
  return kind === 'entitlements' ? repaired.entitlements : kind === 'bundles' ? repaired.bundles : repaired.offerDisplayGroups;
}

export function cleanManagedData(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  offerDisplayGroups: OfferDisplayGroup[] = [],
  retiredVerseKeys: string[] = [],
) {
  const clean: {
    schemaVersion: 4;
    entitlements: EntitlementItem[];
    bundles: BundleOffer[];
    offerDisplayGroups: OfferDisplayGroup[];
    retiredVerseKeys?: string[];
  } = {
    schemaVersion: 4 as const,
    // Normalize before embedding the manifest so a parse -> regenerate cycle
    // cannot change omitted defaults into newly persisted fields.
    entitlements: entitlements.map((item, index) => stripTransientImages(normalizeEntitlement(item, index))),
    bundles: bundles.map((bundle, index) => stripTransientImages(normalizeBundle(bundle, index))),
    offerDisplayGroups: offerDisplayGroups.map(normalizeOfferDisplayGroup),
  };
  const normalizedRetiredVerseKeys = normalizeRetiredVerseKeys(retiredVerseKeys);
  if (normalizedRetiredVerseKeys.length) clean.retiredVerseKeys = normalizedRetiredVerseKeys;
  return clean;
}

export function normalizeCountryCodes(value: unknown): string[] {
  return stringArray(value).map(code => code.trim().toUpperCase()).filter(Boolean);
}
