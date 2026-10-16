# Connection, startup coexistence, and Verse events investigation

Investigation date: 2026-10-16. Changes are local source changes, not a published release.

## Shared Python startup ownership

Ducky source at commit [`76880bb8d68e4835b874e79d0dea8b5af99d57d7`](https://github.com/UEFN-Ducky/UEFN-Ducky/blob/76880bb8d68e4835b874e79d0dea8b5af99d57d7/ducky_app/frontend/deploy.py) confirms that `ensure_project_init` replaces the complete island `Content/Python/init_unreal.py`. `deploy_listener` then runs `quarantine_project_python`, which moves other island Python files into Ducky's quarantine. UTM's previous installation appended a managed block and copied `uefn_auto_connector.py` beside it. Both parts were subject to removal by Ducky.

Reproduction used a disposable copy of an existing test island, the unmodified Ducky source, and a quarantine destination redirected inside the disposable fixture. Calling Ducky's actual `ensure_project_init` replaced the UTM bootstrap. Calling its actual `quarantine_project_python` moved the UTM module away. Only Ducky's `init_unreal.py` remained in `Content/Python`. No Ducky source, installation, or repository was modified.

UTM now loads its application-owned `uefn_auto_connector.py` by absolute path and uses the existing authenticated project handshake. Project linking no longer writes any Python startup file or Python module. This also avoids competing with other startup-file writers. Existing legacy startup files are preserved; the new path does not depend on them and does not automatically delete somebody else's shared startup content.

When Ducky's existing listener is available, UTM can attach through its in-memory Python command without changing foreground focus. Listener health is capability evidence only: the script validates the actual editor PID, mounted project name, and canonical plugin Content root before loading UTM code. Busy or stale listeners, mismatched identities, errors, and cancellation are rejected. This is optional; UTM retains its console fallback and manual Execute Python Script path.

The console fallback follows Epic's documented [Python script execution](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python): `py "<UTM installation>/uefn_auto_connector.py"`. During live testing, Windows refused foreground activation, so this route did not deliver its command. The new Ducky route attached successfully in that same editor and established a verified UTM handshake. Standalone console delivery without Ducky remains an unverified acceptance case. The compatibility status field `autoConnectorInstalled` now indicates that the application connector script is available; it is not evidence of a project startup-file installation or a connected editor.

## Connection tracking fixes

- Successful connection clears the consumed bootstrap retry budget. A later disconnect in the same project and PID receives another bounded recovery attempt sequence.
- Discovery checks the import and heartbeat workers, not just the last session signature. A worker stopped by repeated bridge errors can be reattached to the same desktop session.
- The monitor records its runtime generation so a new connector can replace a legacy in-memory discovery worker. Repeated launches of the current monitor remain idempotent.
- Readiness can validate a mounted island when Unreal's host path is a `.uproject`. It requires the exact plugin Content root and editor-world mount; another `.uefnproject`, Content root, or world remains blocked. This host-path case has synthetic coverage; it was not observed inside the live editor during this run.
- An independent network heartbeat cannot keep a frozen readiness assertion alive indefinitely. If editor ticks stop for more than eight seconds, subsequent reports revoke readiness with `editor-tick-stale`, while preserving connector liveness as a separate fact.
- Bootstrap status and its message now follow connection recovery and loss together. A verified connection cannot keep showing the previous waiting/failure message, and a lost connection cannot retain `bootstrapState: connected`.

## Verse event compatibility and opportunities

Epic's [42.40 release notes](https://dev.epicgames.com/documentation/fortnite/42-40-fortnite-ecosystem-updates-and-release-notes) announce native subscribable `event(t)` for **43.00**, with `Subscribe` returning `cancelable`. Existing user-defined `Subscribe` extensions can conflict with the new API.

UTM emits private native backing events with public suspending `Await…Event()` methods. It emits no `Subscribe` extension or custom subscribable implementation, so the announced overload conflict does not apply to generated UTM code. There is no compiler-proven 43.00 result in this investigation. Existing project-owned code may still contain extensions and needs its own upgrade check.

An isolated 42.40 compiler probe rejected `event.Subscribe` with error 3506 and an `event`-to-`listenable` return with error 3510. The probe was removed and the project recompiled. An additive receive-only native subscription facade could simplify ownership-driven UI and gameplay listeners once the new compiler is available. Keep the existing await API; keep `Signal` private; retain cancellation and initial-state reconciliation; preserve grant, removal, reconciliation, and consume-success semantics. No performance gain is claimed without measurement. See [the public API contract](GENERATED_PUBLIC_API_CONTRACT.md#upcoming-native-subscriptions-4300) for the planned constraints. Native subscriptions are not enabled in the generator.

Compiler warnings exposed the Marketplace namespace migration documented in Epic's [42.20 notes](https://dev.epicgames.com/documentation/fortnite/42-20-fortnite-ecosystem-updates-and-release-notes). The generator and integration contract now import `/UnrealEngine.com/Marketplace`. Fresh generation requires UEFN 42.20 or newer. Public UTM identities and transaction boundaries are unchanged.

Follow-up clarification: "subscribable by default" describes built-in support, not the first possibility of subscriptions. Epic's [staff tutorial](https://dev.epicgames.com/community/learning/tutorials/woOK/fortnite-using-verse-fields-events-in-a-umg-user-widget) describes a custom callback adapter for current releases. The locally installed UI template snapshot uses `SubscribeToEvent` with a spawned await loop and a cancellation event. An equivalent concrete `tuple(player, int)` callback/cancellation helper compiled on 42.40 with zero diagnostics; the generic variant hit compiler limitation 3502. The probe was removed and the fixture recompiled cleanly. Named registration helpers are therefore a possible UTM UX enhancement **now**, while direct native `event.Subscribe` remains unavailable in this build. They would still use await tasks internally; no speedup or native `cancelable` compatibility is inferred from this probe. These helper APIs have not been added to the generator.

## Verification and limits

The production build, 277 TypeScript tests, 22 Python tests, and repository privacy check passed. Hidden Electron lifecycle checks passed for initialized and uninitialized catalogs, including ten project switches per run and owned-process shutdown. Those checks require clearing the T3 host's inherited `ELECTRON_RUN_AS_NODE=1` in the test shell; the initial attempt with that variable inherited exited before Electron startup.

UEFN's installed `Build.version` identifies Release-42.40; launcher inventory still reported 42.30. Computer Use was accidentally cancelled, and the owner resumed by opening the prepared disposable demo. Live work continued through Epic MCP and Ducky's listener. The responding editor reported the correct plugin Content root and world mount while `Paths.project_dir()` returned FortniteGame and `Paths.project_file_path` was unavailable. The separate host `.uproject` case remains synthetically tested, not observed in this build.

Live results:

- Ducky's real refresh/quarantine functions removed the old startup integration in the disposable copy. With the new connector running, a repeat refresh left only Ducky's init in project Python and UTM remained connected.
- The new focus-free attachment reached exact-project `connected` readiness. Wrong Content root, asset mount, and PID were rejected by the responding editor before UTM loading.
- Stopping the import bridge worker in the same desktop session caused readiness loss and automatic reattachment. Both worker threads were confirmed alive afterward. Restarting the test bridge also reconnected without reinstalling project Python.
- UTM regenerated its original disposable catalog after exact asset confirmation and revision-bound preflight. Epic MCP compiled the result with zero diagnostics.
- A UTM dry run and atomic patch expanded only the disposable fixture with two consumables, an alternate offer, static and dynamic bundles, and a storefront, preserving the original durable record. The freshly generated combined fixture compiled with zero diagnostics, including the updated Marketplace import.

Remaining limits: an actual UEFN project close/reopen or switch was not exercised after GUI cancellation; independent console fallback delivery without Ducky and native 43.00 subscriptions remain unverified. Automated Electron project switching and synthetic project/browser transitions are separate evidence. No Marketplace purchase or Fortnite session acceptance is claimed.

Durable coexistence work is tracked in [UTM issue #15](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/issues/15).
