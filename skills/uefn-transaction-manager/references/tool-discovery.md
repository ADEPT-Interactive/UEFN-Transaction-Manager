# Tool discovery and same-project guard

Discover tools at runtime. UTM should advertise `utm-mcp` with Streamable HTTP at the configured loopback endpoint. Epic's server is normally `unreal-mcp` at its configured endpoint. Use the host client's live `tools/list` or toolset discovery rather than copying a stale schema into the workflow.

Before any cross-server mutation:

1. Initialize both servers and record their server identity and protocol.
2. Call UTM `get_project_context`.
3. Query Epic editor/project context and, where necessary, inspect the mounted Verse root or content browser mount through Epic MCP.
4. Compare the strongest available evidence: canonical `.uefnproject` path, project root, project name, and asset/content mount.
5. Stop if the values conflict or if the evidence is insufficient. Loopback addresses do not prove project identity.

Keep server responsibilities unambiguous. A UTM tool name changes transaction state. An Epic tool changes editor/project state. The agent should say which server it is using when the same task crosses both boundaries.

