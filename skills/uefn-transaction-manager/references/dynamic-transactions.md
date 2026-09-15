# Dynamic transactions

UTM owns the generated runtime options type, validation, offer construction, and Marketplace plumbing. Project Verse owns the calculation that supplies runtime values.

1. Identify whether price, quantity, or fill-to-max behavior is truly runtime-driven from declarations and call sites.
2. Represent the transaction-domain shape in UTM, then call `describe_integration_contract`. Use its fully qualified runtime options type, reported fields, and guarded device purchase helper.
3. Keep discounts, missing-resource calculations, progression checks, random selection, and other player/game-state logic in external Verse.
4. Build the options value in the external caller and pass it to the generated helper. A runtime primary offer has the shape `Transactions.Open<Stem>Purchase(Player, <OffersModule>.<Stem>RuntimeOptions{PriceVBucks := Price})`; a runtime alternate uses its alternate stem; a quantity-only bundle passes only its generated quantity fields; a price-and-quantity bundle passes both price and quantity fields.
5. The contract may report `dynamicOfferFactory` for diagnostics and advanced generated-offer plumbing. It is fully module-qualified but lower-level; do not call it for normal purchases or recreate the generated Marketplace path.
6. Validate boundaries before the generated helper is called. Reject invalid runtime values rather than manufacturing a new UTM formula.
7. Compile and inspect diagnostics after integrating the external caller.
