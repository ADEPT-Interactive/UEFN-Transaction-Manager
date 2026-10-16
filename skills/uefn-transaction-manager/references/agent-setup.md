# Agent setup and lifecycle

UTM setup has four separate states:

1. **UTM MCP server** — the project-scoped loopback listener is running by default.
2. **Agent Skill** — the complete UTM skill folder, including `SKILL.md` and `references`, is installed for the selected client.
3. **Client configuration** — the current `utm-mcp` URL and server type were copied/prepared.
4. **Observed client connection** — UTM has received `get_project_context` from a client. Check the reported client name; this does not prove that another already-open agent session has loaded the tools.

Do not describe state 1 as state 4. A running listener is not proof that the current agent has loaded the MCP entry.

The guided UTM panel can install the skill for Codex (`%USERPROFILE%\\.agents\\skills\\uefn-transaction-manager`), Claude Code (`%USERPROFILE%\\.claude\\skills\\uefn-transaction-manager`), or Cursor (`%USERPROFILE%\\.cursor\\skills\\uefn-transaction-manager`). It writes only the UTM-owned folder and refuses to overwrite unrelated files. Manual path/config copying is the fallback for other clients.

After guided setup:

1. Replace or add only the UTM-owned MCP entry in the client configuration using the copied local URL entry.
2. Reload the client or start a fresh coding-agent process.
3. Confirm `utm-mcp` is visible to that fresh session. Discover Epic `unreal-mcp` only when the requested operation needs external editor capabilities.
4. Ask the agent to call `describe_operation_contract`, then `get_project_context`. Compare with Epic context before cross-server changes; UTM-only catalog work does not require Epic.

Start a read-only activity for inspection and call preflight for the selected operation. `catalog-edit` handles ordinary UTM draft edits/save without Epic MCP; `catalog-only-migration` is a separately approved partial import, with parity/identity requirements retained. Existing explicit user approval is sufficient; do not ask again. Full migration never silently downgrades.

After successful UTM-mutation preflight, end discovery before starting a matching mutating activity with its token. Every write carries that token, activity ID, and latest revision. Own successful writes advance the lease; concurrent changes do not. Heartbeat activities before their returned expiry, separately from preflight expiry. End each activity exactly once. External-only operations retain a read-only UTM activity and issue no UTM mutation token.

When the port changes, copy a fresh entry and repeat the reload/verification sequence. If UTM restarts, an MCP session that disconnected must still reconnect.

If UTM MCP is unavailable, diagnose the configuration/listener/process boundary and stop. Do not open localhost in a browser or attempt unsupported desktop automation as a substitute for MCP.
