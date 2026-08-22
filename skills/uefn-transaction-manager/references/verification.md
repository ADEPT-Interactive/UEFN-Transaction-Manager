# Verification and stopping rules

After catalog save, compile the generated managed Verse through Epic MCP and inspect structured diagnostics. A successful UTM save is not a compile result.

For sessions, use:

`StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`

Treat `The Refresh command is not currently available`, missing client logs, disconnected editor state, and unresolved device reference arrays as capability results, not as permission to guess or retry indefinitely. Use the full-compile/restart fallback and report exactly what was not proven.

For migration acceptance, rescan all project Verse for raw Marketplace plumbing, check generated contract usage, verify no external Verse was placed in the managed file, and confirm no real purchase occurred. Clean temporary fixtures and test devices. End only when the semantic audit and compile boundary are explicit.

