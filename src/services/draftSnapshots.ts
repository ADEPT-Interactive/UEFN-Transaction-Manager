import { BundleOffer, EntitlementItem, OfferDisplayGroup, ProjectConfig } from '../types/entitlement';
import {
  normalizeBundle,
  normalizeEntitlement,
  normalizeOfferDisplayGroup,
  stripTransientImages,
} from './projectSchema';

function canonicalizeRestrictions<T extends { blockedCountryCodes: string[]; blockedPlatformFamilies: string[] }>(restrictions: T): T {
  return {
    ...restrictions,
    blockedCountryCodes: [...restrictions.blockedCountryCodes].sort(),
    blockedPlatformFamilies: [...restrictions.blockedPlatformFamilies].sort(),
  };
}

export function entitlementDraftSnapshot(item: EntitlementItem): string {
  const normalized = stripTransientImages(normalizeEntitlement(item, 0));
  return JSON.stringify({
    ...normalized,
    offerRestrictions: normalized.offerRestrictions ? canonicalizeRestrictions(normalized.offerRestrictions) : undefined,
    alternateOffers: normalized.alternateOffers?.map(offer => ({ ...offer, restrictions: canonicalizeRestrictions(offer.restrictions) })),
  });
}

export function bundleDraftSnapshot(bundle: BundleOffer): string {
  const normalized = stripTransientImages(normalizeBundle(bundle, 0));
  return JSON.stringify({ ...normalized, restrictions: normalized.restrictions ? canonicalizeRestrictions(normalized.restrictions) : undefined });
}

export function storefrontDraftSnapshot(group: OfferDisplayGroup): string {
  return JSON.stringify(normalizeOfferDisplayGroup(group, 0));
}

export function projectConfigDraftSnapshot(config: ProjectConfig): string {
  const { contentFolderPath: _contentFolderPath, ...editableConfig } = config;
  return JSON.stringify(editableConfig);
}
