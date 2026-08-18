import { AlternateOffer, BundleOffer, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup, OfferRestrictions, ProjectConfig, StorefrontMembership, ValidationIssue } from '../types/entitlement';
import { COUNTRY_CODE_OPTIONS, EPIC_PLATFORM_FAMILIES } from '../constants/offerRestrictions';
import { MODERATION_RULE_GROUPS } from '../constants/moderationRules';
import { isValidVerseIdentifier, sanitizeVerseIdentifier as canonicalSanitizeVerseIdentifier, toVerseApiStem } from './verseIdentity';
import { entitlementEditableNames, storefrontEditableName } from './editableBindings';
import { legacyStorefrontMembership, offerDisplayEntryKey, resolveStorefrontEntry } from './storefrontMembership';

export { canonicalSanitizeVerseIdentifier as sanitizeVerseIdentifier };

const MAX_ENTITLEMENTS = 100;
const MAX_NAME_LENGTH = 50;
const MAX_SHORT_DESCRIPTION_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BUNDLE_OFFERS = 100;
const MAX_ENTITLEMENT_COUNT = 10_000_000;
const MAX_ALTERNATE_OFFERS = 20;
const BANNED_TERMS = [
  'aura', 'backbling', 'contrail', 'drift trail', 'emoticon', 'glider',
  'harvesting tool', 'pickaxe', 'jam track', 'kicks', 'sidekick', 'spray',
  'wrap', 'outfit', 'emote', 'battle pass', 'experience', 'xp',
];
const VALID_PLATFORM_FAMILY_SET = new Set<string>(EPIC_PLATFORM_FAMILIES);
const VALID_COUNTRY_CODE_SET = new Set<string>(COUNTRY_CODE_OPTIONS);

const MODERATION_LEET_REPLACEMENTS: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's',
};

export function validateVerseIdentifier(identifier: string): boolean {
  return isValidVerseIdentifier(identifier);
}

export function validateTextureExpression(expression: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(expression);
}

export const toPascalCase = toVerseApiStem;

function issue(
  id: string,
  severity: ValidationIssue['severity'],
  message: string,
  ruleName: string,
  field?: string,
  entitlementId?: string,
  bundleId?: string,
): ValidationIssue {
  return { id, severity, message, ruleName, field, entitlementId, bundleId };
}

function generatedDescriptionWithOdds(description: string, odds: string): string {
  const normalizedOdds = odds.trim();
  return normalizedOdds ? `${description}\nOdds: ${normalizedOdds}` : description;
}

function validatePrice(ownerId: string, value: number, bundleId?: string): ValidationIssue[] {
  if (!Number.isInteger(value) || value < 50 || value > 5000 || value % 50 !== 0) {
    return [issue(
      `${ownerId}-price`, 'error',
      'Price must be an integer from 50 to 5,000 V-Bucks in exact increments of 50.',
      'price_bounds_and_step', 'priceVBucks', bundleId ? undefined : ownerId, bundleId,
    )];
  }
  return [];
}

function validateTextLengths(
  ownerId: string,
  name: string,
  shortDescription: string,
  description: string,
  bundleId?: string,
): ValidationIssue[] {
  const target = bundleId ? { bundleId } : { entitlementId: ownerId };
  const result: ValidationIssue[] = [];
  if (!name.trim()) result.push(issue(`${ownerId}-name-required`, 'error', 'Display name is required.', 'name_required', 'name', target.entitlementId, target.bundleId));
  if (name.length > MAX_NAME_LENGTH) result.push(issue(`${ownerId}-name-length`, 'error', `Display name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'name_length', 'name', target.entitlementId, target.bundleId));
  if (!shortDescription.trim()) result.push(issue(`${ownerId}-short-required`, 'error', 'Short description is required.', 'short_description_required', 'shortDescription', target.entitlementId, target.bundleId));
  if (shortDescription.length > MAX_SHORT_DESCRIPTION_LENGTH) result.push(issue(`${ownerId}-short-length`, 'error', `Short description must be ${MAX_SHORT_DESCRIPTION_LENGTH} characters or fewer.`, 'short_description_length', 'shortDescription', target.entitlementId, target.bundleId));
  if (!description.trim()) result.push(issue(`${ownerId}-description-required`, 'error', 'Description is required.', 'description_required', 'description', target.entitlementId, target.bundleId));
  if (description.length > MAX_DESCRIPTION_LENGTH) result.push(issue(`${ownerId}-description-length`, 'error', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'description_length', 'description', target.entitlementId, target.bundleId));
  return result;
}

function validateRestrictions(ownerId: string, restrictions: OfferRestrictions | undefined, field: string, entitlementId?: string, bundleId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const target = bundleId ? { bundleId } : { entitlementId };
  const age = restrictions?.minimumPurchaseAge;
  if (age !== undefined && (!Number.isInteger(age) || age < 0 || age > 99)) {
    issues.push(issue(`${ownerId}-minimum-age`, 'error', 'Minimum purchase age must be an integer from 0 to 99.', 'minimum_purchase_age', `${field}.minimumPurchaseAge`, target.entitlementId, target.bundleId));
  }
  for (const code of restrictions?.blockedCountryCodes ?? []) {
    if (!VALID_COUNTRY_CODE_SET.has(code)) issues.push(issue(`${ownerId}-country-${code}`, 'error', `Blocked country code "${code}" must be an ISO-3166-1 alpha-2 code supported by the country picker.`, 'country_code', `${field}.blockedCountryCodes`, target.entitlementId, target.bundleId));
  }
  for (const platform of restrictions?.blockedPlatformFamilies ?? []) {
    if (!VALID_PLATFORM_FAMILY_SET.has(platform)) issues.push(issue(`${ownerId}-platform-${platform}`, 'error', `Platform family "${platform}" is not an official Epic Marketplace platform ID.`, 'platform_family', `${field}.blockedPlatformFamilies`, target.entitlementId, target.bundleId));
  }
  return issues;
}

function validateCompliance(ownerId: string, texts: string[], entitlementId?: string, bundleId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const joined = texts.join('\n');
  for (const term of BANNED_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
    if (pattern.test(joined)) {
      issues.push(issue(`${ownerId}-term-${term.replace(/[^a-z0-9]+/gi, '-')}`, 'warning', `The text contains the restricted monetization term "${term}". Epic may reject or restrict this offer; review it before publishing.`, 'restricted_monetization_term', 'name_or_description', entitlementId, bundleId));
    }
  }
  const normalized = joined
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, character => MODERATION_LEET_REPLACEMENTS[character] ?? character);
  for (const group of MODERATION_RULE_GROUPS) {
    const matched = group.terms.some(term => {
      const normalizedTerm = term
        .toLowerCase()
        .replace(/[013457@$]/g, character => MODERATION_LEET_REPLACEMENTS[character] ?? character);
      const characters = [...normalizedTerm].map(character => {
        if (/\s|-/.test(character)) return '[\\s._*+\\-]+';
        return `${character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s._*+\\-]*`;
      }).join('');
      return new RegExp(`(?:^|[^a-z])${characters}(?:$|[^a-z])`, 'i').test(normalized);
    });
    if (matched) {
      issues.push(issue(
        `${ownerId}-moderation-${group.key}`,
        'warning',
        `Potential ${group.label} detected; ${group.guidance}. This moderation flag is advisory and does not block entitlement creation.`,
        `moderation_${group.key}`,
        'name_or_description',
        entitlementId,
        bundleId,
      ));
    }
  }
  if (/\b(prize\s*wheel|spin\s*the\s*wheel|wheel\s*spin)\b/i.test(joined)) {
    issues.push(issue(`${ownerId}-prize-wheel`, 'error', 'Offers must not directly or indirectly influence prize wheels.', 'prize_wheel_restriction', 'name_or_description', entitlementId, bundleId));
  }
  return issues;
}

function validateDuration(ownerId: string, description: string, durationDescription: string, entitlementId?: string, bundleId?: string): ValidationIssue[] {
  if (!/(?:limited|temporary|expires?|\b\d+\s*[- ]?day|\b\d+\s*hours?)/i.test(`${description} ${durationDescription}`)) return [];
  if (!durationDescription.trim()) return [issue(`${ownerId}-duration`, 'error', 'Time-limited benefits must include a clear duration disclosure.', 'duration_disclosure', 'durationDescription', entitlementId, bundleId)];
  return [];
}

export function validateEntitlement(item: EntitlementItem, allItems: EntitlementItem[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = item.id;

  if (!validateVerseIdentifier(item.verseKey)) {
    issues.push(issue(`${id}-key`, 'error', 'Verse key must be a valid Verse identifier.', 'identifier_format', 'verseKey', id));
  }
  if (allItems.some(other => other.id !== id && other.verseKey.toLowerCase() === item.verseKey.toLowerCase())) {
    issues.push(issue(`${id}-key-duplicate`, 'error', `Duplicate Verse key "${item.verseKey}".`, 'identifier_unique', 'verseKey', id));
  }

  issues.push(...validateTextLengths(id, item.name, item.shortDescription, item.description));
  issues.push(...validatePrice(id, item.priceVBucks));

  if (item.itemType === 'durable' && item.maxCount !== 1) {
    issues.push(issue(`${id}-durable-count`, 'error', 'Durable entitlements must have MaxCount 1.', 'durable_maxcount_one', 'maxCount', id));
  }
  if (item.itemType === 'consumable' && (!Number.isInteger(item.maxCount) || item.maxCount < 1 || item.maxCount > MAX_ENTITLEMENT_COUNT)) {
    issues.push(issue(`${id}-consumable-count`, 'error', `Consumable MaxCount must be a positive integer no greater than ${MAX_ENTITLEMENT_COUNT.toLocaleString()}.`, 'consumable_maxcount', 'maxCount', id));
  }
  if (item.itemType === 'durable' && item.autoConsume) {
    issues.push(issue(`${id}-durable-consume`, 'error', 'Durable entitlements cannot be auto-consumed.', 'durable_not_consumable', 'autoConsume', id));
  }
  if (!validateTextureExpression(item.iconTexture.trim())) {
    issues.push(issue(`${id}-icon`, 'error', 'Icon must be a dotted Verse texture expression such as EntitlementIcons.VipPass.', 'icon_expression', 'iconTexture', id));
  }
  if (item.flags.paidRandomItem) {
    const odds = item.flags.paidRandomItemOdds.trim();
    if (generatedDescriptionWithOdds(item.description, odds).length > MAX_DESCRIPTION_LENGTH) {
      issues.push(issue(`${id}-odds-length`, 'error', `Description plus the generated odds disclosure must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'random_item_description_length', 'description', id));
    }
  }

  if (!item.flags.paidRandomItem && item.flags.paidRandomItemOdds.trim()) {
    issues.push(issue(`${id}-odds-unused`, 'warning', 'Odds are present but Paid Random Item is disabled.', 'random_item_odds_unused', 'flags.paidRandomItemOdds', id));
  }
  issues.push(...validateDuration(id, item.description, item.durationDescription ?? '', id));
  issues.push(...validateRestrictions(id, item.offerRestrictions, 'offerRestrictions', id));
  issues.push(...validateCompliance(id, [item.name, item.shortDescription, item.description, item.durationDescription ?? '', item.flags.paidRandomItemOdds], id));

  const alternateOffers = item.alternateOffers ?? [];
  if (alternateOffers.length > MAX_ALTERNATE_OFFERS) {
    issues.push(issue(`${id}-alternate-max`, 'error', `An entitlement may have at most ${MAX_ALTERNATE_OFFERS} alternate offers.`, 'alternate_offer_max', 'alternateOffers', id));
  }
  const alternateKeys = new Set<string>();
  alternateOffers.forEach((offer, index) => {
    const offerId = `${id}-alternate-${index}`;
    if (!validateVerseIdentifier(offer.verseKey)) issues.push(issue(`${offerId}-key`, 'error', 'Alternate offer Verse key must be a valid Verse identifier.', 'alternate_offer_identifier', `alternateOffers.${index}.verseKey`, id));
    const normalized = offer.verseKey.toLowerCase();
    if (alternateKeys.has(normalized) || normalized === item.verseKey.toLowerCase()) issues.push(issue(`${offerId}-key-duplicate`, 'error', `Alternate offer Verse key "${offer.verseKey}" conflicts with another offer.`, 'alternate_offer_identifier_unique', `alternateOffers.${index}.verseKey`, id));
    alternateKeys.add(normalized);
    issues.push(...validateTextLengths(offerId, offer.name, offer.shortDescription, offer.description));
    issues.push(...validatePrice(offerId, offer.priceVBucks));
    issues.push(...validateDuration(offerId, offer.description, offer.durationDescription ?? '', id));
    if (item.flags.paidRandomItem) {
      const odds = item.flags.paidRandomItemOdds.trim();
      if (generatedDescriptionWithOdds(offer.description, odds).length > MAX_DESCRIPTION_LENGTH) {
        issues.push(issue(`${offerId}-odds-length`, 'error', `Description plus the generated odds disclosure must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'random_item_description_length', `alternateOffers.${index}.description`, id));
      }
    }
    if (!validateTextureExpression(offer.iconTexture.trim())) issues.push(issue(`${offerId}-icon`, 'error', 'Alternate offer icon must be a dotted Verse texture expression.', 'alternate_offer_icon_expression', `alternateOffers.${index}.iconTexture`, id));
    issues.push(...validateRestrictions(offerId, offer.restrictions, `alternateOffers.${index}.restrictions`, id));
    issues.push(...validateCompliance(offerId, [offer.name, offer.shortDescription, offer.description, offer.durationDescription ?? ''], id));
  });

  return issues;
}

export function validateBundleOffer(bundle: BundleOffer, entitlements: EntitlementItem[], allBundles: BundleOffer[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = bundle.id;
  const entitlementById = new Map(entitlements.map(item => [item.id, item]));

  if (!validateVerseIdentifier(bundle.verseKey)) {
    issues.push(issue(`${id}-key`, 'error', 'Bundle Verse key must be a valid Verse identifier.', 'bundle_identifier', 'verseKey', undefined, id));
  }
  if (allBundles.some(other => other.id !== id && other.verseKey.toLowerCase() === bundle.verseKey.toLowerCase()) ||
      entitlements.some(item => item.verseKey.toLowerCase() === bundle.verseKey.toLowerCase())) {
    issues.push(issue(`${id}-key-duplicate`, 'error', `Bundle Verse key "${bundle.verseKey}" conflicts with another offer.`, 'bundle_identifier_unique', 'verseKey', undefined, id));
  }
  issues.push(...validateTextLengths(id, bundle.name, bundle.shortDescription, bundle.description, id));
  issues.push(...validatePrice(id, bundle.priceVBucks, id));
  issues.push(...validateDuration(id, bundle.description, bundle.durationDescription ?? '', undefined, id));
  issues.push(...validateRestrictions(id, bundle.restrictions, 'restrictions', undefined, id));
  issues.push(...validateCompliance(id, [bundle.name, bundle.shortDescription, bundle.description, bundle.durationDescription ?? ''], undefined, id));
  if (!validateTextureExpression(bundle.iconTexture.trim())) {
    issues.push(issue(`${id}-icon`, 'error', 'Bundle icon must be a dotted Verse texture expression.', 'bundle_icon_expression', 'iconTexture', undefined, id));
  }
  if (!bundle.dynamicRemaining && bundle.items.length < 2) {
    issues.push(issue(`${id}-items-min`, 'error', 'A bundle must contain at least two offer entries.', 'bundle_items_min', 'items', undefined, id));
  }
  if (bundle.items.length > MAX_BUNDLE_OFFERS) {
    issues.push(issue(`${id}-items-max`, 'error', `A bundle may contain at most ${MAX_BUNDLE_OFFERS} direct offer entries.`, 'bundle_items_max', 'items', undefined, id));
  }

  const seen = new Set<string>();
  bundle.items.forEach((entry, index) => {
    const entitlement = entry.entitlementId ? entitlementById.get(entry.entitlementId) : undefined;
    const nestedBundle = entry.bundleId ? allBundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if ((!entitlement && !nestedBundle) || (entitlement && nestedBundle) || (!entry.entitlementId && !entry.bundleId)) {
      issues.push(issue(`${id}-item-${index}-missing`, 'error', 'Bundle entries must reference exactly one existing entitlement or nested bundle.', 'bundle_reference_exists', 'items', undefined, id));
      return;
    }
    const referenceKey = entry.entitlementId ?? entry.bundleId!;
    if (seen.has(referenceKey)) {
      issues.push(issue(`${id}-item-${index}-duplicate`, 'error', 'Bundle contains the same offer more than once; combine its quantity.', 'bundle_reference_unique', 'items', undefined, id));
    }
    seen.add(referenceKey);
    if (nestedBundle && nestedBundle.id === bundle.id) issues.push(issue(`${id}-item-${index}-self`, 'error', 'A bundle cannot contain itself.', 'bundle_cycle', 'items', undefined, id));
    if (entitlement && entry.offerVerseKey && !(entitlement.alternateOffers ?? []).some(offer => offer.verseKey.toLowerCase() === entry.offerVerseKey!.toLowerCase())) {
      issues.push(issue(`${id}-item-${index}-offer`, 'error', 'Bundle offer variant does not exist on the referenced entitlement.', 'bundle_offer_variant_exists', 'items', undefined, id));
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || (entitlement && entry.quantity > entitlement.maxCount)) {
      const maxText = entitlement ? ` and its MaxCount (${entitlement.maxCount})` : '';
      issues.push(issue(`${id}-item-${index}-quantity`, 'error', `Bundle quantity must be a positive integer${maxText}.`, 'bundle_quantity', 'items', undefined, id));
    }
  });
  const collectRandomDisclosures = (candidate: BundleOffer, visited = new Set<string>()): string[] => {
    if (visited.has(candidate.id)) return [];
    const next = new Set(visited).add(candidate.id);
    const disclosures: string[] = [];
    for (const entry of candidate.items) {
      const item = entry.entitlementId ? entitlementById.get(entry.entitlementId) : undefined;
      const odds = item?.flags.paidRandomItem ? item.flags.paidRandomItemOdds.trim() : '';
      if (item?.flags.paidRandomItem && odds) disclosures.push(`${item.name}: ${odds}`);
      const nested = entry.bundleId ? allBundles.find(other => other.id === entry.bundleId) : undefined;
      if (nested) disclosures.push(...collectRandomDisclosures(nested, next));
    }
    return [...new Set(disclosures)];
  };
  const randomDisclosures = collectRandomDisclosures(bundle).join('; ');
  if (randomDisclosures && `${bundle.description}\nOdds: ${randomDisclosures}`.length > MAX_DESCRIPTION_LENGTH) {
    issues.push(issue(`${id}-random-description-length`, 'error', `Bundle description plus included paid-random-item odds must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'bundle_random_item_description_length', 'description', undefined, id));
  }
  if (bundle.dynamicRemaining && bundle.items.some(entry => entry.bundleId)) {
    issues.push(issue(`${id}-dynamic-nested`, 'error', 'Dynamic remaining bundles currently support entitlement entries only.', 'dynamic_bundle_nested', 'dynamicRemaining', undefined, id));
  }
  if (bundle.dynamicRemaining && (bundle.items.length !== 1 || !bundle.items[0]?.entitlementId)) {
    issues.push(issue(`${id}-dynamic-shape`, 'error', 'A dynamic remaining bundle must contain exactly one entitlement entry.', 'dynamic_bundle_shape', 'items', undefined, id));
  }
  if (bundle.dynamicRemaining && bundle.items.length === 1 && bundle.items[0]?.entitlementId && bundle.items[0].quantity !== 1) {
    issues.push(issue(`${id}-dynamic-quantity`, 'error', 'A dynamic remaining bundle must use quantity 1; the purchase-time remaining quantity replaces this entry quantity.', 'dynamic_bundle_quantity', 'items', undefined, id));
  }
  const depth = (candidate: BundleOffer, path: Set<string>): number | undefined => {
    if (path.has(candidate.id)) return undefined;
    const nextPath = new Set(path).add(candidate.id);
    const childDepths = candidate.items
      .map(entry => entry.bundleId ? allBundles.find(other => other.id === entry.bundleId) : undefined)
      .filter((child): child is BundleOffer => Boolean(child))
      .map(child => depth(child, nextPath));
    if (childDepths.some(value => value === undefined)) return undefined;
    const numericDepths = childDepths.filter((value): value is number => value !== undefined);
    return 1 + (numericDepths.length ? Math.max(...numericDepths) : 0);
  };
  const bundleDepth = depth(bundle, new Set());
  if (bundleDepth === undefined) issues.push(issue(`${id}-cycle`, 'error', 'Nested bundle references must not form a cycle.', 'bundle_cycle', 'items', undefined, id));
  else if (bundleDepth > 5) issues.push(issue(`${id}-depth`, 'error', 'Nested bundles may be at most five levels deep.', 'bundle_depth', 'items', undefined, id));
  const leafEntitlements = (candidate: BundleOffer, visited = new Set<string>()): Set<string> => {
    if (visited.has(candidate.id)) return new Set();
    const next = new Set(visited).add(candidate.id);
    const result = new Set<string>();
    for (const entry of candidate.items) {
      if (entry.entitlementId) result.add(entry.entitlementId);
      else if (entry.bundleId) {
        const nested = allBundles.find(other => other.id === entry.bundleId);
        if (nested) for (const entitlementId of leafEntitlements(nested, next)) result.add(entitlementId);
      }
    }
    return result;
  };
  if (leafEntitlements(bundle).size > 100) issues.push(issue(`${id}-entitlement-identifiers`, 'error', 'An offer may contain at most 100 distinct entitlement identifiers, including nested bundles.', 'bundle_entitlement_identifier_limit', 'items', undefined, id));
  const effectiveQuantities = (candidate: BundleOffer, multiplier = 1, visited = new Set<string>()): Map<string, number> => {
    if (visited.has(candidate.id)) return new Map();
    const next = new Set(visited).add(candidate.id);
    const result = new Map<string, number>();
    for (const entry of candidate.items) {
      if (entry.entitlementId) result.set(entry.entitlementId, (result.get(entry.entitlementId) ?? 0) + multiplier * entry.quantity);
      else if (entry.bundleId) {
        const nested = allBundles.find(other => other.id === entry.bundleId);
        if (nested) for (const [entitlementId, quantity] of effectiveQuantities(nested, multiplier * entry.quantity, next)) result.set(entitlementId, (result.get(entitlementId) ?? 0) + quantity);
      }
    }
    return result;
  };
  for (const [entitlementId, quantity] of effectiveQuantities(bundle)) {
    const item = entitlementById.get(entitlementId);
    if (item && quantity > item.maxCount) issues.push(issue(`${id}-effective-quantity-${entitlementId}`, 'error', `Nested bundle quantity for ${item.name} exceeds its MaxCount (${item.maxCount}).`, 'bundle_effective_quantity', 'items', undefined, id));
  }
  return issues;
}

export function validateOfferDisplayGroup(group: OfferDisplayGroup, entitlements: EntitlementItem[], bundles: BundleOffer[], allGroups: OfferDisplayGroup[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!validateVerseIdentifier(group.verseKey)) issues.push(issue(`${group.id}-key`, 'error', 'Offer display Verse key must be a valid Verse identifier.', 'offer_display_identifier', 'verseKey'));
  if (allGroups.some(candidate => candidate.id !== group.id && candidate.verseKey.toLowerCase() === group.verseKey.toLowerCase())) issues.push(issue(`${group.id}-key-duplicate`, 'error', `Offer display Verse key "${group.verseKey}" is already used.`, 'offer_display_identifier_unique', 'verseKey'));
  if (!group.name.trim() || group.name.length > MAX_NAME_LENGTH) issues.push(issue(`${group.id}-name`, 'error', `Offer display title is required and must be ${MAX_NAME_LENGTH} characters or fewer.`, 'offer_display_name', 'name'));
  if (group.entries.length === 0) issues.push(issue(`${group.id}-entries-min`, 'warning', 'This storefront is empty and will show no offers until membership is configured.', 'offer_display_entries_min', 'entries'));
  if (group.entries.length > 100) issues.push(issue(`${group.id}-entries-max`, 'error', 'An offer display may contain at most 100 offers.', 'offer_display_entries_max', 'entries'));
  const seen = new Set<string>();
  for (const [index, entry] of group.entries.entries()) {
    const item = entry.entitlementId ? entitlements.find(candidate => candidate.id === entry.entitlementId) : undefined;
    const bundle = entry.bundleId ? bundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if ((!item && !bundle) || Boolean(item) === Boolean(bundle)) {
      issues.push(issue(`${group.id}-entry-${index}-missing`, 'error', 'Offer display entries must reference exactly one existing entitlement offer or bundle.', 'offer_display_reference_exists', 'entries'));
      continue;
    }
    if (bundle?.dynamicRemaining) {
      issues.push(issue(`${group.id}-entry-${index}-dynamic`, 'error', 'Dynamic remaining bundles are direct-purchase-only because a storefront cannot calculate player-specific remaining quantity.', 'dynamic_bundle_storefront_unsupported', 'entries', undefined, group.id));
    }
    if (item && entry.offerVerseKey && entry.offerVerseKey !== item.verseKey && !(item.alternateOffers ?? []).some(offer => offer.verseKey === entry.offerVerseKey)) {
      issues.push(issue(`${group.id}-entry-${index}-variant`, 'error', 'Offer display variant does not exist on the referenced entitlement.', 'offer_display_variant_exists', 'entries'));
    }
    const key = bundle ? `bundle:${bundle.id}` : `entitlement:${item!.id}:${entry.offerVerseKey ?? item!.verseKey}`;
    if (seen.has(key)) issues.push(issue(`${group.id}-entry-${index}-duplicate`, 'error', 'Offer displays cannot contain the same offer more than once.', 'offer_display_reference_unique', 'entries'));
    seen.add(key);
  }
  return issues;
}

function validateStorefrontEntries(
  label: string,
  entries: OfferDisplayEntry[],
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const resolved = resolveStorefrontEntry(entry, entitlements, bundles);
    if (!resolved) {
      issues.push(issue(`storefront-${label}-${index}-missing`, 'error', `${label} references an offer that does not exist or is ambiguous.`, 'storefront_offer_reference_exists', 'entries'));
      return;
    }
    if (resolved.kind === 'bundle' && resolved.bundle.dynamicRemaining) {
      issues.push(issue(`storefront-${label}-${index}-dynamic`, 'error', 'Dynamic remaining bundles are direct-purchase-only and cannot be included in a storefront.', 'dynamic_bundle_storefront_unsupported', 'entries', undefined, resolved.bundle.id));
    }
    const key = offerDisplayEntryKey(resolved.entry);
    if (seen.has(key)) issues.push(issue(`storefront-${label}-${index}-duplicate`, 'error', `${label} contains the same offer more than once.`, 'storefront_offer_reference_unique', 'entries'));
    seen.add(key);
  });
  return issues;
}

export function validateProjectConfig(config: ProjectConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const symbols: Array<[keyof ProjectConfig, string]> = [
    ['assetFolderName', config.assetFolderName],
    ['deviceClassName', config.deviceClassName],
    ['infoModuleName', config.infoModuleName],
    ['entitlementsModuleName', config.entitlementsModuleName],
    ['pricesModuleName', config.pricesModuleName],
    ['offersModuleName', config.offersModuleName],
  ];
  symbols.forEach(([field, value]) => {
    if (!validateVerseIdentifier(value)) issues.push(issue(`config-${field}`, 'error', `${field} must be a valid Verse identifier.`, 'config_identifier', String(field)));
  });
  const symbolValues = symbols.map(([, value]) => value.toLowerCase());
  if (new Set(symbolValues).size !== symbolValues.length) issues.push(issue('config-symbol-unique', 'error', 'Generated module and device names must be unique.', 'config_identifier_unique'));
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.verse$/i.test(config.targetVerseFileName) || /[\\/]/.test(config.targetVerseFileName)) {
    issues.push(issue('config-file-name', 'error', 'Target filename must be a basename ending in .verse.', 'target_filename', 'targetVerseFileName'));
  }
  return issues;
}

export function validateEntireProject(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[] = [],
  config?: ProjectConfig,
  storefrontInput: StorefrontMembership | OfferDisplayGroup[] = [],
  retiredVerseKeys: string[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (entitlements.length === 0) issues.push(issue('project-empty', 'error', 'Add at least one entitlement before generating Verse.', 'entitlements_min'));
  if (entitlements.length > MAX_ENTITLEMENTS) issues.push(issue('project-max-entitlements', 'error', `Projects may define at most ${MAX_ENTITLEMENTS} distinct entitlements.`, 'entitlements_max'));
  entitlements.forEach(item => issues.push(...validateEntitlement(item, entitlements)));
  bundles.forEach(bundle => issues.push(...validateBundleOffer(bundle, entitlements, bundles)));
  const storefrontMembership = Array.isArray(storefrontInput)
    ? legacyStorefrontMembership(entitlements, bundles, storefrontInput)
    : storefrontInput;
  if (storefrontMembership.allOffers.length === 0) issues.push(issue('all-offers-empty', 'warning', 'All Offers is empty and will show no offers until eligible offers are explicitly included.', 'all_offers_empty', 'allOffers'));
  issues.push(...validateStorefrontEntries('All Offers', storefrontMembership.allOffers, entitlements, bundles));
  storefrontMembership.focused.forEach(group => issues.push(...validateOfferDisplayGroup(group, entitlements, bundles, storefrontMembership.focused)));
  storefrontMembership.focused.forEach(group => issues.push(...validateStorefrontEntries(group.name || group.verseKey, group.entries, entitlements, bundles)));
  const focusedIds = new Set<string>();
  storefrontMembership.focused.forEach(group => {
    if (focusedIds.has(group.id)) issues.push(issue(`${group.id}-id-duplicate`, 'error', 'Focused storefront IDs must be unique.', 'focused_storefront_id_unique'));
    focusedIds.add(group.id);
  });
  if (config) issues.push(...validateProjectConfig(config));

  const memberOwners = new Map<string, string>();
  const registerMember = (name: string, owner: EntitlementItem, field: string) => {
    const normalized = name.toLowerCase();
    const previous = memberOwners.get(normalized);
    if (previous) issues.push(issue(`${owner.id}-member-duplicate-${normalized}`, 'error', `Generated device member "${name}" conflicts with another generated member.`, 'device_member_unique', field, owner.id));
    else memberOwners.set(normalized, owner.id);
  };
  const registerGeneratedMember = (name: string, owner: string) => {
    const normalized = name.toLowerCase();
    const previous = memberOwners.get(normalized);
    if (previous) issues.push(issue(`${owner}-member-duplicate-${normalized}`, 'error', `Generated device member "${name}" conflicts between ${previous} and ${owner}.`, 'device_member_unique'));
    else memberOwners.set(normalized, owner);
  };
  [
    'EntitlementChangeSubscriptions', 'PlayerJoinSubscription', 'PlayerLeftSubscription', 'DeviceSubscriptions',
    'MarketplaceUIInFlight', 'AllOffersStoreTitle', 'OnBegin', 'OnEnd', 'SubscribeToPlayer',
    'UnsubscribeFromPlayer', 'OnPlayerAdded', 'OnPlayerRemoved', 'TrackSubscription', 'CancelAllSubscriptions',
    'TryAcquireMarketplaceUI', 'ReleaseMarketplaceUI', 'ExecutePurchase', 'ExecuteStorefront', 'ShowAllOffers', 'OpenAllOffersStore',
  ].forEach(name => memberOwners.set(name.toLowerCase(), 'generator'));
  memberOwners.set('alloffersstoretitle', 'generator');
  entitlements.forEach(item => {
    const pascal = toPascalCase(item.verseKey);
    const editableNames = entitlementEditableNames(item.verseKey);
    registerMember(`${pascal}_GrantedEvent`, item, 'verseKey');
    registerMember(`${pascal}_RemovedEvent`, item, 'verseKey');
    registerMember(`${pascal}_ReconciledEvent`, item, 'verseKey');
    registerMember(`Get${pascal}Count`, item, 'verseKey');
    registerMember(`Has${pascal}`, item, 'verseKey');
    registerMember(`Process${pascal}Grant`, item, 'verseKey');
    registerMember(`Process${pascal}Removal`, item, 'verseKey');
    registerMember(`Grant${pascal}`, item, 'verseKey');
    registerMember(`Open${pascal}Purchase`, item, 'verseKey');
    if (item.itemType === 'consumable') registerMember(`Consume${pascal}`, item, 'verseKey');
    (item.alternateOffers ?? []).forEach(offer => {
      const offerPascal = toPascalCase(offer.verseKey);
      registerMember(`Open${offerPascal}Purchase`, item, 'alternateOffers');
    });
    if (item.triggers.generateTriggerBinding) registerMember(editableNames.purchaseTriggers, item, 'triggers');
    if (item.triggers.generateButtonBinding) registerMember(editableNames.purchaseButtons, item, 'triggers');
  });
  if (config?.generateStorefrontBinding) {
    registerGeneratedMember(storefrontEditableName('AllOffersStore', 'openButtons'), 'config');
  }
  storefrontMembership.focused.forEach(group => {
    const pascal = toPascalCase(group.verseKey);
    registerGeneratedMember(`${pascal}Title`, 'generator');
    registerGeneratedMember(`Show${pascal}Offers`, 'generator');
    registerGeneratedMember(`Open${pascal}`, `storefront.${group.id}`);
    if (!group.generateTriggerBinding) return;
    const generatedName = storefrontEditableName(group.verseKey);
    const normalized = generatedName.toLowerCase();
    if (memberOwners.has(normalized)) issues.push(issue(`${group.id}-member-duplicate-${normalized}`, 'error', `Generated offer-display member "${generatedName}" conflicts with another generated member.`, 'device_member_unique', 'verseKey'));
    else memberOwners.set(normalized, `offer-display.${group.id}`);
  });

  const offerKeyOwners = new Map<string, string>();
  const retiredKeySet = new Set(retiredVerseKeys.map(key => key.toLowerCase()));
  const registerOfferKey = (name: string, owner: string, entitlementId?: string, bundleId?: string) => {
    const key = name.toLowerCase();
    if (retiredKeySet.has(key)) issues.push(issue(`retired-offer-key-${owner}-${key}`, 'error', `Verse key "${name}" was previously issued and retired. Reusing it would attach old external Verse references to a different object.`, 'retired_verse_key_reuse', 'verseKey', entitlementId, bundleId));
    const previous = offerKeyOwners.get(key);
    if (previous) issues.push(issue(`offer-key-${owner}-${key}`, 'error', `Offer Verse key "${name}" conflicts between ${previous} and ${owner}.`, 'offer_identifier_unique', 'verseKey', entitlementId, bundleId));
    else offerKeyOwners.set(key, owner);
  };
  entitlements.forEach((item, itemIndex) => {
    registerOfferKey(item.verseKey, `entitlement ${item.name || itemIndex + 1}`, item.id);
    (item.alternateOffers ?? []).forEach((offer, offerIndex) => registerOfferKey(offer.verseKey, `alternate offer ${offer.name || offerIndex + 1}`, item.id));
  });
  bundles.forEach((bundle, bundleIndex) => registerOfferKey(bundle.verseKey, `bundle ${bundle.name || bundleIndex + 1}`, undefined, bundle.id));
  storefrontMembership.focused.forEach(group => {
    if (retiredKeySet.has(group.verseKey.toLowerCase())) issues.push(issue(`retired-display-key-${group.id}`, 'error', `Verse key "${group.verseKey}" was previously issued and retired. Reusing it would attach old external Verse references to a different storefront.`, 'retired_verse_key_reuse', 'verseKey'));
  });

  const generatedSymbols = new Map<string, string>();
  const registerGeneratedSymbol = (name: string, owner: string) => {
    const key = name.toLowerCase();
    const previous = generatedSymbols.get(key);
    if (previous && previous !== owner) issues.push(issue(`generated-symbol-${key}`, 'error', `Generated Verse symbol "${name}" conflicts between ${previous} and ${owner}.`, 'generated_symbol_unique'));
    else generatedSymbols.set(key, owner);
  };
  for (const [field, value] of [
    ['assetFolderName', config?.assetFolderName], ['deviceClassName', config?.deviceClassName], ['infoModuleName', config?.infoModuleName],
    ['entitlementsModuleName', config?.entitlementsModuleName], ['pricesModuleName', config?.pricesModuleName], ['offersModuleName', config?.offersModuleName],
  ] as Array<[string, string | undefined]>) if (value) registerGeneratedSymbol(value, `config.${field}`);
  entitlements.forEach(item => {
    registerGeneratedSymbol(toPascalCase(item.verseKey), `entitlement.${item.id}`);
    (item.alternateOffers ?? []).forEach((offer, index) => registerGeneratedSymbol(toPascalCase(offer.verseKey), `alternate.${item.id}.${index}`));
  });
  bundles.forEach(bundle => registerGeneratedSymbol(toPascalCase(bundle.verseKey), `bundle.${bundle.id}`));
  storefrontMembership.focused.forEach(group => registerGeneratedSymbol(toPascalCase(group.verseKey), `offer-display.${group.id}`));
  for (const [memberName, owner] of memberOwners) registerGeneratedSymbol(memberName, `device-member.${owner}`);

  const entitlementIds = new Set<string>();
  const alternateOfferIds = new Set<string>();
  entitlements.forEach(item => {
    if (entitlementIds.has(item.id)) issues.push(issue(`${item.id}-id-duplicate`, 'error', 'Entitlement record IDs must be unique.', 'entitlement_id_unique', undefined, item.id));
    entitlementIds.add(item.id);
    for (const offer of item.alternateOffers ?? []) {
      if (alternateOfferIds.has(offer.id)) issues.push(issue(`${item.id}-${offer.id}-id-duplicate`, 'error', 'Alternate offer record IDs must be unique.', 'alternate_offer_id_unique', 'alternateOffers', item.id));
      alternateOfferIds.add(offer.id);
    }
  });
  const bundleIds = new Set<string>();
  bundles.forEach(bundle => {
    if (bundleIds.has(bundle.id)) issues.push(issue(`${bundle.id}-id-duplicate`, 'error', 'Bundle record IDs must be unique.', 'bundle_id_unique', undefined, undefined, bundle.id));
    bundleIds.add(bundle.id);
  });
  const offerDisplayIds = new Set<string>();
  storefrontMembership.focused.forEach(group => {
    if (offerDisplayIds.has(group.id)) issues.push(issue(`${group.id}-id-duplicate`, 'error', 'Offer display record IDs must be unique.', 'offer_display_id_unique'));
    offerDisplayIds.add(group.id);
  });
  return issues;
}
