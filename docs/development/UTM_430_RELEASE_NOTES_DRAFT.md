# UEFN Transaction Manager 4.3.0 release notes draft

> Internal release-preparation draft. Do not publish until the coordinated ADEPT website and release checklist are ready.

## UEFN Transaction Manager 4.3.0

UTM remains a complete visual transaction manager for creators. Version 4.3 adds an optional way for MCP-compatible coding agents to work with the same catalog. UTM MCP handles transactions; UEFN's Unreal MCP handles the editor project.

### Highlights

- **UTM MCP** — create, inspect, validate, edit, and save the catalog through a project-scoped local MCP server.
- **Packaged UTM Agent Skill** — gives compatible coding agents a safe path through project checks, revision-aware edits, icon adoption, generated-contract inspection, compilation, and verification.
- **Two focused MCP connections** — UTM MCP handles entitlements, offers, bundles, storefronts, dynamic settings, validation, and generated integration. UEFN MCP handles Verse, assets, devices, editor state, compilation, and sessions.
- **The same catalog for people and agents** — edit in the visual app, through MCP, or move between the two without maintaining separate copies.
- **Existing-project migration** — inspect an existing Marketplace transaction layer, map unambiguous semantics into UTM, adopt real UEFN `Texture2D` icons, and update project callers against the generated contract. Ambiguous meaning stops for review.
- **Texture2D discovery and adoption** — use the verified editor bridge to find and adopt existing project icons rather than guessing asset paths or editing `.uasset` files.
- **Safer concurrent edits** — revision checks protect a human save or another agent edit from being overwritten by a stale mutation.
- **Integration contract introspection** — agents can read the generated contract and current catalog rather than guessing generated Verse symbols.
- **Catalog and presentation polish** — clearer validation, moderation guidance, dynamic transaction controls, generated Verse presentation, and Agent Integration onboarding.
- **Guided agent setup and migration entry point** — discover Agent Integration from the main workspace, install the packaged skill for Codex/Claude Code/Cursor without overwriting unrelated files, receive a complete static-header configuration, and see the difference between a running UTM listener and a verified agent connection.

### Important workflow notes

UTM is an independent creator tool and is not affiliated with or endorsed by Epic Games. UEFN and Fortnite are products of Epic Games.

The current UEFN MCP workflow may still require manual UEFN configuration for generated arrays containing placed `trigger_device` or `button_device` references. The tested UEFN session also did not provide a reliable `PushChanges` refresh path; the packaged skill uses save, full compile, session restart, and available editor evidence when that capability is unavailable.

UTM MCP starts with the project bridge. Guided setup or copying its configuration prepares a local bearer token for the selected client. The generated client entry uses a static bearer header rather than depending on `UTM_MCP_LOCAL_ENDPOINT` reaching an already-running process. Keep that configuration private, reload the coding agent after setup or token/port changes, and rotate the token if it is exposed.

For setup and migration instructions, see [Agent Integration](../AGENT_INTEGRATION.md). For generated symbols and runtime options, see the [Generated Verse reference](../GENERATED_VERSE_REFERENCE.md).
