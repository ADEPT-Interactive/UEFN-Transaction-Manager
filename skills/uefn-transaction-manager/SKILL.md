---
name: uefn-transaction-manager
description: Safely create, migrate, validate, and integrate UEFN in-island transaction catalogs using UTM MCP together with Epic's unreal-mcp.
metadata:
  short-description: UTM and dual-MCP transaction workflows
---

# UEFN Transaction Manager

Use this skill when a UEFN task involves in-island transactions, Marketplace plumbing, generated UTM Verse, transaction icons, or migration of an existing transaction implementation.

UTM MCP owns catalog intent, validation, generated `managed_transactions.verse`, controlled icon adoption, and catalog save. Epic `unreal-mcp` owns the editor/project surface: Verse files, assets, devices, compilation, sessions, and editor logs. Project Verse owns gameplay and business logic. Keep those boundaries explicit.

## Non-negotiable gates

- Discover live tools and schemas from both MCP servers before using them. Do not guess tool names, generated symbols, object paths, or editor capabilities.
- Before any mutation, call UTM `get_project_context`, call the strongest available Epic project/editor context, and compare canonical project file/root, project name, and content/asset mount. Same localhost or same display name is not proof. Stop on a mismatch or insufficient evidence.
- Read UTM `get_catalog_snapshot` immediately before a mutation and retain its opaque `revision`. Every UTM mutation must use that exact value as `expectedRevision`.
- For a first managed catalog in a project with no managed Verse file, require the exact target project open in UEFN, a fresh authenticated editor bridge, and Python Editor Scripting enabled. UTM must provision and positively confirm the exact placeholder `Texture2D` object path before any catalog or managed Verse persistence. If any prerequisite or asset check fails, stop without a mutation or file write.
- Before every save, collect every generated icon expression (primary, alternate, and bundle), resolve each to its exact project object path, and confirm the referenced asset exists. Never persist generated managed Verse with an unconfirmed managed asset reference. An initialized project may make catalog-only edits while UEFN is closed only when every referenced project asset is already confirmed present.
- Migrations are read-only until the inventory, semantic mapping, and proposed dry run are reviewed. Stop rather than guess when ambiguity could change what is sold, owned, granted, consumed, priced, or restricted.
- A successful tool call is not verification. Use the full save/generate/compile/inspect/verify loop and report the strongest evidence actually obtained.
- Never put bearer tokens in project files, Verse, logs, source control, prompts, or reports. Never read/write arbitrary files or `.uasset` binaries through UTM.

## MCP-first setup and failure behavior

UTM MCP is a project-scoped authenticated Streamable HTTP server. The generated client configuration uses a private static `Authorization: Bearer ...` header. Do not replace it with `UTM_MCP_LOCAL_ENDPOINT` or another environment-variable reference: an already-running coding agent cannot inherit a later Windows user-environment change. After installing/changing configuration, reload the client or start a fresh agent process, then call `get_project_context` and `get_catalog_snapshot`.

If UTM MCP is missing, do not mutate, improvise with browser automation, open localhost in a browser, or silently switch to desktop control. Tell the user whether the missing evidence is the UTM server, client configuration, agent reload, or actual tool visibility. Use the UTM Agent Integration panel's guided setup, fresh-session/reload path, or manual MCP configuration. Browser/desktop control is unsupported unless a separately documented UTM surface explicitly provides it.

If UEFN MCP is missing, do not pretend project Verse, asset, compile, or session work was verified. Ask the user to enable the supported Epic server or report the exact boundary. If either server targets another project, stop before both catalog and Verse mutation.

The UTM panel distinguishes server running, skill installed, configuration prepared, agent process reload required, and a real client verification. A UTM listener being running is not proof that the current agent can use it. Token rotation or a port change invalidates old client configuration; copy a fresh entry and reload the client. A UTM restart normally preserves the private token, but the current agent still needs a fresh MCP connection if its session lost the server.

## Choose the workflow

- For a new catalog, read [new-project-workflow.md](references/new-project-workflow.md).
- For an existing Marketplace/in-island implementation, follow the migration gate below and read [existing-project-adoption.md](references/existing-project-adoption.md).
- Read [transaction-semantics.md](references/transaction-semantics.md) when classifying ownership, grants, consumes, alternate offers, bundles, restrictions, or gameplay meaning.
- Read [dynamic-transactions.md](references/dynamic-transactions.md) for runtime price, quantity, or fill-to-max behavior.
- Read [asset-adoption.md](references/asset-adoption.md) for icons and [verification.md](references/verification.md) for compile/session stopping rules.
- Read [agent-setup.md](references/agent-setup.md) when configuring or troubleshooting an MCP-capable coding agent.

## Existing-project migration: conservative sequence

1. Verify both MCP servers and project identity. Read the current UTM snapshot and revision. Confirm whether UTM already owns the target managed Verse file; do not overwrite an unmanaged file.
2. Ask Epic MCP to search all relevant project Verse and inspect associated project assets. Trace Marketplace declarations, purchase calls, alternate paths, bundles, storefront arrays, ownership/count checks, grants, consumes, dynamic values, restrictions, display strings, comments, devices, and icon references.
3. Inventory each candidate with its source location and classify it as `confirmed`, `inferred`, `ambiguous`, or `manual`. Preserve identifiers and behavior where the evidence supports them. Distinguish a product from an alternate offer, bundle quantity from gameplay quantity, and eligibility/reward code from transaction plumbing.
4. Produce a non-destructive mapping and explain evidence, assumptions, and unresolved decisions. Do not apply a partial guess. Ask for clarification when competing mappings could change commercial or gameplay semantics.
5. Prepare `apply_catalog_patch` with typed operations and `dryRun: true` using the still-current revision. Inspect normalized operations, cascades, IDs, validation issues, and resulting semantics. Do not use `verseKey` values for new objects or derive keys from display names.
6. After semantic review, apply the complete patch atomically with the same revision. On `CATALOG_REVISION_CONFLICT`, reload the snapshot, reconcile only the intended change, and rerun the dry run. Never clobber a newer human/agent draft.
7. Discover real `Texture2D` objects through Epic MCP and use UTM `adopt_icon` with the exact returned object path. Never invent paths or copy `.uasset` files. If adoption conflicts, preserve the imported asset but reload/reassign explicitly.
8. Validate and call UTM `save_catalog`. Read `describe_integration_contract`; use its current generated class, fields, keys, options, and helper names rather than hardcoded symbols.
9. Through Epic MCP, update only external project Verse callers and integration. Keep calculations, eligibility, progression, rewards, UI, saved state, and gameplay consequences outside the manager-owned generated file. Identify legacy declarations/callers that should be removed only after references are traced.
10. Compile the generated and changed project Verse through Epic MCP. Inspect structured diagnostics, fix errors, and repeat the relevant save/generate/compile loop. A UTM save is not a compile result.
11. Rescan the full project for leftover raw Marketplace plumbing, verify generated-contract callers, inspect device fields, and configure only references accepted by the live Epic server. Run session verification when appropriate without performing a real purchase.
12. Re-read UTM/project state to prove persistence and perform a final semantic audit. Summarize exact catalog records, generated changes, external Verse changes, removed legacy references, compile evidence, and any manual UEFN wiring still required.

## Revision and verification loop

Use this order where applicable:

`discover -> same-project check -> read snapshot/revision -> inspect or dry-run -> mutate -> save/generate -> read contract -> edit callers -> compile -> inspect -> rescan -> session/persistence verify`

UTM mutations update the shared draft used by the human interface. Refresh after any human edit, MCP revision conflict, failed/interrupted migration, or stale client response. Granular mutations may leave ordinary draft validation issues for human editing; structural integrity errors, bulk validation errors, and unmanaged-file errors stop the workflow.

For session evidence use `StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`. If refresh/push or client logs are unavailable, capability-check once, use save/full compile/session restart as the fallback, and report what was not proven. Never loop on an unavailable command.

## Failure recovery

- **UTM MCP missing:** stop; inspect guided setup, static-header configuration, listener status, and agent reload. No browser fallback.
- **UEFN MCP missing:** report editor operations unverified; do not claim compile, asset adoption, or session success.
- **Different projects:** stop; reopen the intended project in both tools and compare canonical identity again.
- **Stale token/config or rotated token:** copy a fresh configuration, replace only the UTM-owned client entry, and restart/reload the client.
- **Listener unavailable or occupied port:** UTM MCP starts with the project bridge; resolve the displayed loopback-port issue or choose another loopback port in the UI, then copy fresh configuration.
- **Revision conflict:** reload, reconcile, dry-run again, and apply only the intended complete patch.
- **Compile failure:** inspect diagnostics and contract usage; do not move gameplay logic into the managed file to force a build.
- **Interrupted/partial migration:** reread the catalog, managed-file hash, and project Verse; determine what actually persisted before retrying. Never duplicate records from an assumption.
- **Unsupported pattern or ambiguity:** preserve the functioning implementation, document the exact evidence gap, and ask for the smallest semantic decision required.

## Device and asset boundaries

Discover exact current Epic MCP representations before assigning generated device references. The tested 42.00 server rejected placed Creative Trigger/Button references for generated `[]trigger_device` and `[]button_device` fields; automate only when a live assignment succeeds, otherwise report manual UEFN wiring. UTM does not expose generic editor automation, arbitrary shell/file access, purchases, or island publishing.
