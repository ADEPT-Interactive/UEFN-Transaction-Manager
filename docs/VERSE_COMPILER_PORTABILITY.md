# Verse Compiler Portability

Phase 23 replaces the UEM compiler client's fixed production endpoint with a reusable local-session discovery layer.

## Contract

The client communicates with the local UEFN Verse Workflow Server using the protocol exposed by Epic's installed Verse VS Code integration:

- TCP on loopback only.
- LSP-style `Content-Length` framing.
- JSON request `{ "seq": 1, "type": 1, "command": "compileProject", "params": {} }`.
- A final response with `type: 2`, `command: "compileProject"`, and numeric `result.numErrors` is required.
- `numErrors: 0` is the only clean-compile result. Warnings and compiler messages remain visible.

The client does not bind a port, expose a LAN address, launch VS Code, or accept remote endpoints. A successful TCP connection is not treated as a successful Verse compile.

## Original endpoint audit

| Location | Occurrence | Classification | Phase 23 disposition |
| --- | --- | --- | --- |
| `server/workflowClient.ts` | `127.0.0.1` and `1962` defaults | Production compiler implementation | Moved to `server/verseCompiler.ts`; no fixed default remains |
| `tests/workflowClient.test.ts` | Default `127.0.0.1:1962` expectation and alternate environment port | Test fixture | Replaced with override, discovery, protocol, and alternate-port tests |
| `tests/server-security.test.ts` | Workflow port override and error assertion | Test fixture | Remains a local-only override fixture and now exercises the new result shape |
| `docs/PHASE21_FINAL_REPORT.md` | `127.0.0.1:1962` | Historical acceptance evidence | Retained as historical evidence; not an implementation contract |
| `docs/UEFN_ACCEPTANCE_CHECKLIST.md` | `127.0.0.1:1962` | Historical acceptance evidence | Retained as historical evidence; Phase 23 documents discovery instead |
| `.codex compile-verse` helper | `127.0.0.1:1962` | Agent-skill production helper | Updated to discover UEFN-owned listeners; 1962 is only a narrow compatibility fallback |
| `server/index.ts` and `electron/bridgeSession.ts` | `127.0.0.1` and dynamic bridge port | UEM local bridge | Unchanged. This is the UEM renderer-to-server bridge, not the Verse compiler endpoint |
| `electron/security.ts` | `localhost` and `127.0.0.1` | Electron local-origin allowlist | Unchanged security boundary for the UEM bridge |
| `scripts/verify-release.ps1` | Dynamic local bridge URL | Release test fixture | Unchanged and unrelated to Verse Workflow Server discovery |
| `vite.config.ts` | `http://localhost:3001` | Development proxy | Unchanged and unrelated to Verse compilation |
| Other web URLs | `http://` and `https://` references | Documentation, OAuth, GitHub, or web application URLs | Not compiler endpoints |

No compiler endpoint was found in generated Verse, Python helpers, Electron packaging configuration, or hidden repository directories beyond the entries above.

## Epic integration audit

The installed extension is `epicgames.verse`, display name `Verse`, version `0.0.56430492`. UEFN supplied `Verse.vsix`, and VS Code activated the extension from the normal user extension directory. The related `epicgames.urc-vscode` extension is separate and is not the Verse Workflow Server client.

The Verse manifest contributed these commands:

- `verseWorkflow.connect`
- `verseWorkflow.disconnect`
- `verseWorkflow.compile`
- compile loading, warning, error, and success states
- `verseWorkflow.pushVerseChanges`

Relevant settings were `verse.serverPath`, `verse.serverArguments`, `verse.syncFileEvents`, `verse.trace`, and `verse.useRelease`. The extension also starts `verse-lsp.exe` for language services. That language server is separate from the Workflow Server compile socket.

The extension's workflow client uses the same raw TCP, Content-Length-framed JSON protocol as UEM. Its observed defaults are `127.0.0.1` and `1962`. No dynamic port setting, project/session identifier, or project-specific discovery artifact was present in the manifest or workflow client. The editor command line exposed a named pipe and normal editor arguments, but no compiler port. This makes process-owned listener discovery the least invasive interoperable mechanism available locally.

## Local observations

With UEFN closed, no relevant UEFN-owned listener was present. After UEFN opened `UEM_Demo`, the UEFN process owned loopback listeners on `1962`, `1963`, and `23430`. The listener at `1962` returned the expected Workflow Server notifications and final compile response. The other listeners were not assumed to be compiler endpoints. The compiler listener was loopback-only, not a LAN bind.

The active project was observable from the UEFN log's latest `Successfully opened project` record. The process command line did not contain a compiler port. Targeted UEFN configuration searches did not find a project-specific compiler endpoint artifact. This explains why the implementation combines:

1. active UEFN process enumeration;
2. process-owned loopback listener enumeration;
3. active project log matching;
4. protocol validation through the real compile request.

The implementation does not scan all 65,535 ports. It only considers loopback listeners owned by the selected UEFN process and, when no listener is visible, performs the historically justified `1962` compatibility probe.

In the live multi-instance probe, a second UEFN process was started for `Asset_Sandbox`. Its process command line exposed that project's descriptor even while the global log still named UEM_Demo. The second process temporarily exposed a different listener set while the original process retained `1962`. Discovery selected the process with the matching descriptor and the new session compiled cleanly. A UEM_Demo request without a process match returned `multiple-sessions-ambiguous`; supplying the authoritative UEFN PID selected the correct session. This is the intended fail-closed behavior when project-to-process evidence is incomplete.

## Session model and selection

`VerseCompilerSession` contains only the fields needed by the consumers: host, port, UEFN process ID when known, project path when known, transport, discovery source, and discovery time.

Selection precedence is:

1. `UEM_VERSE_COMPILER_ENDPOINT`, validated as loopback `host:port`, for tests and advanced local diagnostics;
2. process-owned loopback listeners for the selected UEFN process, with the known Epic port ordered first;
3. a narrow `127.0.0.1:1962` compatibility candidate only when UEFN is running but exposes no enumerated listener;
4. a structured unavailable or ambiguous result.

The UEM bridge supplies the selected UEFN process ID and project path. A caller can also supply a project path directly. Paths are compared case-insensitively after slash normalization, so spaces, apostrophes, Unicode, and non-C drives are supported. If multiple UEFN processes exist without an authoritative process-to-project match, discovery fails closed with `multiple-sessions-ambiguous`.

Discovery states include `uefn-not-running`, `project-not-loaded`, `project-mismatch`, `compiler-not-initialized`, `multiple-sessions-ambiguous`, and `compile-request-failed`. A final compiler response is `compiled`, with `success` determined from `numErrors`.

## Skill and CLI

The reusable core is `server/verseCompiler.ts`. `server/workflowClient.ts` is a compatibility facade for existing UEM imports. The UEM route supplies its verified project and selected UEFN process to the core. `scripts/verse-compiler-cli.ts` provides:

```text
npm run verse-compile -- discover --json
npm run verse-compile -- status --project <path>
npm run verse-compile -- compile --project <path> --process-id <pid> --json
```

The external `compile-verse` skill now uses the same discovery rules in its bundled PowerShell helper. It remains independent of UEM and VS Code. It has no repository-relative path or developer-specific installation assumption.

## Packaging and security

Phase 23 does not change Electron's `asar: false` packaging decision. The compiler core uses no new unpacked runtime path. It runs in the local server/CLI context and does not accept arbitrary renderer URLs. Endpoint overrides are loopback-only. No Epic binary, extension source, token, cookie, or captured secret is included in the repository.

## Validation status

Automated mocked tests cover no UEFN, endpoint validation, process-owned listener selection, project mismatch, ambiguity, path normalization, alternate ports, warnings and errors, malformed protocol responses, and clean results. Live UEM_Demo compilation through the new discovery core returned `numErrors: 0`. Five clean UEFN restart runs returned the same observed local listener port with a new process ID each time. The VS Code processes were closed and UEM_Demo compiled cleanly, proving VS Code is not a runtime dependency. The installed 4.0.0 Phase 23 candidate also completed Save & Compile, with UEFN logging a clean build.

The available non-C project inventory did not contain a safe project that could be opened without expanding the test scope, so non-C live compilation is `NOT TESTED`. Unit path fixtures cover non-C drives, spaces, Unicode, apostrophes, and separator/case normalization. The official VS Code window available during the investigation was in Restricted Mode and did not expose the Verse Workflow command, so an official VS Code compile was not treated as a successful acceptance result.

The future repository should use a neutral name such as `uefn-verse-compiler`. It should state that it is an independent interoperability client for locally installed UEFN tooling, is not an Epic Games product, and does not redistribute Epic binaries or source. Publication, package release, and the standalone repository belong to Phase 24.
