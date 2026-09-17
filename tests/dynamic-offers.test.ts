import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanManagedData, parseManagedData } from '../src/services/projectSchema';
import { bundleQuantityBehavior, getBundleBehavior, validateRuntimeBundleQuantities, validateRuntimePrice } from '../src/services/dynamicOffers';
import { MARKETPLACE_CONSTRAINTS } from '../src/constants/marketplaceValidation';
import { generateVerseCode } from '../src/services/verseGenerator';
import { publicApiConfig, publicApiItems } from './public-api-fixture';

test('legacy dynamicRemaining migrates to canonical runtime behavior on save', () => {
  const parsed = parseManagedData({ schemaVersion: 4, entitlements: publicApiItems, bundles: [{
    id: 'legacy', verseKey: 'legacy_bundle', name: 'Legacy', shortDescription: 'Legacy', description: 'Legacy', priceVBucks: 100,
    iconTexture: 'EntitlementIcons.Legacy', dynamicRemaining: true, items: [{ entitlementId: 'coins', quantity: 1 }],
  }] });
  const legacy = parsed.bundles[0];
  assert.equal(bundleQuantityBehavior(legacy, legacy.items[0]), 'fill-to-max');
  const clean = cleanManagedData(parsed.entitlements, parsed.bundles);
  assert.equal('dynamicRemaining' in clean.bundles[0], false);
  assert.equal(clean.bundles[0].items[0].quantityBehavior, 'fill-to-max');
});

test('fill-to-max is a single-entitlement mode and invalid mixed shapes remain diagnosable', () => {
  const valid = {
    id: 'fill', verseKey: 'fill_bundle', name: 'Fill', shortDescription: 'Fill', description: 'Fill', priceVBucks: 100,
    iconTexture: 'EntitlementIcons.Fill',
    items: [{ entitlementId: 'coins', quantity: 1, quantityBehavior: 'fill-to-max' as const }],
  };
  assert.equal(getBundleBehavior(valid).mode, 'fill-to-max');
  assert.deepEqual(validateRuntimeBundleQuantities(valid, publicApiItems, {}), []);

  const mixed = {
    ...valid,
    id: 'mixed',
    verseKey: 'mixed_bundle',
    items: [
      { entitlementId: 'coins', quantity: 1, quantityBehavior: 'fill-to-max' as const },
      { entitlementId: 'access', quantity: 1 },
    ],
  };
  const behavior = getBundleBehavior(mixed);
  assert.equal(behavior.mode, 'invalid');
  assert.match(behavior.reason ?? '', /exactly one entitlement/i);
  assert.match(validateRuntimeBundleQuantities(mixed, publicApiItems, {}).join(' '), /exactly one entitlement/i);
  const clean = cleanManagedData(publicApiItems, [mixed]).bundles[0];
  assert.equal(clean.items.length, 2);
  assert.equal(clean.items[0].quantityBehavior, 'fill-to-max');
});

test('runtime bundle validation rejects invalid price and empty/oversized quantities', () => {
  assert.match(validateRuntimePrice(125)!, /increments/);
  assert.equal(validateRuntimePrice(250), undefined);
  const bundle = {
    id: 'runtime', verseKey: 'runtime_bundle', name: 'Runtime', shortDescription: 'Runtime', description: 'Runtime', priceVBucks: 250,
    iconTexture: 'EntitlementIcons.Runtime', dynamicOffer: { priceBehavior: 'runtime' as const },
    items: [{ entitlementId: 'coins', quantity: 1, quantityBehavior: 'runtime' as const }],
  };
  assert.match(validateRuntimeBundleQuantities(bundle, publicApiItems, { coins: 0 }).join(' '), /positive/);
  assert.match(validateRuntimeBundleQuantities(bundle, publicApiItems, { coins: 26 }).join(' '), /maximum/);
  assert.deepEqual(validateRuntimeBundleQuantities(bundle, publicApiItems, { coins: 5 }), []);
});

test('runtime price validation covers every hostile boundary and non-finite input', () => {
  const expectedValid = new Set([50, 100, 150, 4950, 5000]);
  for (const value of [0, 49, 50, 51, 99, 100, 150, 275, 4950, 5000, 5001, 5050, 49.5, 50.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const error = validateRuntimePrice(value);
    if (expectedValid.has(value)) assert.equal(error, undefined, `expected ${value} to be valid`);
    else assert.ok(error, `expected ${String(value)} to be rejected`);
  }
});

test('generated runtime bundles expose a stable options type, factory, and purchase helper', () => {
  const source = generateVerseCode(publicApiItems, [{
    id: 'runtime', verseKey: 'runtime_bundle', name: 'Runtime Bundle', shortDescription: 'Runtime bundle', description: 'A runtime bundle.', priceVBucks: 500,
    iconTexture: 'EntitlementIcons.RuntimeBundle', dynamicOffer: { priceBehavior: 'runtime' },
    items: [
      { entitlementId: 'coins', quantity: 1, quantityBehavior: 'runtime' },
      { entitlementId: 'random', quantity: 1, quantityBehavior: 'runtime' },
    ],
  }], publicApiConfig);
  assert.match(source, /RuntimeBundleRuntimeOptions<public> := struct:/);
  assert.match(source, /MakeRuntimeBundleDynamicOffer<public>\(Options:RuntimeBundleRuntimeOptions\)<transacts>:\?offer/);
  assert.match(source, /OpenRuntimeBundlePurchase<public>\(Player:player, Options:Phase4PublicApiOffers\.RuntimeBundleRuntimeOptions\):void/);
  assert.match(source, /RuntimeOffers\.Length = 0/);
  assert.match(source, /Options\.CoinPackQuantity > 0/);
  assert.doesNotMatch(source, /runtime_bundle_offer<public> := class\(bundle_offer\):/);
});

test('runtime direct offers use one exact shared validator for primary and alternate variants', () => {
  const source = generateVerseCode([{
    ...publicApiItems[0],
    dynamicOffer: { priceBehavior: 'runtime' },
    alternateOffers: [{
      id: 'runtime-alt', verseKey: 'coins_alt', name: 'Coins Alternate', shortDescription: 'Alternate', description: 'Alternate',
      priceVBucks: 300, iconTexture: 'EntitlementIcons.CoinsAlt', restrictions: { blockedCountryCodes: [], blockedPlatformFamilies: [] },
      dynamicOffer: { priceBehavior: 'runtime' },
    }],
  }], [], publicApiConfig);
  assert.match(source, /AccessPassRuntimeOptions<public> := struct:/);
  assert.match(source, /MakeAccessPassDynamicOffer<public>\(Options:AccessPassRuntimeOptions\)<transacts>:\?offer/);
  assert.match(source, /OpenAccessPassPurchase<public>\(Player:player, Options:Phase4PublicApiOffers\.AccessPassRuntimeOptions\):void/);
  assert.match(source, /CoinsAltRuntimeOptions<public> := struct:/);
  assert.match(source, /OpenCoinsAltPurchase<public>\(Player:player, Options:Phase4PublicApiOffers\.CoinsAltRuntimeOptions\):void/);
  const validationMatches = [...source.matchAll(/IsValidRuntimePrice<public>\(PriceVBucks:float\)<transacts>:logic =([\s\S]*?)\n\s+false\n/g)];
  assert.equal(validationMatches.length, 1, 'runtime price validation should be emitted exactly once per generated catalog');
  const validationMatch = validationMatches[0];
  const allowedValues = [...validationMatch[1].matchAll(/PriceVBucks = (\d+)\.0/g)].map(match => Number(match[1]));
  assert.equal(allowedValues.length, 100);
  assert.equal(allowedValues[0], MARKETPLACE_CONSTRAINTS.priceMinVBucks);
  assert.equal(allowedValues.at(-1), MARKETPLACE_CONSTRAINTS.priceMaxVBucks);
  assert.deepEqual(allowedValues, Array.from({ length: allowedValues.length }, (_, index) => MARKETPLACE_CONSTRAINTS.priceMinVBucks + index * MARKETPLACE_CONSTRAINTS.priceStepVBucks));
  let depth = 0;
  let maxDepth = 0;
  for (const character of validationMatch[1]) {
    if (character === '(') maxDepth = Math.max(maxDepth, ++depth);
    if (character === ')') depth -= 1;
  }
  assert.ok(maxDepth <= 8, `balanced runtime price expression should stay shallow (got ${maxDepth})`);
  assert.doesNotMatch(source, /\bvar\s+RuntimePrice\b|\bRuntimePrice<override>/);
  assert.match(source, /if \(IsValidRuntimePrice\(Options\.PriceVBucks\) = false\):/);
  assert.doesNotMatch(source, /IsValid[A-Za-z0-9]+RuntimePrice/);
});

test('runtime bundle generation preserves quantity-only and fill-to-max behavior', () => {
  const source = generateVerseCode(publicApiItems, [{
    id: 'quantity-only', verseKey: 'quantity_only', name: 'Quantity Only', shortDescription: 'Runtime quantity', description: 'Runtime quantity bundle.', priceVBucks: 500,
    iconTexture: 'EntitlementIcons.QuantityOnly',
    items: [{ entitlementId: publicApiItems[0].id, quantity: 1, quantityBehavior: 'runtime' }],
  }, {
    id: 'fill-max', verseKey: 'fill_max', name: 'Fill Max', shortDescription: 'Fill maximum', description: 'Fill-to-max bundle.', priceVBucks: 500,
    iconTexture: 'EntitlementIcons.FillMax',
    items: [{ entitlementId: publicApiItems[0].id, quantity: 1, quantityBehavior: 'fill-to-max' }],
  }], publicApiConfig);
  assert.match(source, /QuantityOnlyRuntimeOptions<public> := struct:\n        AccessPassQuantity:int/);
  assert.match(source, /MakeQuantityOnlyDynamicOffer<public>\(Options:QuantityOnlyRuntimeOptions\)<transacts>:\?offer/);
  assert.match(source, /if \(Options\.AccessPassQuantity > 0\):/);
  assert.doesNotMatch(source, /FillMaxRuntimeOptions<public>/);
  assert.match(source, /fill_max_offer<public> := class\(bundle_offer\)/);
  assert.match(source, /Offers<override>:\[\]tuple\(offer, int\) = array\{\(access_pass_offer\{\}, 1\)\}/);
});
