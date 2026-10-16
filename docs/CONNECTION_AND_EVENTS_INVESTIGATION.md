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

Follow-up clarification: "subscribable by default" describes built-in support, not the first possibility of subscriptions. Epic's [staff tutorial](https://dev.epicgames.com/community/learning/tutorials/woOK/fortnite-using-verse-fields-events-in-a-umg-user-widget) describes a custom callback adapter for current releases. The locally installed UI template snapshot uses `SubscribeToEvent` with a spawned await loop and a cancellation event. An equivalent concrete `tuple(player, int)` callback/cancellation helper compiled on 42.40 with zero diagnostics; the generic variant hit compiler limitation 3502. The probe was removed and the fixture recompiled cleanly. Named registration helpers are therefore a possible UTM UX enhancement **now**, while direct native `event.Subscribe` remains unavailable in this build. They would still use await tasks internally; no speedup or native `cancelable` compatibility is inferred from this probe. The 4.5.0-preview.1 generator now adds named, concrete subscription helpers with idempotent cancellation and device-end cleanup, alongside its existing await API. It does not extend event.Subscribe.

## Verification and limits

The production build, 277 TypeScript tests, 22 Python tests, and repository privacy check passed. Hidden Electron lifecycle checks passed for initialized and uninitialized catalogs, including ten project switches per run and owned-process shutdown. Those checks require clearing the T3 host's inherited `ELECTRON_RUN_AS_NODE=1` in the test shell; the initial attempt with that variable inherited exited before Electron startup.

UEFN's installed `Build.version` identifies Release-42.40; launcher inventory still reported 42.30. Computer Use was accidentally cancelled, and the owner resumed by opening the prepared disposable demo. Live work continued through Epic MCP and Ducky's listener. The responding editor reported the correct plugin Content root and world mount while `Paths.project_dir()` returned FortniteGame and `Paths.project_file_path` was unavailable. The separate host `.uproject` case remains synthetically tested, not observed in this build.

Live results:

- Ducky's real refresh/quarantine functions removed the old startup integration in the disposable copy. With the new connector running, a repeat refresh left only Ducky's init in project Python and UTM remained connected.
- The new focus-free attachment reached exact-project `connected` readiness. Wrong Content root, asset mount, and PID were rejected by the responding editor before UTM loading.
- Stopping the import bridge worker in the same desktop session caused readiness loss and automatic reattachment. Both worker threads were confirmed alive afterward. Restarting the test bridge also reconnected without reinstalling project Python.
- UTM regenerated its original disposable catalog after exact asset confirmation and revision-bound preflight. Epic MCP compiled the result with zero diagnostics.
- A UTM dry run and atomic patch expanded only the disposable fixture with two consumables, an alternate offer, static and dynamic bundles, and a storefront, preserving the original durable record. The freshly generated combined fixture compiled with zero diagnostics, including the updated Marketplace import.

The earlier checks above predate the follow-up implementation; see the current preview results below. Native 43.00 subscriptions and Marketplace/Fortnite-session behavior remain outside the verified scope.

Durable coexistence work is tracked in [UTM issue #15](https://github.com/ADEPT-Interactive/UEFN-Transaction-Manager/issues/15).

## 4.5.0-preview.1 follow-up

The working checkout was behind the published 4.4.1 source. Investigation changes were rebased onto current origin/main before the preview work, preserving the shipped duplicate, runtime price, public identity, and editor-state fixes. No Ducky source changes or contributions were made.

Real desktop tests found and fixed three additional regressions:

- UEFN retains the old mounted world and Slate ticks behind its Project Browser. The connector now detects the visible browser in its own Windows process and revokes native readiness. Opening the selector produced `project-browser-open`; cancelling it restored `verified` readiness without reconnecting or relinking. Queued texture jobs also check readiness at execution.
- The bridge originally pinned its launch-time UEFN PID forever. A real close/reopen produced authenticated 409 rejections from the replacement editor. Replacement now requires death of the pinned process, a completed exact-project open, and a matching Windows UEFN process image. Keeping the same UTM window open across a second real UEFN restart successfully adopted the new PID and recovered a verified Ducky-assisted handshake.
- The Electron renderer's long-lived catalog stream captured stale image state and erased alternate-offer previews after save/reload. The existing renderer acceptance reproduced this twice; preserving previews through a current-state reference made the same test pass.

The connection panel now has a trusted, argument-free desktop Retry Connection action, bounded retries, useful waiting guidance and expandable diagnostics. Exhaustion is reported once instead of every polling tick. UTM does not write to project init_unreal.py.

The callback API adds Subscribe<Stem>GrantedEvent, RemovedEvent, ReconciledEvent, and consumable-only ConsumedEvent, returning a device-prefixed UTM handle with Cancel(). Registration after device end is inactive; cancellation and end checks suppress later callbacks and stop the await tasks. Copyable Verse API examples use preserved published identities and runtime option signatures. An option-context mistake in the initial example was caught by actual UEFN compilation and corrected by binding the subscription before constructing its option. A preserved-identity static bundle reference also failed compilation; the primary bundle resolver now uses its published offer stem even when no explicit offerVerseKey is supplied.

Compiler verification temporarily replaced only the disposable fixture's managed source with a generated matrix and actual callback callers, then restored the original bytes in finally and recompiled. The final matrix produced zero diagnostics. Coverage includes durable/manual-use/auto-use consumables, preserved identity and numeric stems, restrictions, alternate/runtime-price offers, static/nested/fill-to-max/runtime-quantity bundles, all callback boundaries, repeated Cancel calls, post-end registration call sites, and copyable gameplay-device examples. Compiler acceptance is distinct from executing gameplay callbacks: no Fortnite session was launched.

A real in-process switch from the linked disposable UEM_Demo into a separate disposable UTM_Demo copy revoked exact-project activity and native import availability while retaining the linked catalog. The second editor was then closed and the linked fixture reopened for recovery checks. The originals in Documents were not edited.

The standalone fallback's original console-form command was observed raising SyntaxError when UEFN retained Python input mode. The second bounded attempt now uses a Python runpy expression; native delivery also checks the intended PID before activation and before each input phase, rejects wrong-PID windows, and searches duplicate captions for the correct process. A wrong-PID live probe returned false without sending input.

On the final live fallback probe, the UTM discovery monitor and import callbacks were deliberately stopped in the disposable editor. Calling the production native delivery function with the Python-form command and exact PID returned delivered=true. UEFN logged the runpy expression, started a fresh monitor, reattached the import bridge and restored verified readiness before the desktop's pending Ducky attachment was needed. The separate wrong-PID probe returned false. The fallback therefore has live Python-mode evidence; a separate Cmd-mode-only run remains unverified.

Clean-worktree verification exposed contention in the per-PID tasklist probe: parallel status requests could time out before a live PID was ever verified, producing a transient false closed state. Known process liveness now uses Node's native signal-zero API first, with tasklist retained for Windows access failures. A live UEFN probe completed in about 0.03 ms and a missing PID returned ESRCH. Running-state checks follow the adopted editor PID after restart. The same process-death, stale-heartbeat, exact-project and replacement-image guards remain covered by the server/lifecycle suites.

The current 42.40 input selector exposes Python and Python REPL. Automatic native attachment now prefers the live-verified Python form, retaining the console form as the second bounded compatibility attempt. Native delivery also refuses a disabled owner window (such as a blocking file picker) and rechecks foreground process ownership before text and submission. A final live call with these guards enabled still returned delivered=true in the expected editor.

The clean verification suite passed 313 TypeScript tests, 23 Python tests, initialized/uninitialized Electron switching and rollback checks, 20 distribution tests, and 7 portable updater tests. Targeted native tests also passed after the final input guards. The preview packaging scripts now use Electron Builder's prerelease channel metadata rather than expecting latest.yml, and the verifier accepts absolute artifact paths. Packaged verification passed real Electron renderer interactions, bridge authentication/CRUD/file IO, image normalization, architecture/checksum validation, and hidden switching/shutdown. A subsequent real packaged launch automatically connected to the disposable editor. Its Compile button exposed an old save timer clearing newer results; expiration now clears only the exact save notification that scheduled it.

## 4.5.0-preview.2 startup ordering

The requested opening-order matrix exposed a real distinction between project-wide Python enablement and the per-user Tools → Enable Python switch. The former preview ignored the local opt-out and exhausted three attachment attempts while the runtime was disabled. The bridge and launcher now read both settings dynamically. Automatic attempts resume after a cooldown, so a late runtime/listener or a previously blocked editor can recover without relinking or manual retry. Real cold starts, live local and project-wide enablement, and delayed Ducky recovery after exhausted attempts are recorded in [STARTUP_SEQUENCE_TESTING.md](STARTUP_SEQUENCE_TESTING.md).


## 4.5.0-preview.3 connection and API UI

Manual retry feedback previously belonged to the component lifetime, so an attachment-in-progress message survived editor close, Python changes, and other connection transitions. Feedback is now scoped to the connection state, bootstrap state, readiness reason, and editor PID. A request sequence also discards late async responses, and current feedback expires after six seconds. The collapsed connection bar uses one compact row; guidance, retry, and technical diagnostics are expandable. Diagnostics from a previous attempt are hidden in unrelated states such as UEFN closed.

The global Verse API action replaces Need Help. Entitlement cards also open Functions directly to their own item. The searchable reference separates functions, events, device wiring, and examples, with readable calls, inputs, return types, suspension markers, and copy feedback. It includes alternate offers, bundles, runtime price/quantity options, and storefronts, using preserved public identities. Device setup has its own view. The duplicate setup guide below the Verse preview starts collapsed. Consumable reward examples now listen to confirmed Consumed notifications for both manual-use and automatic-use items.

The real Electron renderer acceptance exercises item shortcuts, callback and await views, searching exact event names, empty search, actual Windows clipboard contents, and independent dialog scrolling at 1280×720 and 150% zoom. Connection acceptance controls only the disposable renderer's status response and exercises pending retry → UEFN closed → late response, visible busy feedback → Python disabled, and automatic notification expiry. The compact bar is checked below 52 CSS pixels while collapsed. Native Windows visual review confirmed the catalog, functions, and event views.

The updated generated matrix and copied callback examples were compiled in the disposable UEM_Demo project on UEFN 42.40. BuildAll returned zero diagnostics. The original managed source was restored in finally and also returned zero diagnostics. The source generator's runtime implementation is unchanged by this UI refresh. No Fortnite session was launched.


## 4.5.0-preview.4 desktop clipboard correction

Preview.3's new Copy buttons used navigator.clipboard directly, while the standalone host denies browser permission requests. The renderer acceptance had used a permissive BrowserWindow without the production preload, masking this failure. Copies now use a write-only preload/IPC action backed by Electron's native clipboard. The handler validates the existing trusted top-level sender and accepts only bounded strings; browser permissions remain denied, and clipboard reading is not exposed. The shared helper also serves generated Verse and Agent Integration, with the existing browser/DOM fallback retained for web and older hosts. Generated Verse only reports success after a completed write.

The renderer acceptance now loads the production preload, denies browser permissions, verifies that browser clipboard access raises NotAllowedError, and checks actual Windows clipboard contents after function, callback-example, and generated-source copying. Its reconnect fixture uses IPC rather than replacing the immutable preload object.
