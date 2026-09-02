UEFN TRANSACTION MANAGER 4.3.0

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

Use the generated purchase helpers, ownership/count queries, grants, consumption helpers, and Await-based state notifications from your project Verse. Keep rewards, eligibility, progression, saved state, UI, and game-specific calculations in your own Verse. Test purchases, cancellations, refunds, consumption, saved state, and rejoin behavior in a real UEFN session before publishing.

AGENT INTEGRATION

UTM 4.3 can work with UEFN's separate Unreal MCP through an MCP-compatible coding agent.

1. Open the exact project in UEFN, then enable Python Editor Scripting and Unreal MCP Toolsets in that project.
2. Open the visible Agent button in the Transaction Manager workspace. If the catalog is empty and you already have transactions, choose Start guided migration.
3. Select Codex, Claude Code, or Cursor and use the guided setup. UTM installs its complete Agent Skill folder; UTM MCP is already started with the project bridge and the panel prepares the current project configuration.
4. Replace or add only the UTM-owned MCP entry using the copied local URL configuration.
5. Reload the coding agent or start a fresh process. Confirm both UTM MCP and Unreal MCP are visible, then ask the agent to verify that both target the same project.

UTM separately reports its listener, skill installation, agent setup, reload requirement, and verified agent connection. The Agent Skill includes guidance for catalog editing, revision safety, icon adoption, existing-project migration, generated integration review, compile verification, and semantic checks. Manual path copying remains available for unusual clients.

NATIVE ICON IMPORT

For first-time setup or migration, open the exact project in UEFN, open the palm-tree Project menu, choose Project Settings, and enable Python Editor Scripting before creating or importing transactions. Keep the project open while Transaction Manager installs and connects the project helper and confirms its native placeholder asset.

Power-of-two PNGs are imported unchanged. Other sizes are scaled uniformly to a suitable power-of-two shape, with transparent padding only when needed to preserve proportions. Existing UEFN Texture2D assets can be adopted through the verified project workflow; do not enter filesystem paths or edit .uasset files manually.

For source access, contribution rules, support links, security reporting, and license terms, visit:
https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager

The software is owned by AD3PT Interactive Inc., operating as ADEPT Interactive and ADEPT. The source-available license does not permit unauthorized derivative releases, repackaging, embedding, redistribution, or commercialization.
