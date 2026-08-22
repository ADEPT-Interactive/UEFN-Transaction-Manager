import { BundleOffer, BundleOfferItem, BundleQuantityBehavior, DynamicOfferConfig, EntitlementItem } from '../types/entitlement';
import { MARKETPLACE_CONSTRAINTS } from '../constants/marketplaceValidation';

export type RuntimeOfferValue = number;

export function dynamicPriceEnabled(value: DynamicOfferConfig | undefined): boolean {
  return value?.priceBehavior === 'runtime';
}

export function bundleQuantityBehavior(bundle: BundleOffer, entry: BundleOfferItem): 'fixed' | BundleQuantityBehavior {
  if (entry.quantityBehavior) return entry.quantityBehavior;
  return bundle.dynamicRemaining ? 'fill-to-max' : 'fixed';
}

export function hasRuntimeBundleBehavior(bundle: BundleOffer): boolean {
  return Boolean(bundle.dynamicRemaining || dynamicPriceEnabled(bundle.dynamicOffer)
    || bundle.items.some(entry => Boolean(entry.quantityBehavior)));
}

export function isDynamicBundle(bundle: BundleOffer): boolean {
  return hasRuntimeBundleBehavior(bundle);
}

export function validateRuntimePrice(value: RuntimeOfferValue): string | undefined {
  if (!Number.isSafeInteger(value)) return 'Price must be a whole number of V-Bucks.';
  if (value < MARKETPLACE_CONSTRAINTS.priceMinVBucks || value > MARKETPLACE_CONSTRAINTS.priceMaxVBucks) {
    return `Price must be between ${MARKETPLACE_CONSTRAINTS.priceMinVBucks} and ${MARKETPLACE_CONSTRAINTS.priceMaxVBucks} V-Bucks.`;
  }
  if (value % MARKETPLACE_CONSTRAINTS.priceStepVBucks !== 0) return `Price must use ${MARKETPLACE_CONSTRAINTS.priceStepVBucks}-V-Buck increments.`;
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
