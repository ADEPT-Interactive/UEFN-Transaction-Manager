# Transaction semantics

UTM catalog objects describe transaction plumbing, not gameplay meaning.

- A durable entitlement represents persistent ownership and normally has a count cap of one.
- A consumable entitlement represents a quantity that project Verse may consume. A successful generated `Consume<Stem>` changes the authoritative Marketplace quantity and emits that item’s `Consumed` notification after native `ConsumeEntitlement` succeeds. Grant/Consume operation status is not the same as gameplay ownership state.
- An alternate offer is another purchase path for an existing entitlement. It is not automatically a new owned product.
- A bundle describes transaction contents. Nested references and quantities must remain within UTM validation rules.
- A storefront is a composed list of concrete offers. Membership is not ownership.
- Grants are deliberate free grants, restorations, or promotions, not a substitute for a purchase flow.
- Use generated delta events and ownership/count helpers for gameplay reactions. Keep player-specific calculations and consequences external. An immediate-use consequence must await `Consumed`, not `Granted` or generic `Removed`.

For existing-project migration, distinguish these patterns from source evidence:

- An inventory-bearing consumable is `itemType: consumable`, `autoConsume: false`; it remains owned until the project’s deliberate use flow consumes it.
- An immediate-use purchase whose legacy handler consumes after applying or validating the use is `itemType: consumable`, `autoConsume: true`; the migrated gameplay consequence must await `Await<Stem>ConsumedEvent()` and must not be attached to `Granted`.
- A durable entitlement is `itemType: durable`, `maxCount: 1`, and cannot be auto-consumed.

`Removed` is intentionally not an alias for `Consumed`: native entitlement changes can include other decreases/removals. The generated `Consumed` event is emitted only by the generated `Consume<Stem>` wrapper, including auto-consume, and not by arbitrary raw native calls. Migrated callers should use the generated wrapper so the event and failure boundary remain correlated. Repeated immediate-use purchases are represented by repeated positive grants followed by successful consumption, not by retained inventory.

Ask for clarification rather than guessing when evidence cannot distinguish a separate entitlement from an alternate path, an intentionally sold offer from dead code, a transaction quantity from a gameplay quantity, or a product restriction from an eligibility rule.
