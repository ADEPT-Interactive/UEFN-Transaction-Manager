import { BundleOffer, BundleOfferItem, BundleQuantityBehavior, DynamicOfferConfig, EntitlementItem } from '../types/entitlement';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';

export type RuntimeOfferValue = number;

export type CanonicalBundleMode = 'static' | 'fill-to-max' | 'runtime' | 'invalid';

export interface BundleBehavior {
  mode: CanonicalBundleMode;
  valid: boolean;
  reason?: string;
  fillToMaxEntry?: BundleOfferItem;
  runtimeEntries: BundleOfferItem[];
}

export function dynamicPriceEnabled(value: DynamicOfferConfig | undefined): boolean {
  return value?.priceBehavior === 'runtime';
}

export function bundleQuantityBehavior(bundle: BundleOffer, entry: BundleOfferItem): 'fixed' | BundleQuantityBehavior {
  if (entry.quantityBehavior) return entry.quantityBehavior;
  return bundle.dynamicRemaining ? 'fill-to-max' : 'fixed';
}

/**
 * Resolve legacy dynamicRemaining and the current per-entry representation
 * into one semantic mode. Fill-to-max is deliberately a single-entitlement
 * mode; mixed or multi-entry shapes remain visible as invalid instead of
 * being silently skipped by the generator.
 */
export function getBundleBehavior(bundle: BundleOffer): BundleBehavior {
  const effectiveEntries = bundle.items.map(entry => ({ entry, behavior: bundleQuantityBehavior(bundle, entry) }));
  const fillEntries = effectiveEntries.filter(candidate => candidate.behavior === 'fill-to-max');
  const runtimeEntries = effectiveEntries
    .filter(candidate => candidate.behavior === 'runtime')
    .map(candidate => candidate.entry);
  const hasLegacyFill = bundle.dynamicRemaining === true;
  const hasFill = hasLegacyFill || fillEntries.length > 0;
  const hasRuntimePrice = dynamicPriceEnabled(bundle.dynamicOffer);

  if (hasFill) {
    const fillEntry = fillEntries.length === 1 ? fillEntries[0].entry : undefined;
    const valid = !hasRuntimePrice
      && runtimeEntries.length === 0
      && fillEntries.length === 1
      && bundle.items.length === 1
      && Boolean(fillEntry?.entitlementId)
      && !fillEntry?.bundleId
      && fillEntry?.quantity === 1;
    return {
      mode: valid ? 'fill-to-max' : 'invalid',
      valid,
      reason: valid ? undefined : 'Fill-to-max requires exactly one entitlement entry with quantity 1 and no runtime price or runtime quantity.',
      fillToMaxEntry: fillEntry,
      runtimeEntries,
    };
  }

  if (hasRuntimePrice || runtimeEntries.length > 0) {
    return { mode: 'runtime', valid: true, runtimeEntries };
  }

  return { mode: 'static', valid: true, runtimeEntries: [] };
}

export function hasRuntimeBundleBehavior(bundle: BundleOffer): boolean {
  return getBundleBehavior(bundle).mode !== 'static';
}

export function isDynamicBundle(bundle: BundleOffer): boolean {
  return hasRuntimeBundleBehavior(bundle);
}

export function validateRuntimePrice(value: RuntimeOfferValue): string | undefined {
  if (!Number.isSafeInteger(value)) return 'Price must be a whole number of V-Bucks.';
  if (value < MARKETPLACE_CONSTRAINTS.priceMinVBucks || value > MARKETPLACE_CONSTRAINTS.priceMaxVBucks) {
    return `Price must be between ${MARKETPLACE_CONSTRAINTS.priceMinVBucks} and ${MARKETPLACE_CONSTRAINTS.priceMaxVBucks} V-Bucks.`;
  }
  if (value % MARKETPLACE_CONSTRAINTS.priceStepVBucks !== 0) return `Price must use increments of ${MARKETPLACE_CONSTRAINTS.priceStepVBucks} V-Bucks.`;
  return undefined;
}

export function validateRuntimeQuantity(value: number, maximum: number): string | undefined {
  if (!Number.isSafeInteger(value) || value <= 0) return 'Runtime quantity must be a positive whole number.';
  if (value > maximum) return `Runtime quantity cannot exceed the configured maximum of ${maximum.toLocaleString()}.`;
  return undefined;
}

export function validateRuntimeBundleQuantities(
  bundle: BundleOffer,
  entitlements: EntitlementItem[],
  quantities: Record<string, number>,
): string[] {
  const behavior = getBundleBehavior(bundle);
  if (behavior.mode === 'invalid') return [behavior.reason ?? 'Bundle quantity behavior is invalid.'];
  if (behavior.mode === 'fill-to-max') return [];
  const errors: string[] = [];
  let included = 0;
  for (const entry of bundle.items) {
    const behavior = bundleQuantityBehavior(bundle, entry);
    if (behavior === 'fixed') {
      if (entry.quantity > 0) included += 1;
      continue;
    }
    const key = entry.entitlementId ?? entry.bundleId ?? '';
    const quantity = quantities[key];
    if (quantity === undefined) {
      errors.push(`A runtime quantity is required for ${key || 'every dynamic bundle entry'}.`);
      continue;
    }
    const maximum = entry.entitlementId
      ? entitlements.find(item => item.id === entry.entitlementId)?.maxCount ?? 0
      : Number.MAX_SAFE_INTEGER;
    const error = validateRuntimeQuantity(quantity, maximum);
    if (error) errors.push(`${key}: ${error}`);
    else included += 1;
  }
  if (included === 0) errors.push('A runtime bundle must contain at least one positive-quantity entry.');
  return errors;
}
