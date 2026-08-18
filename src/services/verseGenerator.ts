import { AlternateOffer, BundleOffer, BundleOfferItem, EntitlementItem, GeneratedApiOptions, OfferDisplayEntry, OfferDisplayGroup, OfferRestrictions, ProjectConfig } from '../types/entitlement';
import { cleanManagedData, normalizeBundle, normalizeEntitlement, normalizeOfferDisplayGroup } from './projectSchema';
import { MANIFEST_BEGIN, MANIFEST_END } from './verseParser';
import { isValidVerseIdentifier, toVerseApiStem } from './verseIdentity';

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

function canonicalizeManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeManifestValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalizeManifestValue(entry)]));
  }
  return value;
}

function manifestLines(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[],
  offerDisplayGroups: OfferDisplayGroup[],
  retiredVerseKeys: string[],
  apiOptions: GeneratedApiOptions,
): string {
  const encoded = encodeBase64Utf8(JSON.stringify(canonicalizeManifestValue(cleanManagedData(entitlements, bundles, offerDisplayGroups, retiredVerseKeys, apiOptions))));
  const chunks = encoded.match(/.{1,100}/g) ?? [];
  return `${MANIFEST_BEGIN}\n${chunks.map(chunk => `# UEM_DATA ${chunk}`).join('\n')}\n${MANIFEST_END}\n\n`;
}

function displayedDescription(description: string, durationDescription = '', odds = ''): string {
  const normalizedOdds = odds.trim();
  return [description, durationDescription ? `Duration: ${durationDescription}` : '', normalizedOdds ? `Odds: ${normalizedOdds}` : ''].filter(Boolean).join('\n');
}

function metadataModule(key: string, name: string, description: string, shortDescription: string, durationDescription = '', odds = ''): string {
  const moduleName = toVerseApiStem(key);
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

export function generateVerseCode(
  entitlements: EntitlementItem[],
  bundles: BundleOffer[] = [],
  config: ProjectConfig,
  offerDisplayGroups: OfferDisplayGroup[] = [],
  retiredVerseKeys: string[] = [],
  apiOptions: GeneratedApiOptions = { generatedApiVersion: 2 },
): string {
  // Keep direct generation and parse -> regenerate output identical even when
  // callers provide older or partially populated managed-data shapes.
  entitlements = entitlements.map(normalizeEntitlement);
  bundles = bundles.map(normalizeBundle);
  offerDisplayGroups = offerDisplayGroups.map(normalizeOfferDisplayGroup);
  const generatedApiVersion = apiOptions.generatedApiVersion ?? 2;
  const canonicalApi = generatedApiVersion === 2;
  const preserveLegacyApi = generatedApiVersion === 1 || apiOptions.legacyApiCompatibility === true;
  const infoModule = config.infoModuleName;
  const entModule = config.entitlementsModuleName;
  const priceModule = config.pricesModuleName;
  const offersModule = config.offersModuleName;
  const deviceClass = config.deviceClassName;
  const legacyEventNamesById = new Map<string, Set<string>>();
  const usedLegacyEventNames = new Set<string>();
  const addLegacyEvent = (item: EntitlementItem, name: string): void => {
    if (!isValidVerseIdentifier(name)) return;
    const normalized = name.toLowerCase();
    if (usedLegacyEventNames.has(normalized)) return;
    usedLegacyEventNames.add(normalized);
    const names = legacyEventNamesById.get(item.id) ?? new Set<string>();
    names.add(name);
    legacyEventNamesById.set(item.id, names);
  };
  for (const item of entitlements) {
    const legacyStem = toVerseApiStem(item.verseKey);
    addLegacyEvent(item, item.purchaseEventName);
    addLegacyEvent(item, `${legacyStem}${item.itemType === 'durable' ? 'OwnershipRemovedEvent' : 'QuantityDecreasedEvent'}`);
    addLegacyEvent(item, `${legacyStem}EntitlementGrantedEvent`);
    addLegacyEvent(item, `${legacyStem}EntitlementRemovedEvent`);
    addLegacyEvent(item, `${legacyStem}EntitlementReconciledEvent`);
    if (item.itemType === 'durable' && item.restoreOnJoin) addLegacyEvent(item, `${legacyStem}OwnershipVerifiedEvent`);
  }
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(
    `# ${config.targetVerseFileName}`,
    '# Generated and managed by ADEPT Interactive UEFN Entitlement Manager. Do not edit manually.',
    '# Configure through UEM and integrate from your own Verse using the generated public API; regeneration may replace this file.',
    '',
    manifestLines(entitlements, bundles, offerDisplayGroups, retiredVerseKeys, { ...apiOptions, generatedApiVersion }),
    ...(apiOptions.legacyApiDiagnostics?.length
      ? ['# Legacy API migration diagnostics are preserved in the manifest for developer review.', ...apiOptions.legacyApiDiagnostics.map(diagnostic => `# ${diagnostic}`), '']
      : []),
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
    const metadataKey = toVerseApiStem(item.verseKey);
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
    push(offerClass(item.verseKey, `${infoModule}.${toVerseApiStem(item.verseKey)}`, item.verseKey, priceModule, `${item.verseKey}_price`, item.iconTexture, item.offerRestrictions));
    for (const alternate of item.alternateOffers ?? []) {
      push(offerClass(alternate.verseKey, `${infoModule}.${toVerseApiStem(alternate.verseKey)}`, item.verseKey, priceModule, `${alternate.verseKey}_price`, alternate.iconTexture, alternate.restrictions));
    }
  }
  for (const bundle of bundles) {
    const bundleMetadata = `${infoModule}.${toVerseApiStem(bundle.verseKey)}`;
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
  if (preserveLegacyApi) push(
    canonicalApi
      ? '    # Legacy UEM API compatibility only. Prefer the canonical *_GrantedEvent, *_RemovedEvent, and *_ReconciledEvent from your own Verse.'
      : '    # Legacy UEM API declarations. Integrate from external Verse; purchase-named events are not proof that a purchase occurred.',
    '',
  );
  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    if (canonicalApi) {
      push(
        `    ${pascal}_GrantedEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
        `    ${pascal}_RemovedEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
        `    ${pascal}_ReconciledEvent<public>:event(tuple(player, int)) = event(tuple(player, int)){}`,
      );
    }
    if (preserveLegacyApi) {
      const legacyNames = legacyEventNamesById.get(item.id) ?? new Set<string>();
      for (const name of legacyNames) {
        const type = name === item.purchaseEventName ? 'event(player)' : name.endsWith('OwnershipVerifiedEvent') || name.endsWith('OwnershipRemovedEvent') || name.endsWith('QuantityDecreasedEvent') ? 'event(player)' : 'event(tuple(player, int))';
        push(`    ${name}<public>:${type} = ${type}{}`);
      }
    }
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
    const pascal = toVerseApiStem(item.verseKey);
    if (item.triggers.generateTriggerBinding) push(`        for (Trigger : ${item.triggers.triggerDeviceName}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${pascal}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
    if (item.triggers.generateButtonBinding) push(`        for (Button : ${item.triggers.buttonDeviceName}):`, `            Subscription := Button.InteractedWithEvent.Subscribe(On${pascal}ButtonInteracted)`, '            set DeviceSubscriptions += array{Subscription}');
    if (item.triggers.generateZoneBinding) push(`        for (Zone : ${item.triggers.mutatorZoneName}):`, `            Subscription := Zone.AgentEntersEvent.Subscribe(On${pascal}ZoneEntered)`, '            set DeviceSubscriptions += array{Subscription}');
  }
  if (config.generateStorefrontBinding) push(`        for (Button : ${config.storefrontButtonDeviceName}):`, '            Subscription := Button.InteractedWithEvent.Subscribe(OnStorefrontButtonInteracted)', '            set DeviceSubscriptions += array{Subscription}');
  for (const group of offerDisplayGroups) {
    if (group.generateTriggerBinding) push(`        for (Trigger : ${group.triggerDeviceName}):`, `            Subscription := Trigger.TriggeredEvent.Subscribe(On${toVerseApiStem(group.verseKey)}TriggerActivated)`, '            set DeviceSubscriptions += array{Subscription}');
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
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toVerseApiStem(item.verseKey)}Grant(Player, EntitlementChange.Change)`);
  }
  push('            else if (EntitlementChange.Change < 0):');
  for (const item of entitlements) {
    push(`                if (${entModule}.${item.verseKey}_entitlement[ChangedEntitlement]):`, `                    Process${toVerseApiStem(item.verseKey)}Removal(Player, 0 - EntitlementChange.Change)`);
  }
  push('');

  push(
    '    # Managed implementation. Subscribe to the generated entitlement delta events from your own Verse to apply gameplay effects.',
    '    # Do not edit these handlers; regeneration may replace the managed implementation.',
    '',
  );

  push(
    canonicalApi
      ? '    # Grant and Consume return the native Marketplace operation result; true does not mean gameplay state has already been processed.'
      : '    # Grant and Consume retain the historical API-v1 void contract; use the generated entitlement events for gameplay state.',
    '    # Direct grants bypass offer disclosures and the purchase flow. Use them only for deliberate free grants.',
    '    # Apply gameplay changes from the generated entitlement delta events or current-state query helpers in external Verse.',
    '',
  );

  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const printableName = escapeVerseString(item.name);
    const legacyNames = legacyEventNamesById.get(item.id) ?? new Set<string>();
    const legacyStem = toVerseApiStem(item.verseKey);
    const legacyRemovedName = `${legacyStem}${item.itemType === 'durable' ? 'OwnershipRemovedEvent' : 'QuantityDecreasedEvent'}`;
    const legacyGrantedName = `${legacyStem}EntitlementGrantedEvent`;
    const legacyEntitlementRemovedName = `${legacyStem}EntitlementRemovedEvent`;
    push(
      `    Process${pascal}Grant(Player:player, Quantity:int):void =`,
      `        Print("Granted ${printableName} x{Quantity}")`,
      ...(preserveLegacyApi && legacyNames.has(item.purchaseEventName) ? [`        ${item.purchaseEventName}.Signal(Player)`] : []),
      ...(preserveLegacyApi && legacyNames.has(legacyGrantedName) ? [`        ${legacyGrantedName}.Signal((Player, Quantity))`] : []),
      ...(canonicalApi ? [`        ${pascal}_GrantedEvent.Signal((Player, Quantity))`] : []),
      ...(item.itemType === 'consumable' && item.autoConsume
        ? [`        spawn{${canonicalApi ? `AutoConsume${pascal}` : `Consume${pascal}`}(Player, Quantity)}`]
        : []),
      '',
      `    Process${pascal}Removal(Player:player, Quantity:int):void =`,
      `        Print("${item.itemType === 'durable' ? 'Ownership removed for' : 'Inventory decreased for'} ${printableName} x{Quantity}; reconcile saved state")`,
      ...(preserveLegacyApi && legacyNames.has(legacyRemovedName) ? [`        ${legacyRemovedName}.Signal(Player)`] : []),
      ...(preserveLegacyApi && legacyNames.has(legacyEntitlementRemovedName) ? [`        ${legacyEntitlementRemovedName}.Signal((Player, Quantity))`] : []),
      ...(canonicalApi ? [`        ${pascal}_RemovedEvent.Signal((Player, Quantity))`] : []),
      '',
    );
    if (item.itemType === 'consumable') {
      if (canonicalApi) {
        push(
          `    Consume${pascal}<public>(Player:player, Quantity:int)<suspends>:logic =`,
          '        if (Quantity > 0):',
          `            Result := ConsumeEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
          '            if (not Result?):',
          `                Print("Failed to consume ${printableName}")`,
          '            return Result',
          '        Print("Consume quantity must be positive")',
          '        return false',
          '',
        );
        if (item.autoConsume) {
          push(
            `    # Auto-consume intentionally discards Consume${pascal}'s operation result; the public helper logs failures before returning it.`,
            `    AutoConsume${pascal}(Player:player, Quantity:int)<suspends>:void =`,
            `        Consume${pascal}(Player, Quantity)`,
            '',
          );
        }
      } else {
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
    }
    if (canonicalApi) {
      push(
        `    Grant${pascal}<public>(Player:player, Quantity:int)<suspends>:logic =`,
        '        if (Quantity > 0):',
        `            Result := GrantEntitlement(Player, ${entModule}.${item.verseKey}_entitlement, ?Count := Quantity)`,
        '            if (not Result?):',
        `                Print("Failed to grant ${printableName}")`,
        '            return Result',
        '        Print("Grant quantity must be positive")',
        '        return false',
        '',
      );
    } else {
      push(
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
  }

  if (canonicalApi) {
    for (const item of entitlements) {
      const pascal = toVerseApiStem(item.verseKey);
      push(
        `    Get${pascal}Count<public>(Player:player)<suspends>:int =`,
        `        Purchases := GetPurchasedEntitlements(Player, ${entModule}.${item.verseKey}_entitlement)`,
        '        if (Purchase := Purchases[0]):',
        '            return Purchase(1)',
        '        0',
        '',
        `    Has${pascal}<public>(Player:player)<suspends>:logic =`,
        `        OwnedCount := Get${pascal}Count(Player)`,
        '        if (OwnedCount > 0):',
        '            return true',
        '        false',
        '',
      );
    }
  }

  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const printableName = escapeVerseString(item.name);
    const purchaseGuard = purchaseEntryGuardLines();
    const purchaseEntryName = canonicalApi ? `Open${pascal}Purchase` : `PromptBuy${pascal}`;
    if (item.triggers.generateTriggerBinding) {
      push(
        `    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`,
        `        if (Agent := MaybeAgent?):`,
        `            if (Player := player[Agent]):`,
        `                ${purchaseEntryName}(Player)`,
        '',
      );
    }
    if (item.triggers.generateButtonBinding) {
      push(
        `    On${pascal}ButtonInteracted(Agent:agent):void =`,
        `        if (Player := player[Agent]):`,
        `            ${purchaseEntryName}(Player)`,
        '',
      );
    }
    if (item.triggers.generateZoneBinding) {
      push(
        `    On${pascal}ZoneEntered(Agent:agent):void =`,
        `        if (Player := player[Agent]):`,
        ...(config.allowAutomaticZonePrompts ? [`            ${purchaseEntryName}(Player)`] : ['            Print("Shop zone entered; use a deliberate shop interaction to open the storefront")']),
        '',
      );
    }
    push(
      `    ${purchaseEntryName}<public>(Player:player):void =`,
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
    if (canonicalApi && preserveLegacyApi) {
      push(
        `    # Deprecated v1 compatibility wrapper. Prefer ${purchaseEntryName}.`,
        `    PromptBuy${pascal}<public>(Player:player):void =`,
        `        ${purchaseEntryName}(Player)`,
        '',
      );
    }
    for (const alternate of item.alternateOffers ?? []) {
      const altPascal = toVerseApiStem(alternate.verseKey);
      push(
        `    ${canonicalApi ? `Open${altPascal}Purchase` : `PromptBuy${altPascal}`}<public>(Player:player):void =`,
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
      if (canonicalApi && preserveLegacyApi) {
        push(
          `    # Deprecated v1 compatibility wrapper. Prefer Open${altPascal}Purchase.`,
          `    PromptBuy${altPascal}<public>(Player:player):void =`,
          `        Open${altPascal}Purchase(Player)`,
          '',
        );
      }
    }
  }

  for (const bundle of bundles) {
    const pascal = toVerseApiStem(bundle.verseKey);
    const printableName = escapeVerseString(bundle.name);
    const dynamic = Boolean(bundle.dynamicRemaining && bundle.items[0] && bundle.items[0].entitlementId);
    const bundlePurchaseGuard = purchaseEntryGuardLines();
    const purchaseEntryName = canonicalApi ? `Open${pascal}Purchase` : `PromptBuy${pascal}`;
    push(
      `    ${purchaseEntryName}<public>(Player:player):void =`,
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
    if (canonicalApi && preserveLegacyApi) {
      push(
        `    # Deprecated v1 compatibility wrapper. Prefer ${purchaseEntryName}.`,
        `    PromptBuy${pascal}<public>(Player:player):void =`,
        `        ${purchaseEntryName}(Player)`,
        '',
      );
    }
  }

  const allOffers = allOfferReferences(entitlements, bundles, offersModule);
  push('    AllOffersStoreTitle<localizes>:message = "All Offers"', '');
  if (!canonicalApi) {
    push('    ShowStorefront<public>(Player:player)<suspends>:void =');
    if (allOffers.length) push(`        ShowOffersDialog(Player, array{${allOffers.join(', ')}}, ?Title := AllOffersStoreTitle)`);
    else push('        Print("No transaction offers are configured")');
    push('', '    OpenStorefront<public>(Player:player):void =', '        if (Active := StorefrontInFlight[Player], Active?):', '            Print("The storefront is already open for this player")', '        else if (set StorefrontInFlight[Player] = true):', '            spawn{ShowStorefrontAndRelease(Player)}', '        else:', '            Print("Unable to open the storefront")', '', '    ShowStorefrontAndRelease(Player:player)<suspends>:void =', '        ShowStorefront(Player)', '        ClearStorefrontInFlight(Player)', '');
  } else {
    push('    ShowAllOffers(Player:player)<suspends>:void =');
    if (allOffers.length) push(`        ShowOffersDialog(Player, array{${allOffers.join(', ')}}, ?Title := AllOffersStoreTitle)`);
    else push('        Print("No transaction offers are configured")');
    push(
      '',
      '    ShowAllOffersAndRelease(Player:player)<suspends>:void =',
      '        ShowAllOffers(Player)',
      '        ClearStorefrontInFlight(Player)',
      '',
      '    OpenAllOffersStore<public>(Player:player):void =',
      '        if (Active := StorefrontInFlight[Player], Active?):',
      '            Print("The storefront is already open for this player")',
      '        else if (set StorefrontInFlight[Player] = true):',
      '            spawn{ShowAllOffersAndRelease(Player)}',
      '        else:',
      '            Print("Unable to open the storefront")',
      '',
    );
    if (preserveLegacyApi) {
      push(
        '    # Deprecated v1 compatibility. ShowStorefront retains its historical direct-dialog behavior.',
        '    ShowStorefront<public>(Player:player)<suspends>:void =',
        '        ShowAllOffers(Player)',
        '',
        '    OpenStorefront<public>(Player:player):void =',
        '        OpenAllOffersStore(Player)',
        '',
      );
    }
  }
  if (config.generateStorefrontBinding) push('    OnStorefrontButtonInteracted(Agent:agent):void =', '        if (Player := player[Agent]):', `            ${canonicalApi ? 'OpenAllOffersStore' : 'OpenStorefront'}(Player)`, '');

  for (const group of offerDisplayGroups) {
    const pascal = toVerseApiStem(group.verseKey);
    const references = group.entries.map(entry => resolveOfferDisplayEntry(entry, entitlements, bundles, offersModule));
    if (!canonicalApi) {
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
    } else {
      push(
        `    ${pascal}Title<localizes>:message = "${escapeVerseString(group.name)}"`,
        '',
        `    Show${pascal}Offers(Player:player)<suspends>:void =`,
        `        ShowOffersDialog(Player, array{${references.join(', ')}}, ?Title := ${pascal}Title)`,
        '',
        `    Show${pascal}OffersAndRelease(Player:player)<suspends>:void =`,
        `        Show${pascal}Offers(Player)`,
        '        ClearStorefrontInFlight(Player)',
        '',
        `    Open${pascal}<public>(Player:player):void =`,
        '        if (Active := StorefrontInFlight[Player], Active?):',
        '            Print("A storefront is already open for this player")',
        '        else if (set StorefrontInFlight[Player] = true):',
        `            spawn{Show${pascal}OffersAndRelease(Player)}`,
        '        else:',
        '            Print("Unable to open the storefront")',
        '',
      );
      if (preserveLegacyApi) push(
        '    # Deprecated v1 compatibility. This direct-dialog helper is retained for source compatibility.',
        `    Show${pascal}<public>(Player:player)<suspends>:void =`,
        `        Show${pascal}Offers(Player)`,
        '',
      );
    }
    if (group.generateTriggerBinding) push(`    On${pascal}TriggerActivated(MaybeAgent:?agent):void =`, '        if (Agent := MaybeAgent?):', '            if (Player := player[Agent]):', `                Open${pascal}(Player)`, '');
  }

  push('    ReconcilePlayerEntitlements(Player:player)<suspends>:void =');
  for (const item of entitlements) {
    const pascal = toVerseApiStem(item.verseKey);
    const legacyNames = legacyEventNamesById.get(item.id) ?? new Set<string>();
    const legacyReconciledName = `${pascal}EntitlementReconciledEvent`;
    const legacyOwnershipVerifiedName = `${pascal}OwnershipVerifiedEvent`;
    const ownershipQueryLines = canonicalApi
      ? [`        ${pascal}OwnedCount := Get${pascal}Count(Player)`]
      : [
        `        ${pascal}Purchases := GetPurchasedEntitlements(Player, ${entModule}.${item.verseKey}_entitlement)`,
        `        var ${pascal}OwnedCount:int = 0`,
        `        if (Owned := ${pascal}Purchases[0]):`,
        `            set ${pascal}OwnedCount = Owned(1)`,
      ];
    push(
      ...ownershipQueryLines,
      ...(preserveLegacyApi && legacyNames.has(legacyReconciledName) ? [`        ${legacyReconciledName}.Signal((Player, ${pascal}OwnedCount))`] : []),
      ...(canonicalApi ? [`        ${pascal}_ReconciledEvent.Signal((Player, ${pascal}OwnedCount))`] : []),
      ...(preserveLegacyApi && item.itemType === 'durable' && item.restoreOnJoin && legacyNames.has(legacyOwnershipVerifiedName)
        ? [`        if (${pascal}OwnedCount > 0):`, `            ${legacyOwnershipVerifiedName}.Signal(Player)`]
        : []),
    );
  }
  push('');

  return lines.join('\n');
}
