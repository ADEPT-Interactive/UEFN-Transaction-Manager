# Agent Integration

UEFN Transaction Manager 4.3 works alongside Unreal MCP in a coding-agent workflow. Your agent can manage transactions through UTM MCP and work with the project through Unreal MCP. Your project Verse remains responsible for gameplay and business logic.

## Before you connect

- Open the target `.uefnproject` in UEFN.
- Enable Python Editor Scripting and UEFN MCP Toolsets for that project.
- Open the same project in UTM.
- Use an MCP-capable coding agent.

UTM's main workspace now exposes **Agent** directly. If the catalog is empty, **Already have in-island transactions?** opens the migration setup path; the existing project does not need to be rebuilt by hand.

## Guided setup

1. Open **Agent** from the UTM workspace header, or choose **Start guided migration** from the empty-catalog onboarding.
2. Select Codex, Claude Code, or Cursor. UTM installs its complete skill folder into that client's user skill directory without overwriting unrelated files.
3. UTM starts its project-scoped MCP listener with the project bridge and prepares a small `utm-mcp` configuration containing its local URL and server type.
4. Use the copied configuration to add or replace only the UTM-owned client entry.
5. Reload the client or start a fresh coding-agent process. A process that was already running cannot see a new MCP configuration merely because UTM is running.
6. Confirm the fresh session exposes both `utm-mcp` and `unreal-mcp`, then ask the agent to call `get_project_context`. UTM marks the connection **Verified** only after that real MCP call.

UTM reports these states separately: server running, Agent Skill installed, agent setup ready, and connection verified. **UTM MCP Running** does not mean the current coding agent has loaded the new entry.

## Operation preflight and activity state

Every agent operation follows one ordered contract:

`DISCOVER -> PREFLIGHT -> USER BLOCKER/APPROVAL IF NEEDED -> ACTIVITY TRANSITION -> MUTATE -> VERIFY -> COMPLETE`

The packaged skill selects an operation manifest before it starts. It then discovers the live schemas and project/editor context from both MCP servers and submits that evidence to UTM's read-only `preflight_operation` tool. UTM proves its own project identity, catalog revision, managed-file ownership, editor/native readiness, and UTM capabilities. The agent must label Unreal MCP evidence as agent-reported; a server name, endpoint, process, retained heartbeat, or remembered tool name is not capability proof.

UTM compares the canonical project file, project root, project name, Content root, and asset mount. A missing Unreal server, uninspected schema, missing capability, editor-not-ready state, or identity mismatch returns a blocker and no mutation token. A UTM-mutation-capable result returns a short-lived, connection-owned, project- and revision-bound `preflightToken`; the UTM mutation tools enforce that token at the API boundary and also require an active caller-owned mutating activity. External-only mutations remain agent-side and are not represented as UTM catalog modification. Dry runs and read-only inspection remain available without a mutation token.

The UI polls server-owned activity state and shows only safe status text: **Agent is inspecting UTM** or **Agent is modifying your UTM catalog**, followed by the current phase. Activities require heartbeats, expire automatically when heartbeats stop, cannot be revived after expiry, are bound to the selected project and MCP connection, and allow at most one mutating activity per project. Connection close cancels its active activities.

Full existing-project migration is a single all-capability operation. It never silently falls back to catalog-only. If Unreal MCP is unavailable or incomplete, the full operation stops before catalog, generated Verse, source, asset, device, compile, or session mutation. A separate `catalog-only-migration` request is permitted only with explicit owner approval, is returned and displayed as partial, and leaves native icon adoption, device wiring, Verse callers, compilation, and live acceptance open.

## Manual fallback

For another MCP client, expand **Safety and manual setup** in Agent Integration. Copy the complete packaged folder, including `SKILL.md` and `references`, into the client's supported user-skill location and add the displayed `utm-mcp` entry manually. The default endpoint is `http://127.0.0.1:8001/mcp`; the panel supplies the current endpoint if the port was changed.

## Same-project guard

Before any catalog or Verse mutation, the agent must call UTM `get_project_context` and the strongest available Epic project/editor context. Compare the canonical `.uefnproject` path/root, project name, and content/asset mount. Localhost and matching names are not sufficient. A mismatch stops the workflow before mutation.

UTM catalog mutations require the opaque `expectedRevision` returned by `get_catalog_snapshot`. A revision conflict means the shared draft changed; reload, reconcile, and retry safely. `apply_catalog_patch` should be dry-run first for migration.

## Existing-project migration

The packaged Agent Skill performs a read-only inventory first. It searches relevant Verse and assets, traces offers, alternate paths, bundles, storefronts, ownership/count checks, grants, consumption, dynamic values, restrictions, and icons, then classifies findings as confirmed, inferred, ambiguous, or absent. Exhaustive evidence that a concept does not exist is absence, not ambiguity.

The agent must prepare and review a required source-to-proposed semantic parity table before applying an atomic catalog patch. In `existing-project` mode, `apply_catalog_patch` rejects a missing, incomplete, inferred, or contradictory table. Each row records the legacy identity, proposed UTM record, exact Name/Description/ShortDescription, type, MaxCount, immediate-use evidence, `autoConsume`, price, restrictions, icon source, gameplay consequence boundary, repeated-purchase behavior, and offer relationships. It preserves identifiers and gameplay semantics, keeps unmatched existing UTM records unless replacement is proven or deletion is explicitly authorized, adopts only real `Texture2D` paths discovered through Unreal MCP, saves through UTM, reads the current integration contract, updates external project callers, compiles through Unreal MCP, rescans for legacy plumbing, and verifies persistence. It must never duplicate transactions or move gameplay logic into `managed_transactions.verse`.

Call `validate_migration_parity` before the dry run. Immediate-use legacy patterns must map to consumable `autoConsume`; their gameplay consequence must await the generated `Consumed` event, which fires only when the generated consume helper's pending intent is matched to an authoritative negative entitlement delta. Do not use `Granted` or generic `Removed` as a substitute.

## Responsibilities and limits

| Service | Use it for |
| --- | --- |
| **UTM MCP** | Catalog, entitlements, alternate offers, bundles, storefronts, validation, generated integration, icon adoption, and catalog save |
| **Unreal MCP** | Verse, project files, Texture2D discovery, devices, compilation, editor state, sessions, and logs |

UTM does not provide arbitrary shell/file access, raw `.uasset` editing, purchases, or island publishing. The current Unreal MCP may still require manual wiring for generated arrays containing placed `trigger_device` or `button_device` references, and its refresh/client-log capabilities must be checked at runtime rather than assumed.

## Lifecycle recovery

- **UTM MCP unavailable:** UTM MCP starts with the project bridge. Resolve the displayed listener or port issue, then copy the current configuration.
- **Listener unavailable or port occupied:** resolve the displayed loopback-port issue, then copy a fresh configuration.
- **UTM restarted:** reconnect any MCP session that was interrupted.
- **Agent not verified:** start/reload a fresh process and call `get_project_context`; do not infer verification from the UTM panel's server status.
- **UTM MCP missing in the agent:** stop the transaction workflow and repair client setup. Do not open localhost in a browser or attempt unsupported browser/desktop automation.
- **Unreal MCP missing:** report editor, compile, asset, and session work as unverified.

For the complete agent procedure, see [the packaged Agent Skill](../skills/uefn-transaction-manager/SKILL.md).
