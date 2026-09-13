# Transaction semantics

UTM catalog objects describe transaction plumbing, not gameplay meaning.

- A durable entitlement represents persistent ownership and normally has a count cap of one.
- A consumable entitlement represents a quantity that project Verse may consume. A successful generated `Consume<Stem>` changes the authoritative Marketplace quantity and emits that item’s `Consumed` notification after native `ConsumeEntitlement` succeeds. Grant/Consume operation status is not the same as gameplay ownership state.
- An alternate offer is another purchase path for an existing entitlement. It is not automatically a new owned product.
- A bundle describes transaction contents. Nested references and quantities must remain within UTM validation rules.
- A storefront is a composed list of concrete offers. Membership is not ownership.
- Grants are deliberate free grants, restorations, or promotions, not a substitute for a purchase flow.
- Use generated delta events and ownership/count helpers for gameplay reactions. Keep player-specific calculations and consequences external. An immediate-use consequence must await `Consumed`, not `Granted` or generic `Removed`.

## Durable ownership lifecycle

Reconciliation establishes initial truth. Generated delta events keep current truth current.

For a durable entitlement whose ownership affects live gameplay, UI, access, permissions, progression, multipliers, toggles, or another session-scoped behavior, join-time reconciliation is only the initialization half of the integration:

1. During player initialization, use the generated reconciliation notification (`Await<Stem>ReconciledEvent()`) and the authoritative `Has<Stem>`/`Get<Stem>Count` helper as appropriate to initialize the project-owned mirror or cache.
2. For the lifetime of the relevant integration, keep a persistent await loop for `Await<Stem>GrantedEvent()`. Update the external state immediately when the same-session ownership delta arrives; reconnect is not a synchronization mechanism.
3. If the current generated contract supports ownership loss and the project depends on it, also handle `Await<Stem>RemovedEvent()`. Do not invent a loss or revocation event that the generated contract does not expose.

Reconciliation is not a subscription. A successful initial ownership check does not keep a cached gameplay flag synchronized forever. A durable with no mirrored state that is queried ad hoc from authoritative helpers does not need an unnecessary listener; declare that exception explicitly in the migration parity row.

For existing-project migration, distinguish these patterns from source evidence:

- An inventory-bearing consumable is `itemType: consumable`, `autoConsume: false`; it remains owned until the project’s deliberate use flow consumes it.
- An immediate-use purchase whose legacy handler consumes after applying or validating the use is `itemType: consumable`, `autoConsume: true`; the migrated gameplay consequence must await `Await<Stem>ConsumedEvent()` and must not be attached to `Granted`.
- A durable entitlement is `itemType: durable`, `maxCount: 1`, and cannot be auto-consumed.

For existing-project parity, record the initial state source, live-change source, and external state for every migrated entitlement. A gameplay-affecting durable with a mirrored state is incomplete unless the proposed row names both the reconciliation path and a persistent generated `Await<Stem>GrantedEvent()` path. The live path may additionally name the actual `Await<Stem>RemovedEvent()` API when removal is supported and relevant.

`Removed` is intentionally not an alias for `Consumed`: native entitlement changes can include other decreases/removals. The generated `Consume<Stem>` wrapper records a pending intent, and the generated `Consumed` event is emitted only for a matching authoritative negative entitlement delta, including auto-consume. Failed, expired, or unmatched decreases do not emit `Consumed`; arbitrary raw native calls cannot create the correlation. Migrated callers should use the generated wrapper so the event and failure boundary remain correlated. Repeated immediate-use purchases are represented by repeated positive grants followed by confirmed consumption, not by retained inventory.

Ask for clarification rather than guessing when evidence cannot distinguish a separate entitlement from an alternate path, an intentionally sold offer from dead code, a transaction quantity from a gameplay quantity, or a product restriction from an eligibility rule.
