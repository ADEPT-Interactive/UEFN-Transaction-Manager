# Dynamic transactions

UTM owns the generated runtime options type, validation, offer construction, and Marketplace plumbing. Project Verse owns the calculation that supplies runtime values.

1. Identify whether price, quantity, or fill-to-max behavior is truly runtime-driven from declarations and call sites.
2. Represent the transaction-domain shape in UTM. Use `describe_integration_contract` to obtain the current options type, factory, and purchase helper.
3. Keep discounts, missing-resource calculations, progression checks, random selection, and other player/game-state logic in external Verse.
4. Validate boundaries before calling the generated factory. Reject invalid runtime values rather than manufacturing a new UTM formula.
5. Compile and inspect diagnostics after integrating the external caller.

