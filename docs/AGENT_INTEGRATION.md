# Agent Integration

UEFN Transaction Manager 4.3 can work alongside UEFN's Unreal MCP in a single creator workflow. UTM MCP handles transaction intent and catalog state; UEFN MCP handles the editor and project surface. A compatible coding agent coordinates both services while your project Verse remains responsible for gameplay and business logic.

UTM is not a chat client and does not replace your coding agent. It provides a project-scoped, authenticated local MCP server and a packaged Agent Skill that explains how to use the transaction tools safely.

## Prerequisites

- UEFN installed with the target `.uefnproject` open.
- Python Editor Scripting enabled in the UEFN project. UEFN MCP requires it alongside its MCP toolsets.
- A compatible MCP coding agent, such as Codex, Claude Code, or Cursor.
- UEFN MCP enabled and available for the same project. Follow [Epic's UEFN MCP setup guide](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).
- UTM 4.3 open on that same project.

## Connect both MCP servers

The two local services have different responsibilities:

| Service | Use it for |
| --- | --- |
| **UTM MCP** | Transaction catalog, entitlements, offers, bundles, storefronts, validation, generated integration contract, controlled icon adoption, and catalog save. |
| **UEFN MCP** | Project Verse, files, editor state, assets, devices, compilation, sessions, and other supported editor operations. |

1. In UEFN, enable **Python Editor Scripting** and **UEFN MCP Toolsets**, configure MCP auto-start, and generate or confirm the client configuration using [Epic's guide](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).
2. In UTM, open **Tools -> Agent Integration**.
3. Enable **UTM MCP**.
4. Confirm the panel shows **Running**, the `utm-mcp` server name, and the active project.
5. Choose **Copy MCP configuration** and add the copied `utm-mcp` entry to the client configuration that already contains `unreal-mcp`.
6. Install or expose the packaged Agent Skill described below.
7. Start the agent from the project/workspace context required by that client and ask it to verify both project contexts before editing.

UTM MCP normally listens on `http://127.0.0.1:8001/mcp`; the UEFN server normally listens on `http://127.0.0.1:8000/mcp`. The UTM panel supplies the current endpoint. If a local port is occupied, expand **Advanced connection settings** and apply another port.

The copied UTM configuration contains a bearer token. Treat it as a secret: do not commit it, paste it into project files, or share it in an issue. Rotating the token invalidates existing client configurations. Disabling UTM MCP stops its listener. UTM MCP is disabled by default for existing users.

## Agent Skill

The packaged `uefn-transaction-manager` Agent Skill gives a compatible agent the user-facing workflow for:

- discovering both live MCP schemas rather than guessing tool names;
- proving both servers target the same project;
- creating and editing catalog objects with revision checks;
- validating before applying a bulk change;
- adopting real UEFN `Texture2D` assets;
- reading the generated integration contract rather than inventing Verse symbols;
- preserving human edits made concurrently with the agent;
- migrating existing Marketplace transaction code;
- compiling, auditing, and stopping when transaction meaning is ambiguous.

MCP compatibility and Agent Skill support are separate capabilities: an MCP client can connect to UTM MCP without automatically discovering an Agent Skill. Installer and portable builds include the complete `uefn-transaction-manager` folder at `resources/agent-skills/uefn-transaction-manager/`; use **Copy skill path** or **Copy setup instructions** in Agent Integration to locate that packaged folder.

Copy the entire folder, including `SKILL.md` and `references`, into the client location you use:

| Client | User skill location | Verify discovery |
| --- | --- | --- |
| Codex | `%USERPROFILE%\.agents\skills\uefn-transaction-manager\` (or the project `.agents\skills\` folder) | Run `/skills`, or mention `$uefn-transaction-manager`. |
| Claude Code | `%USERPROFILE%\.claude\skills\uefn-transaction-manager\` (or the project `.claude\skills\` folder) | Run `/skills`, then invoke `/uefn-transaction-manager`. |
| Cursor | `%USERPROFILE%\.cursor\skills\uefn-transaction-manager\` (or the project `.cursor\skills\` folder) | In Agent chat, type `/` and choose the skill. |

These are user-facing examples for the named clients; client support for MCP does not by itself guarantee support for Agent Skills. Keep the skill folder together and connect the client to both UTM MCP and UEFN MCP for the same project.

Keep `SKILL.md` and its `references` folder together. The skill is guidance for an MCP-compatible agent, not a replacement for the live tool schemas or the UEFN editor.

## Same-project safety

Before mutation, the agent should call UTM `get_project_context` and the strongest available UEFN project/editor context. Compare the canonical project file or root, project name, and content/asset mount. A shared `localhost` address is not enough to prove that both servers target the same project.

UTM catalog mutations use an opaque revision. If a human saves or changes the catalog first, a stale mutation returns a revision conflict without applying a partial change. Reload the snapshot, reconcile the intended edit, and retry. For migrations, use a dry run before applying the atomic patch.

## Create a new transaction project

1. Open the project in UEFN and UTM, then verify both MCP contexts.
2. Ask the agent to inspect the current UTM catalog and integration contract.
3. Create entitlements, alternate offers, bundles, and storefront membership through UTM MCP.
4. Discover real project icons through UEFN MCP and ask UTM to adopt the selected `Texture2D` objects. Do not invent object paths or copy `.uasset` files.
5. Save through UTM, compile through UEFN MCP, and place/configure the generated device in UEFN.
6. Keep eligibility, progression, rewards, UI, and other gameplay consequences in project Verse.

## Move an existing transaction layer

For an existing Marketplace implementation, ask the agent to perform a read-only inventory first. It should search the relevant Verse and project assets, identify entitlements, offers, alternate paths, bundles, storefronts, ownership checks, grants, consumption, dynamic values, restrictions, and icons, then explain the proposed mapping.

The safe migration sequence is:

1. Verify the UTM and UEFN project contexts.
2. Inspect the existing Marketplace code and associated `Texture2D` assets through UEFN MCP.
3. Map only unambiguous transaction meaning into a UTM MCP dry-run patch.
4. Review validation and the proposed catalog before applying the atomic patch.
5. Adopt existing icons through the verified UTM workflow.
6. Save the catalog and read the generated integration contract.
7. Rewrite external project Verse callers through UEFN MCP while preserving gameplay calculations and consequences.
8. Compile, rescan for leftover raw transaction plumbing, configure proven device fields, and perform a final semantic review.

If the agent cannot safely determine whether two code paths represent the same entitlement, how a bundle quantity is calculated, or which icon is authoritative, it must stop and ask for clarification. A partial guess is not a successful migration.

## Concurrency and revisions

UTM MCP and the human UTM interface share one project-scoped draft. Every mutation carries the revision it read. A mismatch is a protective conflict, not a partial merge. Reload the latest snapshot and reapply only the intended change after checking the human edit.

The generated `managed_transactions.verse` file remains manager-owned. Project Verse should call the generated device and helpers, not edit the managed file or recreate its Marketplace declarations.

## Current UEFN MCP limits

These boundaries affect advanced workflows and should be reported honestly:

- Generated Verse-device arrays containing placed `trigger_device` or `button_device` references were not reliably assignable through the current live UEFN MCP representation. Some reference wiring may still require manual UEFN configuration after the generated device is placed.
- The tested UEFN session did not provide a reliable `PushChanges`/refresh path. The skill performs a capability check once, then uses save, full compile, session restart, and available editor logs when refresh is unavailable.
- UTM MCP does not expose arbitrary shell or file access, raw `.uasset` editing, generic editor automation, purchases, or island publishing.

These limits do not change the ownership boundary: UTM remains the transaction layer, UEFN MCP remains the editor layer, and project Verse remains the gameplay layer.

## Troubleshooting

### UTM MCP is unavailable

Check that UTM MCP is enabled, the endpoint in Agent Integration matches the client configuration, and no other service is using the configured port. Refresh the panel after changing the port. If the listener was disabled or the token was rotated, copy a fresh configuration.

### The agent sees the wrong project

Stop before mutating. Reopen the intended `.uefnproject` in UEFN and UTM, then compare the project context returned by both MCP servers. Do not rely on the project name alone when multiple projects share a name.

### UEFN MCP is missing

Confirm Python Editor Scripting and UEFN MCP Toolsets are enabled, auto-start is configured, and the agent client was started from the directory expected by its configuration. Use Epic's [UEFN MCP troubleshooting guidance](https://dev.epicgames.com/documentation/fortnite/uefn-mcp).

### A migration stops for ambiguity

Review the code path or asset reference the agent named, provide the missing semantic decision, and rerun the dry run. Do not force an inferred mapping into the catalog.

### Compile succeeds but the experience is wrong

A UTM save or Verse compile is not gameplay acceptance. Test purchases, cancellations, refunds, consumption, saved state, rejoin behavior, and reward logic in the real UEFN session.

## Related documentation

- [Generated Verse reference](GENERATED_VERSE_REFERENCE.md)
- [Epic UEFN MCP documentation](https://dev.epicgames.com/documentation/fortnite/uefn-mcp)
- [Epic in-island transactions documentation](https://dev.epicgames.com/documentation/en-us/fortnite/in-island-transactions-in-fortnite)
