# Phase 21 Final Hardening Report

Date: 2026-08-18
Version: 3.0.1
Commit: final local hardening commit, exact hash recorded in the handoff below
Commit message: `Harden release candidate and acceptance checks`

## Outcome

Phases 1 through 20 remain intact. Phase 21 found and fixed three concrete generated-Verse defects, reached a clean live UEFN compile, completed the native icon import path, added the representative fixture and compile-audit coverage, produced the acceptance checklist, and created a fresh verified release artifact. Nothing was pushed remotely.

## Live UEFN validation

- Selected project: `UEM_Demo` in the local UEFN Projects directory.
- No existing UEM-managed generated transaction Verse file was present before generation. Unrelated project content was preserved.
- Python Editor Scripting was enabled, and `Content/Python/init_unreal.py` was run through UEFN Tools. The bridge became fully connected without requiring a restart.
- The Verse Workflow Server at `127.0.0.1:1962` became reachable.
- UEM generated a fresh `Content/managed_transactions.verse` from the six-entitlement, three-bundle, two-focused-store complex fixture.
- Live compile/fix/regenerate iterations: three attempts to clean. The first result had 96 errors, the second had 9, and the third had 0 warnings and 0 errors. A later recompile after native icon import also remained clean. The UEFN editor showed `Built successfully.`

## Defects found and fixed

1. Generated logger helpers accepted `diagnostic` while runtime messages were strings, and the live `Print` call required the named `?Level :=` argument. Logger helpers now accept `Message:string` and emit named log levels.
2. Marketplace UI lock acquisition was embedded in a failable condition that violated the generated effect rules. Acquisition is now synchronous before the `if` and `spawn` boundary.
3. Dynamic bundle runtime construction attempted to assign an immutable overridden `Offers` field and produced an ambiguous subtype. Dynamic offers now initialize the immutable field through the concrete constructor.

Tests were updated for all three fixes. No architecture overhaul was introduced.

## Generated source and API audit

- The compile-audit generator now covers Marketplace classes, restrictions, supplied and external paid-random disclosure, static and nested bundles, dynamic remaining bundles, storefronts, reconciliation, logging, and editables.
- The final compile-audit source was 772 lines with 97 explicit `<public>` occurrences and contained restrictions, dynamic offers, logging, storefront execution, and reconciliation query paths.
- The locked automated representative API fixture remains at exactly 96 explicit `<public>` declarations.
- The richer live UEM_Demo matrix emitted 126 declarations. This is explained by six entitlements, an alternate offer, three bundles, and additional focused-store helpers. No removed API family was regenerated.
- Canonical events, `Open<Stem>Purchase`, `Get<Stem>Count`, `Has<Stem>`, `Grant<Stem>`, consumable `Consume<Stem>`, `OpenAllOffersStore`, and focused storefront helpers were present.
- No generated `PromptBuy`, old purchase events, ownership-verification events, quantity event families, public legacy helpers, API-version branches, or legacy diagnostics were present.
- Obsolete-name matches remain only where intentionally required for schema migration, parser tolerance, negative tests, or compatibility fixtures.
- The generated source audit covered header/manifest, metadata, restrictions, paid-random odds omission and disclosure, static and dynamic bundles, immutable MaxCount-backed runtime offers, native editables, unified Marketplace locking, one base reconciliation query, concrete casts, duplicate aggregation, and debug-gated `[UEM]` logging.

## Persistence and determinism

- The Phase 21 fixture includes stable and retired keys, durable and consumable entitlements, auto-consume, paid-random with odds, paid-random with external disclosure, restrictions, alternate pricing, static and nested bundles, a dynamic direct-purchase-only bundle, explicit All Offers membership, focused storefronts, buttons, triggers, and icons.
- Save, close, reopen, reload, and regenerate passed in UEM_Demo.
- An unchanged reload/save produced the same 69,653-byte managed file and SHA-256 `564B7FF4CDE6D59BCCB635C80D6EE6FE5A7737EFEFC40C6C2D62E6EF19846847` before the later intentional icon-reference update.
- Stable keys, retired keys, catalog configuration, alternate offers, bundle composition, restrictions, paid-random state, storefront membership, editable enablement, icons, MaxCount, auto-consume, dynamic-bundle configuration, and validation state were preserved.
- Schema 2, 3, and 4 loading, obsolete-field normalization, malformed data diagnostics, save-for-repair behavior, and generation blocking are covered by the automated suite.
- No timestamp, random ID, or unstable object-order source was found in generator output.

## Live editor boundary

- Verse Explorer showed `managed_transactions.verse` in the UEM_Demo package.
- The generated device did not appear in Place Actors after clean Workflow Server compilation, editor compilation, or a full UEFN restart. Therefore the generated Details panel, placed assignment persistence, button and trigger wiring, live storefront interaction, live entitlement events, live reconciliation, live Grant/Consume mutation, dynamic Marketplace runtime, and editable debug logging could not be exercised in that project.
- These areas are marked `NOT TESTED` in `docs/UEFN_ACCEPTANCE_CHECKLIST.md`. They are not claimed as runtime acceptance based only on source tests or compilation.

## Native icon and asset validation

- A valid PNG was selected through UEM with the full Python capability check.
- Native import completed as `EntitlementIcons.core_entitlement` in UEM_Demo.
- UEFN Content Browser visibly showed the imported texture and the placeholder texture under `UEM_Demo > EntitlementIcons`.
- Regenerated Verse referenced `EntitlementIcons.core_entitlement`.
- Power-of-two preservation, proportional normalization, and flag-atlas gutter behavior passed automated coverage. No neighboring-flag bleed was reproduced.

## Manager, launcher, and connection regression

- Manager catalog loaded six entitlements and three bundles with one expected advisory warning for externally disclosed paid-random odds and no blocking errors.
- UEM displayed the fully connected Python and authoritative compilation state.
- Launcher showed cached results before broad discovery, displayed `Scanning for more projects...`, found a real non-C project on `O:`, preserved selection, deduplicated cards, and tolerated excluded or inaccessible paths.
- Automated desktop lifecycle coverage passed picker, project confirmation, dashboard navigation, switching, and owned-process shutdown.
- Automated Manager UX coverage passed focus stability, dirty-close decisions, validation-error save behavior, country picker handling, and icon capability states.
- Broad fixed-drive discovery remained non-blocking. The observed six-drive scan took about 21 seconds while early launcher usability was preserved.

## Automated validation

- `npm run test:all`: PASS.
- TypeScript tests: 124 passed, 0 failed.
- Python tests: 11 passed, 0 failed.
- Desktop lifecycle: PASS.
- Version consistency: PASS, version remains intentionally 3.0.1.
- `npx tsc --noEmit`: PASS.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: PASS.
- Final live compile: 0 warnings, 0 errors.
- Final release build reran the complete source verification suite.

## Release artifact

- Fresh artifact: the local release ZIP produced by the release build.
- Size: 141,619,216 bytes.
- The exact final archive SHA-256 is recorded in the handoff below because ZIP metadata changes on each fresh packaging run.
- Inventory: the contents inventory produced alongside the local release ZIP.
- `scripts/verify-release.ps1`: PASS. It verified archive extraction, required files, x64 native modules, source/runtime exclusion, frontend serving, authentication, revision-safe save/load, texture normalization, visible lifecycle, project switching, and shutdown.

## Final issue list

### Verified locally

Source, generator, validator, migration, schema, malformed-data, public API, Marketplace, storefront, dynamic bundle, logging, security, bridge, icon normalization, Manager UX, launcher discovery, desktop lifecycle, version, build, packaging, and extracted-release behavior are covered by the automated and packaged checks listed above.

### Verified live in UEFN

UEM_Demo project selection, clean managed-file start, Python initialization, bridge connection, Workflow Server reachability, fresh generated Verse visibility, three compile/fix/regenerate iterations to a clean result, editor compile success, generated syntax/effect/type surface, and native Texture2D import with Content Browser visibility were verified live.

### Still requires live/runtime validation

The generated device must be surfaced in Place Actors in a suitable UEFN project before Details-panel metadata, placed assignment persistence, button and trigger runtime, storefront runtime, entitlement event runtime, reconciliation runtime, Grant/Consume runtime, dynamic remaining-bundle runtime, and editable debug logging can be tested. No real purchase or V-Bucks transaction was attempted.

### Known defects

No known generator, TypeScript, Python, packaging, or live Verse compiler defects remain. The generated-device Place Actors boundary is unresolved and is recorded as an explicit live validation blocker, not hidden as a pass.

### Optional future enhancements

Investigate why the clean generated device is not surfaced in Place Actors for UEM_Demo and repeat the marked runtime checks in a project where the class is placeable. This is the only outstanding release-validation boundary from this phase and is not a license to change the frozen architecture without evidence.

## Final state

- Phases 1 through 20 remain intact.
- Local commit message is `Harden release candidate and acceptance checks`; the exact final hash is recorded in the handoff below.
- Nothing was pushed remotely.
- The worktree is clean after this report was included in the final commit.
- `docs/UEFN_ACCEPTANCE_CHECKLIST.md` contains the status matrix with PASS and NOT TESTED results.
