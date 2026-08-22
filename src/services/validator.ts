import { AlternateOffer, BundleOffer, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup, OfferRestrictions, ProjectConfig, StorefrontMembership, ValidationIssue } from '../types/entitlement';
import { COUNTRY_CODE_OPTIONS, EPIC_PLATFORM_FAMILIES } from '../constants/offerRestrictions';
import { MODERATION_RULE_GROUPS } from '../constants/moderationRules';
import { characterCount, generatedOfferDescription, MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';
import { isValidVerseIdentifier, sanitizeVerseIdentifier as canonicalSanitizeVerseIdentifier, toVerseApiStem } from './verseIdentity';
import { entitlementEditableNames, storefrontEditableName } from './editableBindings';
import { legacyStorefrontMembership, offerDisplayEntryKey, resolveStorefrontEntry } from './storefrontMembership';
import { bundleQuantityBehavior, dynamicPriceEnabled, isDynamicBundle } from './dynamicOffers';

export { canonicalSanitizeVerseIdentifier as sanitizeVerseIdentifier };

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

const safeText = (value: unknown): string => typeof value === 'string' ? value : '';

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

function validatePrice(
  label: string,
  ownerId: string,
  value: number,
  bundleId?: string,
): ValidationIssue[] {
  if (!Number.isInteger(value)
    || value < MARKETPLACE_CONSTRAINTS.priceMinVBucks
    || value > MARKETPLACE_CONSTRAINTS.priceMaxVBucks
    || value % MARKETPLACE_CONSTRAINTS.priceStepVBucks !== 0) {
    return [issue(
      `${ownerId}-price`, 'error',
      `${label} price must be an integer from ${MARKETPLACE_CONSTRAINTS.priceMinVBucks.toLocaleString()} to ${MARKETPLACE_CONSTRAINTS.priceMaxVBucks.toLocaleString()} V-Bucks in exact increments of ${MARKETPLACE_CONSTRAINTS.priceStepVBucks}. Current value: ${String(value)}.`,
      'price_bounds_and_step', 'priceVBucks', bundleId ? undefined : ownerId, bundleId,
    )];
  }
  return [];
}

function validateTextLengths(
  ownerId: string,
  label: string,
  name: string,
  shortDescription: string,
  description: string,
  durationDescription = '',
  odds = '',
  bundleId?: string,
  generatedDescriptionRuleName = 'description_length',
  targetEntitlementId?: string,
  descriptionField = 'description',
  fieldPrefix = '',
): ValidationIssue[] {
  const target = bundleId ? { bundleId } : { entitlementId: targetEntitlementId ?? ownerId };
  const fieldName = fieldPrefix ? `${fieldPrefix}.name` : 'name';
  const fieldShortDescription = fieldPrefix ? `${fieldPrefix}.shortDescription` : 'shortDescription';
  const fieldDescription = fieldPrefix ? `${fieldPrefix}.${descriptionField}` : descriptionField;
  const result: ValidationIssue[] = [];
  if (!name.trim()) result.push(issue(`${ownerId}-name-required`, 'error', 'Display name is required.', 'name_required', fieldName, target.entitlementId, target.bundleId));
  if (characterCount(name) > MARKETPLACE_CONSTRAINTS.nameMaxCharacters) result.push(issue(`${ownerId}-name-length`, 'error', `${label} name is ${characterCount(name)} characters, which exceeds Epic's limit of ${MARKETPLACE_CONSTRAINTS.nameMaxCharacters}.`, 'name_length', fieldName, target.entitlementId, target.bundleId));
  if (!shortDescription.trim()) result.push(issue(`${ownerId}-short-required`, 'error', 'Short description is required.', 'short_description_required', fieldShortDescription, target.entitlementId, target.bundleId));
  if (characterCount(shortDescription) > MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters) result.push(issue(`${ownerId}-short-length`, 'error', `${label} short description is ${characterCount(shortDescription)} characters, which exceeds Epic's limit of ${MARKETPLACE_CONSTRAINTS.shortDescriptionMaxCharacters}.`, 'short_description_length', fieldShortDescription, target.entitlementId, target.bundleId));
  if (!description.trim()) result.push(issue(`${ownerId}-description-required`, 'error', 'Description is required.', 'description_required', fieldDescription, target.entitlementId, target.bundleId));
  const generatedDescription = generatedOfferDescription(description, durationDescription, odds);
  const generatedLength = characterCount(generatedDescription);
  if (generatedLength > MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters) {
    const suffixes = [durationDescription.trim() ? 'duration disclosure' : '', odds.trim() ? 'paid-random odds disclosure' : ''].filter(Boolean).join(' and ');
    result.push(issue(
      `${ownerId}-description-length`, 'error',
      `${label} final generated description is ${generatedLength} characters, exceeding Epic's limit of ${MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters}${suffixes ? ` after adding the ${suffixes}` : ''}. Remove ${generatedLength - MARKETPLACE_CONSTRAINTS.descriptionMaxCharacters} characters from the source text or generated disclosure.`,
      generatedDescriptionRuleName, fieldDescription, target.entitlementId, target.bundleId,
    ));
  }
  return result;
}

function validateRestrictions(ownerId: string, restrictions: OfferRestrictions | undefined, field: string, entitlementId?: string, bundleId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const target = bundleId ? { bundleId } : { entitlementId };
  const age = restrictions?.minimumPurchaseAge;
  if (age !== undefined && (!Number.isSafeInteger(age) || age < 0)) {
    issues.push(issue(`${ownerId}-minimum-age`, 'error', 'Minimum purchase age must be a non-negative integer. Epic does not publish a smaller Transaction Manager-specific upper bound.', 'minimum_purchase_age', `${field}.minimumPurchaseAge`, target.entitlementId, target.bundleId));
  }
  const countryCodes = restrictions?.blockedCountryCodes ?? [];
  const seenCountries = new Set<string>();
  for (const code of countryCodes) {
    if (!VALID_COUNTRY_CODE_SET.has(code)) issues.push(issue(`${ownerId}-country-${code}`, 'error', `Blocked country code "${code}" must be an ISO-3166-1 alpha-2 code supported by the country picker.`, 'country_code', `${field}.blockedCountryCodes`, target.entitlementId, target.bundleId));
    if (seenCountries.has(code)) issues.push(issue(`${ownerId}-country-duplicate-${code}`, 'warning', `${code} is listed more than once in the blocked-country restrictions. Remove the duplicate; Transaction Manager emits each restriction once.`, 'restriction_duplicate', `${field}.blockedCountryCodes`, target.entitlementId, target.bundleId));
    seenCountries.add(code);
  }
  const platforms = restrictions?.blockedPlatformFamilies ?? [];
  const seenPlatforms = new Set<string>();
  for (const platform of platforms) {
    if (!VALID_PLATFORM_FAMILY_SET.has(platform)) issues.push(issue(`${ownerId}-platform-${platform}`, 'error', `Platform family "${platform}" is not an official Epic Marketplace platform ID.`, 'platform_family', `${field}.blockedPlatformFamilies`, target.entitlementId, target.bundleId));
    if (seenPlatforms.has(platform)) issues.push(issue(`${ownerId}-platform-duplicate-${platform}`, 'warning', `${platform} is listed more than once in the blocked-platform restrictions. Remove the duplicate; Transaction Manager emits each restriction once.`, 'restriction_duplicate', `${field}.blockedPlatformFamilies`, target.entitlementId, target.bundleId));
    seenPlatforms.add(platform);
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

function paidRandomDisclosuresForBundle(
  bundle: BundleOffer,
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  visited = new Set<string>(),
): string[] {
  if (visited.has(bundle.id)) return [];
  const next = new Set(visited).add(bundle.id);
  const disclosures: string[] = [];
  for (const entry of bundle.items ?? []) {
    const item = entry.entitlementId ? entitlements.find(candidate => candidate.id === entry.entitlementId) : undefined;
    const odds = item?.flags?.paidRandomItem === true ? safeText(item.flags.paidRandomItemOdds).trim() : '';
    if (item?.flags?.paidRandomItem === true && odds) disclosures.push(`${safeText(item.name)}: ${odds}`);
    const nested = entry.bundleId ? bundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if (nested) disclosures.push(...paidRandomDisclosuresForBundle(nested, entitlements, bundles, next));
  }
  return [...new Set(disclosures)];
}

export function validateEntitlement(item: EntitlementItem, allItems: EntitlementItem[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = safeText(item.id);
  const name = safeText(item.name);
  const shortDescription = safeText(item.shortDescription);
  const description = safeText(item.description);
  const verseKey = safeText(item.verseKey);
  const durationDescription = safeText(item.durationDescription);
  const flags = item.flags ?? {} as EntitlementItem['flags'];
  const paidRandomItem = flags.paidRandomItem === true;
  const paidRandomItemOdds = safeText(flags.paidRandomItemOdds);
  const label = name || verseKey || id;

  if (!id.trim()) issues.push(issue('entitlement-id-required', 'error', `${label || 'Entitlement'} must have a stable record identifier.`, 'entitlement_id_required', 'id', id || undefined));
  if (!validateVerseIdentifier(verseKey)) {
    issues.push(issue(`${id}-key`, 'error', 'Verse key must be a valid Verse identifier.', 'identifier_format', 'verseKey', id));
  }
  if (allItems.some(other => other.id !== id && safeText(other.verseKey).toLowerCase() === verseKey.toLowerCase())) {
    issues.push(issue(`${id}-key-duplicate`, 'error', `Duplicate Verse key "${verseKey}".`, 'identifier_unique', 'verseKey', id));
  }
  if (item.itemType !== 'durable' && item.itemType !== 'consumable') {
    issues.push(issue(`${id}-type`, 'error', `${label || 'Entitlement'} must use a supported entitlement type: durable or consumable.`, 'entitlement_type', 'itemType', id));
  }

  issues.push(...validateTextLengths(
    id,
    label,
    name,
    shortDescription,
    description,
    durationDescription,
    paidRandomItem ? paidRandomItemOdds : '',
    undefined,
    paidRandomItem && paidRandomItemOdds.trim() ? 'random_item_description_length' : 'description_length',
  ));
  issues.push(...validatePrice(label, id, item.priceVBucks));

  if (item.itemType === 'durable' && item.maxCount !== 1) {
    issues.push(issue(`${id}-durable-count`, 'error', 'Durable entitlements must have MaxCount 1.', 'durable_maxcount_one', 'maxCount', id));
  }
  if (item.itemType === 'consumable' && (!Number.isSafeInteger(item.maxCount) || item.maxCount < MARKETPLACE_CONSTRAINTS.maxCountMin || item.maxCount > MARKETPLACE_CONSTRAINTS.maxCount)) {
    issues.push(issue(`${id}-consumable-count`, 'error', `${label} MaxCount must be an integer from ${MARKETPLACE_CONSTRAINTS.maxCountMin} to ${MARKETPLACE_CONSTRAINTS.maxCount.toLocaleString()}. Current value: ${String(item.maxCount)}.`, 'consumable_maxcount', 'maxCount', id));
  }
  if (item.itemType === 'durable' && item.autoConsume) {
    issues.push(issue(`${id}-durable-consume`, 'error', 'Durable entitlements cannot be auto-consumed.', 'durable_not_consumable', 'autoConsume', id));
  }
  if (!validateTextureExpression(safeText(item.iconTexture).trim())) {
    issues.push(issue(`${id}-icon`, 'error', 'Icon must be a dotted Verse texture expression such as EntitlementIcons.VipPass.', 'icon_expression', 'iconTexture', id));
  }
  if (paidRandomItem) {
    const odds = paidRandomItemOdds.trim();
    if (!odds) issues.push(issue(`${id}-odds-required-warning`, 'warning', `${label} is marked Paid Random Item, but no odds were entered in Transaction Manager. Before purchase, disclose accurate numerical odds in the offer or clearly direct players to where they are visible.`, 'paid_random_odds_required', 'flags.paidRandomItemOdds', id));
  }

  if (!paidRandomItem && paidRandomItemOdds.trim()) {
    issues.push(issue(`${id}-odds-unused`, 'warning', 'Odds are present but Paid Random Item is disabled.', 'random_item_odds_unused', 'flags.paidRandomItemOdds', id));
  }
  issues.push(...validateDuration(id, description, durationDescription, id));
  issues.push(...validateRestrictions(id, item.offerRestrictions, 'offerRestrictions', id));
  issues.push(...validateCompliance(id, [name, shortDescription, description, durationDescription, paidRandomItemOdds], id));

  const alternateOffers = Array.isArray(item.alternateOffers) ? item.alternateOffers : [];
  const alternateKeys = new Set<string>();
  alternateOffers.forEach((offer, index) => {
    const offerId = `${id}-alternate-${index}`;
    const offerLabel = safeText(offer.name) || safeText(offer.verseKey) || `alternate offer ${index + 1}`;
    if (!safeText(offer.id).trim()) issues.push(issue(`${offerId}-id-required`, 'error', `${offerLabel} must have a stable alternate-offer record identifier.`, 'alternate_offer_id_required', `alternateOffers.${index}.id`, id));
    const alternateVerseKey = safeText(offer.verseKey);
    const alternateName = safeText(offer.name);
    const alternateShortDescription = safeText(offer.shortDescription);
    const alternateDescription = safeText(offer.description);
    const alternateDurationDescription = safeText(offer.durationDescription);
    const alternateIconTexture = safeText(offer.iconTexture);
    if (!validateVerseIdentifier(alternateVerseKey)) issues.push(issue(`${offerId}-key`, 'error', 'Alternate offer Verse key must be a valid Verse identifier.', 'alternate_offer_identifier', `alternateOffers.${index}.verseKey`, id));
    const normalized = alternateVerseKey.toLowerCase();
    if (alternateKeys.has(normalized) || normalized === verseKey.toLowerCase()) issues.push(issue(`${offerId}-key-duplicate`, 'error', `Alternate offer Verse key "${alternateVerseKey}" conflicts with another offer.`, 'alternate_offer_identifier_unique', `alternateOffers.${index}.verseKey`, id));
    alternateKeys.add(normalized);
    issues.push(...validateTextLengths(
      offerId,
      offerLabel,
      alternateName,
      alternateShortDescription,
      alternateDescription,
      alternateDurationDescription,
      paidRandomItem ? paidRandomItemOdds : '',
      undefined,
      paidRandomItem && paidRandomItemOdds.trim() ? 'random_item_description_length' : 'description_length',
      id,
      'description',
      `alternateOffers.${index}`,
    ));
    issues.push(...validatePrice(offerLabel, offerId, offer.priceVBucks));
    issues.push(...validateDuration(offerId, alternateDescription, alternateDurationDescription, id));
    if (!validateTextureExpression(alternateIconTexture.trim())) issues.push(issue(`${offerId}-icon`, 'error', 'Alternate offer icon must be a dotted Verse texture expression.', 'alternate_offer_icon_expression', `alternateOffers.${index}.iconTexture`, id));
    issues.push(...validateRestrictions(offerId, offer.restrictions, `alternateOffers.${index}.restrictions`, id));
    issues.push(...validateCompliance(offerId, [alternateName, alternateShortDescription, alternateDescription, alternateDurationDescription], id));
  });

  return issues;
}

export function validateBundleOffer(bundle: BundleOffer, entitlements: EntitlementItem[], allBundles: BundleOffer[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = safeText(bundle.id);
  const name = safeText(bundle.name);
  const shortDescription = safeText(bundle.shortDescription);
  const description = safeText(bundle.description);
  const verseKey = safeText(bundle.verseKey);
  const durationDescription = safeText(bundle.durationDescription);
  const iconTexture = safeText(bundle.iconTexture);
  const bundleEntries = Array.isArray(bundle.items) ? bundle.items : [];
  const label = name || verseKey || id;
  const entitlementById = new Map(entitlements.map(item => [item.id, item]));

  if (!id.trim()) issues.push(issue('bundle-id-required', 'error', `${label || 'Bundle'} must have a stable record identifier.`, 'bundle_id_required', 'id', undefined, id || undefined));
  if (!validateVerseIdentifier(verseKey)) {
    issues.push(issue(`${id}-key`, 'error', 'Bundle Verse key must be a valid Verse identifier.', 'bundle_identifier', 'verseKey', undefined, id));
  }
  if (allBundles.some(other => safeText(other.id) !== id && safeText(other.verseKey).toLowerCase() === verseKey.toLowerCase()) ||
      entitlements.some(item => safeText(item.verseKey).toLowerCase() === verseKey.toLowerCase())) {
    issues.push(issue(`${id}-key-duplicate`, 'error', `Bundle Verse key "${verseKey}" conflicts with another offer.`, 'bundle_identifier_unique', 'verseKey', undefined, id));
  }
  const normalizedBundle = { ...bundle, id, name, shortDescription, description, verseKey, durationDescription, iconTexture, items: bundleEntries };
  const randomDisclosures = paidRandomDisclosuresForBundle(normalizedBundle, entitlements, allBundles).join('; ');
  issues.push(...validateTextLengths(
    id,
    label,
    name,
    shortDescription,
    description,
    durationDescription,
    randomDisclosures,
    id,
    randomDisclosures ? 'bundle_random_item_description_length' : 'description_length',
  ));
  issues.push(...validatePrice(label, id, bundle.priceVBucks, id));
  issues.push(...validateDuration(id, description, durationDescription, undefined, id));
  issues.push(...validateRestrictions(id, bundle.restrictions, 'restrictions', undefined, id));
  issues.push(...validateCompliance(id, [name, shortDescription, description, durationDescription], undefined, id));
  if (!validateTextureExpression(iconTexture.trim())) {
    issues.push(issue(`${id}-icon`, 'error', 'Bundle icon must be a dotted Verse texture expression.', 'bundle_icon_expression', 'iconTexture', undefined, id));
  }
  if (bundleEntries.length < 1) {
    issues.push(issue(`${id}-items-min`, 'error', `${label} must contain at least one entitlement offer entry.`, 'bundle_items_min', 'items', undefined, id));
  }

  const seen = new Set<string>();
  bundleEntries.forEach((entry, index) => {
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
    const quantityBehavior = bundleQuantityBehavior(bundle, entry);
    if (quantityBehavior !== 'fixed' && nestedBundle) {
      issues.push(issue(`${id}-item-${index}-dynamic-nested`, 'error', 'Runtime quantities currently support configured entitlement entries only. Keep nested bundles fixed.', 'dynamic_bundle_nested', 'items', undefined, id));
    }
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || (quantityBehavior === 'fixed' && entitlement && entry.quantity > entitlement.maxCount)) {
      const maxText = entitlement ? ` and its MaxCount (${entitlement.maxCount})` : '';
      issues.push(issue(`${id}-item-${index}-quantity`, 'error', `${label} entry ${index + 1} quantity must be a positive safe integer${maxText}. Current value: ${String(entry.quantity)}.`, 'bundle_quantity', 'items', undefined, id));
    }
  });
  if (bundle.dynamicRemaining && bundleEntries.some(entry => entry.bundleId)) {
    issues.push(issue(`${id}-dynamic-nested`, 'error', 'Dynamic remaining bundles currently support entitlement entries only.', 'dynamic_bundle_nested', 'dynamicRemaining', undefined, id));
  }
  if (bundle.dynamicRemaining && (bundleEntries.length !== 1 || !bundleEntries[0]?.entitlementId)) {
    issues.push(issue(`${id}-dynamic-shape`, 'error', 'A dynamic remaining bundle must contain exactly one entitlement entry.', 'dynamic_bundle_shape', 'items', undefined, id));
  }
  if (bundle.dynamicRemaining && bundleEntries.length === 1 && bundleEntries[0]?.entitlementId && bundleEntries[0].quantity !== 1) {
    issues.push(issue(`${id}-dynamic-quantity`, 'error', 'A dynamic remaining bundle must use quantity 1; the purchase-time remaining quantity replaces this entry quantity.', 'dynamic_bundle_quantity', 'items', undefined, id));
  }
  if (dynamicPriceEnabled(bundle.dynamicOffer) && bundle.priceVBucks < MARKETPLACE_CONSTRAINTS.priceMinVBucks) {
    issues.push(issue(`${id}-runtime-price-template`, 'error', `${label} needs a valid fallback price while its runtime price is configured.`, 'dynamic_price_template', 'priceVBucks', undefined, id));
  }
  if (isDynamicBundle(bundle) && !bundleEntries.some(entry => bundleQuantityBehavior(bundle, entry) !== 'fixed') && !dynamicPriceEnabled(bundle.dynamicOffer)) {
    issues.push(issue(`${id}-dynamic-empty`, 'error', `${label} is marked for runtime behavior but no quantity or price is configured for Verse to provide.`, 'dynamic_configuration_empty', 'dynamicOffer', undefined, id));
  }
  const depth = (candidate: BundleOffer, path: Set<string>): number | undefined => {
    if (path.has(candidate.id)) return undefined;
    const nextPath = new Set(path).add(candidate.id);
    const childDepths = (candidate.items ?? [])
      .map(entry => entry.bundleId ? allBundles.find(other => other.id === entry.bundleId) : undefined)
      .filter((child): child is BundleOffer => Boolean(child))
      .map(child => depth(child, nextPath));
    if (childDepths.some(value => value === undefined)) return undefined;
    const numericDepths = childDepths.filter((value): value is number => value !== undefined);
    return 1 + (numericDepths.length ? Math.max(...numericDepths) : 0);
  };
  const bundleDepth = depth(normalizedBundle, new Set());
  if (bundleDepth === undefined) issues.push(issue(`${id}-cycle`, 'error', 'Nested bundle references must not form a cycle.', 'bundle_cycle', 'items', undefined, id));
  else if (bundleDepth > MARKETPLACE_CONSTRAINTS.maxNestedBundleDepth) issues.push(issue(`${id}-depth`, 'error', `Nested bundles may be at most ${MARKETPLACE_CONSTRAINTS.maxNestedBundleDepth} levels deep under Epic's Marketplace rules.`, 'bundle_depth', 'items', undefined, id));
  const leafEntitlements = (candidate: BundleOffer, visited = new Set<string>()): Set<string> => {
    if (visited.has(candidate.id)) return new Set();
    const next = new Set(visited).add(candidate.id);
    const result = new Set<string>();
    for (const entry of candidate.items ?? []) {
      if (entry.entitlementId) result.add(entry.entitlementId);
      else if (entry.bundleId) {
        const nested = allBundles.find(other => other.id === entry.bundleId);
        if (nested) for (const entitlementId of leafEntitlements(nested, next)) result.add(entitlementId);
      }
    }
    return result;
  };
  if (leafEntitlements(normalizedBundle).size > MARKETPLACE_CONSTRAINTS.maxDistinctEntitlementIdentifiersPerOffer) issues.push(issue(`${id}-entitlement-identifiers`, 'error', `An offer may contain at most ${MARKETPLACE_CONSTRAINTS.maxDistinctEntitlementIdentifiersPerOffer} distinct entitlement identifiers, including nested bundles.`, 'bundle_entitlement_identifier_limit', 'items', undefined, id));
  const effectiveQuantities = (candidate: BundleOffer, multiplier = 1, visited = new Set<string>()): Map<string, number> => {
    if (visited.has(candidate.id)) return new Map();
    const next = new Set(visited).add(candidate.id);
    const result = new Map<string, number>();
    for (const entry of candidate.items ?? []) {
      if (entry.entitlementId) {
        const added = multiplier * entry.quantity;
        const nextQuantity = (result.get(entry.entitlementId) ?? 0) + added;
        result.set(entry.entitlementId, nextQuantity);
      }
      else if (entry.bundleId) {
        const nested = allBundles.find(other => other.id === entry.bundleId);
        if (nested) for (const [entitlementId, quantity] of effectiveQuantities(nested, multiplier * entry.quantity, next)) result.set(entitlementId, (result.get(entitlementId) ?? 0) + quantity);
      }
    }
    return result;
  };
  for (const [entitlementId, quantity] of effectiveQuantities(normalizedBundle)) {
    const item = entitlementById.get(entitlementId);
    if (!Number.isSafeInteger(quantity)) {
      issues.push(issue(`${id}-effective-quantity-overflow-${entitlementId}`, 'error', `${label} has an effective quantity too large for Transaction Manager to represent safely. Reduce a nested or direct bundle quantity.`, 'bundle_effective_quantity_overflow', 'items', undefined, id));
    } else if (item && quantity > item.maxCount) {
      issues.push(issue(`${id}-effective-quantity-${entitlementId}`, 'error', `Nested bundle quantity for ${item.name} exceeds its MaxCount (${item.maxCount}).`, 'bundle_effective_quantity', 'items', undefined, id));
    }
  }
  return issues;
}

export function validateOfferDisplayGroup(group: OfferDisplayGroup, entitlements: EntitlementItem[], bundles: BundleOffer[], allGroups: OfferDisplayGroup[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groupId = safeText(group.id);
  const groupVerseKey = safeText(group.verseKey);
  const groupName = safeText(group.name);
  const groupEntries = Array.isArray(group.entries) ? group.entries : [];
  if (!groupId.trim()) issues.push(issue('storefront-id-required', 'error', `${groupName || 'Storefront'} must have a stable record identifier.`, 'offer_display_id_required', 'id'));
  if (!validateVerseIdentifier(groupVerseKey)) issues.push(issue(`${groupId}-key`, 'error', 'Offer display Verse key must be a valid Verse identifier.', 'offer_display_identifier', 'verseKey'));
  if (allGroups.some(candidate => safeText(candidate.id) !== groupId && safeText(candidate.verseKey).toLowerCase() === groupVerseKey.toLowerCase())) issues.push(issue(`${groupId}-key-duplicate`, 'error', `Offer display Verse key "${groupVerseKey}" is already used.`, 'offer_display_identifier_unique', 'verseKey'));
  if (!groupName.trim()) issues.push(issue(`${groupId}-name-required`, 'error', 'Storefront title is required.', 'offer_display_name', 'name'));
  if (characterCount(groupName) > MARKETPLACE_CONSTRAINTS.nameMaxCharacters) issues.push(issue(`${groupId}-name-length`, 'error', `Storefront title is ${characterCount(groupName)} characters, which exceeds the generated Verse title limit of ${MARKETPLACE_CONSTRAINTS.nameMaxCharacters}.`, 'offer_display_name', 'name'));
  if (groupEntries.length === 0) issues.push(issue(`${groupId}-entries-min`, 'warning', 'This storefront is empty and will show no offers until membership is configured.', 'offer_display_entries_min', 'entries'));
  const seen = new Set<string>();
  for (const [index, entry] of groupEntries.entries()) {
    const item = entry.entitlementId ? entitlements.find(candidate => candidate.id === entry.entitlementId) : undefined;
    const bundle = entry.bundleId ? bundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if ((!item && !bundle) || Boolean(item) === Boolean(bundle)) {
      issues.push(issue(`${groupId}-entry-${index}-missing`, 'error', 'Offer display entries must reference exactly one existing entitlement offer or bundle.', 'offer_display_reference_exists', 'entries'));
      continue;
    }
    if (bundle && isDynamicBundle(bundle)) {
      issues.push(issue(`${groupId}-entry-${index}-dynamic`, 'error', 'Runtime-configured bundles are direct-purchase-only because a fixed storefront cannot supply per-player values.', 'dynamic_bundle_storefront_unsupported', 'entries', undefined, groupId));
    }
    if (item && entry.offerVerseKey && entry.offerVerseKey.toLowerCase() !== item.verseKey.toLowerCase() && !(item.alternateOffers ?? []).some(offer => offer.verseKey.toLowerCase() === entry.offerVerseKey!.toLowerCase() || offer.id.toLowerCase() === entry.offerVerseKey!.toLowerCase())) {
      issues.push(issue(`${groupId}-entry-${index}-variant`, 'error', 'Offer display variant does not exist on the referenced entitlement.', 'offer_display_variant_exists', 'entries'));
    }
    const key = bundle ? `bundle:${bundle.id}` : `entitlement:${item!.id}:${entry.offerVerseKey?.toLowerCase() ?? item!.verseKey.toLowerCase()}`;
    if (seen.has(key)) issues.push(issue(`${groupId}-entry-${index}-duplicate`, 'error', 'Offer displays cannot contain the same offer more than once.', 'offer_display_reference_unique', 'entries'));
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
    if (resolved.kind === 'bundle' && isDynamicBundle(resolved.bundle)) {
      issues.push(issue(`storefront-${label}-${index}-dynamic`, 'error', 'Runtime-configured bundles are direct-purchase-only and cannot be included in a fixed storefront.', 'dynamic_bundle_storefront_unsupported', 'entries', undefined, resolved.bundle.id));
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
    'MarketplaceUIInFlight', 'EnableDebugLogging', 'UEMLogger', 'AllOffersStoreTitle', 'OnBegin', 'OnEnd', 'SubscribeToPlayer',
    'UnsubscribeFromPlayer', 'OnPlayerAdded', 'OnPlayerRemoved', 'TrackSubscription', 'CancelAllSubscriptions',
    'TryAcquireMarketplaceUI', 'ReleaseMarketplaceUI', 'ExecutePurchase', 'ExecuteStorefront', 'ShowAllOffers', 'OpenAllOffersStore',
    'LogDebug', 'LogWarning', 'LogError',
  ].forEach(name => memberOwners.set(name.toLowerCase(), 'generator'));
  memberOwners.set('alloffersstoretitle', 'generator');
  entitlements.forEach(item => {
    const pascal = toPascalCase(item.verseKey);
    const editableNames = entitlementEditableNames(item.verseKey);
    registerMember(`${pascal}_GrantedSignal`, item, 'verseKey');
    registerMember(`${pascal}_RemovedSignal`, item, 'verseKey');
    registerMember(`${pascal}_ReconciledSignal`, item, 'verseKey');
    registerMember(`Await${pascal}GrantedEvent`, item, 'verseKey');
    registerMember(`Await${pascal}RemovedEvent`, item, 'verseKey');
    registerMember(`Await${pascal}ReconciledEvent`, item, 'verseKey');
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

  const stableRecordOwners = new Map<string, string>();
  const registerStableRecord = (recordId: string, owner: string, field: string, entitlementId?: string, bundleId?: string) => {
    const normalized = safeText(recordId).toLowerCase();
    const previous = stableRecordOwners.get(normalized);
    if (previous && previous !== owner) {
      issues.push(issue(`record-id-${normalized}-${owner}`, 'error', `Stable record identifier "${recordId}" is used by both ${previous} and ${owner}. Give each project object a unique identifier.`, 'stable_record_identifier_unique', field, entitlementId, bundleId));
    } else {
      stableRecordOwners.set(normalized, owner);
    }
  };
  entitlements.forEach(item => {
    registerStableRecord(item.id, `entitlement "${item.name || item.verseKey}"`, 'id', item.id);
    (item.alternateOffers ?? []).forEach((offer, index) => registerStableRecord(offer.id, `alternate offer ${index + 1} of "${item.name || item.verseKey}"`, `alternateOffers.${index}.id`, item.id));
  });
  bundles.forEach(bundle => registerStableRecord(bundle.id, `bundle "${bundle.name || bundle.verseKey}"`, 'id', undefined, bundle.id));
  storefrontMembership.focused.forEach(group => registerStableRecord(group.id, `storefront "${group.name || group.verseKey}"`, 'id'));
  return issues;
}
