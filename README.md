<div align="center">
  <img src="public/uem-mark.svg" alt="UEFN Entitlement Manager icon" width="112" height="112">
  <h1>UEFN Entitlement Manager</h1>
  <p><strong>Design In-Island Transaction catalogs, generate reviewable Verse, and keep every project isolated.</strong></p>
  <p>
    <img alt="Version 2.3.2" src="https://img.shields.io/badge/version-2.3.2-24c7dd?style=flat-square">
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-5b8cff?style=flat-square">
    <img alt="UEFN" src="https://img.shields.io/badge/built%20for-UEFN-8b5cf6?style=flat-square">
    <a href="LICENSE"><img alt="ADEPT Source-Available License" src="https://img.shields.io/badge/license-ADEPT%20Source--Available-f59e0b?style=flat-square"></a>
  </p>
  <p>
    <a href="https://adeptinteractive.net">ADEPT Interactive</a>
    &nbsp;&bull;&nbsp;
    <a href="https://discord.gg/playadept">Community Discord</a>
    &nbsp;&bull;&nbsp;
    <a href="https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager/releases/latest">Latest release</a>
  </p>
</div>

UEFN Entitlement Manager is a local Windows desktop tool for Fortnite creators working with In-Island Transactions. It turns a visual catalog into entitlement classes, individual and bundle offers, storefront displays, purchase prompts, event hooks, and a versioned `managed_transactions.verse` file that can be reopened without guessing at existing code.

The manager complements UEFN. It does not replace Verse compilation, edit-session testing, moderation review, or Epic's current transaction requirements.

## See it in action

### Catalog and generated Verse

Build a catalog with custom icons, prices, restrictions, bundles, and focused offer displays while reviewing the generated Verse beside it.

![Catalog and generated Verse workspace](docs/screenshots/catalog-and-verse.png)

### Focused starting templates

Templates apply only the settings described in the expanded row. Prices remain in the editor where they belong, and every template includes a practical example.

![Expanded access entitlement template](docs/screenshots/template-chooser.png)

### Help inside the workflow

The built-in help panel covers Python Editor Scripting, compiling, placing the generated device, and connecting it to your own Verse. Python is detected immediately after it is enabled. No UEFN restart is required.

![In-app Python and UEFN setup help](docs/screenshots/python-help.png)

> The screenshots use isolated dummy catalog data and original flat demo icons. No production project content is included.

## Highlights

- Durable, consumable, time-limited, access, and paid-random entitlements
- Individual offers, alternate variants, nested bundles, and focused storefront displays
- V-Bucks pricing from 50 to 5,000 in increments of 50
- Minimum-age, country, and platform-family purchase restrictions
- Generated public purchase, grant, removal, consumption, and ownership-verification events
- Trigger bindings by default, with optional button and mutator-zone bindings under Advanced settings
- Project-scoped catalog storage and exact reopening through a versioned comment-only manifest
- Authenticated loopback bridge with validated paths, PNG uploads, atomic Verse saves, and verified backups
- Automatic PNG normalization to a logical power-of-two size before UEFN Texture2D import
- One-click save and compile through UEFN's local Verse Workflow Server
- Self-contained Windows release with its own frontend, bridge, desktop shell, Node runtime, and production dependencies

## Download and run

1. Download `UEFN Entitlement Manager.zip` from the [latest release](https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager/releases/latest).
2. Extract the full ZIP to a folder. Keep its contents together.
3. Open `UEFNEntitlementManager-2.3.2.exe`.
4. Select or browse to the intended `.uefnproject`, then confirm the project before UEM starts its isolated bridge.

No Node.js, Python, browser, `npm install`, or administrator access is required for the packaged app. Windows needs the Microsoft Edge WebView2 Runtime and .NET Framework 4.8, which are normally already available on supported systems.

## Enable native icon import

Native Texture2D import uses UEFN's Python Editor Scripting feature:

1. Open your UEFN project.
2. Open the **Project** menu using the small palm-tree icon.
3. Select **Project Settings**.
4. Scroll to **Python Editor Scripting** and enable its checkbox.

UEM detects the setting immediately. A restart is not required. Upload a PNG, review the normalized power-of-two preview, then choose **Confirm & import into UEFN**.

## Creator workflow

1. Create or edit entitlements, optional bundles, and optional offer displays.
2. Resolve every local validation error. Local validation is not a moderation guarantee.
3. Import any custom icons into the verified project mount.
4. Select **Save to project** to write `managed_transactions.verse` atomically.
5. Select **Save & Compile** to save the current state and request a Verse build.
6. Place one generated `managed_transactions_device` in the island.
7. Configure the generated editable Trigger arrays or call the public functions from your own Verse.
8. Test purchases, cancellations, consumption, rejoin behavior, refunds, and moderation-driven changes in a real UEFN edit session.

Generated gameplay benefits are driven by authoritative entitlement changes, not only by the purchase-dialog result. Your project logic remains responsible for idempotent saved-state and gameplay reconciliation.

## What the generator supports

- Individual `entitlement_offer` and multi-item `bundle_offer` classes
- Alternate offer variants with independent prices, icons, descriptions, and restrictions
- Dynamic remaining-quantity bundles and nested bundles up to Epic's five-level limit
- Paid-random-item disclosures appended to displayed offer descriptions
- `RestrictDirectPromptsToPurchase` and `RestrictPaidRandomItems` checks before direct prompts
- Per-entitlement purchase events and quantity-aware grant, removal, and join-reconciliation events
- Positive transaction processing based on `entitlement_change.Change`
- Negative change signaling for refund, moderation, and inventory-decrease handling
- Player join and leave subscription cleanup
- Optional immediate consumption and separate durable ownership verification on join
- Public grant and consume helpers for reviewed project-specific flows

The manager deliberately does not inject arbitrary custom Verse or pretend to call your save, stat, inventory, or reward systems. Connect the generated interface to reviewed project logic.

## Project and data safety

- The user confirms the selected `.uefnproject` before the bridge starts.
- Every launch uses a loopback-only random port and new ephemeral session tokens.
- Browser callers cannot submit arbitrary filesystem paths.
- Foreign origins are rejected and PNG uploads are validated and size-limited.
- Verse saves use a temporary file plus rename. When backups are enabled, a verified backup must succeed first.
- Native texture imports target the verified project plugin mount and refuse Fortnite's ambiguous `/Game` host mount.
- Catalog state is namespaced by normalized Content directory, preventing accidental reuse across projects.
- Files without UEM's versioned manifest are treated as unmanaged and are not silently rewritten.

See [SECURITY.md](SECURITY.md) for reporting instructions and the full trust boundary.

## Build from source

Requirements for contributors:

- Windows
- Node.js 20 or newer
- .NET SDK with .NET Framework 4.8 targeting support
- UEFN for native import and live Verse compile verification

The easiest first-time setup is:

```powershell
scripts\setup.bat
```

The setup script uses an existing supported Node.js installation or downloads the official current Node.js LTS Windows archive, verifies its SHA-256 checksum, installs locked dependencies, builds the frontend and bridge, and publishes the desktop shell. Its private runtime remains inside the project folder.

For developers who already manage Node.js:

```powershell
npm ci
npm run build
npm test
npm run test:python
npm run test:desktop
npm run test:version
```

Run the complete verification sequence with:

```powershell
npm run test:all
```

For explicit local development outside UEFN, point `UEM_CONTENT_ROOT` at a disposable test Content directory. Never point development sessions at customer or production project data.

## Repository map

```text
desktop/                     Windows WebView2 desktop shell
public/                      Program and UI assets
server/                      Authenticated bridge, security, workflow, and imports
src/components/              Catalog, bundle, settings, validation, and preview UI
src/services/                Schema, validation, generation, parsing, and file services
tests/                       TypeScript and Python regression tests
entitlement_manager.py       UEFN connector runtime and development launcher
uefn_auto_connector.py       Project-scoped automatic connector bootstrap
```

Generated `dist`, private runtimes, desktop build outputs, and release packages are intentionally excluded from source control. End users should use the published release ZIP.

## Validation boundary

Local checks cover identifiers, generated name collisions, filenames, texture expressions, metadata lengths, price ranges, entitlement constraints, paid-random copy, purchase restrictions, nested bundle depth, quantities, and generated binding names.

They cannot prove that a texture exists in the active asset digest, that downstream event handlers correctly grant or revoke benefits, or that Epic will approve an island. UEFN compilation and real edit-session testing remain required. Review Epic's current [Creating Items and Offers documentation](https://dev.epicgames.com/documentation/en-us/fortnite/creating-items-and-offers-in-fortnite) before publishing.

## Contributing and license

Source is available for inspection and contributions under the [ADEPT Source-Available License](LICENSE). This is not an open-source license. Official releases may be used to build and operate personal or monetized UEFN projects, but the codebase and releases may not be republished, repackaged, embedded, resold, or redistributed as unauthorized derivatives.

Contributions require the [Contributor License Agreement](CLA.md) and the documented [CLA acceptance process](CLA-ACCEPTANCE.md). Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

<div align="center">
  <sub>Created by AD3PT Interactive Inc., operating as ADEPT Interactive and ADEPT.</sub><br>
  <sub>Not affiliated with, endorsed by, or sponsored by Epic Games, Inc.</sub>
</div>
