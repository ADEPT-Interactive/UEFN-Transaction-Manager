# Phase 28 capability matrix

This document records the current implementation boundary for the 4.2.0 development phase. It distinguishes what Transaction Manager can author and validate from what must still be confirmed by the connected UEFN editor and by gameplay testing.

| Capability | Transaction Manager | UEFN / Epic boundary | Acceptance evidence |
| --- | --- | --- | --- |
| Fixed direct offers | Authors metadata, price, icon reference, restrictions, and stable public helper | Marketplace validates the final offer in the live project | Local validation plus Workflow Server compile |
| Runtime-priced direct or alternate offers | Emits typed `RuntimeOptions`, range/step preflight, a dynamic offer class, and a factory | The project Verse caller supplies the final price | Generated-source tests plus `numErrors: 0` from the connected Workflow Server |
| Fixed bundles | Authors ordered entitlement entries and nested bundle references | Epic applies bundle depth, identifier, and quantity limits | Local validator and generated-source tests |
| Fill-to-max bundle | Preserves the pre-4.2.0 one-entitlement remaining-quantity flow as canonical `quantityBehavior: "fill-to-max"` | Remaining quantity depends on the player's current Marketplace state | Generated-source tests and live compile; gameplay purchase still needs a placed device |
| Runtime bundle quantities | Emits typed quantity options, max-count checks, zero-entry omission, and direct-purchase helper | Project Verse supplies quantities; nested runtime bundles remain unsupported | Generated-source tests plus live compile |
| Native icon import | Normalizes supported raster images to canonical PNG before queueing; can adopt an existing Texture2D through Unreal's editor export API | UEFN must expose Python Editor Scripting and the linked project must be active | Python tests plus Content Browser confirmation |
| Storefronts | Stores explicit membership and excludes runtime-configured bundles | Epic receives the final concrete `[]offer` list | Generated-source tests and live compile |
| Gameplay correctness | Provides stable grant, consume, count, event-await, and purchase helpers | Creator Verse must grant gameplay benefits and reconcile player state | Real island playtest, not compile output |

## Official references used

- [Creating items and offers in Fortnite](https://dev.epicgames.com/documentation/en-us/fortnite/creating-items-and-offers-in-fortnite)
- [Marketplace API](https://dev.epicgames.com/documentation/en-us/uefn/verse-api/fortnite.com/marketplace)
- [bundle_offer](https://dev.epicgames.com/documentation/en-us/uefn/verse-api/fortnite.com/marketplace/bundle_offer)
- [ShowOffersDialog](https://dev.epicgames.com/documentation/en-us/uefn/verse-api/fortnite.com/marketplace/showoffersdialog)
- [Unreal Python RenderingLibrary.export_texture2d](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/RenderingLibrary?application_version=5.6)

The public Epic documentation exposes the Marketplace types and functions, but does not provide a complete runtime factory example for the exact dynamic bundle shape used here. The generator therefore keeps the existing proven field-initializer pattern and treats a connected Workflow Server response with `numErrors: 0` as the authority for live Verse compatibility.
