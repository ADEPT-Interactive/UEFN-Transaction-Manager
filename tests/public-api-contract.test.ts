import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

function publicDeclarations(source: string): string[] {
  return source.split(/\r?\n/).filter(line => line.includes('<public>')).map(line => line.trim().replace(/ =.*$/, ' = …'));
}

function expectedPublicDeclarations(): string[] {
  const declarations = ['EntitlementIcons<public> := module {}', 'Phase4PublicApiInfo<public> := module:'];
  const metadataKeys = ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem', 'MysteryItemMobile', 'StarterBundle', 'NestedBundle', 'DynamicBundle'];
  for (const key of metadataKeys) declarations.push(`${key}<public> := module:`, 'Name<public><localizes>:message = …', 'Description<public><localizes>:message = …', 'ShortDescription<public><localizes>:message = …');
  declarations.push(
    'Phase4PublicApiEntitlements<public> := module:', 'basic_entitlement<public> := class<abstract><castable>(entitlement){}',
    'access_pass_entitlement<public> := class<concrete>(basic_entitlement):', 'season_pass_entitlement<public> := class<concrete>(basic_entitlement):',
    'coin_pack_entitlement<public> := class<concrete>(basic_entitlement):', 'mystery_item_entitlement<public> := class<concrete>(basic_entitlement):',
    'Phase4PublicApiPrices<public> := module:', 'access_pass_price<public>:float = …', 'season_pass_price<public>:float = …',
    'coin_pack_price<public>:float = …', 'mystery_item_price<public>:float = …', 'mystery_item_mobile_price<public>:float = …',
    'starter_bundle_price<public>:float = …', 'nested_bundle_price<public>:float = …', 'dynamic_bundle_price<public>:float = …',
    'Phase4PublicApiOffers<public> := module:', 'access_pass_offer<public> := class(entitlement_offer):', 'season_pass_offer<public> := class(entitlement_offer):',
    'coin_pack_offer<public> := class(entitlement_offer):', 'mystery_item_offer<public> := class(entitlement_offer):', 'mystery_item_mobile_offer<public> := class(entitlement_offer):',
    'starter_bundle_offer<public> := class(bundle_offer):', 'nested_bundle_offer<public> := class(bundle_offer):', 'dynamic_bundle_offer<public> := class(bundle_offer):',
    'dynamic_bundle_dynamic_offer<public> := class(bundle_offer):',
  );
  for (const stem of ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem']) declarations.push(
    `${stem}_GrantedEvent<public>:event(tuple(player, int)) = …`, `${stem}_RemovedEvent<public>:event(tuple(player, int)) = …`, `${stem}_ReconciledEvent<public>:event(tuple(player, int)) = …`,
  );
  declarations.push(
    'GrantAccessPass<public>(Player:player, Quantity:int)<suspends>:logic = …', 'GrantSeasonPass<public>(Player:player, Quantity:int)<suspends>:logic = …',
    'ConsumeCoinPack<public>(Player:player, Quantity:int)<suspends>:logic = …', 'GrantCoinPack<public>(Player:player, Quantity:int)<suspends>:logic = …',
    'ConsumeMysteryItem<public>(Player:player, Quantity:int)<suspends>:logic = …', 'GrantMysteryItem<public>(Player:player, Quantity:int)<suspends>:logic = …',
  );
  for (const stem of ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem']) declarations.push(`Get${stem}Count<public>(Player:player)<suspends>:int = …`, `Has${stem}<public>(Player:player)<suspends>:logic = …`);
  declarations.push(
    'OpenAccessPassPurchase<public>(Player:player):void = …', 'OpenSeasonPassPurchase<public>(Player:player):void = …',
    'OpenCoinPackPurchase<public>(Player:player):void = …', 'OpenMysteryItemPurchase<public>(Player:player):void = …', 'OpenMysteryItemMobilePurchase<public>(Player:player):void = …',
    'OpenStarterBundlePurchase<public>(Player:player):void = …', 'OpenNestedBundlePurchase<public>(Player:player):void = …', 'OpenDynamicBundlePurchase<public>(Player:player):void = …',
    'OpenAllOffersStore<public>(Player:player):void = …', 'OpenCoinStore<public>(Player:player):void = …', 'OpenBundleStore<public>(Player:player):void = …',
  );
  return declarations;
}

test('complex generated output has one locked canonical public declaration baseline', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  assert.deepEqual(publicDeclarations(source), expectedPublicDeclarations());
  assert.equal(publicDeclarations(source).length, 96);
  assert.match(source, /phase4_public_api_device := class\(creative_device\):/);
  assert.doesNotMatch(source, /phase4_public_api_device<public>/);
});

test('UEFN editables are present while device plumbing remains private', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  for (const editable of ['AccessPassTriggers : []trigger_device', 'AccessPassButtons : []button_device', 'AccessPassZones : []mutator_zone_device', 'SeasonPassButtons : []button_device', 'CoinPackTriggers : []trigger_device', 'MysteryItemButtons : []button_device', 'MysteryItemZones : []mutator_zone_device', 'Phase4StorefrontButtons : []button_device', 'CoinStoreTriggers : []trigger_device']) assert.ok(source.includes(`@editable\n    ${editable}`), `missing editable ${editable}`);
  for (const internal of ['OnAccessPassTriggerActivated', 'OnAccessPassButtonInteracted', 'OnAccessPassZoneEntered', 'ProcessAccessPassGrant', 'ProcessAccessPassRemoval', 'ExecuteBuyAccessPass', 'ShowAllOffersAndRelease', 'ShowCoinStoreOffersAndRelease', 'ReconcilePlayerEntitlements']) {
    const line = source.split(/\r?\n/).find(candidate => candidate.includes(`${internal}(`) || candidate.includes(`${internal}:`));
    assert.ok(line, `missing generated internal helper ${internal}`);
    assert.equal(line!.includes('<public>'), false, `${internal} unexpectedly became public`);
  }
});

test('canonical helper signatures and event ownership are stable', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  assert.match(source, /GrantAccessPass<public>\(Player:player, Quantity:int\)<suspends>:logic/);
  assert.match(source, /ConsumeCoinPack<public>\(Player:player, Quantity:int\)<suspends>:logic/);
  assert.match(source, /OpenDynamicBundlePurchase<public>\(Player:player\):void/);
  assert.match(source, /OpenAllOffersStore<public>\(Player:player\):void/);
  assert.match(source, /OpenCoinStore<public>\(Player:player\):void/);
  assert.doesNotMatch(source, /PromptBuy|ShowStorefront|OpenStorefront|OwnershipVerifiedEvent|QuantityDecreasedEvent|PurchaseEvent/);
});

test('Grant and Consume return native Marketplace results without signaling directly', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  for (const stem of ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem']) assert.match(source, new RegExp(`Grant${stem}<public>\\(Player:player, Quantity:int\\)<suspends>:logic`));
  for (const stem of ['CoinPack', 'MysteryItem']) assert.match(source, new RegExp(`Consume${stem}<public>\\(Player:player, Quantity:int\\)<suspends>:logic`));
  assert.doesNotMatch(source, /ConsumeAccessPass<public>|ConsumeSeasonPass<public>/);
  assert.match(source, /Grant quantity must be positive/);
  assert.match(source, /Consume quantity must be positive/);
  assert.match(source, /ProcessMysteryItemGrant\(Player:player, Quantity:int\):void =\n[\s\S]+spawn\{AutoConsumeMysteryItem\(Player, Quantity\)\}/);
  assert.match(source, /AutoConsumeMysteryItem\(Player:player, Quantity:int\)<suspends>:void =\n        ConsumeMysteryItem\(Player, Quantity\)/);
  for (const declaration of ['GrantAccessPass', 'ConsumeCoinPack', 'GrantMysteryItem', 'ConsumeMysteryItem']) {
    const start = source.indexOf(`    ${declaration}<public>`);
    assert.notEqual(start, -1, `missing ${declaration}`);
    const nextDeclaration = source.slice(start + 1).search(/\n    [A-Za-z_][A-Za-z0-9_]*(?:<|\()/);
    const body = source.slice(start, nextDeclaration < 0 ? undefined : start + 1 + nextDeclaration);
    assert.doesNotMatch(body, /\.Signal\(/, `${declaration} must not signal entitlement events directly`);
  }
});

test('canonical ownership query helpers are public, suspending, and entitlement-scoped', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  for (const stem of ['AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem']) {
    assert.match(source, new RegExp(`Get${stem}Count<public>\\(Player:player\\)<suspends>:int`));
    assert.match(source, new RegExp(`Has${stem}<public>\\(Player:player\\)<suspends>:logic`));
  }
  assert.doesNotMatch(source, /GetMysteryItemMobileCount<public>|HasMysteryItemMobile<public>/);
  assert.doesNotMatch(source, /GetStarterBundleCount<public>|HasStarterBundle<public>/);
  assert.doesNotMatch(source, /GetCoinStoreCount<public>|HasCoinStore<public>/);
});
