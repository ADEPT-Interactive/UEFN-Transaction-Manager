import { AlternateOffer, BundleOffer, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup, StorefrontMembership } from '../types/entitlement';

export const emptyStorefrontMembership = (): StorefrontMembership => ({ allOffers: [], focused: [] });

export const offerDisplayEntryKey = (entry: OfferDisplayEntry): string => entry.bundleId
  ? `bundle:${entry.bundleId}`
  : `entitlement:${entry.entitlementId ?? ''}:${entry.offerVerseKey ?? ''}`;

export type ResolvedStorefrontOffer =
  | { kind: 'primary'; item: EntitlementItem; entry: OfferDisplayEntry; offerVerseKey: string }
  | { kind: 'alternate'; item: EntitlementItem; offer: AlternateOffer; entry: OfferDisplayEntry; offerVerseKey: string }
  | { kind: 'bundle'; bundle: BundleOffer; entry: OfferDisplayEntry; offerVerseKey: string };

export function resolveStorefrontEntry(
  entry: OfferDisplayEntry,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
): ResolvedStorefrontOffer | undefined {
  if (entry.bundleId && !entry.entitlementId) {
    const bundle = bundles.find(candidate => candidate.id === entry.bundleId);
    return bundle ? { kind: 'bundle', bundle, entry, offerVerseKey: bundle.verseKey } : undefined;
  }
  if (!entry.entitlementId || entry.bundleId) return undefined;
  const item = entitlements.find(candidate => candidate.id === entry.entitlementId);
  if (!item) return undefined;
  if (!entry.offerVerseKey || entry.offerVerseKey === item.verseKey) {
    return { kind: 'primary', item, entry: { entitlementId: item.id }, offerVerseKey: item.verseKey };
  }
  const offer = item.alternateOffers?.find(candidate => candidate.verseKey === entry.offerVerseKey || candidate.id === entry.offerVerseKey);
  return offer ? { kind: 'alternate', item, offer, entry: { entitlementId: item.id, offerVerseKey: offer.verseKey }, offerVerseKey: offer.verseKey } : undefined;
}

export function isStorefrontEligible(entry: ResolvedStorefrontOffer): boolean {
  return entry.kind !== 'bundle' || !entry.bundle.dynamicRemaining;
}

export function storefrontEntryLabel(entry: ResolvedStorefrontOffer): string {
  if (entry.kind === 'primary') return `${entry.item.name} · Primary Offer`;
  if (entry.kind === 'alternate') return `${entry.item.name} · ${entry.offer.name || 'Alternate Offer'}`;
  return entry.bundle.name;
}

export function storefrontEntryDetail(entry: ResolvedStorefrontOffer): string {
  if (entry.kind === 'primary') return `${entry.item.verseKey}_offer · Primary`;
  if (entry.kind === 'alternate') return `${entry.offer.verseKey}_offer · Alternate`;
  return `${entry.bundle.verseKey}_offer · Static bundle`;
}

export function legacyStorefrontMembership(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  focused: OfferDisplayGroup[] = [],
): StorefrontMembership {
  const allOffers: OfferDisplayEntry[] = [];
  for (const item of entitlements) {
    allOffers.push({ entitlementId: item.id });
    for (const alternate of item.alternateOffers ?? []) allOffers.push({ entitlementId: item.id, offerVerseKey: alternate.verseKey });
  }
  for (const bundle of bundles) if (!bundle.dynamicRemaining) allOffers.push({ bundleId: bundle.id });
  return { allOffers, focused };
}

export function storefrontOfferOptions(entitlements: EntitlementItem[], bundles: BundleOffer[]): Array<{
  key: string;
  label: string;
  detail: string;
  entry: OfferDisplayEntry;
}> {
  const options: Array<{ key: string; label: string; detail: string; entry: OfferDisplayEntry }> = [];
  for (const item of entitlements) {
    const primary = resolveStorefrontEntry({ entitlementId: item.id }, entitlements, bundles);
    if (primary) options.push({ key: offerDisplayEntryKey(primary.entry), label: storefrontEntryLabel(primary), detail: storefrontEntryDetail(primary), entry: primary.entry });
    for (const alternate of item.alternateOffers ?? []) {
      const resolved = resolveStorefrontEntry({ entitlementId: item.id, offerVerseKey: alternate.verseKey }, entitlements, bundles);
      if (resolved) options.push({ key: offerDisplayEntryKey(resolved.entry), label: storefrontEntryLabel(resolved), detail: storefrontEntryDetail(resolved), entry: resolved.entry });
    }
  }
  for (const bundle of bundles) {
    if (bundle.dynamicRemaining) continue;
    const resolved = resolveStorefrontEntry({ bundleId: bundle.id }, entitlements, bundles);
    if (resolved) options.push({ key: offerDisplayEntryKey(resolved.entry), label: storefrontEntryLabel(resolved), detail: storefrontEntryDetail(resolved), entry: resolved.entry });
  }
  return options;
}
