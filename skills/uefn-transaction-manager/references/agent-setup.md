# Agent setup and lifecycle

UTM setup has five separate states:

1. **UTM MCP server** — the project-scoped loopback listener is enabled and running.
2. **Agent Skill** — the complete UTM skill folder, including `SKILL.md` and `references`, is installed for the selected client.
3. **Client configuration** — the current `utm-mcp` URL and private static bearer header were copied/prepared.
4. **Agent process** — an already-running client may need a reload or fresh process to read the new MCP configuration.
5. **Verified connection** — the client has initialized UTM MCP and called `get_project_context` for the current project.

Do not describe state 1 as state 5. A user-environment variable change cannot update an already-running agent. The supported UTM configuration is the static header returned by the panel; keep it private and never place it in a project file or source control.

The guided UTM panel can install the skill for Codex (`%USERPROFILE%\\.agents\\skills\\uefn-transaction-manager`), Claude Code (`%USERPROFILE%\\.claude\\skills\\uefn-transaction-manager`), or Cursor (`%USERPROFILE%\\.cursor\\skills\\uefn-transaction-manager`). It writes only the UTM-owned folder and refuses to overwrite unrelated files. Manual path/config copying is the fallback for other clients.

After guided setup:

1. Replace or add only the UTM-owned MCP entry in the client configuration using the copied static-header entry.
2. Reload the client or start a fresh coding-agent process.
3. Confirm both `utm-mcp` and `unreal-mcp` are visible to that fresh session.
4. Ask the agent to call `get_project_context` and compare it with Epic's project context before doing any mutation.

When a token is rotated or the port changes, the old client entry is invalid. Copy a fresh entry and repeat the reload/verification sequence. When UTM restarts without rotation, the private token normally remains valid, but an MCP session that disconnected must still reconnect.

If UTM MCP is unavailable, diagnose the configuration/listener/process boundary and stop. Do not open localhost in a browser or attempt unsupported desktop automation as a substitute for MCP.
