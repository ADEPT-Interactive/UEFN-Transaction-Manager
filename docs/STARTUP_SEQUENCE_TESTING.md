# Startup and Python enablement acceptance

Tested on Windows with UEFN 42.40, using only disposable project copies. No Fortnite edit/play sessions were launched. The expected result is a verified exact-project connection once the project, Python runtime, and editor thread are ready. Disabled Python and blocking/loading states must withhold native readiness; UTM does not enable Python on the user's behalf.

| Sequence | Live result |
| --- | --- |
| UEFN already open with Python enabled, then UTM opens its project | Preview.1 packaged launch connected automatically; final preview.2 package acceptance repeats this sequence. |
| UEFN already open with local Python disabled, then UTM opens its project, then Tools → Enable Python | Updated UTM showed Python disabled and native operations unavailable. Enabling Python in the same editor process restored verified readiness without restarting or relinking UTM. |
| UTM project already open, then cold UEFN launch with Python enabled | UTM waited through loading, adopted the replacement editor PID, and connected automatically. |
| UTM already open, then cold UEFN launch with project-wide and local Python disabled, then Project Settings → Python Editor Scripting enabled | UTM stayed blocked while disabled. UEFN initialized Python and enabled it locally; UTM connected automatically in the same session. |
| Python disabled while connected, then enabled again | Native readiness was revoked immediately from the local preference, even before the last heartbeat aged out. Enabling Python reset attachment eligibility and recovered the connection. |
| Ducky listener unavailable and editor blocked by a file dialog beyond three initial attachment attempts | Native delivery refused the disabled owner. Attempts resumed after a 30-second cooldown. After the dialog was cancelled and the real Ducky listener returned, the next automatic batch attached and reached verified readiness. No manual Retry Connection or app restart was used. |

The local switch is separate from the `.uefnproject` flag. UTM now reads the matching project GUID entry in `EnablePythonLocallyPerProject` from UEFN's per-user settings and detects changes while running. Unknown or absent local preferences do not prove runtime readiness; the authenticated connector remains mandatory. A project-wide opt-out or an explicit matching per-user opt-out blocks attachment.

Each automatic attachment batch has three attempts, with a cooldown before another batch. Exact project/PID checks, disabled-owner and foreground checks, cancellation, and authentication still apply. Python eligibility changes, a new editor/project identity, manual retry, and a successful connection reset the relevant recovery state. Ducky is optional: earlier live acceptance also verified the native Python-input fallback without using Ducky attachment.

Evidence is retained locally in `temp/editor-transitions.jsonl`, the desktop bridge logs, and the sequence test logs. Source verification passed 315 TypeScript tests and 23 Python tests; targeted startup/discovery/server tests passed 53 cases. The project descriptor was restored to its original bytes, and the disposable project's original local Python preference was restored to enabled. Ducky's source and installed files were not modified.

This is acceptance of the listed sequences, not a promise about every future editor version or external failure. UTM waits while the project is loading, Python is disabled/unavailable, the editor is blocked, or identity cannot be verified. Those states must not appear as a successful connection.
