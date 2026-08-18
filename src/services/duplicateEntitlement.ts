import { BundleOffer, EntitlementItem, OfferDisplayGroup } from '../types/entitlement';
import { createVerseKeyAllocator } from './verseIdentity';

function uniqueIdentifier(preferred: string, used: Set<string>): string {
  let candidate = preferred;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${preferred}_${suffix++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

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
  const usedEvents = new Set(entitlements.map(entitlement => entitlement.purchaseEventName.toLowerCase()));
  const purchaseEventName = uniqueIdentifier(`${verseKey}_GrantedEvent`, usedEvents);
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
    purchaseEventName,
    alternateOffers,
    offerRestrictions: item.offerRestrictions ? {
      ...item.offerRestrictions,
      blockedCountryCodes: [...item.offerRestrictions.blockedCountryCodes],
      blockedPlatformFamilies: [...item.offerRestrictions.blockedPlatformFamilies],
    } : undefined,
    triggers: {
      ...item.triggers,
      triggerDeviceName: item.triggers.generateTriggerBinding ? `${verseKey}_OfferTriggers` : undefined,
      buttonDeviceName: item.triggers.generateButtonBinding ? `${verseKey}_Buttons` : undefined,
      mutatorZoneName: item.triggers.generateZoneBinding ? `${verseKey}_Zones` : undefined,
    },
  };
}
