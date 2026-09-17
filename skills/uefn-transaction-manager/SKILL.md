---
name: uefn-transaction-manager
description: Safely create, migrate, validate, and integrate UEFN in-island transaction catalogs using UTM MCP together with Epic's unreal-mcp.
metadata:
  short-description: UTM and dual-MCP transaction workflows
---

# UEFN Transaction Manager

Use this skill for UTM catalogs, in-island transactions, Marketplace plumbing, generated UTM Verse, transaction icons, or migration of an existing transaction implementation.

UTM MCP manages the transaction catalog, validation, generated `managed_transactions.verse`, controlled icon adoption, and catalog saves. Epic `unreal-mcp` works with the UEFN project, Verse files, assets, devices, editor state, compilation, sessions, and logs. Project Verse keeps gameplay and business logic. Explain this split once, then focus on the creator's workflow.

## Mandatory operation contract

Every operation must follow this order. Treat the order as a safety contract, not a suggestion:

`DISCOVER -> PREFLIGHT -> USER BLOCKER/APPROVAL IF NEEDED -> ACTIVITY TRANSITION -> MUTATE -> VERIFY -> COMPLETE`

1. Classify the requested operation and choose its capability manifest: `inspect-only`, `catalog-only-migration`, `full-existing-project-migration`, `native-icon-adoption`, `managed-device-wiring`, `verse-integration`, `compile-validation`, or `live-session-inspection`.
2. Start a read-only `begin_activity` for the operation before meaningful UTM inspection. Discover both MCP servers, their live tool schemas, and their authoritative project/editor context. A server name, loopback port, retained heartbeat, or stale schema is not capability proof.
3. Call UTM `preflight_operation` with the operation, requested scope, and the live Unreal MCP evidence. The result must be `ready: true`; a UTM-mutation-capable result must also provide a short-lived `preflightToken`. UTM reports its own facts. The agent is responsible for discovering Unreal MCP and must label the supplied external evidence as agent-reported.
4. If the result is blocked, stop and end the read-only activity as `failed`. Report the missing capabilities and identity differences. Do not call any catalog mutation, save, icon adoption, generated-file write, source edit, asset edit, device edit, compile, or session mutation.
5. A full migration is never allowed to fall back to catalog-only. If Unreal MCP is missing or incomplete, ask for explicit owner approval before requesting the separate `catalog-only-migration` operation. That operation is partial and must remain labeled partial in every report.
6. Only after a successful mutation-capable preflight, start a mutating `begin_activity` with the returned `preflightToken`. Every UTM mutating call must carry both that `preflightToken` and its `activityId`. Heartbeat and update the user-safe phase during long work.
7. End the activity exactly once as `success`, `failed`, or `cancelled`. If the agent disconnects, the server TTL expires the activity; do not try to revive it with a stale heartbeat.

## Non-negotiable gates

- Discover live tools and schemas from both MCP servers before using them. Never guess tool names, generated symbols, object paths, or editor capabilities. Use the operation manifest rather than requiring unrelated capabilities.
- UTM MCP is a local Streamable HTTP connection at the configured `127.0.0.1` endpoint. It needs no credential or header. The server still enforces loopback binding, strict Host and Origin checks, a constrained tool surface, project identity, and revision-safe mutations.
- Before any cross-server mutation, call UTM `get_project_context`, call the strongest available Epic project/editor context, and compare canonical project file/root, project name, and content/asset mount. Supply that evidence to `preflight_operation`. Stop on a mismatch or insufficient evidence.
- Read UTM `get_catalog_snapshot` immediately before the authorized mutation and retain its opaque `revision`. Every UTM mutation must use that exact value as `expectedRevision`, plus the active preflight token and mutating activity ID.
- For a first managed catalog with no managed Verse file, require the exact project open in UEFN, a fresh editor bridge, and Python Editor Scripting enabled. UTM must provision and positively confirm the exact placeholder `Texture2D` object path before any catalog or managed Verse persistence. If any prerequisite or asset check fails, stop without a mutation or file write.
- Before every save, collect every generated icon expression (primary, alternate, and bundle), resolve each to its exact project object path, and confirm that the referenced asset exists. Never persist generated Verse with an unconfirmed managed asset reference.
- Migrations are read-only until the inventory, required source-to-proposed semantic parity table, structured public-identity mapping, and dry run are reviewed. Use `validate_migration_parity` and then include the same table in `apply_catalog_patch` with `migration.mode: "existing-project"`; UTM rejects a missing, incomplete, inferred, ambiguous, absent, or contradictory table before any migration mutation. Preserve unmatched existing UTM records by default. Stop only when ambiguity could change what is sold, owned, granted, consumed, priced, restricted, eligible, or publicly referenced.
- A successful tool call is not verification. Use the full save/generate/compile/inspect/verify loop.
- After a generated managed file exists, use the generated public contract and normal setup guidance. UTM does not inspect or gate managed-device placement, project caller wiring, or gameplay behavior; those remain creator-owned UEFN setup. An explicit compile request can still be used when compile evidence is needed.
- Never read or write arbitrary files or `.uasset` binaries through UTM. Internal UTM UI/editor bridge credentials remain private and must never enter project files, generated Verse, logs, prompts, or source control.
- UEFN capability availability is not project readiness. The project browser may keep the UEFN process, Verse workflow server, Python runtime, or UEFN MCP listener alive; treat selector/loading states and retained connector heartbeats as not ready. Require UTM `get_project_context` to report the exact project active with `editorConnected=true` and native texture adoption available before first-run or asset mutations. Recheck the preflight after project close/browser transitions, reconnects, catalog revision changes, or editor process changes.

## Durable ownership lifecycle

`Reconciliation establishes initial truth. Generated delta events keep current truth current.` This is a migration contract, not an optional implementation detail.

For every migrated durable entitlement whose ownership affects gameplay, UI, access, permissions, progression, multipliers, toggles, or any other live-session behavior:

- During player initialization, wait for or otherwise use the generated reconciliation path (`Await<Stem>ReconciledEvent()` and the authoritative `Has<Stem>`/`Get<Stem>Count` helpers) to initialize the project-owned mirror or cache.
- For the lifetime of the integration, maintain a persistent listener loop for `Await<Stem>GrantedEvent()`. A same-session durable acquisition must update the external gameplay state immediately, without reconnecting or rerunning player initialization.
- If ownership loss/revocation is actually supported by the current generated contract and relevant to the project, maintain the corresponding `Await<Stem>RemovedEvent()` path. Do not invent removal APIs or semantics.
- A creator may opt a durable into the separate `Ownership Confirmed` trigger binding. UTM fires it once for that player only when reconciliation reports an owned count greater than zero; it is silent for zero ownership and remains distinct from purchase/grant `Success Triggers`. Keep advanced ownership behavior in Verse and preserve the existing `Reconciled`, `Granted`, and `Removed` APIs.

Reconciliation is state establishment, not a subscription. A join-only flag or cached project flag populated only during player join is incomplete integration. A durable migration is not semantically proven until both initial ownership propagation and live ownership propagation are structurally verified.

Keep the transaction boundary distinct: immediate-use consumables apply their gameplay consequence only from `Await<Stem>ConsumedEvent()`; durable `Granted` represents ownership change and is not a consumption boundary.

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

1. Start a read-only activity, verify both MCP servers and same-project identity, then call `preflight_operation` for `full-existing-project-migration`. Read the UTM snapshot and revision. Confirm whether UTM already owns the target managed Verse file; never overwrite an unmanaged file. If Epic MCP is unavailable or the preflight is blocked, stop before any mutation and report the exact blockers.
2. Inspect all relevant project Verse and assets. Trace entitlements/items, offers, alternate paths, bundles, storefronts, prices, runtime values, quantities, ownership limits, grants, consumption, restrictions, paid-area/gameplay flags, purchase calls, consequences, icons, callers, comments, strings, and devices.
3. Classify each finding as `confirmed`, `inferred`, `ambiguous`, or `absent`. Exhaustive evidence showing that a storefront, bundle, alternate offer, or trigger does not exist is `absent`, not `ambiguous`. Ask only when multiple plausible interpretations could change commercial or gameplay semantics.
4. Build a non-destructive mapping and a parity row for every migrated entitlement, alternate offer, bundle, and storefront. Each row must explicitly compare legacy and proposed identity, Name, Description, ShortDescription, type, MaxCount, immediate-use behavior, `autoConsume`, price, restrictions, icon source, gameplay consequence/boundary, repeated-purchase behavior, relationships, and runtime propagation. When the published source uses names that differ from the catalog key, include a complete legacy/proposed structured `publicIdentity` pair: API, metadata, entitlement, price, and offer stems as applicable, plus qualified module/device/file paths. For every durable, record the authoritative initial-state source, the external state that mirrors or depends on ownership, the same-session `Granted` event path, and the supported removal path when relevant. Existing UTM records not represented by the legacy source are preserved unless evidence proves that a record is the same transaction being replaced or the creator explicitly authorizes deletion.
5. Call `validate_migration_parity`, then prepare `apply_catalog_patch` with typed operations, explicit stable IDs, `migration.mode: "existing-project"`, the same parity rows, and `dryRun: true` using the still-current revision. Use `adopt_existing_identity` for every imported published identity; do not put `verseKey` or `publicIdentity` on generic create/update operations. Include the captured module configuration, inspect current/requested/effective identity evidence, cascades, IDs, validation issues, and resulting semantics, and stop on any mismatch or conflict. Do not use `verseKey` values for new objects or derive keys from display names.
6. After semantic review, begin the matching mutating activity with the preflight token and apply the complete patch atomically with the same revision, token, activity ID, and parity table. On `CATALOG_REVISION_CONFLICT` or a stale preflight, reread the snapshot, reconcile only the intended change, and rerun preflight, parity validation, and dry run. Never clobber a newer draft.
7. Discover real `Texture2D` objects through Epic MCP and use UTM `adopt_icon` with exact returned object paths, the same live activity, and a token whose icon domain is authorized. If adoption conflicts, preserve the imported asset, reload, and explicitly reassign it.
8. Validate and call UTM `save_catalog` with the save-authorized token and activity. Read `describe_integration_contract` and use its current symbols, fields, keys, options, and helpers.
9. Through Epic MCP, update only external project Verse callers and integration. Preserve calculations, eligibility, progression, rewards, UI, saved state, and gameplay consequences. For a gameplay-affecting durable, preserve both halves of the lifecycle: initialize the external state from reconciliation/authoritative ownership during player initialization and keep it current with a persistent `Await<Stem>GrantedEvent()` listener for same-session acquisition. If supported and relevant, also handle `Await<Stem>RemovedEvent()`. For an immediate-use legacy purchase, preserve the successful-use boundary by listening to `Await<Stem>ConsumedEvent()`; never replace it with a pre-consumption `Granted` callback or infer it from generic `Removed`. Never manually edit `managed_transactions.verse`.
10. Compile the generated and changed project Verse through Epic MCP. Fix structured diagnostics and repeat the relevant save/generate/compile loop until there are zero relevant errors.
11. Rescan the full project for raw Marketplace plumbing, duplicate purchase paths, generated-contract usage, icons, and device references. Configure only representations accepted by the live Epic server.
12. If switching projects drops the editor bridge, wait/reconnect, refresh context, and verify exact identity again. Do not end the migration with a documented disconnect when safe reconnection can continue it.
13. Re-read UTM/project state to prove persistence and summarize the exact catalog, generated changes, external Verse changes, removed legacy references, any explicit compile result, and any remaining manual UEFN wiring. Complete a transaction-type matrix that records initial-state source, live-change source, external gameplay consequence, structural integration evidence, compile evidence, and whether owner-only live acceptance remains required. Do not call the migration complete from compile, prompt, Marketplace, generated-contract, or reconnect evidence alone.

### Public identity adoption

`verseKey` is the UTM catalog key and the default source of generated names for new records. It is not a substitute for reading a published managed Verse file. When an existing project's public symbols, module names, or device class differ from the current catalog key, capture the exact source identity before mutation and represent it in the parity row and `adopt_existing_identity` operation. The operation must name the stable target ID and kind, the desired catalog key, the complete applicable public stems, and the legacy generated module/device/file configuration.

UTM derives the requested and effective qualified paths and returns both in dry-run evidence. It rejects incomplete, invalid, conflicting, or mismatched identities before changing the draft. A changed former key is retired and references are updated atomically. The generated manifest persists the adopted identity for reopen/regeneration; generic create/update operations must never be used to smuggle a published identity into a new catalog record.

## Verification loop

Use this order where applicable:

`discover -> preflight -> approval if needed -> same-project check -> read snapshot/revision -> inspect or dry-run -> activity transition -> mutate -> save/generate -> read contract -> edit callers -> compile -> inspect -> rescan -> persistence verify -> end activity`

For sessions use `StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`. Treat unavailable refresh/push, missing client logs, disconnected editor state, and unresolved device arrays as capability results; use full compile/restart fallback and report exactly what was not proven. Never loop indefinitely.

For an existing-project migration, classify verification by transaction type. Immediate-use consumables require a `Consumed`-correlated use path; inventory-bearing consumables require authoritative quantity/use preservation; gameplay-affecting durables require pre-owned join initialization and a persistent same-session `Granted` propagation path; alternate offers must preserve the underlying entitlement semantics; bundles must propagate each contained entitlement according to its own type. Automated checks may prove the structural paths, synthetic fixtures, and compile. They do not prove a real Marketplace purchase.

The real purchase boundary is owner-only: a live prompt, Marketplace purchase, native entitlement delta, generated `Granted` event, and immediate gameplay effect can be accepted only by the owner in a real UEFN/Fortnite session. Do not attempt purchase automation or report synthetic evidence as live commerce acceptance.

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
