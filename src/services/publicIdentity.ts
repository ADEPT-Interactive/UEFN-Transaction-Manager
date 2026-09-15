import type {
  AlternateOffer,
  BundleOffer,
  EntitlementItem,
  OfferDisplayGroup,
  ProjectConfig,
  PublicIdentityOverrides,
} from '../types/entitlement';
import { isValidVerseIdentifier, toVerseApiStem } from './verseIdentity';

export type PublicIdentityKind = 'entitlement' | 'alternate_offer' | 'bundle' | 'storefront';

export type IdentityRecord = {
  id: string;
  verseKey: string;
  publicIdentity?: PublicIdentityOverrides;
};

export interface DerivedPublicIdentity {
  kind: PublicIdentityKind;
  stableId: string;
  verseKey: string;
  apiStem: string;
  metadataStem?: string;
  entitlementStem?: string;
  priceStem?: string;
  offerStem?: string;
  modules: {
    info: string;
    entitlements: string;
    prices: string;
    offers: string;
    device: string;
    targetFile: string;
  };
  paths: {
    api: string;
    metadata?: string;
    entitlement?: string;
    price?: string;
    offer?: string;
    title?: string;
    show?: string;
    open?: string;
  };
}

export type PublicIdentityCandidate =
  | EntitlementItem
  | AlternateOffer
  | BundleOffer
  | OfferDisplayGroup;

const overrideValue = (record: IdentityRecord, key: keyof PublicIdentityOverrides, fallback: string): string => {
  const value = record.publicIdentity?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
};

export function normalizePublicIdentityOverrides(value: unknown): PublicIdentityOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result: PublicIdentityOverrides = {};
  for (const key of ['apiStem', 'metadataStem', 'entitlementStem', 'priceStem', 'offerStem'] as const) {
    const candidate = typeof record[key] === 'string' ? record[key].trim() : '';
    if (candidate) result[key] = candidate;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function identityOverrideKeys(kind: PublicIdentityKind): Array<keyof PublicIdentityOverrides> {
  if (kind === 'storefront') return ['apiStem'];
  if (kind === 'alternate_offer') return ['apiStem', 'metadataStem', 'priceStem', 'offerStem'];
  return ['apiStem', 'metadataStem', 'entitlementStem', 'priceStem', 'offerStem'];
}

export function validatePublicIdentityOverrides(
  value: unknown,
  kind: PublicIdentityKind,
  label: string = kind,
): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} must provide a publicIdentity object.`];
  }
  const record = value as Record<string, unknown>;
  for (const key of identityOverrideKeys(kind)) {
    if (typeof record[key] !== 'string' || !(record[key] as string).trim()) {
      problems.push(`${label}.publicIdentity.${key} is required for an explicit existing-project identity adoption.`);
      continue;
    }
    const candidate = (record[key] as string).trim();
    if (!isValidVerseIdentifier(candidate)) problems.push(`${label}.publicIdentity.${key} must be a valid non-reserved Verse identifier.`);
  }
  for (const key of Object.keys(record)) {
    if (!identityOverrideKeys(kind).includes(key as keyof PublicIdentityOverrides)) {
      problems.push(`${label}.publicIdentity.${key} is not a supported public identity field.`);
    }
  }
  return problems;
}

export function validateStoredPublicIdentity(
  value: unknown,
  kind: PublicIdentityKind,
  label: string = kind,
): string[] {
  if (value === undefined) return [];
  return validatePublicIdentityOverrides(value, kind, label);
}

function moduleSet(config: ProjectConfig): DerivedPublicIdentity['modules'] {
  return {
    info: config.infoModuleName,
    entitlements: config.entitlementsModuleName,
    prices: config.pricesModuleName,
    offers: config.offersModuleName,
    device: config.deviceClassName,
    targetFile: config.targetVerseFileName,
  };
}

export function derivePublicIdentity(
  record: IdentityRecord,
  config: ProjectConfig,
  kind: PublicIdentityKind,
  parent?: EntitlementItem,
): DerivedPublicIdentity {
  const apiStem = overrideValue(record, 'apiStem', toVerseApiStem(record.verseKey));
  const metadataStem = kind === 'storefront' ? undefined : overrideValue(record, 'metadataStem', apiStem);
  const priceStem = kind === 'storefront' ? undefined : overrideValue(record, 'priceStem', record.verseKey);
  const offerStem = kind === 'storefront' ? undefined : overrideValue(record, 'offerStem', record.verseKey);
  const entitlementStem = kind === 'entitlement'
    ? overrideValue(record, 'entitlementStem', record.verseKey)
    : kind === 'alternate_offer'
      ? parent?.publicIdentity?.entitlementStem ?? parent?.verseKey
      : undefined;
  const modules = moduleSet(config);
  const paths: DerivedPublicIdentity['paths'] = {
    api: `${modules.device}.${apiStem}`,
    ...(metadataStem ? { metadata: `${modules.info}.${metadataStem}` } : {}),
    title: kind === 'storefront' ? `${modules.device}.${apiStem}Title` : undefined,
    show: kind === 'storefront' ? `${modules.device}.Show${apiStem}Offers` : undefined,
    open: kind === 'storefront' ? `${modules.device}.Open${apiStem}` : undefined,
  };
  if (entitlementStem) paths.entitlement = `${modules.entitlements}.${entitlementStem}_entitlement`;
  if (priceStem) paths.price = `${modules.prices}.${priceStem}_price`;
  if (offerStem) paths.offer = `${modules.offers}.${offerStem}_offer`;
  return {
    kind,
    stableId: record.id,
    verseKey: record.verseKey,
    apiStem,
    ...(metadataStem ? { metadataStem } : {}),
    ...(entitlementStem ? { entitlementStem } : {}),
    ...(priceStem ? { priceStem } : {}),
    ...(offerStem ? { offerStem } : {}),
    modules,
    paths,
  };
}

export function publicIdentityComparable(identity: DerivedPublicIdentity): Record<string, unknown> {
  return {
    kind: identity.kind,
    stableId: identity.stableId,
    verseKey: identity.verseKey,
    apiStem: identity.apiStem,
    metadataStem: identity.metadataStem,
    entitlementStem: identity.entitlementStem,
    priceStem: identity.priceStem,
    offerStem: identity.offerStem,
    modules: identity.modules,
    paths: identity.paths,
  };
}

export function publicIdentitiesEqual(left: DerivedPublicIdentity, right: DerivedPublicIdentity): boolean {
  return JSON.stringify(publicIdentityComparable(left)) === JSON.stringify(publicIdentityComparable(right));
}

export function publicIdentityFromCandidate(
  candidate: PublicIdentityCandidate,
  config: ProjectConfig,
  kind: PublicIdentityKind,
  parent?: EntitlementItem,
): DerivedPublicIdentity {
  return derivePublicIdentity(candidate, config, kind, parent);
}
