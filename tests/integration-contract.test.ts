import assert from 'node:assert/strict';
import test from 'node:test';
import { describeIntegrationContract } from '../src/services/integrationContract';
import { defaultProjectConfig } from '../src/services/catalogSession';
import { generateVerseCode } from '../src/services/verseGenerator';
import { normalizeEntitlement, normalizeBundle } from '../src/services/projectSchema';

test('integration contract is derived from generator naming for static, alternate, bundle, storefront, and runtime objects', () => {
  const config = defaultProjectConfig('C:/Demo/Content');
  const entitlement = normalizeEntitlement({ id: 'ent-1', verseKey: 'season_pass', name: 'Season Pass', shortDescription: 'Pass', description: 'Pass', itemType: 'durable', alternateOffers: [{ id: 'alt-1', verseKey: 'season_pass_discount', name: 'Discount', shortDescription: 'Discount', description: 'Discount' }] }, 0);
  const consumable = normalizeEntitlement({ id: 'ent-2', verseKey: 'coins', name: 'Coins', shortDescription: 'Coins', description: 'Coins', itemType: 'consumable', dynamicOffer: { priceBehavior: 'runtime' } }, 1);
  const bundle = normalizeBundle({ id: 'bundle-1', verseKey: 'starter_pack', name: 'Starter Pack', shortDescription: 'Pack', description: 'Pack', items: [{ entitlementId: entitlement.id, quantity: 1 }] }, 0);
  const runtimeBundle = normalizeBundle({ id: 'bundle-2', verseKey: 'runtime_pack', name: 'Runtime Pack', shortDescription: 'Pack', description: 'Pack', dynamicOffer: { priceBehavior: 'runtime' }, items: [{ entitlementId: consumable.id, quantity: 1, quantityBehavior: 'runtime' }] }, 1);
  const storefrontMembership = { allOffers: [{ entitlementId: entitlement.id }, { bundleId: bundle.id }], focused: [{ id: 'store-1', verseKey: 'featured', name: 'Featured', entries: [{ entitlementId: entitlement.id, offerVerseKey: 'season_pass_discount' }], generateTriggerBinding: true }] };
  const contract = describeIntegrationContract(config, [entitlement, consumable], [bundle, runtimeBundle], storefrontMembership, '4.3.0');
  const verse = generateVerseCode([entitlement, consumable], [bundle, runtimeBundle], config, storefrontMembership, []);
  assert.equal(contract.generatorVersion, '4.3.0');
  assert.equal(contract.managedVerseFile, 'managed_transactions.verse');
  assert.ok(contract.entitlements.some(item => item.primaryPurchaseHelper?.name === 'OpenSeasonPassPurchase'));
  const coinsContract = contract.entitlements.find(item => item.stableId === 'ent-2');
  assert.equal((coinsContract?.awaitEvents as { consumed?: string }).consumed, 'AwaitCoinsConsumedEvent');
  assert.equal((coinsContract?.editableFields as { successTriggers?: string }).successTriggers, 'Coins_SuccessTriggers');
  assert.equal((contract.entitlements.find(item => item.stableId === 'ent-1')?.awaitEvents as { consumed?: string }).consumed, undefined);
  assert.ok(contract.alternateOffers.some(item => item.purchaseHelper === 'OpenSeasonPassDiscountPurchase'));
  assert.ok(contract.bundles.some(item => item.purchaseHelper === 'OpenStarterPackPurchase'));
  assert.ok(contract.bundles.some(item => item.runtimeOptionsType === 'RuntimePackRuntimeOptions'));
  assert.ok(contract.storefronts.some(item => item.openHelper === 'OpenFeatured'));
  for (const item of contract.entitlements) {
    const purchase = (item.primaryPurchaseHelper as { name: string }).name;
    assert.match(verse, new RegExp(purchase));
    assert.match(verse, new RegExp(String(item.ownershipHelper)));
    assert.match(verse, new RegExp(String(item.countHelper)));
    assert.match(verse, new RegExp(String(item.grantHelper)));
  }
  assert.match(verse, /MakeCoinsDynamicOffer/);
  assert.match(verse, /RuntimePackRuntimeOptions/);
  assert.match(verse, /CoinsQuantity:int/);
  assert.doesNotMatch(verse, /Ent-2Quantity:int/);
});
