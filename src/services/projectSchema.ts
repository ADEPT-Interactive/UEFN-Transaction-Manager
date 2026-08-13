import { AlternateOffer, BundleOffer, EntitlementItem, OfferDisplayGroup, OfferRestrictions, ProjectConfig } from '../types/entitlement';

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
  const verseKey = stringValue(value.verseKey, `${parentKey}_alternate_${index + 1}`);
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

  const verseKey = stringValue(value.verseKey, `item_${index + 1}`);
  const flags = isRecord(value.flags) ? value.flags : {};
  const triggers = isRecord(value.triggers) ? value.triggers : {};
  const legacyActionHook = isRecord(value.actionHook) ? value.actionHook : {};
  const legacyRejoinHook = isRecord(value.rejoinHook) ? value.rejoinHook : {};
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
    purchaseEventName: stringValue(
      value.purchaseEventName,
      stringValue(legacyActionHook.eventName, `${verseKey}_GrantedEvent`),
    ),
    restoreOnJoin: booleanValue(
      value.restoreOnJoin,
      booleanValue(legacyRejoinHook.autoRestore, itemType === 'durable'),
    ),
    triggers: {
      // Trigger devices are the default, low-code way to open each offer. Keep
      // old saved projects compatible by supplying a predictable editable name.
      generateTriggerBinding: booleanValue(triggers.generateTriggerBinding, true),
      triggerDeviceName: stringValue(triggers.triggerDeviceName) || `${verseKey}_OfferTriggers`,
      generateButtonBinding: booleanValue(triggers.generateButtonBinding),
      buttonDeviceName: stringValue(triggers.buttonDeviceName) || undefined,
      generateZoneBinding: booleanValue(triggers.generateZoneBinding),
      mutatorZoneName: stringValue(triggers.mutatorZoneName) || undefined,
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

  const verseKey = stringValue(value.verseKey, `bundle_${index + 1}`);
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
  const verseKey = stringValue(value.verseKey, `offer_store_${index + 1}`);
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
    triggerDeviceName: stringValue(value.triggerDeviceName) || `${verseKey}_StoreTriggers`,
  };
}

export function parseManagedData(value: unknown): { entitlements: EntitlementItem[]; bundles: BundleOffer[]; offerDisplayGroups: OfferDisplayGroup[] } {
  if (!isRecord(value)) throw new Error('Preset must contain a JSON object.');
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    throw new Error('Preset schemaVersion must be 2, 3, or 4. Future, missing, and unsupported schemas are not imported.');
  }
  if (!Array.isArray(value.entitlements)) throw new Error('Preset must contain an entitlements array.');
  if (value.bundles !== undefined && !Array.isArray(value.bundles)) throw new Error('Preset bundles must be an array.');
  if (value.offerDisplayGroups !== undefined && !Array.isArray(value.offerDisplayGroups)) throw new Error('Preset offerDisplayGroups must be an array.');

  return {
    entitlements: value.entitlements.map(normalizeEntitlement),
    bundles: (value.bundles ?? []).map(normalizeBundle),
    offerDisplayGroups: (value.offerDisplayGroups ?? []).map(normalizeOfferDisplayGroup),
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
    storefrontButtonDeviceName: stringValue(value.storefrontButtonDeviceName, fallback.storefrontButtonDeviceName),
    allowAutomaticZonePrompts: booleanValue(value.allowAutomaticZonePrompts, fallback.allowAutomaticZonePrompts),
    // The active launcher-provided root is authoritative; presets cannot redirect disk access.
    contentFolderPath: fallback.contentFolderPath,
  };
}

export function parseStoredArray(value: string | null, kind: 'entitlements' | 'bundles' | 'offerDisplayGroups') {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Stored ${kind} data is not an array.`);
  return kind === 'entitlements' ? parsed.map(normalizeEntitlement) : kind === 'bundles' ? parsed.map(normalizeBundle) : parsed.map(normalizeOfferDisplayGroup);
}

export function cleanManagedData(entitlements: EntitlementItem[], bundles: BundleOffer[], offerDisplayGroups: OfferDisplayGroup[] = []) {
  return {
    schemaVersion: 4 as const,
    entitlements: entitlements.map(stripTransientImages),
    bundles: bundles.map(stripTransientImages),
    offerDisplayGroups,
  };
}

export function normalizeCountryCodes(value: unknown): string[] {
  return stringArray(value).map(code => code.trim().toUpperCase()).filter(Boolean);
}
