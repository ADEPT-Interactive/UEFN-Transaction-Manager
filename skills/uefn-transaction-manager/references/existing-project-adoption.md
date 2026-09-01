# Existing-project transaction adoption

This is a semantic migration, not a text-only rename.

1. Verify both servers, compare canonical project identity, and read the UTM snapshot/revision.
2. Use Epic MCP to search all relevant project Verse. Trace Marketplace declarations, purchase calls, alternate paths, bundles, storefront arrays, ownership/count checks, grants, consumes, dynamic values, restrictions, comments, strings, device references, and associated Texture2D assets.
3. Classify every candidate as confirmed, inferred, ambiguous, or absent. Exhaustive evidence that a concept does not exist is absent, not ambiguous.
4. Build a non-destructive mapping of transaction intent. Preserve unmatched existing UTM records by default; delete only when the evidence proves replacement or the creator explicitly authorizes it. Stop only if an ambiguity could change what is sold, owned, granted, consumed, priced, restricted, or eligible.
5. Use UTM `apply_catalog_patch` dry-run, inspect operation results/cascades/validation, then apply atomically with the still-current revision.
6. Adopt associated icons through Epic Texture2D discovery followed by UTM `adopt_icon`. Save with UTM and request the current integration contract.
7. Rewrite only the external project Verse callers and gameplay integration through Epic MCP. Preserve calculations, eligibility, UI, and gameplay consequences outside the managed file.
8. Compile through Epic MCP, rescan the full project for leftover raw Marketplace plumbing and duplicate purchase paths, configure proven device fields, reconnect after project switching when necessary, and perform a final semantic audit.
