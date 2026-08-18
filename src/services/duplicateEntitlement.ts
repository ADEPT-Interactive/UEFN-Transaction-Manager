import { BundleOffer, EntitlementItem, OfferDisplayGroup } from '../types/entitlement';
import { createVerseKeyAllocator } from './verseIdentity';

export function duplicateEntitlement(
  item: EntitlementItem,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  idFactory: () => string = () => crypto.randomUUID(),
  offerDisplayGroups: OfferDisplayGroup[] = [],
): EntitlementItem {
  const usedKeys = entitlements.flatMap(entitlement => [entitlement.verseKey, ...(entitlement.alternateOffers ?? []).map(offer => offer.verseKey)])
    .concat(bundles.map(bundle => bundle.verseKey), offerDisplayGroups.map(group => group.verseKey));
  const allocator = createVerseKeyAllocator(usedKeys);
  const verseKey = allocator.allocate(`${item.name} Copy`);
  const alternateOffers = (item.alternateOffers ?? []).map(offer => ({
    ...offer,
    id: `offer-${idFactory()}`,
    verseKey: allocator.allocateAlternate(verseKey),
    name: `${offer.name} Copy`,
    restrictions: {
      ...offer.restrictions,
      blockedCountryCodes: [...offer.restrictions.blockedCountryCodes],
      blockedPlatformFamilies: [...offer.restrictions.blockedPlatformFamilies],
    },
  }));

  return {
    ...item,
    id: `ent-${idFactory()}`,
    verseKey,
    name: `${item.name} Copy`,
    alternateOffers,
    offerRestrictions: item.offerRestrictions ? {
      ...item.offerRestrictions,
      blockedCountryCodes: [...item.offerRestrictions.blockedCountryCodes],
      blockedPlatformFamilies: [...item.offerRestrictions.blockedPlatformFamilies],
    } : undefined,
    triggers: { ...item.triggers },
  };
}
