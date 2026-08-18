import { BundleOffer, EntitlementItem, OfferDisplayGroup } from '../types/entitlement';

/**
 * Verse keywords and effect/access terms are kept out of generated identifiers.
 * The list is intentionally defensive because an identifier can be emitted as
 * a module, type, member, or asset-facing symbol in generated Verse.
 */
export const VERSE_RESERVED_IDENTIFIERS = new Set([
  'abstract', 'allocates', 'and', 'as', 'block', 'break', 'class', 'computes',
  'concrete', 'continue', 'decides', 'defer', 'do', 'else', 'enum', 'event',
  'external', 'failure', 'false', 'final', 'for', 'if', 'in', 'interface',
  'internal', 'loop', 'macro', 'module', 'native', 'no_rollback', 'not', 'or',
  'private', 'protected', 'public', 'reads', 'return', 'scoped', 'self', 'set',
  'struct', 'super', 'suspends', 'then', 'this', 'transacts', 'true', 'unique',
  'using', 'var', 'where', 'weak_map', 'writes',
]);

const VERSE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidVerseIdentifier(identifier: string): boolean {
  return VERSE_IDENTIFIER_PATTERN.test(identifier) && !VERSE_RESERVED_IDENTIFIERS.has(identifier.toLowerCase());
}

/**
 * Convert the persisted stable Verse key into the one canonical public API
 * stem. Public events, purchase helpers, and storefront helpers all use this
 * transformation so display-name edits cannot rename generated API symbols.
 */
export function toVerseApiStem(value: string): string {
  const words = value.split('_').filter(Boolean);
  const result = words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
  if (!result) return 'Item';
  return /^[0-9]/.test(result) ? `Item${result}` : result;
}

/**
 * Convert human-facing text to the conservative ASCII identifier subset that
 * Verse accepts. Existing persisted keys are not passed through this function
 * during normal reopen/regeneration; it is for new keys and deterministic repair.
 */
export function sanitizeVerseIdentifier(input: string): string {
  let clean = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (/^[0-9]/.test(clean)) clean = `item_${clean}`;
  if (!clean) clean = 'item';
  if (VERSE_RESERVED_IDENTIFIERS.has(clean)) clean = `item_${clean}`;
  return clean;
}

function keySet(values: Iterable<string>): Set<string> {
  return new Set(Array.from(values, value => value.toLowerCase()));
}

export interface VerseKeyAllocator {
  allocate(name: string): string;
  allocateAlternate(parentKey: string): string;
  has(key: string): boolean;
  reserveExisting(key: string): boolean;
}

/**
 * Create a project-scoped allocator. Active keys and retired keys both occupy
 * candidates for new objects. Existing keys can be reserved separately so a
 * valid legacy key that happens to appear in the retired registry is still
 * preserved on its current object.
 */
export function createVerseKeyAllocator(
  activeKeys: Iterable<string> = [],
  retiredKeys: Iterable<string> = [],
): VerseKeyAllocator {
  const active = keySet(activeKeys);
  const reserved = new Set([...active, ...keySet(retiredKeys)]);

  const reserveExisting = (key: string): boolean => {
    const normalized = key.toLowerCase();
    if (active.has(normalized)) return false;
    active.add(normalized);
    reserved.add(normalized);
    return true;
  };

  const reserveAllocated = (key: string): string => {
    const normalized = key.toLowerCase();
    active.add(normalized);
    reserved.add(normalized);
    return key;
  };

  const allocate = (name: string): string => {
    const base = sanitizeVerseIdentifier(name);
    let candidate = base;
    let suffix = 2;
    while (reserved.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}`;
    return reserveAllocated(candidate);
  };

  return {
    allocate,
    allocateAlternate(parentKey: string): string {
      const parent = sanitizeVerseIdentifier(parentKey);
      let ordinal = 1;
      let candidate = `${parent}_alternate_${ordinal}`;
      while (reserved.has(candidate.toLowerCase())) candidate = `${parent}_alternate_${++ordinal}`;
      return reserveAllocated(candidate);
    },
    has(key: string): boolean {
      return reserved.has(key.toLowerCase());
    },
    reserveExisting,
  };
}

export function allocateVerseKey(name: string, activeKeys: Iterable<string> = [], retiredKeys: Iterable<string> = []): string {
  return createVerseKeyAllocator(activeKeys, retiredKeys).allocate(name);
}

export function allocateAlternateVerseKey(parentKey: string, activeKeys: Iterable<string> = [], retiredKeys: Iterable<string> = []): string {
  return createVerseKeyAllocator(activeKeys, retiredKeys).allocateAlternate(parentKey);
}

export function collectManagedVerseKeys(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[] = [],
  offerDisplayGroups: OfferDisplayGroup[] = [],
): string[] {
  const keys: string[] = [];
  for (const item of entitlements) {
    keys.push(item.verseKey);
    for (const alternate of item.alternateOffers ?? []) keys.push(alternate.verseKey);
  }
  for (const bundle of bundles) keys.push(bundle.verseKey);
  for (const group of offerDisplayGroups) keys.push(group.verseKey);
  return keys;
}

export function normalizeRetiredVerseKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const key = entry.trim();
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(key);
  }
  return result;
}

/** Drafts may follow their display name. Once saved, the persisted key wins. */
export function draftVerseKeyForName(currentKey: string, previousName: string, nextName: string, isExisting: boolean): string {
  if (isExisting) return currentKey;
  const previousGeneratedKey = sanitizeVerseIdentifier(previousName);
  return !currentKey || currentKey === previousGeneratedKey ? sanitizeVerseIdentifier(nextName) : currentKey;
}
