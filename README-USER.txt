UEFN ENTITLEMENT MANAGER 4.0.1

GET STARTED

1. Download and run `UEFN-Entitlement-Manager-Setup.exe` from the latest GitHub release.
2. Launch UEFN Entitlement Manager from Windows Start/Search.
3. Select the project that is open in UEFN, choose a recent project, or browse
   to its .uefnproject file.
4. Confirm Open project in UEM.

Known projects appear first. The launcher can continue discovering projects across local fixed drives while it is open.

UEM installs as a per-user Windows x64 application. It creates a Start menu
entry and an Add or Remove Programs entry. Project data, discovery cache, and
settings remain in your user profile when UEM is upgraded or uninstalled.

UEM checks for stable ADEPT update-service updates in the background after the launcher is ready.
Use Tools, then Check for Updates to check manually. Choose Restart and Install
after an update has finished downloading. The portable ZIP is a secondary
diagnostic fallback, not the normal installation path.

CREATOR WORKFLOW

Create your entitlements, offers, bundles, and displays, then use Save & Compile
to write managed_transactions.verse and compile it in UEFN. Find the generated
managed_transactions_device in UEFN's Content Browser, place it in your island,
and connect its Trigger arrays or canonical public events and functions to your gameplay systems. UEM uses
stable-key-based names such as OpenDurableEntitlementPurchase and
AwaitDurableEntitlementGrantedEvent for every project. Use Get<StableKeyStem>Count
and Has<StableKeyStem> from your own Verse to query current Marketplace
ownership; do not edit the managed file.
Grant<StableKeyStem> and consumable Consume<StableKeyStem> are
suspending helpers that return the native Marketplace operation result as logic.
Non-positive quantities return false without calling Marketplace. That result is
not a replacement for awaiting the canonical entitlement delta events, which
remain the gameplay-state signal. UEM custom notifications use generated
`Await<StableKeyStem>GrantedEvent()` / `RemovedEvent()` / `ReconciledEvent()`
functions backed by native `.Await()`, not `.Subscribe()`. Epic-provided
device/listenable events may separately support `.Subscribe()`. Supported old manifests and temporary
compatibility metadata regenerate to the same current canonical API.

Test purchases, cancellations, refunds, consumption, saved state, and rejoin
behavior in a real UEFN session before publishing.

NATIVE ICON IMPORT

In UEFN, open the palm-tree Project menu, choose Project Settings, scroll to
Python Editor Scripting, and enable it. No restart is needed. UEM installs and
connects the project helper automatically.

Power-of-two PNGs are imported unchanged. Other sizes are scaled uniformly to
the closest suitable power-of-two shape. Transparent edge space is added only
when needed to preserve the original proportions, so icons are never stretched
or squashed.

For source access, contribution rules, support links, security reporting, and
license terms, visit:
https://github.com/ADEPT-Interactive/UEFN-Entitlement-Manager

The software is owned by AD3PT Interactive Inc., operating as ADEPT Interactive
and ADEPT. The source-available license does not permit unauthorized derivative
releases, repackaging, embedding, redistribution, or commercialization.
