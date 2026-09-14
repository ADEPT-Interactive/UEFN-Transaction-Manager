import assert from 'node:assert/strict';
import test from 'node:test';
import { describeIntegrationContract } from '../src/services/integrationContract';
import { defaultProjectConfig } from '../src/services/catalogSession';
import { generateVerseCode } from '../src/services/verseGenerator';
import { normalizeEntitlement, normalizeBundle } from '../src/services/projectSchema';

test('integration contract is derived from generator naming for static, alternate, bundle, storefront, and runtime objects', () => {
  const config = defaultProjectConfig('C:/Demo/Content');
  const entitlement = normalizeEntitlement({ id: 'ent-1', verseKey: 'season_pass', name: 'Season Pass', shortDescription: 'Pass', description: 'Pass', itemType: 'durable', alternateOffers: [{ id: 'alt-1', verseKey: 'season_pass_discount', name: 'Discount', shortDescription: 'Discount', description: 'Discount', priceVBucks: 200, dynamicOffer: { priceBehavior: 'runtime' } }] }, 0);
  const consumable = normalizeEntitlement({ id: 'ent-2', verseKey: 'coins', name: 'Coins', shortDescription: 'Coins', description: 'Coins', itemType: 'consumable', dynamicOffer: { priceBehavior: 'runtime' } }, 1);
  const bundle = normalizeBundle({ id: 'bundle-1', verseKey: 'starter_pack', name: 'Starter Pack', shortDescription: 'Pack', description: 'Pack', items: [{ entitlementId: entitlement.id, quantity: 1 }] }, 0);
  const runtimeBundle = normalizeBundle({ id: 'bundle-2', verseKey: 'runtime_pack', name: 'Runtime Pack', shortDescription: 'Pack', description: 'Pack', dynamicOffer: { priceBehavior: 'runtime' }, items: [{ entitlementId: consumable.id, quantity: 1, quantityBehavior: 'runtime' }] }, 1);
  const storefrontMembership = { allOffers: [{ entitlementId: entitlement.id }, { bundleId: bundle.id }], focused: [{ id: 'store-1', verseKey: 'featured', name: 'Featured', entries: [{ entitlementId: entitlement.id, offerVerseKey: 'season_pass_discount' }], generateTriggerBinding: true }] };
  const contract = describeIntegrationContract(config, [entitlement, consumable], [bundle, runtimeBundle], storefrontMembership, '4.3.0');
  const verse = generateVerseCode([entitlement, consumable], [bundle, runtimeBundle], config, storefrontMembership, []);
  assert.equal(contract.generatorVersion, '4.3.0');
  assert.equal(contract.managedVerseFile, 'managed_transactions.verse');
  assert.ok(contract.entitlements.some(item => item.primaryPurchaseHelper?.name === 'OpenSeasonPassPurchase'));
  const seasonContract = contract.entitlements.find(item => item.stableId === 'ent-1');
  assert.equal(seasonContract?.reconciliationHelper, 'AwaitSeasonPassReconciledEvent');
  assert.deepEqual(seasonContract?.ownershipLifecycle, {
    initialState: 'AwaitSeasonPassReconciledEvent, then HasSeasonPass or GetSeasonPassCount for the project-owned mirror.',
    liveState: 'Persistent AwaitSeasonPassGrantedEvent loop updates the mirror immediately in the same session.',
    lossState: 'AwaitSeasonPassRemovedEvent updates the mirror when ownership loss is supported and semantically relevant.',
    reconciliationIsNotSubscription: 'The reconciliation notification establishes initial truth; the persistent delta listener keeps it current.',
  });
  const coinsContract = contract.entitlements.find(item => item.stableId === 'ent-2');
  assert.equal((coinsContract?.awaitEvents as { consumed?: string }).consumed, 'AwaitCoinsConsumedEvent');
  assert.equal((coinsContract?.editableFields as { successTriggers?: string }).successTriggers, 'Coins_SuccessTriggers');
  assert.equal((contract.entitlements.find(item => item.stableId === 'ent-1')?.awaitEvents as { consumed?: string }).consumed, undefined);
  assert.ok(contract.alternateOffers.some(item => item.purchaseHelper === 'OpenSeasonPassDiscountPurchase'));
  assert.ok(contract.bundles.some(item => item.purchaseHelper === 'OpenStarterPackPurchase'));
  const runtimeCoinsContract = contract.entitlements.find(item => item.stableId === 'ent-2');
  assert.equal(runtimeCoinsContract?.runtimeOptionsType, `${config.offersModuleName}.CoinsRuntimeOptions`);
  assert.equal((runtimeCoinsContract?.primaryPurchaseHelper as { signature: string }).signature, `(Player:player, Options:${config.offersModuleName}.CoinsRuntimeOptions):void`);
  const alternateContract = contract.alternateOffers.find(item => item.stableId === 'alt-1');
  assert.equal(alternateContract?.runtimeOptionsType, `${config.offersModuleName}.SeasonPassDiscountRuntimeOptions`);
  assert.equal(alternateContract?.signature, `(Player:player, Options:${config.offersModuleName}.SeasonPassDiscountRuntimeOptions):void`);
  const runtimeBundleContract = contract.bundles.find(item => item.stableId === 'bundle-2');
  assert.equal(runtimeBundleContract?.runtimeOptionsType, `${config.offersModuleName}.RuntimePackRuntimeOptions`);
  assert.equal(runtimeBundleContract?.signature, `(Player:player, Options:${config.offersModuleName}.RuntimePackRuntimeOptions):void`);
  assert.ok(contract.bundles.some(item => item.runtimeOptionsType === `${config.offersModuleName}.RuntimePackRuntimeOptions`));
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
  assert.ok(contract.runtimeConstraints.some(rule => /Reconciliation establishes initial truth.*delta events keep current truth current/i.test(rule)));
  assert.ok(contract.runtimeConstraints.some(rule => /gameplay-affecting durable.*persistent.*Granted.*same-session/i.test(rule)));
  assert.ok(contract.runtimeConstraints.some(rule => /durable Granted.*consumable Consumed/i.test(rule)));
});
