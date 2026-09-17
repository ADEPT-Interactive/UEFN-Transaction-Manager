/**
 * Marketplace limits verified against Epic's current In-Island Transactions
 * documentation. Keep these values in one place so editor hints and the
 * project validator cannot drift apart.
 *
 * Sources:
 * - https://dev.epicgames.com/documentation/en-us/fortnite/creating-items-and-offers-in-fortnite
 * - https://dev.epicgames.com/documentation/en-us/fortnite/in-island-transactions-overview-in-fortnite
 */
export const MARKETPLACE_CONSTRAINTS = {
  nameMaxCharacters: 50,
  descriptionMaxCharacters: 500,
  shortDescriptionMaxCharacters: 100,
  priceMinVBucks: 50,
  priceMaxVBucks: 5000,
  priceStepVBucks: 50,
  maxCountMin: 1, // Epic documents values below 1 as non-grantable; Transaction Manager requires a positive count.
  maxCount: 10_000_000,
  maxNestedBundleDepth: 5,
  maxDistinctEntitlementIdentifiersPerOffer: 100,
} as const;

/** The canonical exact Marketplace V-Bucks price predicate. */
export function isValidMarketplacePrice(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= MARKETPLACE_CONSTRAINTS.priceMinVBucks
    && value <= MARKETPLACE_CONSTRAINTS.priceMaxVBucks
    && value % MARKETPLACE_CONSTRAINTS.priceStepVBucks === 0;
}

export function characterCount(value: string): number {
  return Array.from(value).length;
}

export function generatedOfferDescription(
  description: string,
  durationDescription = '',
  odds = '',
): string {
  const normalizedDuration = durationDescription.trim();
  const normalizedOdds = odds.trim();
  return [
    description,
    normalizedDuration ? `Duration: ${durationDescription}` : '',
    normalizedOdds ? `Odds: ${normalizedOdds}` : '',
  ].filter(Boolean).join('\n');
}
