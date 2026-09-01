# UTM 4.3 first-run asset readiness

## Reproduction captured before the fix

In a disposable project Content directory with no managed Verse file, no UEFN editor session, and Python Editor Scripting disabled:

1. Open the catalog bridge session.
2. Create the first entitlement with the default icon reference.
3. Save the catalog.

The bridge returned success and wrote `managed_transactions.verse` even though the referenced project `Texture2D` package was absent. The generated Verse therefore contained a managed icon reference that could not compile or open safely in UEFN. The root cause was that the UI treated a missing placeholder import as deferrable, while the server and MCP save paths performed only structural catalog validation and did not verify native asset existence.

## Release invariant

UTM never persists generated managed Verse while any primary, alternate-offer, or bundle icon reference cannot be resolved to a confirmed exact project object path. First initialization additionally requires the exact target project to be open in UEFN, a fresh authenticated editor bridge, and Python Editor Scripting. UTM provisions the placeholder through the editor bridge and confirms both the returned object path and the project asset package before accepting the catalog mutation or save.

Initialized projects can make catalog-only edits while UEFN is closed when every referenced project asset is already present and confirmed. Missing assets remain a blocking readiness error; UTM does not fabricate paths or copy `.uasset` files.

## Automated cases

`tests/release-readiness.test.ts` covers the release matrix:

- A closed editor, B Python disabled, C successful placeholder provisioning, D failed provisioning, E wrong project, F initialized/offline with assets, G initialized/offline with a missing asset, H disconnect before first save, I MCP mutation preflight, and J migration/catalog replacement preflight.

The generic Verse writer also rejects the reserved managed transaction filename, so migration or internal callers cannot bypass the catalog readiness gate.
