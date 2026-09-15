# Stable generated Verse identifiers

UEM-managed objects have three separate identity concepts:

- The persistent record `id` is machine-oriented and is used for references inside the managed manifest.
- `verseKey` is the persisted developer-facing Verse identity component.
- `name` is the editable display name shown to creators and players.

Existing-project records may also carry `publicIdentity`. This is the captured published Verse identity: API, metadata, entitlement, price, and offer stems, with the configured module/device/file names used to qualify them. It is separate from the catalog key because a legacy source can expose `PremiumPowerPass` while its current catalog key is `power_pass` (or the reverse). The managed manifest also records the generated module/device configuration so a bridge restart reopens the same qualified paths.

For ordinary records, a non-empty `verseKey` is authoritative during reopen and regeneration. Editing the display name does not change it. Existing valid legacy keys, including keys with timestamp-like text, remain unchanged for compatibility. During an existing-project migration, `adopt_existing_identity` may intentionally correct the catalog key only when the complete published identity is supplied and parity confirms that the public paths are unchanged.

New entitlements, bundles, offer displays, and alternate offers use the canonical allocator in `src/services/verseIdentity.ts`. It lowercases human-facing names, converts punctuation and whitespace to underscores, removes combining accents, prefixes leading numbers with `item_`, prefixes reserved Verse words with `item_`, and uses deterministic case-insensitive suffixes (`_2`, `_3`, and so on). Alternate offers use the parent key plus the next available `_alternate_N` ordinal.

The allocation scope includes root entitlements, alternates, bundles, and offer displays because their Pascal-case stems contribute to generated metadata, type, event, helper, and device-member symbols in the same generated device surface. UEFN editable identifiers are also derived from these stable stems. They use role-specific names such as `VipPass_PurchaseTriggers`, `VipPass_SuccessTriggers`, and `CoinStore_OpenTriggers`; mutable display text and user-entered property names never determine editable identity.

The manifest may contain `retiredVerseKeys`. UEM adds an object key when an object is deleted or an existing key is explicitly replaced. Retired keys remain unavailable to the allocator and are rejected if a different active object attempts to reuse them. Old manifests without this optional field continue to load with an empty registry.

Missing, empty, reserved, malformed, and duplicate legacy keys are repaired deterministically when imported. A valid non-empty key is preserved, including a legacy key such as `starter_bundle2213124124`. Repairs use the display name and current project allocation scope; references to repaired alternate keys are updated. These repairs are compatibility-sensitive because the source data was already unusable or ambiguous, so they are surfaced through the generated project validation path.

`schemaVersion` remains the managed-data schema marker. The generated API has one effective output path per record. Without `publicIdentity`, public stems are derived from `verseKey` through the shared deterministic Pascal/API transformation used by events, purchase helpers, and storefront helpers. With an adopted identity, the persisted stems drive those same declarations and helpers while the catalog key remains available for manifest identity, logs, and allocation. Older manifests may contain obsolete generated-API metadata or purchase-event fields; UEM ignores those fields, preserves valid project data, and regenerates the current canonical API. Generic create/update operations cannot import public identity; repairs and explicit adoption are surfaced through validation and migration evidence.
