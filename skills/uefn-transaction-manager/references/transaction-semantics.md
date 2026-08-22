# Transaction semantics

UTM catalog objects describe transaction plumbing, not gameplay meaning.

- A durable entitlement represents persistent ownership and normally has a count cap of one.
- A consumable entitlement represents a quantity that project Verse may consume. Grant/Consume operation status is not the same as gameplay ownership state.
- An alternate offer is another purchase path for an existing entitlement. It is not automatically a new owned product.
- A bundle describes transaction contents. Nested references and quantities must remain within UTM validation rules.
- A storefront is a composed list of concrete offers. Membership is not ownership.
- Grants are deliberate free grants, restorations, or promotions, not a substitute for a purchase flow.
- Use generated delta events and ownership/count helpers for gameplay reactions. Keep player-specific calculations and consequences external.

Ask for clarification rather than guessing when evidence cannot distinguish a separate entitlement from an alternate path, an intentionally sold offer from dead code, a transaction quantity from a gameplay quantity, or a product restriction from an eligibility rule.

