# Stable generated Verse identifiers

UEM-managed objects have three separate identity concepts:

- The persistent record `id` is machine-oriented and is used for references inside the managed manifest.
- `verseKey` is the persisted developer-facing Verse identity component.
- `name` is the editable display name shown to creators and players.

Once an object has a non-empty `verseKey`, that value is authoritative during reopen and regeneration. Editing the display name does not change it. Existing valid legacy keys, including keys with timestamp-like text, remain unchanged for compatibility.

New entitlements, bundles, offer displays, and alternate offers use the canonical allocator in `src/services/verseIdentity.ts`. It lowercases human-facing names, converts punctuation and whitespace to underscores, removes combining accents, prefixes leading numbers with `item_`, prefixes reserved Verse words with `item_`, and uses deterministic case-insensitive suffixes (`_2`, `_3`, and so on). Alternate offers use the parent key plus the next available `_alternate_N` ordinal.

The allocation scope includes root entitlements, alternates, bundles, and offer displays because their Pascal-case stems contribute to generated metadata, type, event, helper, and device-member symbols in the same generated device surface. Explicit editable device names remain user-configured and are not redesigned in this phase; the existing validator continues to detect member collisions.

The manifest may contain `retiredVerseKeys`. UEM adds an object key when an object is deleted or an existing key is explicitly replaced. Retired keys remain unavailable to the allocator and are rejected if a different active object attempts to reuse them. Old manifests without this optional field continue to load with an empty registry.

Missing, empty, reserved, malformed, and duplicate legacy keys are repaired deterministically when imported. A valid non-empty key is preserved, including a legacy key such as `starter_bundle2213124124`. Repairs use the display name and current project allocation scope; references to repaired alternate keys are updated. These repairs are compatibility-sensitive because the source data was already unusable or ambiguous, so they are surfaced through the generated project validation path.

`schemaVersion` remains the managed-data schema marker. `generatedApiVersion` is the separate developer-facing generated Verse API marker. API-v2 public stems are derived from `verseKey` through the shared deterministic Pascal/API transformation used by events, purchase helpers, and storefront helpers. Manifests without this field are interpreted as API v1; opening one migrates generated output to API v2 while retaining `legacyApiCompatibility` shims where historical names are reproducible. Compatibility-affecting repairs are retained in `legacyApiDiagnostics` for developer review.
