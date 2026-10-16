# Tool discovery and same-project guard

Discover tools at runtime. UTM should advertise `utm-mcp` with Streamable HTTP at the configured loopback endpoint. Epic's server is normally `unreal-mcp` at its configured endpoint. Use the host client's live `tools/list` or toolset discovery rather than copying a stale schema into the workflow.

Before any cross-server mutation:

1. Initialize both servers and record their server identity and protocol.
2. Call UTM `get_project_context`.
3. Query Epic editor/project context and, where necessary, inspect the mounted Verse root or content browser mount through Epic MCP.
4. Compare the strongest available evidence: canonical `.uefnproject` path, project root, project name, and asset/content mount.
5. Stop if the values conflict or if the evidence is insufficient. Loopback addresses do not prove project identity.

Keep server responsibilities unambiguous. UTM includes read-only and draft-mutation tools. Epic owns external editor/project operations; inspect each tool’s live schema and annotations. The agent should say which server it is using when the same task crosses both boundaries.

## Preflight boundary

Call `describe_operation_contract` for this build’s manifests. `inspect-only`, `catalog-edit`, and explicitly approved `catalog-only-migration` require no Epic server. Supply no unrelated external evidence for these operations. Classify the requested work, then call UTM `preflight_operation` after live discovery. Supply the exact requested scope and the agent-reported Unreal server/schema/project/editor evidence. Treat `ready: false` as a hard stop. A mutation-capable `ready: true` result returns a short-lived `preflightToken` bound to the caller, project identity, catalog revision, operation, and allowed mutation domains. Re-evaluate after a project switch, reconnect, editor transition, or concurrent revision change. Successful own mutations advance the existing lease; use their returned snapshot revision.

The UTM API rejects non-dry catalog writes, icon adoption, and saves without both a valid token and an active mutating `activityId`. Start `begin_activity` as read-only during discovery; end that activity before beginning a new mutating activity with the matching token. Epic-only operations have no UTM mutation token and keep UTM activity read-only. Keep heartbeating and update the safe phase. End once with `success`, `failed`, or `cancelled`; a stale heartbeat expires the server-owned activity and its token must not be revived.
