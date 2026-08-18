import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { cleanManagedData, legacyProjectConfigDiagnostics, normalizeProjectConfig, parseManagedData } from '../src/services/projectSchema';
import { entitlementEditableNames, storefrontEditableName } from '../src/services/editableBindings';
import { publicApiBundles, publicApiConfig, publicApiDisplayGroups, publicApiItems } from './public-api-fixture';

test('editable identifiers use stable stems and role-specific names', () => {
  assert.deepEqual(entitlementEditableNames('vip_pass_2'), {
    purchaseTriggers: 'VipPass2_PurchaseTriggers',
    purchaseButtons: 'VipPass2_PurchaseButtons',
  });
  assert.equal(storefrontEditableName('coin_store'), 'CoinStore_OpenTriggers');
  assert.equal(storefrontEditableName('AllOffersStore', 'openButtons'), 'AllOffersStore_OpenButtons');

  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  for (const name of [
    'AccessPass_PurchaseTriggers', 'AccessPass_PurchaseButtons',
    'SeasonPass_PurchaseButtons', 'CoinPack_PurchaseTriggers', 'MysteryItem_PurchaseButtons',
    'AllOffersStore_OpenButtons', 'CoinStore_OpenTriggers',
  ]) assert.match(source, new RegExp(`${name} : \\[`), `missing canonical editable ${name}`);
  const editableSurface = source.slice(source.indexOf('# Generated editable metadata'));
  assert.doesNotMatch(editableSurface, /(?:vip_pass|coin_pack|mystery_item)_(?:OfferTriggers|Buttons|Zones)/);
  assert.doesNotMatch(editableSurface, /PurchaseZones|mutator_zone_device|ZoneEntered/);
  assert.doesNotMatch(editableSurface, /(?:timestamp|uuid|[A-Za-z]+zzzz)/i);
});

test('display-name changes do not change editable identifiers', () => {
  const renamed = structuredClone(publicApiItems[0]);
  renamed.name = 'Founder Access';
  const source = generateVerseCode([renamed], [], { ...publicApiConfig, generateStorefrontBinding: false }, []);
  assert.match(source, /Founder Access/);
  assert.match(source, /AccessPass_PurchaseTriggers : \[\]trigger_device/);
  assert.doesNotMatch(source, /FounderAccess_PurchaseTriggers/);

  const similarKeys = [
    { ...renamed, id: 'same-a', verseKey: 'access_pass_a', name: 'Same Name' },
    { ...renamed, id: 'same-b', verseKey: 'access_pass_b', name: 'Same Name' },
  ];
  const similarSource = generateVerseCode(similarKeys, [], { ...publicApiConfig, generateStorefrontBinding: false }, []);
  assert.match(similarSource, /AccessPassAPurchaseTriggers|AccessPassA_PurchaseTriggers/);
  assert.match(similarSource, /AccessPassB_PurchaseTriggers/);
});

test('editable metadata uses native categories, concise tooltips, and correct array types', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  assert.match(source, /@editable:\n        ToolTip := UEM_AccessPass_purchaseTriggersToolTip\n        Categories := array\{UEM_EntitlementsCategory, UEM_AccessPass_Category, UEM_PurchaseTriggersCategory\}\n    AccessPass_PurchaseTriggers : \[\]trigger_device/);
  assert.match(source, /Categories := array\{UEM_StorefrontsCategory, UEM_CoinStore_Category, UEM_OpenTriggersCategory\}[\s\S]+CoinStore_OpenTriggers : \[\]trigger_device/);
  assert.match(source, /Activating an assigned Trigger device opens Epic's purchase interface for Access Pass/);
  assert.match(source, /Use it only with a deliberate player purchase interaction/);
  assert.match(source, /Interacting with an assigned Button device opens Epic's purchase interface for Season Pass/);
  assert.match(source, /Activating an assigned Trigger device opens the Coin Store storefront\. Use it with a deliberate player interaction/);
  assert.doesNotMatch(source, /PurchaseZones|mutator_zone_device|ZoneEntered|automatic zone prompt/i);
});

test('purchase bindings use deliberate interaction callbacks and canonical helpers', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  assert.match(source, /OnAccessPassTriggerActivated\(MaybeAgent:\?agent\):void =\n        if \(Agent := MaybeAgent\?\):\n            if \(Player := player\[Agent\]\):\n                OpenAccessPassPurchase\(Player\)/);
  assert.match(source, /OnAccessPassButtonInteracted\(Agent:agent\):void =\n        if \(Player := player\[Agent\]\):\n            OpenAccessPassPurchase\(Player\)/);
  assert.match(source, /OnStorefrontButtonInteracted\(Agent:agent\):void =\n        if \(Player := player\[Agent\]\):\n            OpenAllOffersStore\(Player\)/);
  assert.match(source, /OnCoinStoreTriggerActivated\(MaybeAgent:\?agent\):void =\n        if \(Agent := MaybeAgent\?\):\n            if \(Player := player\[Agent\]\):\n                OpenCoinStore\(Player\)/);
  for (const callback of ['OnAccessPassTriggerActivated', 'OnAccessPassButtonInteracted', 'OnStorefrontButtonInteracted', 'OnCoinStoreTriggerActivated']) {
    const start = source.indexOf(`    ${callback}`);
    const end = source.indexOf('\n\n', start);
    assert.notEqual(start, -1, `missing ${callback}`);
    assert.doesNotMatch(source.slice(start, end), /BuyOffer|ShowOffersDialog/);
  }
  assert.equal((source.match(/TriggeredEvent\.Subscribe\(OnAccessPassTriggerActivated\)/g) ?? []).length, 1);
  assert.equal((source.match(/InteractedWithEvent\.Subscribe\(OnAccessPassButtonInteracted\)/g) ?? []).length, 1);
});

test('legacy custom editable names load, warn, and converge to canonical output', () => {
  const rawItem = {
    ...structuredClone(publicApiItems[0]),
    triggers: {
      generateTriggerBinding: true,
      triggerDeviceName: 'ConsumableEntitlementOfferzzzzTriggers',
      generateButtonBinding: true,
      buttonDeviceName: 'LegacyButtons',
      generateZoneBinding: true,
      mutatorZoneName: 'LegacyZones',
    },
  };
  const rawGroup = {
    ...structuredClone(publicApiDisplayGroups[0]),
    triggerDeviceName: 'CoinStoreTriggers',
  };
  const parsed = parseManagedData({ schemaVersion: 4, entitlements: [rawItem], bundles: [], offerDisplayGroups: [rawGroup] });
  assert.equal(parsed.entitlements[0].triggers.generateTriggerBinding, true);
  assert.equal('triggerDeviceName' in parsed.entitlements[0].triggers, false);
  assert.equal(parsed.projectDataDiagnostics.length, 5);
  assert.ok(parsed.projectDataDiagnostics.filter(message => /legacy editable name|reassigned/i.test(message)).length === 3);
  assert.ok(parsed.projectDataDiagnostics.some(message => /Purchase Zone bindings are no longer supported/i.test(message)));
  assert.deepEqual(legacyProjectConfigDiagnostics({ config: { allowAutomaticZonePrompts: true } }), [
    'Automatic zone prompts are no longer supported. The old setting was ignored; use a deliberate Purchase Trigger or Purchase Button instead.',
  ]);
  const normalizedConfig = normalizeProjectConfig({ allowAutomaticZonePrompts: true }, publicApiConfig);
  assert.equal('allowAutomaticZonePrompts' in normalizedConfig, false);
  const source = generateVerseCode(parsed.entitlements, parsed.bundles, publicApiConfig, parsed.offerDisplayGroups);
  assert.match(source, /AccessPass_PurchaseTriggers : \[\]trigger_device/);
  assert.match(source, /CoinStore_OpenTriggers : \[\]trigger_device/);
  assert.doesNotMatch(source, /ConsumableEntitlementOfferzzzzTriggers|LegacyButtons|LegacyZones|CoinStoreTriggers/);
  assert.doesNotMatch(source, /PurchaseZones|mutator_zone_device|ZoneEntered/);
  const cleaned = cleanManagedData(parsed.entitlements, parsed.bundles, parsed.offerDisplayGroups);
  assert.equal('triggerDeviceName' in cleaned.entitlements[0].triggers, false);
  assert.equal('triggerDeviceName' in cleaned.storefrontMembership.focused[0], false);
});

test('only enabled bindings are emitted and bundles remain one logical storefront surface', () => {
  const disabled = structuredClone(publicApiItems[0]);
  disabled.id = 'disabled';
  disabled.verseKey = 'disabled_item';
  disabled.triggers = { generateTriggerBinding: false, generateButtonBinding: false };
  const source = generateVerseCode([...publicApiItems, disabled], publicApiBundles, { ...publicApiConfig, generateStorefrontBinding: false }, [publicApiDisplayGroups[0]]);
  assert.doesNotMatch(source, /DisabledItem_Purchase(?:Triggers|Buttons)/);
  assert.doesNotMatch(source, /DisabledItem_PurchaseZones|DisabledItemZoneEntered/);
  assert.doesNotMatch(source, /AllOffersStore_OpenButtons/);
  assert.match(source, /CoinStore_OpenTriggers/);
  assert.doesNotMatch(source, /StarterBundle_Purchase|DynamicBundle_Purchase/);
  assert.ok(source.includes('# Entitlement Purchase Bindings'));
  assert.ok(source.includes('# Storefront Bindings'));
});

test('generated editable sections are deterministically ordered before private state', () => {
  const source = generateVerseCode(publicApiItems, publicApiBundles, publicApiConfig, publicApiDisplayGroups);
  const entitlementSection = source.indexOf('# Entitlement Purchase Bindings');
  const storefrontSection = source.indexOf('# Storefront Bindings');
  const privateState = source.indexOf('    var EntitlementChangeSubscriptions');
  assert.ok(entitlementSection >= 0 && storefrontSection > entitlementSection && privateState > storefrontSection);
  assert.ok(source.indexOf('AccessPass_PurchaseTriggers') < source.indexOf('SeasonPass_PurchaseButtons'));
  assert.ok(source.indexOf('AllOffersStore_OpenButtons') < source.indexOf('CoinStore_OpenTriggers'));
});
