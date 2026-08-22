# Generated Verse reference

UEFN Transaction Manager generates `managed_transactions.verse` from the catalog saved for your project. The generated file is managed by the application. Do not edit it manually. Put gameplay rules, rewards, saved state, and player-specific decisions in your own Verse.

## Place the generated device

After a successful **Save** and **Compile**:

1. Find `managed_transactions_device` in the target project's Content Browser.
2. Place one instance in the island.
3. Assign generated Trigger or Button arrays in the device details panel when you use those bindings.
4. Reference the placed device from your own `creative_device`.

```verse
using { /Fortnite.com/Devices }

my_game_device := class(creative_device):
    @editable
    Transactions : managed_transactions_device = managed_transactions_device{}
```

The generated device is the supported integration surface. The generated Marketplace declarations and icon members are implementation details of the generated file, not a second public API.

## Purchase helpers

For a catalog item whose stable key is `access_pass`, the device exposes helpers shaped like:

```verse
Transactions.OpenAccessPassPurchase(Player)
Transactions.GetAccessPassCount(Player)
Transactions.HasAccessPass(Player)
```

The helper stem comes from the saved stable key. Changing only the display name does not rename the generated helper. Entitlement ownership helpers are generated for entitlements, including alternate offers through their parent entitlement. Bundles and storefronts do not have ownership helpers.

Generated Trigger and Button bindings call the same purchase helpers. Use them for deliberate player interactions. A storefront helper is generated for All Offers when enabled, and focused storefronts receive their own open helper.

## Runtime prices and quantities

When an offer is configured to receive a runtime price, the generated device purchase helper accepts a generated `<StableKeyStem>RuntimeOptions` value with `PriceVBucks`:

```verse
Price := CalculatePriceForPlayer(Player)
Options := ManagedOffers.AccessPassRuntimeOptions{PriceVBucks := Price}
Transactions.OpenAccessPassPurchase(Player, Options)
```

`ManagedOffers` is the default Offers module name. If you changed the module name in Project Settings, use that name instead. The exact option type and helper stem are generated from the saved stable key. Only values accepted by the Marketplace constraints are opened. Invalid values return through the generated validation path and do not open the Marketplace interface.

Runtime-quantity bundles expose a generated options type with fields such as `<StableKeyStem>Quantity` for each runtime entry. Your Verse calculates the values, then passes the options value to the generated bundle purchase helper. Quantities must be positive whole numbers when included and cannot exceed the configured entitlement maximum. A runtime-configured bundle is a direct purchase and is not added to a storefront.

Fill-to-max bundles use the no-options purchase helper. The generated integration checks current ownership and offers only the remaining quantity. If nothing remains, it does not open a purchase.

For the exact fields in a project, inspect the generated file after compiling or use the Verse preview in Transaction Manager. Do not copy generated module names into long-lived project abstractions.

## Ownership and gameplay operations

Use the count and boolean helpers to query current Marketplace state:

```verse
CheckAccess(Player:player)<suspends>:void =
    if (Transactions.HasAccessPass(Player)):
        Print("Player currently owns the access pass")

    OwnedCount := Transactions.GetAccessPassCount(Player)
```

`Grant<StableKeyStem>` and consumable `Consume<StableKeyStem>` are suspending helpers that return the Marketplace operation result as `logic`. A successful operation result is not a replacement for handling the generated state notifications.

## Grant, removal, and reconciliation events

Generated notifications are recurring suspending functions. Start a watcher and await the next notification in a loop:

```verse
WatchAccess()<suspends>:void =
    loop:
        Grant := Transactions.AwaitAccessPassGrantedEvent()
        HandleAccessGranted(Grant)
```

The generated device provides matching `Await<StableKeyStem>RemovedEvent()` and `Await<StableKeyStem>ReconciledEvent()` functions. Each returns the generated `(player, int)` notification value. A grant represents a positive entitlement delta, a removal represents a negative delta, and reconciliation reports the current count, including zero.

Use `.Await()` through these generated helpers for Transaction Manager notifications. Epic-provided device events such as Button, Trigger, and playspace events are separate APIs and may use `.Subscribe()`.

## Dynamic offer guidance

Keep calculations in your project Verse. Transaction Manager supplies the generated option type, validates the final values, creates the Marketplace offer, and exposes the purchase helper. Your project should own rules such as discounts, progression, player eligibility, and game-state-dependent quantities.

Do not construct raw Marketplace offers in project Verse when the catalog already owns that offer. This keeps purchase locking, validation, logging, and reconciliation in the generated device.

## Debugging and boundaries

Enable **Enable Debug Logging** on the placed generated device when you need additional runtime diagnostics in the Verse log. A successful compile confirms generated Verse compatibility, not gameplay correctness or Marketplace approval. Test the actual purchase, grant, removal, consumption, saved state, and rejoin flows in a real UEFN session.
