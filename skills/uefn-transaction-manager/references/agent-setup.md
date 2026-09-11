# Agent setup and lifecycle

UTM setup has four separate states:

1. **UTM MCP server** — the project-scoped loopback listener is running by default.
2. **Agent Skill** — the complete UTM skill folder, including `SKILL.md` and `references`, is installed for the selected client.
3. **Client configuration** — the current `utm-mcp` URL and server type were copied/prepared.
4. **Verified connection** — the reloaded or fresh client has initialized UTM MCP and called `get_project_context` for the current project.

Do not describe state 1 as state 4. A running listener is not proof that the current agent has loaded the MCP entry.

The guided UTM panel can install the skill for Codex (`%USERPROFILE%\\.agents\\skills\\uefn-transaction-manager`), Claude Code (`%USERPROFILE%\\.claude\\skills\\uefn-transaction-manager`), or Cursor (`%USERPROFILE%\\.cursor\\skills\\uefn-transaction-manager`). It writes only the UTM-owned folder and refuses to overwrite unrelated files. Manual path/config copying is the fallback for other clients.

After guided setup:

1. Replace or add only the UTM-owned MCP entry in the client configuration using the copied local URL entry.
2. Reload the client or start a fresh coding-agent process.
3. Confirm both `utm-mcp` and `unreal-mcp` are visible to that fresh session.
4. Ask the agent to call `get_project_context` and compare it with Epic's project context before doing any mutation.

The first operation call must be a read-only `begin_activity`. The agent then discovers the live tool schemas and both canonical project contexts and calls UTM `preflight_operation` with the selected operation manifest. A successful mutation-capable response contains a short-lived `preflightToken`; a blocked response is terminal for that operation and must be reported before any catalog, generated Verse, source, asset, device, compile, or session mutation. Every later UTM mutation carries the token and its mutating `activityId`.

Full existing-project migration never downgrades itself. If Unreal MCP is unavailable, request a separate `catalog-only-migration` only after explicit owner approval and keep that result labeled partial. `begin_activity`, `heartbeat_activity`, `update_activity_phase`, and `end_activity` are server-owned lifecycle calls; the server binds them to the MCP connection and selected project and expires stale heartbeats.

When the port changes, copy a fresh entry and repeat the reload/verification sequence. If UTM restarts, an MCP session that disconnected must still reconnect.

If UTM MCP is unavailable, diagnose the configuration/listener/process boundary and stop. Do not open localhost in a browser or attempt unsupported desktop automation as a substitute for MCP.
