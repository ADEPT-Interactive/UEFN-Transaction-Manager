import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

const legacyApiOptions = { generatedApiVersion: 1 as const };

function publicDeclarations(source: string): string[] {
  return source
    .split(/\r?\n/)
    .filter(line => line.includes('<public>'))
    .map(line => line.trim().replace(/ = .*$/, ' = …'));
}

function expectedPublicDeclarations(): string[] {
  const declarations = [
    'EntitlementIcons<public> := module {}',
    'Phase4PublicApiInfo<public> := module:',
  ];
  const metadataKeys = [
    'AccessPass', 'SeasonPass', 'CoinPack', 'MysteryItem', 'MysteryItemMobile',
    'StarterBundle', 'NestedBundle', 'DynamicBundle',
  ];
  for (const key of metadataKeys) {
    declarations.push(
      `${key}<public> := module:`,
      'Name<public><localizes>:message = …',
      'Description<public><localizes>:message = …',
      'ShortDescription<public><localizes>:message = …',
    );
  }

  declarations.push(
    'Phase4PublicApiEntitlements<public> := module:',
    'basic_entitlement<public> := class<abstract><castable>(entitlement){}',
    'access_pass_entitlement<public> := class<concrete>(basic_entitlement):',
    'season_pass_entitlement<public> := class<concrete>(basic_entitlement):',
    'coin_pack_entitlement<public> := class<concrete>(basic_entitlement):',
    'mystery_item_entitlement<public> := class<concrete>(basic_entitlement):',
    'Phase4PublicApiPrices<public> := module:',
    'access_pass_price<public>:float = …',
    'season_pass_price<public>:float = …',
    'coin_pack_price<public>:float = …',
    'mystery_item_price<public>:float = …',
    'mystery_item_mobile_price<public>:float = …',
    'starter_bundle_price<public>:float = …',
    'nested_bundle_price<public>:float = …',
    'dynamic_bundle_price<public>:float = …',
    'Phase4PublicApiOffers<public> := module:',
    'access_pass_offer<public> := class(entitlement_offer):',
    'season_pass_offer<public> := class(entitlement_offer):',
    'coin_pack_offer<public> := class(entitlement_offer):',
    'mystery_item_offer<public> := class(entitlement_offer):',
    'mystery_item_mobile_offer<public> := class(entitlement_offer):',
    'starter_bundle_offer<public> := class(bundle_offer):',
    'nested_bundle_offer<public> := class(bundle_offer):',
    'dynamic_bundle_offer<public> := class(bundle_offer):',
    'dynamic_bundle_dynamic_offer<public> := class(bundle_offer):',
  );

  declarations.push(
    'AccessPassPurchaseEvent<public>:event(player) = …',
    'AccessPassOwnershipRemovedEvent<public>:event(player) = …',
    'AccessPassEntitlementGrantedEvent<public>:event(tuple(player, int)) = …',
    'AccessPassEntitlementRemovedEvent<public>:event(tuple(player, int)) = …',
    'AccessPassEntitlementReconciledEvent<public>:event(tuple(player, int)) = …',
    'AccessPassOwnershipVerifiedEvent<public>:event(player) = …',
    'SeasonPassPurchaseEvent<public>:event(player) = …',
    'SeasonPassOwnershipRemovedEvent<public>:event(player) = …',
    'SeasonPassEntitlementGrantedEvent<public>:event(tuple(player, int)) = …',
    'SeasonPassEntitlementRemovedEvent<public>:event(tuple(player, int)) = …',
    'SeasonPassEntitlementReconciledEvent<public>:event(tuple(player, int)) = …',
    'CoinPackPurchaseEvent<public>:event(player) = …',
    'CoinPackQuantityDecreasedEvent<public>:event(player) = …',
    'CoinPackEntitlementGrantedEvent<public>:event(tuple(player, int)) = …',
    'CoinPackEntitlementRemovedEvent<public>:event(tuple(player, int)) = …',
    'CoinPackEntitlementReconciledEvent<public>:event(tuple(player, int)) = …',
    'MysteryItemPurchaseEvent<public>:event(player) = …',
    'MysteryItemQuantityDecreasedEvent<public>:event(player) = …',
    'MysteryItemEntitlementGrantedEvent<public>:event(tuple(player, int)) = …',
    'MysteryItemEntitlementRemovedEvent<public>:event(tuple(player, int)) = …',
    'MysteryItemEntitlementReconciledEvent<public>:event(tuple(player, int)) = …',
    'GrantAccessPass<public>(Player:player, Quantity:int)<suspends>:void =',
    'GrantSeasonPass<public>(Player:player, Quantity:int)<suspends>:void =',
    'ConsumeCoinPack<public>(Player:player, Quantity:int)<suspends>:void =',
    'GrantCoinPack<public>(Player:player, Quantity:int)<suspends>:void =',
    'ConsumeMysteryItem<public>(Player:player, Quantity:int)<suspends>:void =',
    'GrantMysteryItem<public>(Player:player, Quantity:int)<suspends>:void =',
    'PromptBuyAccessPass<public>(Player:player):void =',
    'PromptBuySeasonPass<public>(Player:player):void =',
    'PromptBuyCoinPack<public>(Player:player):void =',
    'PromptBuyMysteryItem<public>(Player:player):void =',
    'PromptBuyMysteryItemMobile<public>(Player:player):void =',
    'PromptBuyStarterBundle<public>(Player:player):void =',
    'PromptBuyNestedBundle<public>(Player:player):void =',
    'PromptBuyDynamicBundle<public>(Player:player):void =',
    'ShowStorefront<public>(Player:player)<suspends>:void =',
    'OpenStorefront<public>(Player:player):void =',
    'ShowCoinStore<public>(Player:player)<suspends>:void =',
    'OpenCoinStore<public>(Player:player):void =',
    'ShowBundleStore<public>(Player:player)<suspends>:void =',
    'OpenBundleStore<public>(Player:player):void =',
  );
  return declarations;
}

test('complex generated output has a locked public declaration baseline', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], legacyApiOptions);
  assert.deepEqual(publicDeclarations(source), expectedPublicDeclarations());
  assert.equal(publicDeclarations(source).length, 100);
  assert.match(source, /phase4_public_api_device := class\(creative_device\):/);
  assert.doesNotMatch(source, /phase4_public_api_device<public>/);
});

test('UEFN-exposed editables are present while device plumbing remains private', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], legacyApiOptions);
  for (const editable of [
    'AccessPassTriggers : []trigger_device', 'AccessPassButtons : []button_device', 'AccessPassZones : []mutator_zone_device',
    'SeasonPassButtons : []button_device', 'CoinPackTriggers : []trigger_device',
    'MysteryItemButtons : []button_device', 'MysteryItemZones : []mutator_zone_device',
    'Phase4StorefrontButtons : []button_device', 'CoinStoreTriggers : []trigger_device',
  ]) assert.ok(source.includes(`@editable\n    ${editable}`), `missing editable ${editable}`);

  for (const internal of [
    'OnAccessPassTriggerActivated', 'OnAccessPassButtonInteracted', 'OnAccessPassZoneEntered',
    'ProcessAccessPassGrant', 'ProcessAccessPassRemoval', 'ExecuteBuyAccessPass',
    'ShowStorefrontAndRelease', 'ShowCoinStoreAndRelease', 'ReconcilePlayerEntitlements',
  ]) {
    const line = source.split(/\r?\n/).find(candidate => candidate.includes(`${internal}(`) || candidate.includes(`${internal}:`));
    assert.ok(line, `missing generated internal helper ${internal}`);
    assert.equal(line!.includes('<public>'), false, `${internal} unexpectedly became public`);
  }
});

test('public helper signatures preserve current return and suspension contracts', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups, [], legacyApiOptions);
  assert.match(source, /GrantAccessPass<public>\(Player:player, Quantity:int\)<suspends>:void/);
  assert.match(source, /ConsumeCoinPack<public>\(Player:player, Quantity:int\)<suspends>:void/);
  assert.match(source, /PromptBuyDynamicBundle<public>\(Player:player\):void/);
  assert.match(source, /ShowStorefront<public>\(Player:player\)<suspends>:void/);
  assert.match(source, /OpenStorefront<public>\(Player:player\):void/);
});
