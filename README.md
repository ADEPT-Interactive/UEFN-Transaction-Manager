<div align="center">
  <img src="public/uem-mark.svg" alt="UEFN Transaction Manager icon" width="112" height="112">
  <h1>UEFN Transaction Manager</h1>
  <p><strong>A visual tool for building and managing Fortnite in-island transactions in UEFN.</strong></p>
  <p>
    <img alt="Version 4.3.0" src="https://img.shields.io/badge/version-4.3.0-24c7dd?style=flat-square">
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-5b8cff?style=flat-square">
    <img alt="UEFN" src="https://img.shields.io/badge/built%20for-UEFN-8b5cf6?style=flat-square">
    <a href="https://discord.gg/playadept"><img alt="ADEPT Discord" src="https://img.shields.io/discord/790712680482603038?label=Discord&logo=discord&logoColor=white&color=5865F2&style=flat-square"></a>
    <a href="LICENSE"><img alt="ADEPT Source-Available License" src="https://img.shields.io/badge/license-ADEPT%20Source--Available-f59e0b?style=flat-square"></a>
  </p>
  <p>
    <a href="https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Installer.exe">Download Installer</a>
    &nbsp;&bull;&nbsp;
    <a href="https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Portable.zip">Portable ZIP</a>
    &nbsp;&bull;&nbsp;
    <a href="https://discord.gg/playadept">Community Discord</a>
    &nbsp;&bull;&nbsp;
    <a href="https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest">Latest release</a>
  </p>
</div>

UEFN Transaction Manager is a visual Windows app for building Fortnite in-island transactions in UEFN. Create entitlements, offers, bundles, storefronts, dynamic purchases, icons, and generated Verse from one project catalog. Use the app yourself, or let a compatible coding agent work with the same catalog.

![UEFN Transaction Manager catalog showing entitlements, offers, bundles, and connected project status](docs/screenshots/catalog-overview.png)

## Why creators use UTM

- Build the transaction catalog visually instead of hand-editing Marketplace plumbing.
- Configure durable and consumable entitlements, alternate offers, prices, restrictions, disclosures, ownership limits, and gameplay-facing flags.
- Compose fixed bundles, fill-to-max bundles, runtime-quantity bundles, and storefronts.
- Use runtime prices and quantities calculated by your own Verse while UTM validates the final values and generates the integration surface.
- Import supported artwork or adopt existing UEFN `Texture2D` assets into the managed icon workflow.
- Generate the managed Verse device, purchase helpers, ownership queries, grants, consumption helpers, and state notifications.
- Review local validation and advisory moderation guidance before compiling and testing in UEFN.

## Built for creators. Ready for coding agents.

You do not need a coding agent to use UTM. The complete catalog editor, validation, icon tools, Verse generation, and UEFN compile workflow are available in the app.

If you connect a coding agent such as Codex, Claude Code, or Cursor, it can work with that same catalog through **UTM MCP** and with your UEFN project through [Unreal MCP](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).

<p align="center"><img src="docs/assets/utm-mcp-workflow.svg" alt="A coding agent connects to UTM MCP for transaction catalog work and Unreal MCP for UEFN editor work; both meet in the same UEFN project." width="92%"></p>

Connect your coding agent to UTM and Unreal MCP. It can manage your transaction catalog through UTM, inspect your project, update Verse and assets, and compile the result through Unreal MCP. Your project Verse keeps gameplay rules, rewards, eligibility, progression, and UI. UTM is an independent tool and is not endorsed by or affiliated with Epic Games. UEFN and Fortnite are products of Epic Games.

## Existing-project migration

Already have Marketplace transactions in Verse? A coding agent can inspect the existing setup, recreate the catalog in UTM, reuse project icons, update your Verse to use the generated UTM helpers, and compile the result.

Your gameplay calculations and purchase consequences stay in your Verse. If ownership, offer meaning, bundle contents, or runtime behavior are unclear, the Agent Skill stops for review instead of guessing. See the [existing-project adoption guidance](docs/AGENT_INTEGRATION.md#existing-project-migration) for the full workflow.

## Download and install

**Recommended: [Download the Windows installer](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Installer.exe)**

The installer is a per-user Windows x64 application. It does not require administrator access, Node.js, Python, or a separate runtime installation. The [Portable ZIP](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Portable.zip) is a secondary option for testing or environments where you do not want an installed copy. Both links use stable latest-release aliases.

## Requirements

- Windows x64.
- UEFN installed for project connection and Verse compilation.
- The exact target `.uefnproject` open in UEFN and **Python Editor Scripting** enabled for first-time managed setup or migration, compilation, and native asset changes. Initialized catalogs with already-confirmed assets can receive catalog-only saves while UEFN is closed.
- An MCP-compatible coding agent only if you want to use Agent Integration.

## Quick start

1. Open the UEFN project you want to work on.
2. [Download and run the installer](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/releases/latest/download/UEFN-Transaction-Manager-Installer.exe).
3. Select the open project, choose a recent project, or browse to its `.uefnproject` file.
4. Confirm the project and create your first entitlement or offer.

<p align="center">
  <img src="docs/screenshots/launcher.png" alt="UEFN Transaction Manager project launcher showing several creator projects" width="78%">
</p>
<p align="center"><em>Choose the project that should receive the catalog and generated Verse.</em></p>

## Build the catalog

Start with an entitlement, then configure its primary offer. Add alternate offers when the same entitlement needs a different price, restriction, or presentation. Use bundles for grouped purchases and storefronts for the exact offers you want to present together.

<p align="center">
  <img src="docs/screenshots/offer-editor.png" alt="UEFN Transaction Manager offer editor showing name, description, price, and runtime behavior" width="55%">
  <img src="docs/screenshots/dynamic-transactions.png" alt="UEFN Transaction Manager dynamic transaction editor showing a price supplied by Verse" width="40%">
</p>

Prices are entered as V-Bucks. UTM allocates the stable Verse identity used by generated helpers; changing a display name does not rename that integration surface. Trigger and Button bindings are explicit, so a purchase flow starts from a deliberate player interaction rather than automatic zone entry.

### A guided first offer

When you create a new offer, UTM walks you through **General & Pricing**, **Icon & Texture**, and **Behavior & Moderation** before **Save Offer** becomes available. Templates arrive prefilled, but still pass through the same review. Existing offers remain freeform to edit, so advanced creators can move directly to the section they need.

### Runtime prices and quantities

Some offers need values supplied by gameplay, such as a price calculated from progression or a bundle quantity calculated from current ownership. Mark the offer for runtime values, then pass the generated options type from your project Verse when opening the purchase. UTM validates the allowed range before the Marketplace interface opens.

Fill-to-max bundles calculate the remaining quantity from current ownership. Runtime-quantity bundles let your Verse supply positive quantities for configured entries. Runtime-configured bundles are direct purchases and are not added to storefront displays. The [Generated Verse reference](docs/GENERATED_VERSE_REFERENCE.md) shows the generated option shapes.

### Icons and UEFN project assets

For first-time setup or migration, confirm the exact project is open in UEFN and Python Editor Scripting is enabled before UTM writes the first managed catalog or generated Verse. To import artwork into the Content Browser:

1. In UEFN, open the palm-tree **Project** menu.
2. Choose **Project Settings**.
3. Enable **Python Editor Scripting**.
4. Keep this exact project open while UTM provisions its native placeholder and confirms the object path.
5. Add or edit an icon and confirm the import.

Power-of-two PNGs are kept unchanged. Other supported raster images are normalized and scaled uniformly, with transparent padding only when needed to preserve proportions. New offers start with a built-in square placeholder Texture2D; UTM provisions and confirms it before generated Verse is saved. Replace it with a custom icon when your artwork is ready. The Icon tab can also adopt a verified UEFN `Texture2D` object path; do not enter a Windows filesystem path or edit `.uasset` files manually.

<p align="center">
  <img src="docs/screenshots/icon-texture.png" alt="UEFN Transaction Manager icon editor showing an adopted UEFN Texture2D and managed icon preview" width="72%">
</p>

### Bundles and storefronts

Bundles preserve configured order and quantities, including nested and dynamic behavior. Storefront membership is explicit, so you choose exactly which primary offers, alternate offers, and static bundles appear in All Offers or a storefront.

<p align="center">
  <img src="docs/screenshots/bundles-storefronts.png" alt="UEFN Transaction Manager bundle and storefront sections showing grouped offers and storefront membership" width="82%">
</p>

## Agent Integration

Agent Integration is optional. Connect your coding agent to UTM MCP and Unreal MCP when you want it to work with this catalog and your UEFN project.

1. Enable Unreal MCP in the UEFN project using [Epic's setup guide](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).
2. In UTM, open **Agent** from the workspace header.
3. Choose **Copy MCP configuration**. UTM supplies the local endpoint and server type.
4. Install or use the packaged [UTM Agent Skill](docs/AGENT_INTEGRATION.md#agent-skill) using the client-specific destination shown in the guide.
5. Connect a compatible coding agent to both UTM MCP and Unreal MCP, then verify both identify the same project before making changes.

<p align="center">
  <img src="docs/screenshots/agent-integration.png" alt="UTM Agent Integration panel showing a running UTM MCP endpoint, active project, and Agent Skill access" width="82%">
</p>

The packaged Agent Skill teaches the safe workflow for catalog creation, revision-aware edits, UTM-managed Verse identities, icon adoption, generated integration review, existing-project migration, compilation, and semantic checks. MCP support and Agent Skill support are separate capabilities; a client that can connect to UTM MCP does not automatically discover the skill. Read the [Agent Integration guide](docs/AGENT_INTEGRATION.md) for client setup, same-project safety, and troubleshooting.

## Compile and connect generated Verse

When the catalog is ready:

1. Resolve validation errors and review warnings.
2. Choose **Save** to persist the catalog and update `managed_transactions.verse`.
3. Choose **Compile** while the target project is open in UEFN.
4. Find the generated `managed_transactions_device` in the Content Browser and place it in your island.
5. Assign generated Trigger or Button arrays in the device details panel when you use those bindings.
6. Reference the placed device from your own Verse and connect purchases to your gameplay systems.

<p align="center">
  <img src="docs/screenshots/verse-integration.png" alt="UEFN Transaction Manager catalog beside generated managed_transactions.verse and compile controls" width="90%">
</p>

The generated device is the supported integration surface. For an entitlement with the stable key `access_pass`, project Verse can use helpers shaped like these:

```verse
using { /Fortnite.com/Devices }

my_game_device := class(creative_device):
    @editable
    Transactions : managed_transactions_device = managed_transactions_device{}

    BuyAccess(Player:player):void =
        Transactions.OpenAccessPassPurchase(Player)

    CheckAccess(Player:player)<suspends>:void =
        OwnedCount := Transactions.GetAccessPassCount(Player)
        # Apply your game's access rules using OwnedCount.

    WatchAccess()<suspends>:void =
        loop:
            Grant := Transactions.AwaitAccessPassGrantedEvent()
            HandleAccessGranted(Grant)
```

Keep `managed_transactions.verse` manager-owned. Put rewards, eligibility, progression, saved state, and game-specific UI in your own Verse. See the [Generated Verse reference](docs/GENERATED_VERSE_REFERENCE.md) for runtime options, ownership, events, grants, consumption, and device bindings.

## Validation and testing

Errors prevent invalid catalog data from being saved or compiled. Warnings are review aids and do not guarantee Marketplace approval. Transaction Manager's odds field is optional, but paid-random offers still need accurate numerical odds disclosed to players before purchase; if the field is empty, provide that disclosure elsewhere in your island and clearly direct players there.

<p align="center">
  <img src="docs/screenshots/validation.png" alt="UEFN Transaction Manager validation report showing local checks and review guidance" width="62%">
  <img src="docs/screenshots/moderation-guidance.png" alt="UEFN Transaction Manager offer editor showing transaction moderation flags" width="32%">
</p>

A successful Verse compile proves that the generated code compiles. It does not prove that gameplay grants the intended reward, a purchase flow works in a live session, or an island will be approved. Test purchases, cancellations, refunds, consumption, saved state, and rejoin behavior in a real UEFN session before publishing.

## Troubleshooting and limits

### The project is not connected

When UEFN is closed, open the project linked to this Transaction Manager window manually in UEFN. UTM will reconnect automatically when the editor opens. Close duplicate UEFN sessions if more than one project is open.

### Icon import is unavailable

Enable **Python Editor Scripting** in the project settings, then confirm UEFN and UTM target the same project. First-time setup and native import require the editor connection to remain available while the exact Texture2D object path is confirmed. If an initialized catalog references only existing confirmed assets, catalog-only edits can be saved while UEFN is closed.

### A generated device field is missing

Compile successfully, refresh the UEFN Content Browser, and confirm that you placed the generated device from the target project. Some generated device reference arrays may still require manual UEFN wiring when the current UEFN MCP representation cannot assign them reliably.

### An agent cannot see both servers

Confirm Unreal MCP is available and the agent was started from the project/workspace context expected by that client. UTM MCP starts with the project bridge. Compare both servers' project context before mutation. If Unreal MCP's refresh or session command is unavailable, save, run a full compile, and restart the editor session as described in the [Agent Integration guide](docs/AGENT_INTEGRATION.md#current-uefn-mcp-limits).

## Documentation and support

- [Agent Integration guide](docs/AGENT_INTEGRATION.md) for UTM MCP, Unreal MCP, the packaged skill, migration, and limits.
- [Generated Verse reference](docs/GENERATED_VERSE_REFERENCE.md) for the current generated contract and common integration patterns.
- [Epic's UEFN MCP documentation](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).
- [Epic's In-Island Transactions documentation](https://dev.epicgames.com/documentation/en-us/fortnite/in-island-transactions-in-fortnite).
- [Epic's Creating Items and Offers guide](https://dev.epicgames.com/documentation/en-us/fortnite/creating-items-and-offers-in-fortnite).
- [Epic's In-Island Transactions restrictions](https://dev.epicgames.com/documentation/en-us/fortnite/in-island-transactions-restrictions-in-fortnite).
- [Contribution guide](CONTRIBUTING.md) for developers working from source.
- [Security policy](SECURITY.md) for reporting a security issue.

Ask questions and share feedback in the [ADEPT Community Discord](https://discord.gg/playadept), or open an issue in this repository with a reproducible problem.

## Contributing

The repository is source-available. Before submitting a contribution, read [CONTRIBUTING.md](CONTRIBUTING.md) and complete the required [CLA acceptance process](CLA-ACCEPTANCE.md). Keep changes focused and include the relevant automated or live UEFN evidence.

## License

Copyright © 2026 AD3PT Interactive Inc., operating as ADEPT Interactive and ADEPT.

This project uses the [ADEPT Source-Available License](LICENSE). Viewing, private evaluation, and contribution through the official repository are permitted. The license does not permit unauthorized redistribution, derivative releases, repackaging, embedding, commercialization, or branding use.

UEFN and Fortnite are products of Epic Games. UEFN Transaction Manager is an independent community tool and is not endorsed by or affiliated with Epic Games.
