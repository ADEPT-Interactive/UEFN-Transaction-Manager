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

1. Enable Python Editor Scripting and UEFN MCP Toolsets in the UEFN project.
2. Open Tools -> Agent Integration in Transaction Manager.
3. Enable UTM MCP and choose Copy MCP configuration.
4. Copy the complete packaged Agent Skill folder from resources\agent-skills\uefn-transaction-manager\ into the skill location for your client: `%USERPROFILE%\.agents\skills\uefn-transaction-manager\` for Codex, `%USERPROFILE%\.claude\skills\uefn-transaction-manager\` for Claude Code, or `%USERPROFILE%\.cursor\skills\uefn-transaction-manager\` for Cursor.
5. Connect the agent to both UTM MCP and UEFN MCP, and verify they target the same project. MCP access does not automatically install or discover the Agent Skill.

Keep copied bearer configuration private. The Agent Skill includes guidance for catalog editing, revision safety, icon adoption, existing-project migration, generated contract inspection, compile verification, and ambiguity stops.

NATIVE ICON IMPORT

In UEFN, open the palm-tree Project menu, choose Project Settings, and enable Python Editor Scripting. Transaction Manager installs and connects the project helper automatically.

Power-of-two PNGs are imported unchanged. Other sizes are scaled uniformly to a suitable power-of-two shape, with transparent padding only when needed to preserve proportions. Existing UEFN Texture2D assets can be adopted through the verified project workflow; do not enter filesystem paths or edit .uasset files manually.

For source access, contribution rules, support links, security reporting, and license terms, visit:
https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager

The software is owned by AD3PT Interactive Inc., operating as ADEPT Interactive and ADEPT. The source-available license does not permit unauthorized derivative releases, repackaging, embedding, redistribution, or commercialization.
