# UEFN Transaction Manager Agent Integration (4.3.0 development)

This document describes the unreleased 4.3.0 development integration. The public README remains the 4.2.0 release documentation.

## What it does

UTM MCP is a project-scoped, authenticated Streamable HTTP server inside the existing UTM bridge. It exposes transaction-domain operations only: catalog snapshots and validation, entitlements, alternate offers, bundles, storefront membership, typed bulk migration, generated integration-contract introspection, controlled Texture2D adoption, and catalog save.

Epic's `unreal-mcp` remains the UEFN editor server. Use it for Verse/file operations, compilation, asset discovery, device/editor automation, and sessions. Project Verse remains responsible for gameplay and business logic.

## Enable UTM MCP

1. Open the linked project in UEFN Transaction Manager.
2. Open `Tools -> Agent Integration`.
3. Enable `UTM MCP`.
4. Copy the generic HTTP MCP configuration into the client that will use it. The copied configuration contains the bearer token and must be kept private.
5. Install or point the client at the repository skill under `skills/uefn-transaction-manager`. Packaged builds include it under `resources/agent-skills/uefn-transaction-manager`.

The default endpoint is `http://127.0.0.1:8001/mcp` and the server name is `utm-mcp`. An occupied port does not prevent the dashboard from opening. Choose another local port under `Agent Integration -> Advanced MCP port`.

Disabling UTM MCP stops its listener. Rotating the token invalidates existing client configurations. The token is stored only in private local application state, never in project files, generated Verse, diagnostics, or the repository.

## Same-project safety

An agent using both servers must call UTM `get_project_context` and the strongest available Epic editor/project context before mutation. Compare the canonical project path/root, name, and content/asset mount. Localhost alone is not proof that both servers target the same project.

UTM catalog mutations require an opaque `expectedRevision`. A stale revision returns `CATALOG_REVISION_CONFLICT` without applying any part of the request. Reload the snapshot, reconcile, and retry. `apply_catalog_patch` is atomic and should be dry-run first for migrations.

## Current Epic MCP boundaries

The current 42.00 live server rejected placed Creative Trigger/Button references when assigning generated UTM Verse `[]trigger_device` and `[]button_device` arrays. Primitive device fields, discovery, and placement were proven; reference-array assignment remains a manual UEFN fallback until Epic MCP accepts a compatible representation.

The live session spike also returned `The Refresh command is not currently available` and did not expose a usable client log. The Agent Skill uses a one-shot capability check and falls back to save, full compile, session restart, and available editor logs. It does not loop on unavailable refresh commands.

UTM does not expose arbitrary file or shell access, generic UEFN editor tools, raw `.uasset` operations, purchase automation, or island publishing.

