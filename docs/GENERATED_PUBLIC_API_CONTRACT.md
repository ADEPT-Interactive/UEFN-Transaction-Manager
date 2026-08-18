# Generated Verse Public API Contract

Status: Phase 7 canonical API migration and ownership queries, 2026-08-18

This document defines the generated Verse surface that UEFN Entitlement Manager may expose to a creator's own Verse. It is a compatibility contract. The generated API version is separate from the managed-data schema version.

## Generated API versions

`schemaVersion` describes the persisted UEM manifest format. `generatedApiVersion` describes the developer-facing generated Verse contract.

- API v1 is the legacy shape. Manifests without `generatedApiVersion` are interpreted as v1. It includes `PromptBuy...`, the old event families, `OpenStorefront`, focused `Show...` helpers, and the configurable `purchaseEventName` event.
- API v2 is the canonical shape. New projects use it by default. Public symbols derive from the persisted stable `verseKey`, not the mutable display name.
- When UEM opens a v1 project, it records API v2 with `legacyApiCompatibility: true`. Canonical v2 symbols are generated and reproducible v1 functions/events remain as compatibility shims where their historical identity is known.

Regeneration is idempotent. Compatibility metadata is part of the embedded manifest and is not a second schema version.

## Ownership and scope

The managed Verse file is generated and must not be edited manually. Developers configure and place the generated device, assign its `@editable` arrays, subscribe to supported events, and call supported public helpers from their own Verse. Game-specific rewards, save logic, and gameplay effects belong outside the managed file.

An explicit Verse `<public>` declaration is compatibility-sensitive. A declaration may be public because it is a supported developer API or because another generated module needs to reference it. Those reasons are not interchangeable.

Display names, generated display modules, and persistent manifest IDs are data and identity inputs. They are not automatically supported public API identifiers. A generator refactor must not rename a supported symbol merely because its display name, internal implementation, or generated spelling can be improved.

## Concrete inventory baseline

The baseline was generated from `tests/public-api-fixture.ts` into `temp/phase4_public_api_fixture.verse`. The representative project contains four entitlements, one alternate offer, two durable items, two consumables, a paid-random item with odds, static and nested bundles, a dynamic remaining-quantity bundle, two focused storefronts, age/country/platform restrictions, trigger/button/zone bindings, auto-consume, and a global storefront binding.

The clean API-v2 output contains 96 explicit `<public>` declarations and 9 UEFN-exposed `@editable` arrays for this fixture. The same fixture contains 100 declarations as API v1 and 129 when API-v1 compatibility is retained during migration. Counts vary with the catalog. API-v2 ownership queries add two supported helpers per entitlement; they are not generated for alternate offers, bundles, or storefronts.

| Category | Current generated declarations | Fixture count | Classification |
| --- | --- | ---: | --- |
| Icon asset module | `${assetFolderName}<public> := module {}` | 1 | Potentially useful, needs justification |
| Metadata root and modules | `${infoModule}<public>`, one `${PascalKey}<public>` module per item, alternate, and bundle | 9 | Potentially useful, needs justification |
| Localized metadata members | `Name<public><localizes>`, `Description<public><localizes>`, `ShortDescription<public><localizes>` | 24 | Potentially useful, needs justification |
| Entitlement module and types | `${entitlementsModule}<public>`, `basic_entitlement<public>`, one concrete `${verseKey}_entitlement<public>` per entitlement | 6 | Potentially useful, needs justification |
| Price module and constants | `${pricesModule}<public>`, `${verseKey}_price<public>:float` for items, alternates, and bundles | 9 | Potentially useful, needs justification |
| Offer module and classes | `${offersModule}<public>`, `${verseKey}_offer<public>`, plus `${verseKey}_dynamic_offer<public>` for dynamic bundles | 10 | Potentially useful, needs justification |
| Entitlement events | `<Stem>_GrantedEvent`, `<Stem>_RemovedEvent`, and `<Stem>_ReconciledEvent` in v2; old families only in v1 or migrated compatibility output | 12 | Supported canonical tuple events |
| Grant and consume helpers | `Grant${Pascal}<public>`, `Consume${Pascal}<public>` for consumables | 6 | Supported developer API |
| Ownership/count query helpers | `Get${Stem}Count<public>` and `Has${Stem}<public>` for each entitlement | 8 | Supported canonical API |
| Purchase helpers | `Open${Stem}Purchase<public>` for items, alternates, and bundles | 8 | Supported canonical API |
| Global storefront helpers | `OpenAllOffersStore<public>` | 1 | Supported canonical API |
| Focused storefront helpers | `Open${StoreStem}<public>` per offer display group | 2 | Supported canonical API |

The generated device class is currently `deviceClassName := class(creative_device):` without `<public>`. UEFN exposes it as a placeable Verse device after compilation, and the editor exposes each generated `@editable` array. The fixture editables are `AccessPassTriggers`, `AccessPassButtons`, `AccessPassZones`, `SeasonPassButtons`, `CoinPackTriggers`, `MysteryItemButtons`, `MysteryItemZones`, `Phase4StorefrontButtons`, and `CoinStoreTriggers`.

## Classification

### A. Supported developer API

These are the deliberate integration points for creator-authored Verse:

- The generated `creative_device` subclass as a placeable device and a type that can hold a reference to the placed instance.
- Generated `@editable` trigger, button, zone, and global storefront arrays as UEFN authoring configuration. They are exposed editor fields, not a promise that external Verse should manipulate the arrays directly.
- `${Stem}_GrantedEvent<public>:event(tuple(player, int))`.
- `${Stem}_RemovedEvent<public>:event(tuple(player, int))`.
- `${Stem}_ReconciledEvent<public>:event(tuple(player, int))`.
- API-v2 `Grant${Pascal}<public>(Player:player, Quantity:int)<suspends>:logic`; explicit API-v1 retains the historical `:void` signature.
- API-v2 `Consume${Pascal}<public>(Player:player, Quantity:int)<suspends>:logic` for consumables; explicit API-v1 retains the historical `:void` signature.
- `Get${Stem}Count<public>(Player:player)<suspends>:int` for each managed entitlement.
- `Has${Stem}<public>(Player:player)<suspends>:logic` for each managed entitlement, including consumables.
- `Open${Stem}Purchase<public>(Player:player):void`, including alternate and bundle variants.
- `OpenAllOffersStore<public>(Player:player):void`.
- `Open${StoreStem}<public>(Player:player):void` for focused storefronts.

The supported surface is intentionally based on device operations, events, and helpers. Direct use of generated metadata, price, entitlement, or offer declarations is not required for the normal UEM integration flow.

### B. Legacy compatibility API only

These declarations are generated only for API-v1 output or a migrated v2 project with `legacyApiCompatibility: true`:

- The configurable `purchaseEventName<public>:event(player)`. Its current signal site is the generic positive entitlement-delta handler, so a name such as `VipPassPurchasedEvent` does not prove that a purchase occurred. It also omits quantity. Existing integrations may still reference it, so it is compatibility-sensitive.
- `${Pascal}OwnershipRemovedEvent<public>:event(player)` for durable items and `${Pascal}QuantityDecreasedEvent<public>:event(player)` for consumables. These are lower-level player-only signals. The consumable event omits the quantity that is available on `EntitlementRemovedEvent`.
- `${Pascal}OwnershipVerifiedEvent<public>:event(player)` for durable items with restore-on-join. It is a convenience signal, not new state information beyond a positive reconciled count.
- `PromptBuy${Pascal}<public>(Player:player):void` delegates to `Open${Stem}Purchase` in migrated output.
- `ShowStorefront<public>(...)<suspends>` and `Show${StorePascal}<public>(...)<suspends>` retain their historical direct-dialog behavior for source compatibility. They are deprecated and unsafe because they bypass the generated in-flight guard.
- `OpenStorefront<public>(Player:player):void` delegates to `OpenAllOffersStore` in migrated output.
- The asset module, metadata modules, localized metadata messages, price constants, entitlement classes, offer classes, and dynamic offer classes. Generated modules reference one another across module boundaries, which explains much of their current visibility. External Verse may have legitimate custom-UI or direct Marketplace reasons to use some of them, but UEM does not currently define them as a stable facade.
- `basic_entitlement<public>` and concrete entitlement types. UEM uses the base type for entitlement-change subscriptions and the concrete types for Marketplace calls. Direct external use is plausible, but changing or hiding these types could break custom Marketplace integrations.
- `ManagedOffers` offer classes and `ManagedTransactionPrices` price constants. They are useful to direct `BuyOffer` or custom `ShowOffersDialog` integrations, but UEM's safe wrappers should be the normal path.

### C. Internal implementation detail

These declarations are not explicitly public and must remain generator plumbing unless a later phase establishes a concrete developer use:

- `ExecuteBuy${Pascal}` and its alternate or bundle variants.
- `Process${Pascal}Grant` and `Process${Pascal}Removal`.
- `On${Pascal}TriggerActivated`, `On${Pascal}ButtonInteracted`, and `On${Pascal}ZoneEntered`.
- `OnBegin`, `OnEnd`, `OnPlayerAdded`, `OnPlayerRemoved`, `OnEntitlementsChanged`, subscription cleanup, and in-flight cleanup helpers.
- `ShowAllOffers`, `ShowAllOffersAndRelease`, and `Show${StorePascal}OffersAndRelease`.
- `EntitlementChangeSubscriptions`, `PurchaseInFlight`, `StorefrontInFlight`, device subscription arrays, and other implementation state.
- `ReconcilePlayerEntitlements` as the implementation routine that obtains the Marketplace snapshot and emits the supported reconciliation event.

The fact that these functions are callable from other code in the same generated device does not make them supported API. They are free to change as long as the supported surface and generated behavior remain compatible.

## Event semantics

The device subscribes to `GetEntitlementsChangedEvent` and examines each authoritative `entitlement_change`. A positive change calls `Process...Grant`; a negative change calls `Process...Removal` with the magnitude of the decrease.

| Event family | Signal cause | Payload and limits | Contract assessment |
| --- | --- | --- | --- |
| Custom `purchaseEventName` | Every positive delta reaching `Process...Grant`, including a direct grant that produces a positive Marketplace delta. It is not signaled from `BuyOffer` itself. | `player` only | Misleading for purchase-specific semantics; retain for compatibility and treat as legacy or advisory. |
| `${Stem}_GrantedEvent` | Every positive entitlement delta. It can represent a completed purchase, direct grant, or another authoritative positive change. | `(player, int)` with the positive quantity | Canonical v2 event. It is not purchase-specific. |
| Durable `OwnershipRemovedEvent` | Every negative delta for a durable entitlement. | `player` only; no quantity because durable ownership is normally one | Low-level convenience event. Its information is covered by the tuple removal event plus item type. |
| Consumable `QuantityDecreasedEvent` | Every negative delta for a consumable, including a successful `ConsumeEntitlement` operation. | `player` only; quantity is omitted | Redundant with the tuple removal event, which carries the quantity. |
| `${Stem}_RemovedEvent` | Every negative entitlement delta. | `(player, int)` with the removed quantity | Canonical v2 event. It is not purchase-specific. |
| `${Stem}_ReconciledEvent` | `ReconcilePlayerEntitlements` on player join, after `GetPurchasedEntitlements` returns the saved Marketplace snapshot. | `(player, int)` containing the current owned count, including zero | Canonical v2 snapshot event. |
| `${Pascal}OwnershipVerifiedEvent` | During reconciliation only, for durable restore-on-join items whose reconciled count is greater than zero. | `player` only | Convenience boolean signal. It conveys no state that a positive reconciled count does not already convey. |

Auto-consume adds a second state transition: a positive grant can spawn the public consume helper, and the later negative entitlement change then emits the removal events. No event is signaled directly by the public helper before the Marketplace state changes.

The API-v2 canonical event shape is:

```verse
X_GrantedEvent : event(tuple(player, int))
X_RemovedEvent : event(tuple(player, int))
X_ReconciledEvent : event(tuple(player, int))
```

API v2 does not generate `PurchasedEvent`, `OwnershipRemovedEvent`, `QuantityDecreasedEvent`, or a canonical `OwnershipVerifiedEvent`. A positive reconciliation count communicates ownership; migrated API-v1 output still signals the legacy ownership-verification event when it was part of the historical shape.

## Ownership and count query semantics

`Get${Stem}Count(Player)` is a suspending query of the current Marketplace state for the generated concrete entitlement type. It calls `GetPurchasedEntitlements(Player, ${entitlementsModule}.${verseKey}_entitlement)` and returns the owned quantity from the first matching result. If the Marketplace result contains no matching entitlement, it returns `0`. It does not use a cached map or the latest entitlement-change event, so it reflects purchases, direct grants, consumption, decreases, restoration, and other current Marketplace state when the query completes.

`Has${Stem}(Player)` calls the corresponding count helper and returns `true` when the count is greater than zero, otherwise `false`. The same predictable rule is used for durable and consumable entitlements: `HasCoins` means the player currently owns at least one coin entitlement, while `GetCoinsCount` supplies the quantity. The helpers are suspending because the underlying Marketplace query suspends.

Alternate offers are purchase paths for the same entitlement inventory and do not create duplicate query helpers. Bundles contain offers whose component entitlements are queried individually, so UEM does not generate `GetStarterBundleCount` or `HasStarterBundle`. Storefronts only open offer dialogs and never receive ownership helpers.

Query helpers and reconciliation events serve different purposes. `Get${Stem}Count` and `Has${Stem}` let external Verse ask for a current snapshot explicitly. `${Stem}_GrantedEvent`, `${Stem}_RemovedEvent`, and `${Stem}_ReconciledEvent` notify external Verse about authoritative deltas or the join-time snapshot. Query helpers do not replace or suppress those events.

## Grant and consume helpers

For API v2, `Grant${Pascal}<public>(Player:player, Quantity:int)<suspends>:logic` calls `GrantEntitlement(Player, Entitlement, ?Count := Quantity)` and returns the native Marketplace operation result. `Consume${Pascal}<public>(Player:player, Quantity:int)<suspends>:logic` is generated only for consumables, calls `ConsumeEntitlement(Player, Entitlement, ?Count := Quantity)`, and returns that native result. Both helpers reject non-positive quantities without calling Marketplace, print the existing diagnostic, and return `false`; positive quantities preserve the native success/failure result and print the existing failure diagnostic when it is false. A returned `true` means only that the Marketplace operation reported success. It does not mean gameplay effects or entitlement-event subscribers have already processed the change.

Explicit API-v1 generation retains the historical `void` Grant/Consume signatures. A migrated API-v1 project generates the canonical API-v2 result-returning functions alongside its legacy event and purchase compatibility symbols; the Grant/Consume names are not duplicated because Verse cannot overload a function by return type. Verse permits a returned value to be ignored in a standalone call, so existing calls such as `Transactions.GrantAccessPass(Player, 1)` remain valid at the call site. New integrations may assign or branch on the result, for example:

```verse
GrantSucceeded := Transactions.GrantAccessPass(Player, 1)
if (GrantSucceeded?):
    Print("Marketplace grant accepted")
```

Grant and Consume do not directly signal `${Pascal}_GrantedEvent` or `${Pascal}_RemovedEvent`. Use those canonical entitlement delta events, plus `Get${Pascal}Count` or `Has${Pascal}` when an explicit current-state query is needed, to drive gameplay state. Auto-consume uses a private suspending fire-and-forget helper that intentionally ignores the public result after the public helper has logged any failure.

The helpers do not directly signal the generated events. The event path is the authoritative `GetEntitlementsChangedEvent` subscription. Direct grants are deliberately outside the purchase flow and do not create an offer disclosure or a V-Bucks purchase.

## Purchase helper semantics

Every generated API-v2 `Open...Purchase` helper is a guarded, non-suspending entry point. It sets the per-player purchase in-flight flag and spawns an internal suspending `ExecuteBuy...` function. The internal function calls `BuyOffer`, which opens the Epic purchase UI and returns an optional result indicating whether the offer was purchased. Closing the dialog does not purchase the offer. The generated purchase helper therefore initiates a purchase UI flow; it does not purchase automatically and does not guarantee a purchase.

In migrated output, `PromptBuyX` is a same-signature wrapper that calls `OpenXPurchase`; it does not duplicate the purchase implementation. Internal trigger, button, and deliberate zone callbacks call the canonical function directly.

## Storefront helper semantics

API v2 exposes:

- `OpenAllOffersStore<public>(Player)`, which applies the in-flight guard and spawns the internal dialog flow.
- `Open${StoreStem}<public>(Player)` for focused storefronts, with the same guard.

API-v2 output does not expose unsafe `Show...` helpers. Migrated output retains `ShowStorefront` and focused `Show...` functions with their old suspending signatures and direct-dialog behavior, and retains `OpenStorefront` as a safe alias to `OpenAllOffersStore`.

Dynamic bundle purchase restriction parity, richer storefront behavior, and any generic storefront execution refactor remain deferred.

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

Transactions.OpenAllOffersStore(Player)
```

An external device can use the placed generated device for both event integration and an explicit current-state query:

```verse
using { /Fortnite.com/Devices }

my_game_device := class(creative_device):
    @editable
    Transactions : managed_transactions_device = managed_transactions_device{}

    OnBegin<override>()<suspends>:void =
        Transactions.AccessPass_GrantedEvent.Subscribe(OnAccessPassGranted)

    CheckAccess(Player:player)<suspends>:void =
        OwnedCount := Transactions.GetAccessPassCount(Player)
        # Apply game-specific state from OwnedCount in this external device.
```

The generated managed file remains UEM-owned. Subscribe to its canonical delta events and call its public query helpers from external Verse; do not add gameplay code to generated `Process...` handlers.

The class name, its placement identity, and every editable property name are compatibility-sensitive even though the class declaration and fields are not marked `<public>`. UEFN serializes placed-device property assignments. Editable renames therefore need preservation or an explicit migration, not a silent source-level rename.

## Compatibility model

There are two separate compatibility layers.

### Layer A: UEM-managed state

The embedded manifest is the data UEM owns and regenerates. The current manifest uses `schemaVersion: 4`; older supported schemas 2, 3, and 4 remain importable. The manifest preserves catalog data such as persistent item IDs, bundle IDs, offer keys, event-name fields, trigger names, and editable names. UEM can regenerate its managed file from this data.

`schemaVersion` describes the managed manifest data shape. `generatedApiVersion` and `legacyApiCompatibility` describe the generated public API contract. The application and `version.json` describe the shipped UEM and bridge version.

### Layer B: developer-authored Verse

External Verse may reference the placed device, call canonical `Open...Purchase`, `Grant...`, `Consume...`, and `Open...` helpers, subscribe to generated events, or directly use generated module/type names. A managed-file regeneration does not rewrite those external references. UEM also deliberately refuses to import an unmanaged Verse file because guessing its structure would risk data loss.

Therefore, changing a public symbol can break an existing project even when the manifest imports and the managed file regenerates perfectly. Public generated names must be treated as source-compatibility commitments.

## Recommended migration strategy

Use a compatibility-preserving hybrid of Strategy A and Strategy B:

1. Preserve legacy public identifiers for existing objects using persisted manifest identity. New objects use the canonical stable-key rules.
2. For functions, generate the new canonical implementation and a legacy public wrapper when the old identifier is known. A function wrapper is technically practical because it can delegate to the safe implementation without changing the old signature.
3. For events, do not assume a first-class alias is practical. An event value must receive signals. During a deprecation window, retain the legacy event declaration and signal both legacy and canonical events at the same authoritative signal sites, or preserve the legacy event name for that object. This has a temporary declaration and signal cost but avoids silent loss of subscriptions.
4. For modules and types, preserve the old public declarations for existing projects unless a small Verse alias/facade prototype compiles in the real editor. Type and module aliases cannot be assumed from the TypeScript generator.
5. For `@editable` fields, preserve serialized legacy field names for existing placed devices. Add migration support only when UEFN's actual property behavior is verified. Do not silently rename editable fields.
6. Keep legacy compatibility for migrated projects until an explicit future major-version removal or opt-in project migration. New API-v2 projects do not generate legacy symbols.

This strategy protects unmanaged external Verse while allowing later canonical names. It does increase generated code for function wrappers and, temporarily, for paired events. That cost is safer and more maintainable than pretending UEM can rewrite arbitrary external Verse.

## Generated API version decision

API v2 adds `generatedApiVersion: 2` to new manifests. A missing value safely defaults to v1 on import. Opening that project migrates the generated output to v2 and sets `legacyApiCompatibility: true`; the managed schema remains unchanged. `legacyApiDiagnostics` records non-blocking compatibility warnings such as repaired or ambiguous historical keys.

## Deliberate non-changes and deferrals

Phase 7 does not:

- rename entitlement keys, bundle keys, editables, modules, or the device class;
- change persisted `purchaseEventName`; it remains legacy compatibility data and is not the canonical event identity;
- change Grant or Consume return types;
- genericize purchase or storefront execution;
- optimize reconciliation beyond its per-entitlement Marketplace query architecture, or change logging or zone behavior;
- implement dynamic-offer live restriction parity;
- add richer external-disclosure location modeling;
- add a structured probability or reward editor.

Those remain later-phase work after this contract is reviewed.
