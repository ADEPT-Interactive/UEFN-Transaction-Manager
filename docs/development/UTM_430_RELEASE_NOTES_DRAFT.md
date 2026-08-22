# UEFN Transaction Manager 4.3.0 release notes draft

> Internal release-preparation draft. Do not publish until the coordinated ADEPT website and release checklist are ready.

## UEFN Transaction Manager 4.3.0

UTM 4.3 brings transaction-aware agent workflows to UEFN. Pair UTM MCP with UEFN's Unreal MCP so an MCP-compatible coding agent can work across a creator's transaction catalog and editor project while each tool stays responsible for its own domain.

### Highlights

- **UTM MCP** — create, inspect, validate, edit, and save transaction catalogs through a project-scoped local MCP server.
- **Packaged UTM Agent Skill** — gives compatible coding agents a safe workflow for project checks, revision-aware catalog edits, icon adoption, generated-contract inspection, compilation, and verification.
- **Dual-MCP workflow** — use UTM MCP for entitlements, offers, bundles, storefronts, dynamic configuration, validation, and generated integration; use UEFN MCP for Verse, assets, devices, editor state, compilation, and sessions.
- **Agent-driven catalog work** — ask a compatible agent to create or adjust transaction objects while preserving the creator's gameplay-specific Verse.
- **Existing-project migration** — inspect an existing Marketplace transaction layer, map unambiguous semantics into UTM, adopt real UEFN `Texture2D` icons, and update project callers against the generated contract. Ambiguous meaning stops for review.
- **Texture2D discovery and adoption** — use the verified editor bridge to find and adopt existing project icons rather than guessing asset paths or editing `.uasset` files.
- **Safer concurrent edits** — revision checks protect a human save or another agent edit from being overwritten by a stale mutation.
- **Integration contract introspection** — agents can read the generated contract and current catalog rather than guessing generated Verse symbols.
- **Catalog and presentation polish** — clearer validation, moderation guidance, dynamic transaction controls, generated Verse presentation, and Agent Integration onboarding.

### Important workflow notes

UTM is an independent creator tool and is not affiliated with or endorsed by Epic Games. UEFN and Fortnite are products of Epic Games.

The current UEFN MCP workflow may still require manual UEFN configuration for generated arrays containing placed `trigger_device` or `button_device` references. The tested UEFN session also did not provide a reliable `PushChanges` refresh path; the packaged skill uses save, full compile, session restart, and available editor evidence when that capability is unavailable.

UTM MCP is disabled by default. Copying its configuration includes a local bearer token only after the creator requests the configuration. Keep that configuration private and rotate it if it is exposed.

For setup and migration instructions, see [Agent Integration](../AGENT_INTEGRATION.md). For generated symbols and runtime options, see the [Generated Verse reference](../GENERATED_VERSE_REFERENCE.md).
