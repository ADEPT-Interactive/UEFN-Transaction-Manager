---
name: uefn-transaction-manager
description: Safely create, migrate, validate, and integrate UEFN in-island transaction catalogs using UTM MCP together with Epic's unreal-mcp. Use when transaction intent, Marketplace plumbing, generated UTM Verse, icon adoption, or existing-project transaction migration is involved.
metadata:
  short-description: UTM and dual-MCP transaction workflows
---

# UEFN Transaction Manager agent skill

Use this skill for transaction-domain work in a UEFN project. UTM MCP owns catalog intent, validation, generated `managed_transactions.verse`, controlled icon adoption, and save. Epic `unreal-mcp` owns generic UEFN editor automation, Verse/file operations, assets, devices, and sessions. Project Verse owns gameplay and business logic. The agent coordinates between them.

## Start safely

1. Discover live schemas from both configured MCP servers. Do not assume tool names, generated symbols, object paths, or Epic MCP capabilities.
2. Call UTM `get_project_context` and the strongest project/editor context available from Epic MCP. Compare canonical project file/root, project name, and asset/content mount. If identity cannot be established, stop before mutating either server.
3. Call UTM `get_catalog_snapshot` and retain its opaque `revision`. Every UTM mutation must send that exact `expectedRevision`. On `CATALOG_REVISION_CONFLICT`, reload, reconcile, and retry. Never overwrite a newer human draft.
4. Call `describe_integration_contract` after catalog changes. Do not hardcode generated Verse symbols in the skill or project integration.

Read only the reference needed for the current workflow:

- [tool discovery](references/tool-discovery.md) for live dual-server setup and identity checks;
- [new project workflow](references/new-project-workflow.md) for greenfield work;
- [existing project adoption](references/existing-project-adoption.md) for raw Marketplace migration;
- [transaction semantics](references/transaction-semantics.md) when mapping ownership, grants, consumes, or alternate offers;
- [dynamic transactions](references/dynamic-transactions.md) for runtime price or quantity behavior;
- [asset adoption](references/asset-adoption.md) for Texture2D discovery and controlled import;
- [verification](references/verification.md) for compile, session, ambiguity, and cleanup gates.

## UTM mutation rules

- Use UTM MCP for entitlements, alternate offers, bundles, storefront membership, validation, integration introspection, icon adoption, and saving.
- Use Epic MCP for project Verse search/edit, `BuildAll`, device placement/property inspection, asset discovery, and session operations. Do not duplicate those tools through UTM.
- Prefer `apply_catalog_patch` with `dryRun: true` before a migration or mixed bulk change. Apply only after semantic review and validation errors are resolved. It is atomic: no partial patch is acceptable.
- Granular mutations may leave ordinary draft validation issues for human editing. Structural integrity errors and bulk validation errors must stop the operation. `save_catalog` is blocked by validation errors and does not compile Verse.
- Never read or write arbitrary files, run shell commands, invent Unreal object paths, manipulate `.uasset` binaries, perform purchases, or move gameplay logic into the managed Verse file.
- Preserve player-specific discounts, progression checks, resource calculations, custom UI, gameplay consequences, runtime quantities, and other business logic in external project Verse. Use the current integration contract and runtime options API.

## Device and session boundaries

Discover the exact current Epic MCP representation before assigning generated device reference arrays. The current tested 42.00 server rejects placed Creative Trigger/Button references for generated Verse `[]trigger_device` and `[]button_device` fields; automate discovery, placement, primitive edit, and read-back only when a live assignment succeeds. Otherwise report the fields that require manual UEFN wiring.

For play verification, use the proven lifecycle and capability-check each time: session start, wait for `Connected`, start game, confirm `Running`, then attempt the exposed refresh path once after a successful compile. If PushChanges or client logs are unavailable, do not loop on Refresh. Save/generate, run the strongest available full compile, restart the session when needed, inspect available editor logs, and report the limitation.

