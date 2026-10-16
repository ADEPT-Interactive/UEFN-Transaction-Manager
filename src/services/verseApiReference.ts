import type { BundleOffer, EntitlementItem, ProjectConfig, StorefrontMembership } from '../types/entitlement';
import { derivePublicIdentity } from './publicIdentity';
import { describeIntegrationContract, transactionCallbackExample } from './integrationContract';
import { dynamicPriceEnabled } from './dynamicOffers';
import { entitlementEditableNames, storefrontEditableName } from './editableBindings';

export interface ApiFunction {
  title: string;
  symbol: string;
  call: string;
  description: string;
  inputs: string;
  returns: string;
  suspends?: boolean;
}
export interface ApiReferenceItem {
  id: string;
  name: string;
  key: string;
  kind: string;
  description: string;
  functions: ApiFunction[];
  events: Array<{ name: string; description: string; subscribe: string; await: string }>;
  wiring: Array<{ label: string; symbol: string; description: string }>;
  runtime?: { type: string; fields: string[] };
  example?: string;
  note?: string;
}

function purchase(stem: string, dynamic: boolean): ApiFunction {
  return { title: 'Open purchase', symbol: `Open${stem}Purchase`, call: `Transactions.Open${stem}Purchase(Player${dynamic ? ', Options' : ''})`, description: 'Open Epic’s purchase prompt for this player. Apply gameplay rewards from the appropriate entitlement event after success.', inputs: `Player: player${dynamic ? ' · Options: runtime options' : ''}`, returns: 'No value (void)' };
}

export function createVerseApiReference(config: ProjectConfig, entitlements: EntitlementItem[], bundles: BundleOffer[], storefronts: StorefrontMembership): ApiReferenceItem[] {
  const items: ApiReferenceItem[] = [];
  const contract = describeIntegrationContract(config, entitlements, bundles, storefronts, 'reference');
  for (const item of entitlements) {
    const stem = derivePublicIdentity(item, config, 'entitlement').apiStem;
    const names = entitlementEditableNames(item.verseKey, stem);
    const dynamic = dynamicPriceEnabled(item.dynamicOffer);
    const consumable = item.itemType === 'consumable';
    const events = [
      { name: 'Granted', description: 'A positive, authoritative inventory change. For durables, update access or ownership here.' },
      { name: 'Reconciled', description: 'The player’s initial inventory has been checked, including a zero balance. Use this to establish initial state.' },
      { name: 'Removed', description: 'An authoritative decrease in inventory. This alone does not prove the player used a consumable.' },
      ...(consumable ? [{ name: 'Consumed', description: 'Confirmed use correlated with a generated Consume request. Apply successful-use gameplay effects here.' }] : []),
    ].map(event => ({ ...event, subscribe: `Subscribe${stem}${event.name}Event`, await: `Await${stem}${event.name}Event` }));
    items.push({
      id: item.id, name: item.name || item.verseKey, key: item.verseKey, kind: consumable ? 'Consumable' : 'Durable',
      description: consumable ? item.autoConsume ? 'Used automatically after acquisition. Apply the effect after Consumed.' : 'Stored in inventory until used. Apply the effect after Consumed.' : 'Permanent ownership. Initialize from Reconciled and keep changes current with Granted and relevant Removed notifications.',
      functions: [purchase(stem, dynamic),
        { title: 'Check ownership', symbol: `Has${stem}`, call: `Transactions.Has${stem}(Player)`, description: 'Check whether this player currently owns at least one.', inputs: 'Player: player', returns: 'Owned or not owned (logic)', suspends: true },
        { title: 'Get owned quantity', symbol: `Get${stem}Count`, call: `Transactions.Get${stem}Count(Player)`, description: 'Read the player’s authoritative owned quantity.', inputs: 'Player: player', returns: 'Owned quantity (int)', suspends: true },
        { title: 'Grant without a purchase', symbol: `Grant${stem}`, call: `Transactions.Grant${stem}(Player, Quantity)`, description: 'Request a grant for a promotion or test. Use inventory events to track the resulting ownership change.', inputs: 'Player: player · Quantity: positive int', returns: 'Operation succeeded (logic)', suspends: true },
        ...(consumable ? [{ title: 'Request use', symbol: `Consume${stem}`, call: `Transactions.Consume${stem}(Player, Quantity)`, description: 'Request consumption of owned inventory. Apply the gameplay effect only after Consumed confirms use.', inputs: 'Player: player · Quantity: positive int', returns: 'Operation succeeded (logic)', suspends: true }] : []),
      ], events,
      wiring: [
        ...(item.triggers.generateTriggerBinding ? [{ label: 'Purchase triggers', symbol: names.purchaseTriggers, description: 'Assign Trigger devices activated by a deliberate player purchase interaction.' }] : []),
        ...(item.triggers.generateButtonBinding ? [{ label: 'Purchase buttons', symbol: names.purchaseButtons, description: 'Assign Button devices that open this offer’s purchase prompt.' }] : []),
        ...(item.triggers.generateSuccessTriggerBinding ? [{ label: 'Success triggers', symbol: names.successTriggers, description: 'Fires after authoritative success. Use Verse events when the gameplay effect needs the quantity.' }] : []),
        ...(!consumable && item.triggers.generateOwnershipConfirmedTriggerBinding ? [{ label: 'Ownership confirmed', symbol: names.ownershipConfirmedTriggers, description: 'Fires once when initial reconciliation confirms ownership. Separate from purchase success.' }] : []),
      ],
      ...(dynamic ? { runtime: { type: `${config.offersModuleName}.${stem}RuntimeOptions`, fields: ['PriceVBucks'] } } : {}),
      example: transactionCallbackExample(item, config),
      note: 'Callbacks receive future notifications without replay. Register during OnBegin, and use ownership/count helpers when attaching late. Cancel the returned handle when your listener ends; the transaction device also stops callbacks on end.',
    });
    for (const offer of item.alternateOffers ?? []) {
      const alternate = derivePublicIdentity(offer, config, 'alternate_offer', item).apiStem;
      const runtime = dynamicPriceEnabled(offer.dynamicOffer);
      items.push({ id: `alternate:${offer.id}`, name: offer.name || offer.verseKey, key: offer.verseKey, kind: 'Alternate offer', description: `Another way to purchase ${item.name || item.verseKey}. Ownership, inventory, and events belong to that entitlement.`, functions: [purchase(alternate, runtime)], events: [], wiring: [], ...(runtime ? { runtime: { type: `${config.offersModuleName}.${alternate}RuntimeOptions`, fields: ['PriceVBucks'] } } : {}) });
    }
  }
  for (const bundle of bundles) {
    const stem = derivePublicIdentity(bundle, config, 'bundle').apiStem;
    const record = contract.bundles.find(entry => entry.stableId === bundle.id);
    const fields = record?.runtimeOptionsFields as string[] | undefined;
    items.push({ id: `bundle:${bundle.id}`, name: bundle.name || bundle.verseKey, key: bundle.verseKey, kind: 'Bundle', description: 'Open a purchase containing multiple offers. Handle gameplay through the events of each contained entitlement.', functions: [purchase(stem, Boolean(fields?.length))], events: [], wiring: [], ...(fields?.length ? { runtime: { type: String(record?.runtimeOptionsType), fields } } : {}) });
  }
  items.push({ id: 'store:all', name: 'All offers', key: 'AllOffersStore', kind: 'Storefront', description: 'Display the offers included in All Offers as individually purchasable cards.', functions: [{ title: 'Open storefront', symbol: 'OpenAllOffersStore', call: 'Transactions.OpenAllOffersStore(Player)', description: 'Show the configured All Offers storefront for this player.', inputs: 'Player: player', returns: 'No value (void)' }], events: [], wiring: config.generateStorefrontBinding ? [{ label: 'Open buttons', symbol: storefrontEditableName('AllOffersStore', 'openButtons'), description: 'Assign Button devices that open All Offers.' }] : [] });
  for (const group of storefronts.focused) {
    const stem = derivePublicIdentity(group, config, 'storefront').apiStem;
    items.push({ id: `store:${group.id}`, name: group.name || group.verseKey, key: group.verseKey, kind: 'Storefront', description: 'Display selected offers as individually purchasable cards.', functions: [{ title: 'Open storefront', symbol: `Open${stem}`, call: `Transactions.Open${stem}(Player)`, description: 'Show this configured storefront for the player.', inputs: 'Player: player', returns: 'No value (void)' }], events: [], wiring: group.generateTriggerBinding ? [{ label: 'Open triggers', symbol: storefrontEditableName(group.verseKey, 'openTriggers', stem), description: 'Assign Trigger devices that open this storefront.' }] : [] });
  }
  return items;
}
