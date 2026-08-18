import { AlternateOffer, BundleOffer, BundleOfferItem, EntitlementItem, OfferDisplayEntry, OfferDisplayGroup, OfferRestrictions, ProjectConfig } from '../types/entitlement';
import { cleanManagedData } from './projectSchema';
import { MANIFEST_BEGIN, MANIFEST_END } from './verseParser';
import { toPascalCase } from './validator';

function escapeVerseString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function manifestLines(entitlements: EntitlementItem[], bundles: BundleOffer[], offerDisplayGroups: OfferDisplayGroup[]): string {
  const encoded = encodeBase64Utf8(JSON.stringify(cleanManagedData(entitlements, bundles, offerDisplayGroups)));
  const chunks = encoded.match(/.{1,100}/g) ?? [];
  return `${MANIFEST_BEGIN}\n${chunks.map(chunk => `# UEM_DATA ${chunk}`).join('\n')}\n${MANIFEST_END}\n\n`;
}

function displayedDescription(description: string, durationDescription = '', odds = ''): string {
  const normalizedOdds = odds.trim();
  return [description, durationDescription ? `Duration: ${durationDescription}` : '', normalizedOdds ? `Odds: ${normalizedOdds}` : ''].filter(Boolean).join('\n');
}

function metadataModule(key: string, name: string, description: string, shortDescription: string, durationDescription = '', odds = ''): string {
  const moduleName = toPascalCase(key);
  return [
    `    ${moduleName}<public> := module:`,
    `        Name<public><localizes>:message = "${escapeVerseString(name)}"`,
    `        Description<public><localizes>:message = "${escapeVerseString(displayedDescription(description, durationDescription, odds))}"`,
    `        ShortDescription<public><localizes>:message = "${escapeVerseString(shortDescription)}"`,
    '',
  ].join('\n');
}

function restrictionLines(restrictions: OfferRestrictions | undefined): string {
  const blockedCountryCodes = restrictions?.blockedCountryCodes ?? [];
  const blockedPlatformFamilies = restrictions?.blockedPlatformFamilies ?? [];
  const hasConfiguredRestrictions = Boolean(
    restrictions && (
      restrictions.minimumPurchaseAge !== undefined
      || blockedCountryCodes.length > 0
      || blockedPlatformFamilies.length > 0
    ),
  );
  if (!hasConfiguredRestrictions) return '';

  const lines: string[] = [];
  for (const country of blockedCountryCodes) lines.push(`            CountryCode <> "${escapeVerseString(country)}"`);
  for (const platform of blockedPlatformFamilies) lines.push(`            PlatformFamily <> "${escapeVerseString(platform)}"`);
  lines.push(`            return ${restrictions?.minimumPurchaseAge ?? 0}`);
  return [
    '        GetMinPurchaseAge<override>(CountryCode:string, SubdivisionCode:string, PlatformFamily:string)<decides><computes>:int =',
    ...lines,
    '',
  ].join('\n');
}

function oddsForItem(item: EntitlementItem): string {
  return item.flags.paidRandomItem ? item.flags.paidRandomItemOdds.trim() : '';
}

function offerClass(
  key: string,
  metadataKey: string,
  entitlementKey: string,
  priceModule: string,
  priceKey: string,
  iconTexture: string,
  restrictions: OfferRestrictions | undefined,
): string {
  const restriction = restrictionLines(restrictions);
  return [
    `    ${key}_offer<public> := class(entitlement_offer):`,
    `        var Name<override>:message = ${metadataKey}.Name`,
    `        var Description<override>:message = ${metadataKey}.Description`,
    `        var ShortDescription<override>:message = ${metadataKey}.ShortDescription`,
    `        var Icon<override>:texture = ${iconTexture}`,
    `        EntitlementType<override>:concrete_subtype(entitlement) = ${entitlementKey}_entitlement`,
    `        Price<override>:price_dimension = MakePriceVBucks(${priceModule}.${priceKey})`,
    restriction,
    '',
  ].filter(Boolean).join('\n');
}

function resolveBundleEntry(entry: BundleOfferItem, entitlements: EntitlementItem[], bundles: BundleOffer[]): string {
  if (entry.bundleId) {
    const nested = bundles.find(bundle => bundle.id === entry.bundleId);
    return `${nested?.verseKey ?? 'invalid'}_offer{}`;
  }
  const item = entitlements.find(candidate => candidate.id === entry.entitlementId);
  const offerKey = entry.offerVerseKey || item?.verseKey || 'invalid';
  return `${offerKey}_offer{}`;
}

function allOfferReferences(entitlements: EntitlementItem[], bundles: BundleOffer[], offersModule: string): string[] {
  const references: string[] = [];
  for (const item of entitlements) {
    references.push(`${offersModule}.${item.verseKey}_offer{}`);
    for (const alternate of item.alternateOffers ?? []) references.push(`${offersModule}.${alternate.verseKey}_offer{}`);
  }
  for (const bundle of bundles) references.push(`${offersModule}.${bundle.verseKey}_offer{}`);
  return references;
}

function resolveOfferDisplayEntry(entry: OfferDisplayEntry, entitlements: EntitlementItem[], bundles: BundleOffer[], offersModule: string): string {
  if (entry.bundleId) {
    const bundle = bundles.find(candidate => candidate.id === entry.bundleId);
    return `${offersModule}.${bundle?.verseKey ?? 'invalid'}_offer{}`;
  }
  const item = entitlements.find(candidate => candidate.id === entry.entitlementId);
  return `${offersModule}.${entry.offerVerseKey ?? item?.verseKey ?? 'invalid'}_offer{}`;
}

function paidRandomDisclosuresForBundle(bundle: BundleOffer, entitlements: EntitlementItem[], bundles: BundleOffer[], visited = new Set<string>()): string[] {
  if (visited.has(bundle.id)) return [];
  const next = new Set(visited).add(bundle.id);
  const disclosures: string[] = [];
  for (const entry of bundle.items) {
    const item = entry.entitlementId ? entitlements.find(candidate => candidate.id === entry.entitlementId) : undefined;
    const odds = item?.flags.paidRandomItem ? item.flags.paidRandomItemOdds.trim() : '';
    if (item?.flags.paidRandomItem && odds) disclosures.push(`${item.name}: ${odds}`);
    const nested = entry.bundleId ? bundles.find(candidate => candidate.id === entry.bundleId) : undefined;
    if (nested) disclosures.push(...paidRandomDisclosuresForBundle(nested, entitlements, bundles, next));
  }
  return [...new Set(disclosures)];
}

/**
 * Direct Marketplace offers carry paid-random classification on their
 * entitlement metadata, and Epic applies the relevant Purchase API rules.
 * UEM does not generate creator-authored random redemption/use logic, so a
 * paid-random check belongs at that future redemption boundary, not here.
 */
function purchaseEntryGuardLines(): string[] {
  return ['        if (Active := PurchaseInFlight[Player], Active?):'];
}

export function generateVerseCode(entitlements: EntitlementItem[], bundles: BundleOffer[] = [], config: ProjectConfig, offerDisplayGroups: OfferDisplayGroup[] = []): string {
  const infoModule = config.infoModuleName;
  const entModule = config.entitlementsModuleName;
  const priceModule = config.pricesModuleName;
  const offersModule = config.offersModuleName;
  const deviceClass = config.deviceClassName;
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(
    `# ${config.targetVerseFileName}`,
    '# Generated by ADEPT Interactive UEFN Entitlement Manager.',
    '# Edit through the manager; its versioned manifest below preserves exact project data.',
    '',
    manifestLines(entitlements, bundles, offerDisplayGroups),
    'using { /Fortnite.com/Devices }',
    'using { /Fortnite.com/Marketplace }',
    'using { /Fortnite.com/Playspaces }',
    'using { /UnrealEngine.com/Temporary/Diagnostics }',
    'using { /Verse.org/Assets }',
    'using { /Verse.org/Simulation }',
    '',
    `${config.assetFolderName}<public> := module {}`,
    '',
    `${infoModule}<public> := module:`,
  );

  for (const item of entitlements) {
    push(metadataModule(item.verseKey, item.name, item.description, item.shortDescription, item.durationDescription ?? '', oddsForItem(item)));
    for (const alternate of item.alternateOffers ?? []) {
      push(metadataModule(alternate.verseKey, alternate.name, alternate.description, alternate.shortDescription, alternate.durationDescription ?? '', oddsForItem(item)));
    }
  }
  for (const bundle of bundles) {
    const bundleOdds = paidRandomDisclosuresForBundle(bundle, entitlements, bundles).join('; ');
    push(metadataModule(bundle.verseKey, bundle.name, bundle.description, bundle.shortDescription, bundle.durationDescription ?? '', bundleOdds));
  }

  push(`${entModule}<public> := module:`, `    using { ${infoModule} }`, '', '    basic_entitlement<public> := class<abstract><castable>(entitlement){}', '');
  for (const item of entitlements) {
    const metadataKey = toPascalCase(item.verseKey);
    push(
      `    ${item.verseKey}_entitlement<public> := class<concrete>(basic_entitlement):`,
      `        var Name<override>:message = ${metadataKey}.Name`,
      `        var Description<override>:message = ${metadataKey}.Description`,
      `        var ShortDescription<override>:message = ${metadataKey}.ShortDescription`,
      `        var Icon<override>:texture = ${item.iconTexture}`,
      `        PaidRandomItem<override>:logic = ${item.flags.paidRandomItem}`,
      `        PaidArea<override>:logic = ${item.flags.paidArea}`,
      `        Consumable<override>:logic = ${item.itemType === 'consumable'}`,
      `        MaxCount<override>:int = ${item.itemType === 'durable' ? 1 : item.maxCount}`,
      `        ConsequentialToGameplay<override>:logic = ${item.flags.consequentialToGameplay}`,
      '',
    );
  }

  push(`${priceModule}<public> := module:`);
  for (const item of entitlements) {
    push(`    ${item.verseKey}_price<public>:float = ${item.priceVBucks.toFixed(1)}`);
    for (const alternate of item.alternateOffers ?? []) push(`    ${alternate.verseKey}_price<public>:float = ${alternate.priceVBucks.toFixed(1)}`);
  }
  for (const bundle of bundles) push(`    ${bundle.verseKey}_price<public>:float = ${bundle.priceVBucks.toFixed(1)}`);
  push('');

  push(`${offersModule}<public> := module:`, `    using { ${infoModule} }`, `    using { ${entModule} }`, `    using { ${priceModule} }`, '');
  for (const item of entitlements) {
    push(offerClass(item.verseKey, `${infoModule}.${toPascalCase(item.verseKey)}`, item.verseKey, priceModule, `${item.verseKey}_price`, item.iconTexture, item.offerRestrictions));
    for (const alternate of item.alternateOffers ?? []) {
      push(offerClass(alternate.verseKey, `${infoModule}.${toPascalCase(alternate.verseKey)}`, item.verseKey, priceModule, `${alternate.verseKey}_price`, alternate.iconTexture, alternate.restrictions));
    }
  }
  for (const bundle of bundles) {
    const bundleMetadata = `${infoModule}.${toPascalCase(bundle.verseKey)}`;
    const entries = bundle.items.map(entry => `(${resolveBundleEntry(entry, entitlements, bundles)}, ${entry.quantity})`).join(', ');
    push(
      `    ${bundle.verseKey}_offer<public> := class(bundle_offer):`,
      `        var Name<override>:message = ${bundleMetadata}.Name`,
      `        var Description<override>:message = ${bundleMetadata}.Description`,
      `        var ShortDescription<override>:message = ${bundleMetadata}.ShortDescription`,
      `        var Icon<override>:texture = ${bundle.iconTexture}`,
      `        Offers<override>:[]tuple(offer, int) = array{${entries}}`,
      `        Price<override>:price_dimension = MakePriceVBucks(${priceModule}.${bundle.verseKey}_price)`,
      restrictionLines(bundle.restrictions),
      '',
    );
    if (bundle.dynamicRemaining && bundle.items[0]) {
      const dynamicEntry = bundle.items[0];
      push(
        `    ${bundle.verseKey}_dynamic_offer<public> := class(bundle_offer):`,
        `        var Name<override>:message = ${bundleMetadata}.Name`,
        `        var Description<override>:message = ${bundleMetadata}.Description`,
        `        var ShortDescription<override>:message = ${bundleMetadata}.ShortDescription`,
        `        var Icon<override>:texture = ${bundle.iconTexture}`,
        '        var Offers<override>:[]tuple(offer, int) = array{}',
        `        Price<override>:price_dimension = MakePriceVBucks(${priceModule}.${bundle.verseKey}_price)`,
        restrictionLines(bundle.restrictions),
        '',
      );
      void dynamicEntry;
    }
  }

  push(`${deviceClass} := class(creative_device):`, '');
  for (const item of entitlements) {
    if (item.triggers.generateTriggerBinding) push('    @editable', `    ${item.triggers.triggerDeviceName} : []trigger_device = array{}`, '');
    if (item.triggers.generateButtonBinding) push('    @editable', `    ${item.triggers.buttonDeviceName} : []button_device = array{}`, '');
    if (item.triggers.generateZoneBinding) push('    @editable', `    ${item.triggers.mutatorZoneName} : []mutator_zone_device = array{}`, '');
  }
  if (config.generateStorefrontBinding) push('    @editable', `    ${config.storefrontButtonDeviceName} : []button_device = array{}`, '');
  for (const group of offerDisplayGroups) {
    if (group.generateTriggerBinding) push('    @editable', `    ${group.triggerDeviceName} : []trigger_device = array{}`, '');
  }

  push(
    '    var EntitlementChangeSubscriptions:[player]?cancelable = map{}',
    '    var PlayerJoinSubscription:?cancelable = false',
    '    var PlayerLeftSubscription:?cancelable = false',
    '    var DeviceSubscriptions:[]cancelable = array{}',
    '    var PurchaseInFlight:[player]logic = map{}',
    '    var StorefrontInFlight:[player]logic = map{}',
    '',
  );
  for (const item of entitlements) {
    const pascal = toPascalCase(item.verseKey);
    push(
      `    ${item.purchaseEventName}<public>:event(player) = event(player){}`,
      `    ${pascal}${item.itemType === 'durable' ? 'OwnershipRemovedEvent' : 'QuantityDecreasedEvent'}<public>:event(player) = event(player){}`,
      `    ${pascal}EntitlementGrantedEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
      `    ${pascal}EntitlementRemovedEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
      `    ${pascal}EntitlementReconciledEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
      ...(item.itemType === 'durable' && item.restoreOnJoin ? [`    ${pascal}OwnershipVerifiedEvent<public>:event(player) = event(player){}`] : []),
    );
  }
  push('');

  push(
    '    OnBegin<override>()<suspends>:void =',
    '        JoinSubscription := GetPlayspace().PlayerAddedEvent().Subscribe(OnPlayerAdded)',
    '        set PlayerJoinSubscription = option{JoinSubscription}',
    '        LeftSubscription := GetPlayspace().PlayerRemovedEvent().Subscribe(OnPlayerRemoved)',
    '        set PlayerLeftSubscription = option{LeftSubscription}',
    '        for (Player : GetPlayspace().GetPlayers()):',
    '            OnPlayerAdded(Player)',
  );
  for (const item of entitlements) {
    const pascal = toPascalCase(item.verseKey);
    if (item.triggers.generateTriggerBinding) push(`        for (Trigger : ${item.triggers.triggerDeviceName}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${pascal}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
    if (item.triggers.generateButtonBinding) push(`        for (Button : ${item.triggers.buttonDeviceName}):`, `            Subscription := Button.InteractedWithEvent.Subscribe(On${pascal}ButtonInteracted)`, '            set DeviceSubscriptions += array{Subscription}');
    if (item.triggers.generateZoneBinding) push(`        for (Zone : ${item.triggers.mutatorZoneName}):`, `            Subscription := Zone.AgentEntersEvent.Subscribe(On${pascal}ZoneEntered)`, '            set DeviceSubscriptions += array{Subscription}');
  }
  if (config.generateStorefrontBinding) push(`        for (Button : ${config.storefrontButtonDeviceName}):`, '            Subscription := Button.InteractedWithEvent.Subscribe(OnStorefrontButtonInteracted)', '            set DeviceSubscriptions += array{Subscription}');
  for (const group of offerDisplayGroups) {
    if (group.generateTriggerBinding) push(`        for (Trigger : ${group.triggerDeviceName}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${toPascalCase(group.verseKey)}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
  }
  push('');

  push(
    '    OnEnd<override>():void =',
    '        if (Subscription := PlayerJoinSubscription?):',
    '            Subscription.Cancel()',
    '        if (Subscription := PlayerLeftSubscription?):',
    '            Subscription.Cancel()',
    '        for (PlayerKey -> MaybeSubscription : EntitlementChangeSubscriptions):',
    '            if (Subscription := MaybeSubscription?):',
    '                Subscription.Cancel()',
    '        for (Subscription : DeviceSubscriptions):',
    '            Subscription.Cancel()',
    '',
    '    OnPlayerAdded(Player:player):void =',
    '        RemovePlayerSubscription(Player)',
    `        Subscription := GetEntitlementsChangedEvent(Player, ${entModule}.basic_entitlement).Subscribe(OnEntitlementsChanged)`,
    '        if (set EntitlementChangeSubscriptions[Player] = option{Subscription}):',
    '            Print("Entitlement listener registered")',
    '        spawn{ReconcilePlayerEntitlements(Player)}',
    '',
    '    OnPlayerRemoved(Player:player):void =',
    '        RemovePlayerSubscription(Player)',
    '        ClearPurchaseInFlight(Player)',
    '        ClearStorefrontInFlight(Player)',
    '',
    '    RemovePlayerSubscription(Player:player):void =',
    '        if (Subscription := EntitlementChangeSubscriptions[Player]?):',
    '            Subscription.Cancel()',
    '        var RemainingSubscriptions:[player]?cancelable = map{}',
    '        for (Key -> Value : EntitlementChangeSubscriptions, Key <> Player):',
    '            set RemainingSubscriptions = ConcatenateMaps(RemainingSubscriptions, map{Key => Value})',
    '        set EntitlementChangeSubscriptions = RemainingSubscriptions',
    '',
    '    ClearPurchaseInFlight(Player:player):void =',
    '        var RemainingPurchases:[player]logic = map{}',
    '        for (Key -> Value : PurchaseInFlight, Key <> Player):',
    '            set RemainingPurchases = ConcatenateMaps(RemainingPurchases, map{Key => Value})',
    '        set PurchaseInFlight = RemainingPurchases',
    '',
    '    ClearStorefrontInFlight(Player:player):void =',
    '        var RemainingStorefronts:[player]logic = map{}',
    '        for (Key -> Value : StorefrontInFlight, Key <> Player):',
    '            set RemainingStorefronts = ConcatenateMaps(RemainingStorefronts, map{Key => Value})',
    '        set StorefrontInFlight = RemainingStorefronts',
    '',
    '    OnEntitlementsChanged(Player:player, Changes:[]entitlement_change(entitlement)):void =',
    '        for (EntitlementChange : Changes, ChangedEntitlement := EntitlementChange.Entitlement):',
    '            if (EntitlementChange.Change > 0):',
  );
  for (const item of entitlements) {
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toPascalCase(item.verseKey)}Grant(Player, EntitlementChange.Change)`);
  }
  push('            else if (EntitlementChange.Change < 0):');
  for (const item of entitlements) {
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toPascalCase(item.verseKey)}Removal(Player, 0 - EntitlementChange.Change)`);
  }
  push('');

  for (const item of entitlements) {
    const pascal = toPascalCase(item.verseKey);
    const printableName = escapeVerseString(item.name);
    push(
      '    # Signals for every positive entitlement delta, including purchases and direct grants.',
      '    # Apply gameplay benefits here; do not rely on BuyOffer or GrantEntitlement return values.',
      `    Process${pascal}Grant(Player:player, Quantity:int):void =`,
      `        Print("Granted ${printableName} x{Quantity}")`,
      `        ${item.purchaseEventName}.Signal(Player)`,
      `        ${pascal}EntitlementGrantedEvent.Signal((Player, Quantity))`,
      ...(item.itemType === 'consumable' && item.autoConsume ? [`        spawn{Consume${pascal}(Player, Quantity)}`] : []),
      '',
      `    Process${pascal}Removal(Player:player, Quantity:int):void =`,
      `        Print("${item.itemType === 'durable' ? 'Ownership removed for' : 'Inventory decreased for'} ${printableName} x{Quantity}; reconcile saved state")`,
      `        ${pascal}${item.itemType === 'durable' ? 'OwnershipRemovedEvent' : 'QuantityDecreasedEvent'}.Signal(Player)`,
      `        ${pascal}EntitlementRemovedEvent.Signal((Player, Quantity))`,
      '',
    );
    if (item.itemType === 'consumable') {
      push(
        `    Consume${pascal}<public>(Player:player, Quantity:int)<suspends>:void =`,
        '        if (Quantity > 0):',
        `            Result := ConsumeEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
        '            if (not Result?):',
        `                Print("Failed to consume ${printableName}")`,
        '        else:',
        '            Print("Consume quantity must be positive")',
        '',
      );
    }
    push(
      '    # Direct grants bypass offer disclosures and the purchase flow. Use only for deliberate free grants.',
      `    Grant${pascal}<public>(Player:player, Quantity:int)<suspends>:void =`,
      '        if (Quantity > 0):',
      `            Result := GrantEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
      '            if (not Result?):',
      `                Print("Failed to grant ${printableName}")`,
      '        else:',
      '            Print("Grant quantity must be positive")',
      '',
    );
  }

  for (const item of entitlements) {
    const pascal = toPascalCase(item.verseKey);
    const printableName = escapeVerseString(item.name);
    const purchaseGuard = purchaseEntryGuardLines();
    if (item.triggers.generateTriggerBinding) {
      push(
        `    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`,
        `        if (Agent := MaybeAgent?):`,
        `            if (Player := player[Agent]):`,
        `                PromptBuy${pascal}(Player)`,
        '',
      );
    }
    if (item.triggers.generateButtonBinding) {
      push(
        `    On${pascal}ButtonInteracted(Agent:agent):void =`,
        `        if (Player := player[Agent]):`,
        `            PromptBuy${pascal}(Player)`,
        '',
      );
    }
    if (item.triggers.generateZoneBinding) {
      push(
        `    On${pascal}ZoneEntered(Agent:agent):void =`,
        `        if (Player := player[Agent]):`,
        ...(config.allowAutomaticZonePrompts ? [`            PromptBuy${pascal}(Player)`] : ['            Print("Shop zone entered; use a deliberate shop interaction to open the storefront")']),
        '',
      );
    }
    push(
      `    PromptBuy${pascal}<public>(Player:player):void =`,
      ...purchaseGuard,
      '            Print("A purchase dialog is already open for this player")',
      '        else if (set PurchaseInFlight[Player] = true):',
      `            spawn{ExecuteBuy${pascal}(Player)}`,
      '        else:',
      '            Print("Unable to start a purchase dialog")',
      '',
      `    ExecuteBuy${pascal}(Player:player)<suspends>:void =`,
      `        WasPurchased := BuyOffer(Player, ${offersModule}.${item.verseKey}_offer{})`,
      '        if (not WasPurchased?):',
      `            Print("Purchase dialog closed without buying ${printableName}")`,
      '        ClearPurchaseInFlight(Player)',
      '',
    );
    for (const alternate of item.alternateOffers ?? []) {
      const altPascal = toPascalCase(alternate.verseKey);
      push(
        `    PromptBuy${altPascal}<public>(Player:player):void =`,
        ...purchaseGuard,
        '            Print("A purchase dialog is already open for this player")',
        '        else if (set PurchaseInFlight[Player] = true):',
        `            spawn{ExecuteBuy${altPascal}(Player)}`,
        '        else:',
        '            Print("Unable to start a purchase dialog")',
        '',
        `    ExecuteBuy${altPascal}(Player:player)<suspends>:void =`,
        `        WasPurchased := BuyOffer(Player, ${offersModule}.${alternate.verseKey}_offer{})`,
        '        if (not WasPurchased?):',
        `            Print("Purchase dialog closed without buying ${escapeVerseString(alternate.name)}")`,
        '        ClearPurchaseInFlight(Player)',
        '',
      );
    }
  }

  for (const bundle of bundles) {
    const pascal = toPascalCase(bundle.verseKey);
    const printableName = escapeVerseString(bundle.name);
    const dynamic = Boolean(bundle.dynamicRemaining && bundle.items[0] && bundle.items[0].entitlementId);
    const bundlePurchaseGuard = purchaseEntryGuardLines();
    push(
      `    PromptBuy${pascal}<public>(Player:player):void =`,
      ...bundlePurchaseGuard,
      '            Print("A purchase dialog is already open for this player")',
      '        else if (set PurchaseInFlight[Player] = true):',
      `            spawn{ExecuteBuy${pascal}(Player)}`,
      '        else:',
      '            Print("Unable to start a purchase dialog")',
      '',
      `    ExecuteBuy${pascal}(Player:player)<suspends>:void =`,
    );
    if (dynamic) {
      const entry = bundle.items[0];
      const item = entitlements.find(candidate => candidate.id === entry.entitlementId)!;
      const offerReference = `${offersModule}.${resolveBundleEntry(entry, entitlements, bundles)}`;
      push(
        `        Purchases := GetPurchasedEntitlements(Player, ${entModule}.${item.verseKey}_entitlement)`,
        '        var OwnedCount:int = 0',
        '        if (Purchase := Purchases[0]):',
        '            set OwnedCount = Purchase(1)',
        `        RemainingCount := ${item.maxCount} - OwnedCount`,
        '        if (RemainingCount > 0):',
        `            DynamicOffer := ${offersModule}.${bundle.verseKey}_dynamic_offer{}`,
        `            set DynamicOffer.Offers = array{(${offerReference}, RemainingCount)}`,
        '            WasPurchased := BuyOffer(Player, DynamicOffer)',
        '            if (not WasPurchased?):',
        `                Print("Purchase dialog closed without buying ${printableName}")`,
        '        else:',
        `            Print("${escapeVerseString(item.name)} is already at its maximum owned quantity")`,
      );
    } else {
      push(
        `        WasPurchased := BuyOffer(Player, ${offersModule}.${bundle.verseKey}_offer{})`,
        '        if (not WasPurchased?):',
        `            Print("Purchase dialog closed without buying ${printableName}")`,
      );
    }
    push('        ClearPurchaseInFlight(Player)', '');
  }

  push('    AllOffersStoreTitle<localizes>:message = "All Offers"', '', '    ShowStorefront<public>(Player:player)<suspends>:void =');
  if (allOfferReferences(entitlements, bundles, offersModule).length) push(`        ShowOffersDialog(Player, array{${allOfferReferences(entitlements, bundles, offersModule).join(', ')}}, ?Title := AllOffersStoreTitle)`);
  else push('        Print("No transaction offers are configured")');
  push('', '    OpenStorefront<public>(Player:player):void =', '        if (Active := StorefrontInFlight[Player], Active?):', '            Print("The storefront is already open for this player")', '        else if (set StorefrontInFlight[Player] = true):', '            spawn{ShowStorefrontAndRelease(Player)}', '        else:', '            Print("Unable to open the storefront")', '', '    ShowStorefrontAndRelease(Player:player)<suspends>:void =', '        ShowStorefront(Player)', '        ClearStorefrontInFlight(Player)', '');
  if (config.generateStorefrontBinding) push('    OnStorefrontButtonInteracted(Agent:agent):void =', '        if (Player := player[Agent]):', '            OpenStorefront(Player)', '');

  for (const group of offerDisplayGroups) {
    const pascal = toPascalCase(group.verseKey);
    const references = group.entries.map(entry => resolveOfferDisplayEntry(entry, entitlements, bundles, offersModule));
    push(
      `    ${pascal}Title<localizes>:message = "${escapeVerseString(group.name)}"`,
      '',
      `    Show${pascal}<public>(Player:player)<suspends>:void =`,
      `        ShowOffersDialog(Player, array{${references.join(', ')}}, ?Title := ${pascal}Title)`,
      '',
      `    Open${pascal}<public>(Player:player):void =`,
      '        if (Active := StorefrontInFlight[Player], Active?):',
      '            Print("A storefront is already open for this player")',
      '        else if (set StorefrontInFlight[Player] = true):',
      `            spawn{Show${pascal}AndRelease(Player)}`,
      '        else:',
      '            Print("Unable to open the storefront")',
      '',
      `    Show${pascal}AndRelease(Player:player)<suspends>:void =`,
      `        Show${pascal}(Player)`,
      '        ClearStorefrontInFlight(Player)',
      '',
    );
    if (group.generateTriggerBinding) push(`    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`, '        if (Agent := MaybeAgent?):', '            if (Player := player[Agent]):', `                Open${pascal}(Player)`, '');
  }

  push('    ReconcilePlayerEntitlements(Player:player)<suspends>:void =');
  for (const item of entitlements) {
    const pascal = toPascalCase(item.verseKey);
    push(
      `        ${pascal}Purchases := GetPurchasedEntitlements(Player, ${entModule}.${item.verseKey}_entitlement)`,
      `        var ${pascal}OwnedCount:int = 0`,
      `        if (Owned := ${pascal}Purchases[0]):`,
      `            set ${pascal}OwnedCount = Owned(1)`,
      `        ${pascal}EntitlementReconciledEvent.Signal((Player, ${pascal}OwnedCount))`,
      ...(item.itemType === 'durable' && item.restoreOnJoin ? [`        if (${pascal}OwnedCount > 0):`, `            ${pascal}OwnershipVerifiedEvent.Signal(Player)`] : []),
    );
  }
  push('');

  return lines.join('\n');
}
