import { BundleOffer, EntitlementItem } from '../types/entitlement';

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
): EntitlementItem {
  const usedOfferKeys = new Set<string>();
  for (const entitlement of entitlements) {
    usedOfferKeys.add(entitlement.verseKey.toLowerCase());
    for (const offer of entitlement.alternateOffers ?? []) usedOfferKeys.add(offer.verseKey.toLowerCase());
  }
  for (const bundle of bundles) usedOfferKeys.add(bundle.verseKey.toLowerCase());

  const verseKey = uniqueIdentifier(`${item.verseKey}_copy`, usedOfferKeys);
  const usedEvents = new Set(entitlements.map(entitlement => entitlement.purchaseEventName.toLowerCase()));
  const purchaseEventName = uniqueIdentifier(`${verseKey}_GrantedEvent`, usedEvents);
  const alternateOffers = (item.alternateOffers ?? []).map(offer => ({
    ...offer,
    id: `offer-${idFactory()}`,
    verseKey: uniqueIdentifier(`${offer.verseKey}_copy`, usedOfferKeys),
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
