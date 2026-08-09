import { EntitlementItem, BundleOffer, ValidationIssue } from '../types/entitlement';

export function validateVerseIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

export function sanitizeVerseIdentifier(input: string): string {
  let clean = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  clean = clean.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (/^[0-9]/.test(clean)) {
    clean = 'item_' + clean;
  }
  return clean || 'item';
}

export function validateEntitlement(
  item: EntitlementItem, 
  allOtherItems: EntitlementItem[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Verse Identifier Validation
  if (!item.verseKey || !item.verseKey.trim()) {
    issues.push({
      id: `${item.id}-missing-key`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Verse identifier symbol is required.',
      field: 'verseKey',
      ruleName: 'identifier_required',
    });
  } else if (!validateVerseIdentifier(item.verseKey)) {
    issues.push({
      id: `${item.id}-invalid-key`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Verse identifier must contain only letters, numbers, and underscores, and cannot start with a number.',
      field: 'verseKey',
      ruleName: 'identifier_format',
    });
  } else {
    const isDuplicate = allOtherItems.some(
      other => other.id !== item.id && other.verseKey.toLowerCase() === item.verseKey.toLowerCase()
    );
    if (isDuplicate) {
      issues.push({
        id: `${item.id}-duplicate-key`,
        entitlementId: item.id,
        severity: 'error',
        message: `Duplicate Verse identifier "${item.verseKey}". Each entitlement must have a unique key.`,
        field: 'verseKey',
        ruleName: 'identifier_unique',
      });
    }
  }

  // 2. Display Name & Descriptions
  if (!item.name || !item.name.trim()) {
    issues.push({
      id: `${item.id}-missing-name`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Display Name is required for storefront presentation.',
      field: 'name',
      ruleName: 'name_required',
    });
  }

  if (!item.shortDescription || !item.shortDescription.trim()) {
    issues.push({
      id: `${item.id}-missing-short-desc`,
      entitlementId: item.id,
      severity: 'warning',
      message: 'Short Description is strongly recommended for in-game offer cards.',
      field: 'shortDescription',
      ruleName: 'short_description_recommended',
    });
  }

  // 3. V-Bucks Price Validation (UEFN Requirement: 50-5000, step 50)
  if (item.priceVBucks < 50 || item.priceVBucks > 5000) {
    issues.push({
      id: `${item.id}-price-range`,
      entitlementId: item.id,
      severity: 'error',
      message: `Price (${item.priceVBucks} V-Bucks) is outside allowed range. Fortnite In-Island Transactions require 50 to 5,000 V-Bucks.`,
      field: 'priceVBucks',
      ruleName: 'price_bounds',
    });
  } else if (item.priceVBucks % 50 !== 0) {
    issues.push({
      id: `${item.id}-price-step`,
      entitlementId: item.id,
      severity: 'error',
      message: `Price (${item.priceVBucks} V-Bucks) must be an exact multiple of 50 (e.g., 50, 100, 150, 200...).`,
      field: 'priceVBucks',
      ruleName: 'price_step_50',
    });
  }

  // 4. Durable vs Consumable Constraints
  if (item.itemType === 'durable' && item.maxCount !== 1) {
    issues.push({
      id: `${item.id}-durable-maxcount`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Durable entitlements must have MaxCount set to 1. UEFN does not permit MaxCount > 1 for durable items.',
      field: 'maxCount',
      ruleName: 'durable_maxcount_one',
    });
  }

  if (item.itemType === 'consumable' && item.maxCount < 1) {
    issues.push({
      id: `${item.id}-consumable-maxcount`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Consumable entitlements must allow at least 1 item in MaxCount.',
      field: 'maxCount',
      ruleName: 'consumable_maxcount_min',
    });
  }

  // 5. Icon Texture Reference
  if (!item.iconTexture || !item.iconTexture.trim()) {
    issues.push({
      id: `${item.id}-missing-icon`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Icon texture reference is required. Concrete entitlement classes must define an Icon texture.',
      field: 'iconTexture',
      ruleName: 'icon_required',
    });
  }

  // 6. Moderation & PaidRandomItem Compliance
  if (item.flags.paidRandomItem && (!item.flags.paidRandomItemOdds || !item.flags.paidRandomItemOdds.trim())) {
    issues.push({
      id: `${item.id}-missing-odds`,
      entitlementId: item.id,
      severity: 'error',
      message: 'Epic Games moderation rules require explicit numerical odds disclosure for all Paid Random Items (loot crates / RNG pulls).',
      field: 'flags.paidRandomItemOdds',
      ruleName: 'random_item_odds_disclosure',
    });
  }

  // 7. Age & Region Gating
  if (item.ageAndRegion.enabled && (item.ageAndRegion.minAge < 0 || item.ageAndRegion.minAge > 100)) {
    issues.push({
      id: `${item.id}-invalid-age`,
      entitlementId: item.id,
      severity: 'warning',
      message: 'Minimum purchase age is outside realistic range (0-100).',
      field: 'ageAndRegion.minAge',
      ruleName: 'min_age_range',
    });
  }

  return issues;
}

export function validateBundleOffer(
  bundle: BundleOffer,
  entitlements: EntitlementItem[],
  allBundles: BundleOffer[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!bundle.verseKey || !bundle.verseKey.trim() || !validateVerseIdentifier(bundle.verseKey)) {
    issues.push({
      id: `${bundle.id}-invalid-key`,
      severity: 'error',
      message: 'Bundle offer must have a valid Verse identifier.',
      field: 'verseKey',
      ruleName: 'bundle_identifier',
    });
  }

  if (bundle.priceVBucks < 50 || bundle.priceVBucks > 5000 || bundle.priceVBucks % 50 !== 0) {
    issues.push({
      id: `${bundle.id}-invalid-price`,
      severity: 'error',
      message: 'Bundle price must be between 50 and 5,000 V-Bucks in increments of 50.',
      field: 'priceVBucks',
      ruleName: 'bundle_price',
    });
  }

  if (!bundle.items || bundle.items.length === 0) {
    issues.push({
      id: `${bundle.id}-empty-items`,
      severity: 'error',
      message: 'Bundle offer must contain at least one item.',
      field: 'items',
      ruleName: 'bundle_items_min',
    });
  }

  return issues;
}

export function validateEntireProject(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[] = []
): ValidationIssue[] {
  let allIssues: ValidationIssue[] = [];

  for (const item of entitlements) {
    allIssues = allIssues.concat(validateEntitlement(item, entitlements));
  }

  for (const bundle of bundles) {
    allIssues = allIssues.concat(validateBundleOffer(bundle, entitlements, bundles));
  }

  return allIssues;
}
