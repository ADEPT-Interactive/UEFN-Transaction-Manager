import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanManagedData, parseManagedData } from '../src/services/projectSchema';
import { bundleQuantityBehavior, validateRuntimeBundleQuantities, validateRuntimePrice } from '../src/services/dynamicOffers';
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
  assert.match(source, /MakeRuntimeBundleDynamicOffer<public>\(Options:RuntimeBundleRuntimeOptions\):\?offer/);
  assert.match(source, /OpenRuntimeBundlePurchase<public>\(Player:player, Options:RuntimeBundleRuntimeOptions\):void/);
  assert.match(source, /RuntimeOffers\.Length = 0/);
  assert.match(source, /Options\.CoinsQuantity > 0/);
  assert.doesNotMatch(source, /runtime_bundle_offer<public> := class\(bundle_offer\):/);
});

test('runtime direct offers expose typed pricing for primary and alternate variants', () => {
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
  assert.match(source, /MakeAccessPassDynamicOffer<public>\(Options:AccessPassRuntimeOptions\):\?offer/);
  assert.match(source, /OpenAccessPassPurchase<public>\(Player:player, Options:AccessPassRuntimeOptions\):void/);
  assert.match(source, /CoinsAltRuntimeOptions<public> := struct:/);
  assert.match(source, /OpenCoinsAltPurchase<public>\(Player:player, Options:CoinsAltRuntimeOptions\):void/);
  assert.match(source, /PriceVBucks = 50\.0 or PriceVBucks = 100\.0/);
});
