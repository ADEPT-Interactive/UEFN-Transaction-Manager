/**
 * Symbols emitted by UTM are not limited to the public API stems. Verse
 * metadata modules and native offer members share the generated symbol space,
 * so new keys must avoid the names that the generator emits on every offer.
 *
 * Existing persisted keys are never rewritten by this registry. They are
 * reported by validation (or rejected by generation) so a published public
 * identity cannot move silently.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const GENERATED_NATIVE_RESERVED_SYMBOLS = new Map<string, string>([
  ['uemlogchannel', 'generated UTM log channel'],
  ['basicentitlement', 'generated basic entitlement class'],
  ['enabledebuglogging', 'generated device debug toggle'],
  ['entitlementchangesubscriptions', 'generated device state'],
  ['playerjoinsubscription', 'generated device state'],
  ['playerleftsubscription', 'generated device state'],
  ['devicesubscriptions', 'generated device state'],
  ['marketplaceuiflight', 'generated device state'],
  ['uemlogger', 'generated device logger'],
  ['alloffersstoretitle', 'generated all-offers storefront member'],
  ['onbegin', 'generated device lifecycle member'],
  ['onend', 'generated device lifecycle member'],
  ['subscribeToPlayer'.toLowerCase(), 'generated device lifecycle member'],
  ['unsubscribeFromPlayer'.toLowerCase(), 'generated device lifecycle member'],
  ['onPlayerAdded'.toLowerCase(), 'generated device lifecycle member'],
  ['onPlayerRemoved'.toLowerCase(), 'generated device lifecycle member'],
  ['trackSubscription'.toLowerCase(), 'generated device lifecycle member'],
  ['cancelAllSubscriptions'.toLowerCase(), 'generated device lifecycle member'],
  ['tryAcquireMarketplaceUI'.toLowerCase(), 'generated marketplace UI guard'],
  ['releaseMarketplaceUI'.toLowerCase(), 'generated marketplace UI guard'],
  ['executePurchase'.toLowerCase(), 'generated marketplace purchase helper'],
  ['executeStorefront'.toLowerCase(), 'generated storefront helper'],
  ['showAllOffers'.toLowerCase(), 'generated all-offers storefront helper'],
  ['openAllOffersStore'.toLowerCase(), 'generated all-offers storefront helper'],
  ['logDebug'.toLowerCase(), 'generated logging helper'],
  ['logWarning'.toLowerCase(), 'generated logging helper'],
  ['logError'.toLowerCase(), 'generated logging helper'],
  ['name', 'native offer member Name'],
  ['description', 'native offer member Description'],
  ['shortdescription', 'native offer member ShortDescription'],
  ['icon', 'native offer member Icon'],
  ['offers', 'native bundle member Offers'],
  ['price', 'native offer member Price'],
  ['entitlementtype', 'native entitlement offer member EntitlementType'],
  ['maxcount', 'native entitlement member MaxCount'],
  ['consumable', 'native entitlement member Consumable'],
  ['paidrandomitem', 'native entitlement member PaidRandomItem'],
  ['paidrandomitemodds', 'native marketplace metadata field PaidRandomItemOdds'],
  ['paidarea', 'native entitlement member PaidArea'],
  ['consequentialtogameplay', 'native entitlement member ConsequentialToGameplay'],
]);

export function normalizeGeneratedSymbol(value: string): string {
  return value.trim().toLowerCase();
}

export function isGeneratedStemSafe(value: string): boolean {
  const normalized = normalizeGeneratedSymbol(value);
  return IDENTIFIER_PATTERN.test(value) && !GENERATED_NATIVE_RESERVED_SYMBOLS.has(normalized);
}

export interface GeneratedSymbolConflict {
  name: string;
  owner: string;
  previousOwner: string;
}

/** A project-wide registry used by allocation, validation, and generation. */
export class GeneratedSymbolRegistry {
  private readonly owners = new Map<string, string>();

  constructor() {
    for (const [name, owner] of GENERATED_NATIVE_RESERVED_SYMBOLS) this.owners.set(name, owner);
  }

  register(name: string, owner: string): GeneratedSymbolConflict | undefined {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const key = normalizeGeneratedSymbol(trimmed);
    const previousOwner = this.owners.get(key);
    if (previousOwner && previousOwner !== owner) {
      return { name: trimmed, owner, previousOwner };
    }
    this.owners.set(key, owner);
    return undefined;
  }

  registerMany(names: Iterable<string>, owner: string): GeneratedSymbolConflict[] {
    const conflicts: GeneratedSymbolConflict[] = [];
    for (const name of names) {
      const conflict = this.register(name, owner);
      if (conflict) conflicts.push(conflict);
    }
    return conflicts;
  }

  has(name: string): boolean {
    return this.owners.has(normalizeGeneratedSymbol(name));
  }
}
