import type {
  AlternateOffer,
  BundleOffer,
  BundleOfferItem,
  EntitlementItem,
  OfferDisplayGroup,
  OfferRestrictions,
  ProjectConfig,
  StorefrontMembership,
} from '../types/entitlement';
import { cleanManagedData } from './projectSchema';

type MutationPayload = Record<string, unknown>;

function pick(value: Record<string, unknown>, keys: readonly string[]): MutationPayload {
  return Object.fromEntries(keys
    .filter(key => value[key] !== undefined)
    .map(key => [key, value[key]]));
}

function restrictions(value: OfferRestrictions | undefined): MutationPayload | undefined {
  if (!value) return undefined;
  return {
    ...(value.minimumPurchaseAge !== undefined ? { minimumPurchaseAge: value.minimumPurchaseAge } : {}),
    blockedCountryCodes: [...value.blockedCountryCodes],
    blockedPlatformFamilies: [...value.blockedPlatformFamilies],
  };
}

function dynamicOffer(value: unknown): MutationPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const priceBehavior = (value as { priceBehavior?: unknown }).priceBehavior;
  return priceBehavior === 'runtime' ? { priceBehavior } : undefined;
}

const entitlementFields = [
  'name', 'shortDescription', 'description', 'priceVBucks', 'itemType', 'maxCount',
  'autoConsume', 'iconTexture', 'durationDescription', 'dynamicOffer',
] as const;

const alternateFields = [
  'name', 'shortDescription', 'description', 'durationDescription', 'priceVBucks',
  'iconTexture', 'dynamicOffer',
] as const;

const bundleFields = [
  'name', 'shortDescription', 'description', 'priceVBucks', 'iconTexture',
  'durationDescription', 'dynamicOffer',
] as const;

function alternatePayload(offer: AlternateOffer, includeId: boolean, clearOptionalFields = false): MutationPayload {
  const raw = offer as unknown as Record<string, unknown>;
  return {
    ...(includeId ? { id: offer.id } : {}),
    ...pick(raw, alternateFields),
    ...(offer.restrictions ? { restrictions: restrictions(offer.restrictions) } : clearOptionalFields ? { restrictions: null } : {}),
    ...(offer.dynamicOffer ? { dynamicOffer: dynamicOffer(offer.dynamicOffer) } : clearOptionalFields ? { dynamicOffer: null } : {}),
    ...(clearOptionalFields && offer.durationDescription === undefined ? { durationDescription: null } : {}),
  };
}

function entitlementPayload(item: EntitlementItem, includeAlternateIds: boolean, clearOptionalFields = false): MutationPayload {
  const raw = item as unknown as Record<string, unknown>;
  const payload: MutationPayload = {
    ...pick(raw, entitlementFields.filter(field => field !== 'dynamicOffer')),
    flags: {
      paidRandomItem: item.flags.paidRandomItem,
      paidRandomItemOdds: item.flags.paidRandomItemOdds,
      paidArea: item.flags.paidArea,
      consequentialToGameplay: item.flags.consequentialToGameplay,
    },
    triggers: {
      generateTriggerBinding: item.triggers.generateTriggerBinding,
      generateButtonBinding: item.triggers.generateButtonBinding,
      generateSuccessTriggerBinding: item.triggers.generateSuccessTriggerBinding,
    },
    ...(item.offerRestrictions ? { offerRestrictions: restrictions(item.offerRestrictions) } : clearOptionalFields ? { offerRestrictions: null } : {}),
    ...(item.dynamicOffer ? { dynamicOffer: dynamicOffer(item.dynamicOffer) } : clearOptionalFields ? { dynamicOffer: null } : {}),
    ...(clearOptionalFields && item.durationDescription === undefined ? { durationDescription: null } : {}),
  };
  if (item.alternateOffers) payload.alternateOffers = item.alternateOffers.map(offer => alternatePayload(offer, includeAlternateIds, clearOptionalFields));
  return payload;
}

/** Build the only fields allowed in an ordinary new-entitlement command. */
export function buildEntitlementCreatePayload(item: EntitlementItem): MutationPayload {
  return entitlementPayload(item, false);
}

/** Build an ordinary existing-entitlement update without public identity or UI-only fields. */
export function buildEntitlementUpdatePayload(item: EntitlementItem): MutationPayload {
  return entitlementPayload(item, true, true);
}

export function buildAlternateOfferCreatePayload(offer: AlternateOffer): MutationPayload {
  return alternatePayload(offer, false);
}

export function buildAlternateOfferUpdatePayload(offer: AlternateOffer): MutationPayload {
  return alternatePayload(offer, true, true);
}

function bundleItemPayload(item: BundleOfferItem): MutationPayload {
  return pick(item as unknown as Record<string, unknown>, [
    'entitlementId', 'bundleId', 'offerVerseKey', 'quantity', 'quantityBehavior',
  ]);
}

function bundlePayload(bundle: BundleOffer, clearOptionalFields = false): MutationPayload {
  const raw = bundle as unknown as Record<string, unknown>;
  return {
    ...pick(raw, bundleFields),
    ...(bundle.restrictions ? { restrictions: restrictions(bundle.restrictions) } : clearOptionalFields ? { restrictions: null } : {}),
    ...(bundle.dynamicOffer ? { dynamicOffer: dynamicOffer(bundle.dynamicOffer) } : clearOptionalFields ? { dynamicOffer: null } : {}),
    ...(clearOptionalFields && bundle.durationDescription === undefined ? { durationDescription: null } : {}),
    items: bundle.items.map(bundleItemPayload),
  };
}

export function buildBundleCreatePayload(bundle: BundleOffer): MutationPayload {
  return bundlePayload(bundle);
}

export function buildBundleUpdatePayload(bundle: BundleOffer): MutationPayload {
  return bundlePayload(bundle, true);
}

export function buildStorefrontCreatePayload(group: OfferDisplayGroup): MutationPayload {
  return {
    name: group.name,
    entries: group.entries.map(entry => ({ ...entry })),
    generateTriggerBinding: group.generateTriggerBinding,
  };
}

export function buildStorefrontUpdatePayload(group: OfferDisplayGroup): MutationPayload {
  return buildStorefrontCreatePayload(group);
}

export function buildStorefrontMembershipPayload(membership: StorefrontMembership): MutationPayload {
  return {
    entries: membership.allOffers.map(entry => ({ ...entry })),
  };
}

/**
 * Full replacement remains for import/recovery and settings changes. It is
 * still serialized explicitly so hydrated artwork and file-picker metadata
 * never cross the JSON bridge.
 */
export function buildCatalogReplacementPayload(input: {
  config: ProjectConfig;
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  storefrontMembership: StorefrontMembership;
  retiredVerseKeys: string[];
  projectDataDiagnostics: string[];
}): MutationPayload {
  const clean = cleanManagedData(input.entitlements, input.bundles, input.storefrontMembership, input.retiredVerseKeys);
  return {
    config: input.config,
    entitlements: clean.entitlements,
    bundles: clean.bundles,
    storefrontMembership: clean.storefrontMembership,
    retiredVerseKeys: clean.retiredVerseKeys ?? [],
    projectDataDiagnostics: [...input.projectDataDiagnostics],
  };
}
