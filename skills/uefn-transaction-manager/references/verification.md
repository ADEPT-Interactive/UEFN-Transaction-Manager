# Verification and stopping rules

Use one canonical lifecycle rule throughout verification: reconciliation establishes initial truth, and generated delta events keep current truth current.

After catalog save, compile the generated managed Verse through Epic MCP and inspect structured diagnostics. A successful UTM save is not a compile result.

Before every mutation, retain the current UTM `preflightToken`, `activityId`, and `expectedRevision`. Recheck the preflight after any project/editor transition, MCP reconnect, capability change, or revision change. If preflight expires or the activity loses its heartbeat, stop, end the activity if still active, and start a new operation; never retry with stale credentials.

After catalog save, use an explicit compile request when compile evidence is needed and inspect its structured diagnostics. Managed-device placement, editable assignments, caller wiring, and gameplay remain creator-owned UEFN setup and are not inferred or gated by UTM. A static caller reference or a successful forced grant does not prove that a normal gameplay interaction reaches the Marketplace prompt.

For sessions, use:

`StartSession -> Connected -> StartGame -> Running -> optional one-shot PushChanges after compile -> available logs -> StopGame -> StopSession`

Treat `The Refresh command is not currently available`, missing client logs, disconnected editor state, and unresolved device reference arrays as capability results, not as permission to guess or retry indefinitely. Use the full-compile/restart fallback and report exactly what was not proven.

## Existing-project migration completion gate

Do not call an existing-project migration complete merely because Verse compiled, a purchase prompt appeared, Marketplace ownership changed, a generated contract exists, or reconnect later reports ownership. Those are separate observations and none replaces the integration audit.

Complete a compact row for every migrated entitlement, alternate offer, and bundle:

| Field | Required evidence |
| --- | --- |
| Transaction type | Durable, immediate-use consumable, inventory-bearing consumable, alternate offer, or bundle contents |
| Initial-state source | Reconciliation notification and/or the generated authoritative ownership/count helper used at player initialization |
| Live-change source | Persistent generated `Granted` path for mirrored durables, `Consumed` for immediate-use effects, and the actual `Removed` path when supported and relevant |
| External consequence | Every gameplay, UI, access, permission, progression, multiplier, toggle, or inventory state that depends on the entitlement |
| Structural integration | Listener is persistent, started for the intended integration/player lifetime, routes the correct stem/player, and updates the external state |
| Compile | Generated and changed project Verse compiled with structured diagnostics reviewed |
| Owner live acceptance | Mark whether a real purchase/prompt-to-gameplay test remains owner-controlled |

For every gameplay-affecting durable with mirrored project state, both halves are mandatory: pre-owned player initialization from reconciliation and same-session acquisition through a persistent `Await<Stem>GrantedEvent()` path. Reconnect or rerunning player initialization must not be required. A durable that has no live gameplay consequence and is queried ad hoc from authoritative state may declare that exception instead of adding a needless mirror/listener.

For immediate-use consumables, correlate the purchase/use path to `Await<Stem>ConsumedEvent()`; do not use durable `Granted` as a consumption boundary. Inventory-bearing consumables must preserve authoritative quantity and deliberate-use behavior. Alternate offers must resolve to the underlying entitlement semantics, and bundle contents must be checked according to each contained entitlement's type.

Automated and agent-provable evidence may establish the generated APIs, persistent listener structure, caller updates, compile result, and synthetic same-session fixtures. Only the owner can prove the live chain from a real purchase prompt through Marketplace/native entitlement change and the immediate in-session gameplay effect. Do not attempt real purchase automation or report synthetic evidence as live acceptance.

For migration acceptance, rescan all project Verse for raw Marketplace plumbing, check generated contract usage, verify no external Verse was placed in the managed file, and confirm no real purchase occurred. Clean temporary fixtures and test devices. End only when the semantic audit, evidence level, and compile boundary are explicit.
