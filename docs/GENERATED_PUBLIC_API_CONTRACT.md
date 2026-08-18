# Generated Verse Public API Contract

Status: Phase 4 baseline, 2026-08-17

This document defines the generated Verse surface that UEFN Entitlement Manager may expose to a creator's own Verse. It is a contract boundary, not a naming proposal. The naming overhaul is intentionally deferred.

## Ownership and scope

The managed Verse file is generated and must not be edited manually. Developers configure and place the generated device, assign its `@editable` arrays, subscribe to supported events, and call supported public helpers from their own Verse. Game-specific rewards, save logic, and gameplay effects belong outside the managed file.

An explicit Verse `<public>` declaration is compatibility-sensitive. A declaration may be public because it is a supported developer API or because another generated module needs to reference it. Those reasons are not interchangeable.

Display names, generated display modules, and persistent manifest IDs are data and identity inputs. They are not automatically supported public API identifiers. A generator refactor must not rename a supported symbol merely because its display name, internal implementation, or generated spelling can be improved.

## Concrete inventory baseline

The baseline was generated from `tests/public-api-fixture.ts` into `temp/phase4_public_api_fixture.verse`. The representative project contains four entitlements, one alternate offer, two durable items, two consumables, a paid-random item with odds, static and nested bundles, a dynamic remaining-quantity bundle, two focused storefronts, age/country/platform restrictions, trigger/button/zone bindings, auto-consume, and a global storefront binding.

The output contains 100 explicit `<public>` declarations and 9 UEFN-exposed `@editable` arrays. The declaration patterns below are exhaustive for the current generator. Counts vary with the catalog.

| Category | Current generated declarations | Fixture count | Classification |
| --- | --- | ---: | --- |
| Icon asset module | `${assetFolderName}<public> := module {}` | 1 | Potentially useful, needs justification |
| Metadata root and modules | `${infoModule}<public>`, one `${PascalKey}<public>` module per item, alternate, and bundle | 9 | Potentially useful, needs justification |
| Localized metadata members | `Name<public><localizes>`, `Description<public><localizes>`, `ShortDescription<public><localizes>` | 24 | Potentially useful, needs justification |
| Entitlement module and types | `${entitlementsModule}<public>`, `basic_entitlement<public>`, one concrete `${verseKey}_entitlement<public>` per entitlement | 6 | Potentially useful, needs justification |
| Price module and constants | `${pricesModule}<public>`, `${verseKey}_price<public>:float` for items, alternates, and bundles | 9 | Potentially useful, needs justification |
| Offer module and classes | `${offersModule}<public>`, `${verseKey}_offer<public>`, plus `${verseKey}_dynamic_offer<public>` for dynamic bundles | 10 | Potentially useful, needs justification |
| Entitlement events | Purchase-event name, ownership/quantity event, granted, removed, reconciled, and conditional ownership-verified events | 21 | Mixed: supported tuple events; legacy or needs justification for the rest |
| Grant and consume helpers | `Grant${Pascal}<public>`, `Consume${Pascal}<public>` for consumables | 6 | Supported developer API |
| Purchase helpers | `PromptBuy${Pascal}<public>` for items, alternates, and bundles | 8 | Supported today, rename-sensitive |
| Global storefront helpers | `ShowStorefront<public>`, `OpenStorefront<public>` | 2 | `OpenStorefront` supported; `ShowStorefront` unsafe legacy surface |
| Focused storefront helpers | `Show${StorePascal}<public>`, `Open${StorePascal}<public>` per offer display group | 4 | `Open...` supported; `Show...` unsafe legacy surface |

The generated device class is currently `deviceClassName := class(creative_device):` without `<public>`. UEFN exposes it as a placeable Verse device after compilation, and the editor exposes each generated `@editable` array. The fixture editables are `AccessPassTriggers`, `AccessPassButtons`, `AccessPassZones`, `SeasonPassButtons`, `CoinPackTriggers`, `MysteryItemButtons`, `MysteryItemZones`, `Phase4StorefrontButtons`, and `CoinStoreTriggers`.

## Classification

### A. Supported developer API

These are the deliberate integration points for creator-authored Verse:

- The generated `creative_device` subclass as a placeable device and a type that can hold a reference to the placed instance.
- Generated `@editable` trigger, button, zone, and global storefront arrays as UEFN authoring configuration. They are exposed editor fields, not a promise that external Verse should manipulate the arrays directly.
- `${Pascal}EntitlementGrantedEvent<public>:event(tuple(player, int))`.
- `${Pascal}EntitlementRemovedEvent<public>:event(tuple(player, int))`.
- `${Pascal}EntitlementReconciledEvent<public>:event(tuple(player, int))`.
- `Grant${Pascal}<public>(Player:player, Quantity:int)<suspends>:void`.
- `Consume${Pascal}<public>(Player:player, Quantity:int)<suspends>:void` for consumables.
- `PromptBuy${Pascal}<public>(Player:player):void`, including alternate and bundle variants. This is the current supported purchase entry point, even though its name is not the desired final name.
- `OpenStorefront<public>(Player:player):void`.
- `Open${StorePascal}<public>(Player:player):void` for focused storefronts.

The supported surface is intentionally based on device operations, events, and helpers. Direct use of generated metadata, price, entitlement, or offer declarations is not required for the normal UEM integration flow.

### B. Public today, but useful only with justification or compatibility handling

These declarations are currently public or editor-exposed, but should not automatically become the future facade:

- The configurable `purchaseEventName<public>:event(player)`. Its current signal site is the generic positive entitlement-delta handler, so a name such as `VipPassPurchasedEvent` does not prove that a purchase occurred. It also omits quantity. Existing integrations may still reference it, so it is compatibility-sensitive.
- `${Pascal}OwnershipRemovedEvent<public>:event(player)` for durable items and `${Pascal}QuantityDecreasedEvent<public>:event(player)` for consumables. These are lower-level player-only signals. The consumable event omits the quantity that is available on `EntitlementRemovedEvent`.
- `${Pascal}OwnershipVerifiedEvent<public>:event(player)` for durable items with restore-on-join. It is a convenience signal, not new state information beyond a positive reconciled count.
- `ShowStorefront<public>(...)<suspends>` and `Show${StorePascal}<public>(...)<suspends>`. These directly call `ShowOffersDialog` and bypass the generated in-flight guard. They are currently public and must not be removed or renamed in this phase.
- The asset module, metadata modules, localized metadata messages, price constants, entitlement classes, offer classes, and dynamic offer classes. Generated modules reference one another across module boundaries, which explains much of their current visibility. External Verse may have legitimate custom-UI or direct Marketplace reasons to use some of them, but UEM does not currently define them as a stable facade.
- `basic_entitlement<public>` and concrete entitlement types. UEM uses the base type for entitlement-change subscriptions and the concrete types for Marketplace calls. Direct external use is plausible, but changing or hiding these types could break custom Marketplace integrations.
- `ManagedOffers` offer classes and `ManagedTransactionPrices` price constants. They are useful to direct `BuyOffer` or custom `ShowOffersDialog` integrations, but UEM's safe wrappers should be the normal path.

### C. Internal implementation detail

These declarations are not explicitly public and must remain generator plumbing unless a later phase establishes a concrete developer use:

- `ExecuteBuy${Pascal}` and its alternate or bundle variants.
- `Process${Pascal}Grant` and `Process${Pascal}Removal`.
- `On${Pascal}TriggerActivated`, `On${Pascal}ButtonInteracted`, and `On${Pascal}ZoneEntered`.
- `OnBegin`, `OnEnd`, `OnPlayerAdded`, `OnPlayerRemoved`, `OnEntitlementsChanged`, subscription cleanup, and in-flight cleanup helpers.
- `ShowStorefrontAndRelease` and `Show${StorePascal}AndRelease`.
- `EntitlementChangeSubscriptions`, `PurchaseInFlight`, `StorefrontInFlight`, device subscription arrays, and other implementation state.
- `ReconcilePlayerEntitlements` as the implementation routine that obtains the Marketplace snapshot and emits the supported reconciliation event.

The fact that these functions are callable from other code in the same generated device does not make them supported API. They are free to change as long as the supported surface and generated behavior remain compatible.

## Event semantics

The device subscribes to `GetEntitlementsChangedEvent` and examines each authoritative `entitlement_change`. A positive change calls `Process...Grant`; a negative change calls `Process...Removal` with the magnitude of the decrease.

| Current event family | Signal cause | Payload and limits | Contract assessment |
| --- | --- | --- | --- |
| Custom `purchaseEventName` | Every positive delta reaching `Process...Grant`, including a direct grant that produces a positive Marketplace delta. It is not signaled from `BuyOffer` itself. | `player` only | Misleading for purchase-specific semantics; retain for compatibility and treat as legacy or advisory. |
| `${Pascal}EntitlementGrantedEvent` | Every positive entitlement delta. It can represent a completed purchase, direct grant, or another authoritative positive change. | `(player, int)` with the positive quantity | Useful supported event. The current name is more accurate than the purchase-event name but still describes a delta rather than a purchase. |
| Durable `OwnershipRemovedEvent` | Every negative delta for a durable entitlement. | `player` only; no quantity because durable ownership is normally one | Low-level convenience event. Its information is covered by the tuple removal event plus item type. |
| Consumable `QuantityDecreasedEvent` | Every negative delta for a consumable, including a successful `ConsumeEntitlement` operation. | `player` only; quantity is omitted | Redundant with the tuple removal event, which carries the quantity. |
| `${Pascal}EntitlementRemovedEvent` | Every negative entitlement delta. | `(player, int)` with the removed quantity | Useful supported event. It is not purchase-specific. |
| `${Pascal}EntitlementReconciledEvent` | `ReconcilePlayerEntitlements` on player join, after `GetPurchasedEntitlements` returns the saved Marketplace snapshot. | `(player, int)` containing the current owned count, including zero | Useful snapshot event, distinct from a delta event. |
| `${Pascal}OwnershipVerifiedEvent` | During reconciliation only, for durable restore-on-join items whose reconciled count is greater than zero. | `player` only | Convenience boolean signal. It conveys no state that a positive reconciled count does not already convey. |

Auto-consume adds a second state transition: a positive grant can spawn the public consume helper, and the later negative entitlement change then emits the removal events. No event is signaled directly by the public helper before the Marketplace state changes.

The recommended future canonical event shape remains:

```verse
X_GrantedEvent : event(tuple(player, int))
X_RemovedEvent : event(tuple(player, int))
X_ReconciledEvent : event(tuple(player, int))
```

The names and any collapse of redundant events belong to a later event/naming phase. This phase does not rename, remove, or collapse any event.

## Grant and consume helpers

`Grant${Pascal}` calls `GrantEntitlement(Player, Entitlement, ?Count := Quantity)`. `Consume${Pascal}` calls `ConsumeEntitlement(Player, Entitlement, ?Count := Quantity)`. Both public helpers validate that the requested quantity is positive, are suspending functions, return `void`, and print a failure message when the underlying optional result is not successful. The underlying result is intentionally discarded by the public contract.

The helpers do not directly signal the generated events. The event path is the authoritative `GetEntitlementsChangedEvent` subscription. Direct grants are deliberately outside the purchase flow and do not create an offer disclosure or a V-Bucks purchase.

The current `void` return type is compatibility-sensitive. Changing it to expose the underlying result would alter the callable signature and could affect existing calls, stored function values, or future wrappers. This phase makes no return-type change.

## Purchase helper semantics

Every generated `PromptBuy...` helper is a guarded, non-suspending entry point. It sets the per-player purchase in-flight flag and spawns an internal suspending `ExecuteBuy...` function. The internal function calls `BuyOffer`, which opens the Epic purchase UI and returns an optional result indicating whether the offer was purchased. Closing the dialog does not purchase the offer. The generated purchase helper therefore initiates a purchase UI flow; it does not purchase automatically and does not guarantee a purchase.

The later name `OpenXPurchase` is semantically clearer than `PromptBuyX`, but no rename occurs here. Existing public item, alternate, static-bundle, and dynamic-bundle prompt functions remain in the baseline.

## Storefront helper semantics

The global storefront currently exposes both:

- `ShowStorefront<public>(Player)<suspends>`, which calls `ShowOffersDialog` directly and can bypass `StorefrontInFlight`.
- `OpenStorefront<public>(Player)`, which applies the in-flight guard and spawns `ShowStorefrontAndRelease`.

Each focused offer display group has the same pair, `Show${StorePascal}` and `Open${StorePascal}`. `Show...AndRelease` is internal and clears the guard after the direct dialog call completes.

The intended later public surface is the safe `Open...` family. The unsafe `Show...` functions remain public for compatibility analysis and are not removed in Phase 4. Dynamic bundle purchase restriction parity, richer storefront behavior, and any generic storefront execution refactor remain deferred.

## Modules and types

The current visibility has two causes:

1. Generated modules reference one another. The offers module needs the metadata, entitlement, and price modules. The device needs the entitlement base/concrete types and offer types. Public module and class visibility is therefore partly required by the generated module graph.
2. External Verse can use the same declarations for custom Marketplace flows or custom UI, but UEM has not promised all of those declarations as a stable facade.

The current decisions are:

- Keep `EntitlementIcons`, metadata modules and localized fields, `ManagedEntitlements`, `ManagedTransactionPrices`, and `ManagedOffers` at their current visibility in this phase.
- Treat metadata and price declarations as potentially useful, not automatically supported API.
- Treat entitlement and offer classes as potentially useful because direct Marketplace interoperability is plausible. Do not hide them without a compile-tested facade or migration plan.
- Do not add aliases for types or modules by assumption. Verse type/module aliasing and cross-module compatibility need a separate live compile prototype before a naming phase relies on them.

## Device class and editables

The default class remains `managed_transactions_device := class(creative_device):`. It has no explicit `<public>` specifier. UEFN discovers the compiled `creative_device` subclass as a placeable device, and the application instructs creators to assign the placed instance to an `@editable` reference in their own device. The current integration example is equivalent to:

```verse
@editable
Transactions : managed_transactions_device = managed_transactions_device{}

Transactions.OpenStorefront(Player)
```

The class name, its placement identity, and every editable property name are compatibility-sensitive even though the class declaration and fields are not marked `<public>`. UEFN serializes placed-device property assignments. Editable renames therefore need preservation or an explicit migration, not a silent source-level rename.

## Compatibility model

There are two separate compatibility layers.

### Layer A: UEM-managed state

The embedded manifest is the data UEM owns and regenerates. The current manifest uses `schemaVersion: 4`; older supported schemas 2, 3, and 4 remain importable. The manifest preserves catalog data such as persistent item IDs, bundle IDs, offer keys, event-name fields, trigger names, and editable names. UEM can regenerate its managed file from this data.

`schemaVersion` describes the managed manifest data shape. The application and `version.json` describe the shipped UEM and bridge version. None of these is currently a generated public-API version.

### Layer B: developer-authored Verse

External Verse may reference the placed device, call `PromptBuy...`, `Grant...`, `Consume...`, and `Open...`, subscribe to generated events, or directly use generated module/type names. A managed-file regeneration does not rewrite those external references. UEM also deliberately refuses to import an unmanaged Verse file because guessing its structure would risk data loss.

Therefore, changing a public symbol can break an existing project even when the manifest imports and the managed file regenerates perfectly. Public generated names must be treated as source-compatibility commitments.

## Recommended migration strategy

Use a compatibility-preserving hybrid of Strategy A and Strategy B:

1. Preserve legacy public identifiers for existing objects using persisted manifest identity. New objects may use the future canonical naming rules.
2. For functions, generate the new canonical implementation and a legacy public wrapper when the old identifier is known. A function wrapper is technically practical because it can delegate to the safe implementation without changing the old signature.
3. For events, do not assume a first-class alias is practical. An event value must receive signals. During a deprecation window, retain the legacy event declaration and signal both legacy and canonical events at the same authoritative signal sites, or preserve the legacy event name for that object. This has a temporary declaration and signal cost but avoids silent loss of subscriptions.
4. For modules and types, preserve the old public declarations for existing projects unless a small Verse alias/facade prototype compiles in the real editor. Type and module aliases cannot be assumed from the TypeScript generator.
5. For `@editable` fields, preserve serialized legacy field names for existing placed devices. Add migration support only when UEFN's actual property behavior is verified. Do not silently rename editable fields.
6. Keep legacy compatibility through the naming migration and at least until an explicit future major-version removal or opt-in project migration. Do not remove compatibility merely because new names are cleaner.

This strategy protects unmanaged external Verse while allowing later canonical names. It does increase generated code for function wrappers and, temporarily, for paired events. That cost is safer and more maintainable than pretending UEM can rewrite arbitrary external Verse.

## Generated API version decision

Do not add a `generatedApiVersion` field in Phase 4. No public behavior changes in this phase require one. However, the upcoming naming migration has a real need for a marker separate from `schemaVersion`: the manifest data shape and the generated callable surface are different compatibility dimensions.

Add an optional generated API version as part of the first naming/migration implementation. It should select legacy preservation, wrappers, and event compatibility behavior without changing the meaning of the managed-data schema version. Adding it during the migration also allows old manifests to default to the legacy API behavior without a breaking import change.

## Deliberate non-changes and deferrals

Phase 4 does not:

- rename `PromptBuyX`, generated events, entitlement keys, bundle keys, editables, storefront helpers, modules, or the device class;
- collapse redundant events;
- change Grant or Consume return types;
- add query helpers;
- genericize purchase or storefront execution;
- change reconciliation, logging, or zone behavior;
- implement dynamic-offer live restriction parity;
- add richer external-disclosure location modeling;
- add a structured probability or reward editor.

Those remain later-phase work after this contract is reviewed.
