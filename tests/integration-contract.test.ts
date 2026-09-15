import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { describeIntegrationContract } from '../src/services/integrationContract';
import { defaultProjectConfig } from '../src/services/catalogSession';
import { generateVerseCode } from '../src/services/verseGenerator';
import { normalizeEntitlement, normalizeBundle } from '../src/services/projectSchema';

const customOffersModule = 'CustomOffers';
const canonicalVersion = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'version.json'), 'utf8')).version as string;

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertGeneratedPurchase(verse: string, helper: { name?: string; signature?: string } | undefined, label: string): void {
  assert.ok(helper?.name && helper.signature, `${label} must expose a purchase helper name and signature`);
  assert.ok(verse.includes(`${helper.name}<public>${helper.signature}`), `${label} signature must match generated Verse`);
}

function assertRuntimeContractParity(verse: string, value: Record<string, unknown>, label: string): void {
  const runtimeOptionsType = value.runtimeOptionsType;
  assert.equal(typeof runtimeOptionsType, 'string', `${label} must expose a runtime options type`);
  assert.match(runtimeOptionsType as string, new RegExp(`^${escaped(customOffersModule)}\\.[A-Z][A-Za-z0-9]*RuntimeOptions$`), `${label} runtime options type must be qualified by the configured Offers module`);
  const bareType = (runtimeOptionsType as string).slice(customOffersModule.length + 1);
  assert.ok(verse.includes(`${bareType}<public> := struct:`), `${label} runtime options declaration must exist in generated Verse`);

  const factory = value.dynamicOfferFactory;
  assert.equal(typeof factory, 'string', `${label} must expose its lower-level factory when runtime options exist`);
  assert.match(factory as string, new RegExp(`^${escaped(customOffersModule)}\\.Make${escaped(bareType.replace(/RuntimeOptions$/, ''))}DynamicOffer$`), `${label} factory must be module-qualified`);
  assert.equal(value.dynamicOfferFactorySignature, `(Options:${runtimeOptionsType as string})<transacts>:?offer`, `${label} factory signature must use the qualified runtime options type`);
  assert.match(String(value.dynamicOfferFactoryRole), /lower-level.*generated-offer construction.*guarded device purchase helper/i);
  const factoryName = (factory as string).slice(customOffersModule.length + 1);
  assert.ok(verse.includes(`${factoryName}<public>(Options:${bareType})<transacts>:?offer`), `${label} factory signature must match generated Verse`);
  assert.ok(Array.isArray(value.runtimeOptionsFields) && (value.runtimeOptionsFields as unknown[]).length > 0, `${label} must report every runtime options field`);
}

test('integration contract is derived from generator naming and exposes a qualified runtime caller surface', () => {
  const config = defaultProjectConfig('C:/Demo/Content', { deviceClassName: 'CustomTransactionDevice', offersModuleName: customOffersModule });
  const staticEntitlement = normalizeEntitlement({
    id: 'static-entitlement', verseKey: 'static_access', name: 'Static Access', shortDescription: 'Access', description: 'Access',
    itemType: 'durable', priceVBucks: 500,
    alternateOffers: [{ id: 'runtime-alt', verseKey: 'runtime_alt', name: 'Runtime Alternate', shortDescription: 'Alternate', description: 'Alternate', priceVBucks: 200, dynamicOffer: { priceBehavior: 'runtime' } }],
  }, 0);
  const runtimeEntitlement = normalizeEntitlement({
    id: 'runtime-entitlement', verseKey: 'runtime_coins', name: 'Runtime Coins', shortDescription: 'Coins', description: 'Coins',
    itemType: 'consumable', priceVBucks: 250, maxCount: 100, dynamicOffer: { priceBehavior: 'runtime' },
  }, 1);
  const staticBundle = normalizeBundle({
    id: 'static-bundle', verseKey: 'static_pack', name: 'Static Pack', shortDescription: 'Pack', description: 'Pack', priceVBucks: 800,
    items: [{ entitlementId: staticEntitlement.id, quantity: 1 }],
  }, 0);
  const priceBundle = normalizeBundle({
    id: 'price-bundle', verseKey: 'price_pack', name: 'Price Pack', shortDescription: 'Pack', description: 'Price pack', priceVBucks: 600,
    dynamicOffer: { priceBehavior: 'runtime' }, items: [{ entitlementId: staticEntitlement.id, quantity: 1 }],
  }, 1);
  const quantityBundle = normalizeBundle({
    id: 'quantity-bundle', verseKey: 'quantity_pack', name: 'Quantity Pack', shortDescription: 'Pack', description: 'Quantity pack', priceVBucks: 600,
    items: [{ entitlementId: runtimeEntitlement.id, quantity: 1, quantityBehavior: 'runtime' }],
  }, 2);
  const combinedBundle = normalizeBundle({
    id: 'combined-bundle', verseKey: 'runtime_pack', name: 'Runtime Pack', shortDescription: 'Pack', description: 'Runtime pack', priceVBucks: 600,
    dynamicOffer: { priceBehavior: 'runtime' }, items: [{ entitlementId: runtimeEntitlement.id, quantity: 1, quantityBehavior: 'runtime' }],
  }, 3);
  const entitlements = [staticEntitlement, runtimeEntitlement];
  const bundles = [staticBundle, priceBundle, quantityBundle, combinedBundle];
  const storefrontMembership = {
    allOffers: [{ entitlementId: staticEntitlement.id }, { bundleId: staticBundle.id }],
    focused: [{ id: 'store-1', verseKey: 'featured', name: 'Featured', entries: [{ entitlementId: staticEntitlement.id, offerVerseKey: 'runtime_alt' }], generateTriggerBinding: true }],
  };
  const contract = describeIntegrationContract(config, entitlements, bundles, storefrontMembership, canonicalVersion);
  const verse = generateVerseCode(entitlements, bundles, config, storefrontMembership, []);

  assert.equal(contract.generatorVersion, canonicalVersion);
  assert.equal(contract.managedVerseFile, 'managed_transactions.verse');
  assert.ok(contract.entitlements.some(item => (item.primaryPurchaseHelper as { name?: string })?.name === 'OpenStaticAccessPurchase'));

  const staticContract = contract.entitlements.find(item => item.stableId === staticEntitlement.id)!;
  assertGeneratedPurchase(verse, staticContract.primaryPurchaseHelper as { name?: string; signature?: string }, 'static primary entitlement');
  assert.equal(staticContract.runtimeOptionsType, undefined);

  const runtimeContract = contract.entitlements.find(item => item.stableId === runtimeEntitlement.id)!;
  assertGeneratedPurchase(verse, runtimeContract.primaryPurchaseHelper as { name?: string; signature?: string }, 'runtime primary entitlement');
  assertRuntimeContractParity(verse, runtimeContract, 'runtime primary entitlement');
  assert.deepEqual(runtimeContract.runtimeOptionsFields, ['PriceVBucks']);

  const alternateContract = contract.alternateOffers.find(item => item.stableId === 'runtime-alt')!;
  assertGeneratedPurchase(verse, { name: String(alternateContract.purchaseHelper), signature: String(alternateContract.signature) }, 'runtime alternate entitlement');
  assertRuntimeContractParity(verse, alternateContract, 'runtime alternate entitlement');

  const staticBundleContract = contract.bundles.find(item => item.stableId === staticBundle.id)!;
  assertGeneratedPurchase(verse, { name: String(staticBundleContract.purchaseHelper), signature: String(staticBundleContract.signature) }, 'static bundle');
  assert.equal(staticBundleContract.runtimeOptionsType, undefined);

  const priceBundleContract = contract.bundles.find(item => item.stableId === priceBundle.id)!;
  assertGeneratedPurchase(verse, { name: String(priceBundleContract.purchaseHelper), signature: String(priceBundleContract.signature) }, 'runtime price bundle');
  assertRuntimeContractParity(verse, priceBundleContract, 'runtime price bundle');
  assert.deepEqual(priceBundleContract.runtimeOptionsFields, ['PriceVBucks']);

  const quantityBundleContract = contract.bundles.find(item => item.stableId === quantityBundle.id)!;
  assertGeneratedPurchase(verse, { name: String(quantityBundleContract.purchaseHelper), signature: String(quantityBundleContract.signature) }, 'runtime quantity-only bundle');
  assertRuntimeContractParity(verse, quantityBundleContract, 'runtime quantity-only bundle');
  assert.deepEqual(quantityBundleContract.runtimeOptionsFields, ['RuntimeCoinsQuantity']);

  const combinedBundleContract = contract.bundles.find(item => item.stableId === combinedBundle.id)!;
  assertGeneratedPurchase(verse, { name: String(combinedBundleContract.purchaseHelper), signature: String(combinedBundleContract.signature) }, 'runtime price and quantity bundle');
  assertRuntimeContractParity(verse, combinedBundleContract, 'runtime price and quantity bundle');
  assert.deepEqual(combinedBundleContract.runtimeOptionsFields, ['PriceVBucks', 'RuntimeCoinsQuantity']);

  assert.ok(contract.storefronts.some(item => item.openHelper === 'OpenFeatured'));
  assert.ok(contract.examples.some(example => /OpenStaticAccessPurchase\(Player\)/.test(example)), 'contract should retain a static primary example');
  assert.ok(contract.examples.some(example => /CustomOffers\.RuntimeCoinsRuntimeOptions\{PriceVBucks := RuntimePrice\}/.test(example) && /OpenRuntimeCoinsPurchase\(Player, Options\)/.test(example)), 'contract should include a runtime primary example');
  assert.ok(contract.examples.some(example => /CustomOffers\.RuntimeAltRuntimeOptions\{PriceVBucks := RuntimePrice\}/.test(example) && /OpenRuntimeAltPurchase\(Player, Options\)/.test(example)), 'contract should include a runtime alternate example');
  assert.ok(contract.examples.some(example => /OpenQuantityPackPurchase\(Player, Options\)/.test(example) && /RuntimeCoinsQuantity :=/.test(example)), 'contract should include a quantity-only bundle example');
  assert.ok(contract.examples.some(example => /OpenRuntimePackPurchase\(Player, Options\)/.test(example) && /PriceVBucks := RuntimePrice/.test(example) && /RuntimeCoinsQuantity :=/.test(example)), 'contract should include a price-plus-quantity bundle example');

  for (const example of contract.examples) {
    const optionMatch = example.match(/Options := ([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*RuntimeOptions)\{([^}]*)\}/);
    const purchaseMatch = example.match(/Transactions\.(Open[A-Za-z0-9]+Purchase)\(Player(?:, Options)?\)/);
    assert.ok(purchaseMatch, 'every contract example must call a generated purchase helper');
    assert.ok(verse.includes(`${purchaseMatch[1]}<public>`), `example helper ${purchaseMatch[1]} must exist in generated Verse`);
    if (optionMatch) {
      assert.equal(optionMatch[1], customOffersModule, 'example runtime types must use the configured Offers module');
      assert.ok(verse.includes(`${optionMatch[2]}<public> := struct:`), `example runtime type ${optionMatch[2]} must exist in generated Verse`);
      assert.ok(purchaseMatch[0].includes(', Options'), 'runtime examples must pass the options value to the helper');
    } else {
      assert.ok(!purchaseMatch[0].includes(', Options'), 'static examples must use the one-argument helper');
    }
  }
  assert.doesNotMatch(JSON.stringify(contract), /"dynamicOfferFactory":"Make/);
  assert.match(verse, /MakeRuntimeCoinsDynamicOffer/);
  assert.match(verse, /RuntimePackRuntimeOptions/);
  assert.match(verse, /RuntimeCoinsQuantity:int/);
  assert.doesNotMatch(verse, /RuntimeEntitlementQuantity:int/);
  assert.ok(contract.runtimeConstraints.some(rule => /Reconciliation establishes initial truth.*delta events keep current truth current/i.test(rule)));
  assert.ok(contract.runtimeConstraints.some(rule => /gameplay-affecting durable.*persistent.*Granted.*same-session/i.test(rule)));
  assert.ok(contract.runtimeConstraints.some(rule => /durable Granted.*consumable Consumed/i.test(rule)));
});

test('integration contract and generated Verse preserve explicit existing-project public identities', () => {
  const config = defaultProjectConfig('C:/Demo/Content', { deviceClassName: 'PublishedTransactionDevice', offersModuleName: 'PublishedOffers' });
  const item = normalizeEntitlement({
    id: 'published-power',
    verseKey: 'power_pass',
    publicIdentity: {
      apiStem: 'PublishedPower',
      metadataStem: 'PublishedPowerMetadata',
      entitlementStem: 'legacy_power',
      priceStem: 'published_power',
      offerStem: 'published_power',
    },
    name: 'Published Power',
    shortDescription: 'Power',
    description: 'Power',
    itemType: 'durable',
    priceVBucks: 300,
    triggers: { generateTriggerBinding: true, generateButtonBinding: false, generateSuccessTriggerBinding: true },
    alternateOffers: [{
      id: 'published-power-alt',
      verseKey: 'power_pass_alternate_1',
      publicIdentity: {
        apiStem: 'PublishedPowerAlt',
        metadataStem: 'PublishedPowerAltMetadata',
        priceStem: 'published_power_alt',
        offerStem: 'published_power_alt',
      },
      name: 'Published Power Alternate',
      shortDescription: 'Alternate',
      description: 'Alternate',
      priceVBucks: 200,
    }],
  }, 0);
  const membership = {
    allOffers: [{ entitlementId: item.id }],
    focused: [{
      id: 'published-storefront',
      verseKey: 'storefront_old_key',
      publicIdentity: { apiStem: 'PublishedStorefront' },
      name: 'Published Storefront',
      entries: [{ entitlementId: item.id }],
      generateTriggerBinding: true,
    }],
  };
  const contract = describeIntegrationContract(config, [item], [], membership, canonicalVersion);
  const verse = generateVerseCode([item], [], config, membership, []);

  assert.match(verse, /PublishedPowerMetadata<public> := module:/);
  assert.match(verse, /legacy_power_entitlement<public>/);
  assert.match(verse, /published_power_price<public>/);
  assert.match(verse, /published_power_offer<public>/);
  assert.match(verse, /PublishedPowerAltMetadata<public> := module:/);
  assert.match(verse, /published_power_alt_offer<public>/);
  assert.match(verse, /OpenPublishedPowerPurchase<public>/);
  assert.match(verse, /OpenPublishedPowerAltPurchase<public>/);
  assert.match(verse, /PublishedStorefrontTitle<localizes>/);
  assert.match(verse, /OpenPublishedStorefront<public>/);
  assert.match(verse, /PublishedStorefront_OpenTriggers/);

  const published = contract.entitlements.find(value => value.stableId === item.id)!;
  assert.equal((published.publicIdentity as { apiStem: string }).apiStem, 'PublishedPower');
  assert.equal((published.primaryPurchaseHelper as { name: string }).name, 'OpenPublishedPowerPurchase');
  assert.equal(contract.alternateOffers.find(value => value.stableId === 'published-power-alt')?.purchaseHelper, 'OpenPublishedPowerAltPurchase');
  assert.equal(contract.storefronts[0]?.openHelper, 'OpenPublishedStorefront');
  assert.deepEqual(contract.editableFields.entitlementBindings[0]?.publicIdentity, published.publicIdentity);
  assert.equal(contract.editableFields.storefrontBindings[0]?.openTriggers, 'PublishedStorefront_OpenTriggers');
});
