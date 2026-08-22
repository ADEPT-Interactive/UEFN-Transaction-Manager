# UEFN Acceptance Checklist

Status: Release-hardening evidence for version 4.0.1, 2026-08-21

This checklist records the Phase 21 release candidate results. `PASS` means the behavior was directly verified by a test, packaged artifact, UEM session, or live UEFN editor. `NOT TESTED` identifies a boundary that could not be reached in the available project. No real Marketplace purchase or V-Bucks transaction was performed.

## Live environment

| Area | Result | Evidence |
| --- | --- | --- |
| Selected project | PASS | The `UEM_Demo` project in the local UEFN Projects directory was preferred and used. |
| Existing managed output cleanup | PASS | No UEM-managed generated transaction Verse file was present in UEM_Demo before generation. Unrelated Verse and project content were preserved. |
| Python initialization | PASS | Python Editor Scripting was enabled in UEFN Project Settings and `Content/Python/init_unreal.py` was run through UEFN Tools. No restart was needed for the bridge to become available. |
| Workflow Server | PASS | `127.0.0.1:1962` became reachable and the bundled compile-audit path completed against the open UEM_Demo editor. |
| Fresh generated source | PASS | UEM generated a fresh `Content/managed_transactions.verse` from the Phase 21 complex fixture. |

## Verse compilation

| Area | Result | Evidence |
| --- | --- | --- |
| Initial live compile | FAIL, fixed | 96 errors exposed logger argument typing, named log-level syntax, failable lock acquisition, and dynamic offer construction issues. |
| Regenerate and compile | FAIL, fixed | 9 errors remained after the first fixes: logger named-argument syntax and dynamic offer subtype/immutability issues. |
| Final live compile | PASS | The Workflow Server and UEFN editor both reported `Compilation complete`, `Linking complete`, `SUCCESS -- Build complete`, with 0 warnings and 0 errors. |
| Phase 26 await consumer compile | PASS | A temporary external Verse consumer awaited `AwaitCoreEntitlementGrantedEvent()` from the generated device through the live UEM_Demo Workflow Server; the producer and consumer compiled with 0 warnings and 0 errors. The fixture was removed after verification. |
| `GetMinPurchaseAge` | PASS | Restricted offer override compiled with the expected body and return. |
| Restrictions | PASS | Country, platform, and age expressions compiled. |
| Logger and diagnostic levels | PASS | Generated diagnostic helpers compile with `Message:string` and named `?Level := log_level.*`. |
| Marketplace UI lock | PASS | Synchronous acquisition occurs before `spawn`, without placing a no-rollback call inside a failable condition. |
| Shared offer executors | PASS | Common `offer` purchase execution and `[]offer` storefront execution compiled. |
| Reconciliation | PASS | One `GetPurchasedEntitlements(Player, ManagedEntitlements.basic_entitlement)` query, concrete casts, aggregation, and zero signals compiled. |
| Dynamic offer construction | PASS | Runtime offer construction with immutable `Offers<override>` initialization compiled. |
| `MaxCount` | PASS | Generated dynamic remaining quantity reads the concrete consumable entitlement's authoritative `MaxCount`. |
| Public declaration inventory | PASS | The locked automated representative fixture remains at 96 explicit `<public>` declarations. The richer live six-entitlement fixture emitted 126 declarations, explained by its larger catalog and additional storefront surface. No removed API family was regenerated. |

## Generated behavior and data lifecycle

| Area | Result | Evidence |
| --- | --- | --- |
| Save, close, reopen, regenerate | PASS | UEM_Demo was saved, UEM was restarted/reloaded, and the complex project regenerated successfully. |
| Deterministic generation | PASS | Unchanged reload/save produced the same 69,653-byte managed file and SHA-256 `564B7FF4CDE6D59BCCB635C80D6EE6FE5A7737EFEFC40C6C2D62E6EF19846847` before the later icon-reference update. |
| Stable keys and configuration | PASS | Entitlements, alternate offer, bundles, storefront membership, restrictions, odds state, MaxCount, auto-consume, and icon configuration reloaded without identity drift. |
| Schema 2, 3, and 4 loading | PASS | Automated compatibility tests cover representative old schemas and normalization. |
| Malformed supported data | PASS | Automated malformed fixtures verify non-crashing diagnostics, save-for-repair behavior, and generation blocking for invalid configurations. |
| Obsolete API removal | PASS | Repository searches found obsolete names only in migration parsers, compatibility fixtures, or negative tests. No obsolete generated API branch remains. |

## UEFN editor and runtime boundaries

| Area | Result | Evidence |
| --- | --- | --- |
| Generated source visible | PASS | Verse Explorer showed `managed_transactions.verse` in the UEM_Demo package. |
| Generated device Details panel | NOT TESTED | The generated `managed_transactions_device` is expected to be found through the UEFN Content Browser and placed from there; no device instance was available to inspect during this acceptance run. |
| Editable categories/tooltips and binding names | NOT TESTED | Source metadata was audited, but no generated device Details panel was available. |
| Placed-device assignment persistence | NOT TESTED | No generated device could be placed, saved, regenerated, and reopened. |
| Purchase button and trigger runtime | NOT TESTED | No generated device was available for wiring. Static generation and compile coverage passed. |
| Storefront runtime and membership | NOT TESTED | Static generation and compile coverage passed. No placed device or Marketplace session was available. |
| Entitlement events and Grant/Consume runtime | NOT TESTED | Generated signatures and compile behavior passed; live gameplay/event mutation was not reachable without a placed device. |
| Reconciliation runtime | NOT TESTED | Live compilation of the base query and casts passed; no runtime player session was available. |
| Dynamic remaining bundle runtime | NOT TESTED | Runtime construction, restrictions, MaxCount access, and zero-state guards compiled; no live Marketplace runtime session was available. |
| Paid-random behavior | PASS | Classification, supplied odds disclosure, and empty external-disclosure odds omission compiled. The empty-odds case remains warning-only and does not emit malformed `Odds:` text. |
| Debug logging runtime | NOT TESTED | Logger syntax, severity names, and debug gating compiled. The generated device could not be placed to toggle the editable and observe runtime output. |

## Python and icon pipeline

| Area | Result | Evidence |
| --- | --- | --- |
| Full Python bridge | PASS | UEM reported fully connected Python capability and authoritative compilation availability. |
| Native icon import | PASS | `vbucks-icon.png` was imported as `EntitlementIcons.core_entitlement`; UEM reported completion and UEFN Content Browser showed the imported texture. |
| Generated texture reference | PASS | Generated Verse referenced `EntitlementIcons.core_entitlement` after import and save. |
| Icon persistence | PASS | The imported icon remained in the UEM_Demo project and was represented in regenerated output. |
| Country flag atlas bleed | PASS | Existing atlas slicing and automated visual bounds coverage showed no reproduced neighboring-flag bleed in the current implementation. |

## Manager and launcher

| Area | Result | Evidence |
| --- | --- | --- |
| Manager catalog and validation | PASS | The six-entitlement, three-bundle, two-focused-store fixture loaded with the expected single advisory paid-random warning and no blocking errors. |
| Manager connection lifecycle | PASS | UEM displayed fully connected Python capability after initialization; automated lifecycle tests cover unavailable, connected, switch, and shutdown states. |
| Launcher discovery | PASS | Launcher displayed cached projects before broad discovery, showed the scanning indicator, found the non-C project on `O:`, and preserved selection without duplicate cards. |
| Project switching | PASS | Automated desktop lifecycle coverage passed project switching and shutdown. The live UEM_Demo session loaded from the launcher successfully. |
| Focus and dirty-close regressions | PASS | Automated Manager UX suite passed; prior manual Phase 19 workflows remain the manual evidence for polling focus and modal decision behavior. |
| Launcher visual audit | PASS | Cards, selected state, scan indicator, icon treatment, spacing, and empty/error-state structure were inspected without a material release defect. |

## Release and safety

| Area | Result | Evidence |
| --- | --- | --- |
| Version | PASS | Version `4.0.1` is consistent across authoritative sources. |
| Security sanity | PASS | Security and bridge tests passed. Discovery excludes automatic network, removable, and optical-drive crawling, and bridge paths remain project-scoped. |
| Performance sanity | PASS | Cached/known launcher results arrived before broad discovery. The six-fixed-drive broad scan took about 21 seconds without blocking launcher usability. |
| Documentation | PASS | Current API contract and this acceptance record describe the canonical device API, explicit storefront membership, current launcher discovery, and live validation boundary. |
| Release artifact | PASS | Fresh 4.0.1 NSIS installer and portable ZIP passed `scripts/verify-release.ps1`, including extraction, x64, frontend, authentication, file IO, texture normalization, visible lifecycle, switching, and shutdown checks. The installer SHA-256 is `e654b4365c259251adb453f2a2e50d7b46ae5dc6caa5ad73fe03f6f82043ab8a`. |

## Final boundary

The only material live boundary remaining is editor placement of the generated device in UEM_Demo. The source is visible and compiles cleanly, but no device instance was available through the Content Browser placement workflow, preventing Details panel, placed assignment, and device-runtime Marketplace checks. This is not treated as proof that those behaviors work at runtime. No unrelated architecture change was made to work around that editor boundary.
