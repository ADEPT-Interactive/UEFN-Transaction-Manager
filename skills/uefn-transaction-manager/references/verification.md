# Verification and stopping rules

After catalog save, compile the generated managed Verse through Epic MCP and inspect structured diagnostics. A successful UTM save is not a compile result.

Before every mutation, retain the current UTM `preflightToken`, `activityId`, and `expectedRevision`. Recheck the preflight after any project/editor transition, MCP reconnect, capability change, or revision change. If preflight expires or the activity loses its heartbeat, stop, end the activity if still active, and start a new operation; never retry with stale credentials.

After catalog save, use an explicit compile request when compile evidence is needed and inspect its structured diagnostics. Managed-device placement, editable assignments, caller wiring, and gameplay remain creator-owned UEFN setup and are not inferred or gated by UTM. A static caller reference or a successful forced grant does not prove that a normal gameplay interaction reaches the Marketplace prompt.

For sessions, use:

`StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`

Treat `The Refresh command is not currently available`, missing client logs, disconnected editor state, and unresolved device reference arrays as capability results, not as permission to guess or retry indefinitely. Use the full-compile/restart fallback and report exactly what was not proven.

For migration acceptance, rescan all project Verse for raw Marketplace plumbing, check generated contract usage, verify no external Verse was placed in the managed file, and confirm no real purchase occurred. Clean temporary fixtures and test devices. End only when the semantic audit and compile boundary are explicit.
