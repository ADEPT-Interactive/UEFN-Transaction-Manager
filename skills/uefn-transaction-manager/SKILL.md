---
name: uefn-transaction-manager
description: Safely create, migrate, validate, and integrate UEFN in-island transaction catalogs using UTM MCP together with Epic's unreal-mcp.
metadata:
  short-description: UTM and dual-MCP transaction workflows
---

# UEFN Transaction Manager

Use this skill for UTM catalogs, in-island transactions, Marketplace plumbing, generated UTM Verse, transaction icons, or migration of an existing transaction implementation.

UTM MCP manages the transaction catalog, validation, generated `managed_transactions.verse`, controlled icon adoption, and catalog saves. Epic `unreal-mcp` works with the UEFN project, Verse files, assets, devices, editor state, compilation, sessions, and logs. Project Verse keeps gameplay and business logic. Explain this split once, then focus on the creator's workflow.

## Non-negotiable gates

- Discover live tools and schemas from both MCP servers before using them. Never guess tool names, generated symbols, object paths, or editor capabilities.
- UTM MCP is a local Streamable HTTP connection at the configured `127.0.0.1` endpoint. It needs no credential or header. The server still enforces loopback binding, strict Host and Origin checks, a constrained tool surface, project identity, and revision-safe mutations.
- Before any cross-server mutation, call UTM `get_project_context`, call the strongest available Epic project/editor context, and compare canonical project file/root, project name, and content/asset mount. Stop on a mismatch or insufficient evidence.
- Read UTM `get_catalog_snapshot` immediately before a mutation and retain its opaque `revision`. Every UTM mutation must use that exact value as `expectedRevision`.
- For a first managed catalog with no managed Verse file, require the exact project open in UEFN, a fresh editor bridge, and Python Editor Scripting enabled. UTM must provision and positively confirm the exact placeholder `Texture2D` object path before any catalog or managed Verse persistence. If any prerequisite or asset check fails, stop without a mutation or file write.
- Before every save, collect every generated icon expression (primary, alternate, and bundle), resolve each to its exact project object path, and confirm that the referenced asset exists. Never persist generated Verse with an unconfirmed managed asset reference.
- Migrations are read-only until the inventory, required source-to-proposed semantic parity table, and dry run are reviewed. Use `validate_migration_parity` and then include the same table in `apply_catalog_patch` with `migration.mode: "existing-project"`; UTM rejects a missing, incomplete, inferred, ambiguous, absent, or contradictory table before any migration mutation. Preserve unmatched existing UTM records by default. Stop only when ambiguity could change what is sold, owned, granted, consumed, priced, restricted, or eligible.
- A successful tool call is not verification. Use the full save/generate/compile/inspect/verify loop.
- After a generated managed file exists, treat `get_project_context.projectReadiness.transactionSetup` as an explicit operational gate. Confirm generated source and managed class presence, current generated source, current compile evidence, one unambiguous placed managed-device instance, a proven `Transactions` reference, and `utmRuntimeReady=true` before describing the generated runtime as operational; follow its remediation when any state is missing or stale. Project-specific purchase callers and gameplay remain outside UTM's automatic proof.
- Never read or write arbitrary files or `.uasset` binaries through UTM. Internal UTM UI/editor bridge credentials remain private and must never enter project files, generated Verse, logs, prompts, or source control.
- UEFN capability availability is not project readiness. The project browser may keep the UEFN process, Verse workflow server, Python runtime, or UEFN MCP listener alive; treat selector/loading states and retained connector heartbeats as not ready. Require UTM `get_project_context` to report the exact project active with `editorConnected=true` and native texture adoption available before first-run or asset mutations. Recheck after project close/browser transitions and after reconnects.

## Setup and connection

UTM MCP starts with the project bridge and is available by default. The generated client entry is intentionally small:

```json
{
  "mcpServers": {
    "utm-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:8001/mcp"
    }
  }
}
```

After guided setup or a port change, reload the coding agent or start a fresh process. Confirm that the fresh client can see both `utm-mcp` and `unreal-mcp`, then call `get_project_context` before editing. If UTM MCP is missing, diagnose the listener, client configuration, or process-reload boundary. Do not open localhost in a browser or substitute unsupported desktop automation. If Epic MCP is missing, do not claim project, asset, Verse, compile, or session evidence.

For supported agents, the guided panel installs this complete skill folder into the agent-specific user skill directory. Manual copying is only a fallback. An installed skill may be opened from the readiness pod when its verified path is known.

## Choose the workflow

- For a new catalog, read [new-project-workflow.md](references/new-project-workflow.md).
- For an existing implementation, read [existing-project-adoption.md](references/existing-project-adoption.md).
- Read [transaction-semantics.md](references/transaction-semantics.md) for ownership, grants, consumption, alternate offers, bundles, restrictions, and gameplay meaning.
- Read [dynamic-transactions.md](references/dynamic-transactions.md) for runtime price, quantity, or fill-to-max behavior.
- Read [asset-adoption.md](references/asset-adoption.md) for icons and [verification.md](references/verification.md) for compile/session stopping rules.

## Existing-project migration

1. Verify both MCP servers and same-project identity. Read the UTM snapshot and revision. Confirm whether UTM already owns the target managed Verse file; never overwrite an unmanaged file.
2. Inspect all relevant project Verse and assets. Trace entitlements/items, offers, alternate paths, bundles, storefronts, prices, runtime values, quantities, ownership limits, grants, consumption, restrictions, paid-area/gameplay flags, purchase calls, consequences, icons, callers, comments, strings, and devices.
3. Classify each finding as `confirmed`, `inferred`, `ambiguous`, or `absent`. Exhaustive evidence showing that a storefront, bundle, alternate offer, or trigger does not exist is `absent`, not `ambiguous`. Ask only when multiple plausible interpretations could change commercial or gameplay semantics.
4. Build a non-destructive mapping and a parity row for every migrated entitlement, alternate offer, and bundle. Each row must explicitly compare legacy and proposed identity, Name, Description, ShortDescription, type, MaxCount, immediate-use behavior, `autoConsume`, price, restrictions, icon source, gameplay consequence/boundary, repeated-purchase behavior, and relationships. Existing UTM records not represented by the legacy source are preserved unless evidence proves that a record is the same transaction being replaced or the creator explicitly authorizes deletion.
5. Call `validate_migration_parity`, then prepare `apply_catalog_patch` with typed operations, explicit stable IDs, `migration.mode: "existing-project"`, the same parity rows, and `dryRun: true` using the still-current revision. Inspect normalized operations, cascades, IDs, validation issues, and resulting semantics. Do not use `verseKey` values for new objects or derive keys from display names.
6. After semantic review, apply the complete patch atomically with the same revision and parity table. On `CATALOG_REVISION_CONFLICT`, reread the snapshot, reconcile only the intended change, and rerun the parity validation and dry run. Never clobber a newer draft.
7. Discover real `Texture2D` objects through Epic MCP and use UTM `adopt_icon` with exact returned object paths. If adoption conflicts, preserve the imported asset, reload, and explicitly reassign it.
8. Validate and call UTM `save_catalog`. Read `describe_integration_contract` and use its current symbols, fields, keys, options, and helpers.
9. Through Epic MCP, update only external project Verse callers and integration. Preserve calculations, eligibility, progression, rewards, UI, saved state, and gameplay consequences. For an immediate-use legacy purchase, preserve the successful-use boundary by listening to `Await<Stem>ConsumedEvent()`; never replace it with a pre-consumption `Granted` callback or infer it from generic `Removed`. Never manually edit `managed_transactions.verse`.
10. Compile the generated and changed project Verse through Epic MCP. Fix structured diagnostics and repeat the relevant save/generate/compile loop until there are zero relevant errors.
11. Rescan the full project for raw Marketplace plumbing, duplicate purchase paths, generated-contract usage, icons, and device references. Configure only representations accepted by the live Epic server.
12. If switching projects drops the editor bridge, wait/reconnect, refresh context, and verify exact identity again. Do not end the migration with a documented disconnect when safe reconnection can continue it.
13. Re-read UTM/project state to prove persistence and summarize the exact catalog, generated changes, external Verse changes, removed legacy references, compile evidence, managed-device placement and `Transactions` wiring state, and any remaining manual UEFN wiring.

## Verification loop

Use this order where applicable:

`discover -> same-project check -> read snapshot/revision -> inspect or dry-run -> mutate -> save/generate -> read contract -> edit callers -> compile -> inspect -> rescan -> persistence verify`

For sessions use `StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`. Treat unavailable refresh/push, missing client logs, disconnected editor state, and unresolved device arrays as capability results; use full compile/restart fallback and report exactly what was not proven. Never loop indefinitely.

## First-run safety

For a fresh unmanaged project, UEFN must be open on the exact project and Python Editor Scripting must be enabled before first-offer creation or migration. Provision and verify the placeholder asset first, then persist catalog and generated Verse. UEFN closed, Python disabled, a different project, or a failed provisioning job must leave the catalog and managed file unchanged and provide retryable guidance. Already-initialized projects may make catalog-only edits while UEFN is closed only when every referenced project asset is already confirmed present.

## Failure recovery

- **UTM MCP missing:** inspect guided setup, listener state, client configuration, and process reload; do not use browser or desktop fallback.
- **UEFN MCP missing:** report editor operations as unverified and do not claim compile, asset adoption, or session success.
- **Different projects:** stop before mutation, reconnect both servers to the intended project, and compare identity again.
- **Revision conflict:** reload, reconcile, dry-run again, and apply only the intended complete patch.
- **Compile failure:** inspect diagnostics and contract usage; do not move gameplay logic into the managed file.
- **Interrupted migration:** reread catalog, managed-file hash, and project Verse before retrying. Never duplicate records from an assumption.
- **Unsupported pattern or ambiguity:** preserve the functioning implementation and ask for the smallest semantic decision required.

## Device and asset boundaries

Discover exact current Epic MCP representations before assigning generated device references. The tested server rejected some placed Trigger/Button reference arrays; automate only when a live assignment succeeds, otherwise report manual UEFN wiring. UTM does not expose generic editor automation, arbitrary shell/file access, purchases, or island publishing.
