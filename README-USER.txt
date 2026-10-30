UEFN TRANSACTION MANAGER 4.6.0

GET STARTED

1. Download and run `UEFN-Transaction-Manager-Installer.exe` from the latest GitHub release.
2. Launch UEFN Transaction Manager from Windows Start/Search.
3. Select the project that is open in UEFN, choose a recent project, or browse
   to its .uefnproject file.
4. Confirm Open project in Transaction Manager.

Known projects appear first. The launcher can continue discovering projects across local fixed drives while it is open.

Transaction Manager installs as a per-user Windows x64 application. Project data, discovery cache, and settings remain in your user profile when Transaction Manager is upgraded or uninstalled.

Transaction Manager checks for stable ADEPT update-service updates in the background after the launcher is ready. Use Tools, then Check for Updates to check manually. Portable copies use a verified ZIP update path and stay in the same folder.

CREATOR WORKFLOW

Create entitlements, offers, bundles, and storefronts, then use Save and Compile to write managed_transactions.verse and compile it in UEFN. Find the generated managed_transactions_device in UEFN's Content Browser, place one instance in your island, and connect it to your own gameplay systems. Do not edit the managed file by hand.

Use the generated purchase helpers, ownership/count queries, grants, consumption helpers, and awaitable or cancellable callback state notifications from your project Verse. Keep rewards, eligibility, progression, saved state, UI, and game-specific calculations in your own Verse. Test purchases, cancellations, refunds, consumption, saved state, and rejoin behavior in a real UEFN session before publishing.

Open Verse API or an offer's Functions shortcut to browse exact calls, events, wiring, and examples. New offer key previews follow the title until creation; existing keys stay stable during title edits.

Durable offers can also expose an optional Ownership Confirmed trigger for join-time access effects. It fires only when reconciliation confirms a positive owned count; purchase Success Triggers keep their existing purchase/grant meaning.

AGENT INTEGRATION

UTM MCP supports catalog work through a compatible coding agent. Add Epic Unreal MCP for editor assets, external gameplay Verse, device wiring, compilation, or full migration.

1. Open the intended project in UTM. For native/editor work, open the exact project in UEFN and enable the required Python/MCP tools.
2. Open the visible Agent button in the Transaction Manager workspace. If the catalog is empty and you already have transactions, choose Start guided migration.
3. Select Codex, Claude Code, or Cursor and use the guided setup. UTM installs its complete Agent Skill folder; UTM MCP is already started with the project bridge and the panel prepares the current project configuration.
4. Replace or add only the UTM-owned MCP entry using the copied local URL configuration.
5. Reload the coding agent or start a fresh process. Ask it to call describe_operation_contract and get_project_context. For editor work, also verify that Epic Unreal MCP identifies the same project.

UTM separately reports its listener, skill installation, agent setup, reload requirement, and verified agent connection. The Agent Skill includes guidance for catalog editing, revision safety, icon adoption, existing-project migration, generated integration review, compile verification, and semantic checks. Manual path copying remains available for unusual clients.

NATIVE ICON IMPORT

For first-time setup or migration, open the exact project in UEFN, open the palm-tree Project menu, choose Project Settings, and under Beta Access enable Python Editor Scripting. Keep the project open while Transaction Manager connects its application-owned helper and confirms its native placeholder asset. It does not add to init_unreal.py or install Python files into the project.

Power-of-two PNGs are imported unchanged. Other sizes are scaled uniformly to a suitable power-of-two shape, with transparent padding only when needed to preserve proportions. Keep original artwork outside mounted Content folders; import only the prepared image. Existing UEFN Texture2D assets can be adopted through the verified project workflow; do not enter filesystem paths or edit .uasset files manually.

For source access, contribution rules, support links, security reporting, and license terms, visit:
https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager

The software is owned by AD3PT Interactive Inc., operating as ADEPT Interactive and ADEPT. The source-available license does not permit unauthorized derivative releases, repackaging, embedding, redistribution, or commercialization.
