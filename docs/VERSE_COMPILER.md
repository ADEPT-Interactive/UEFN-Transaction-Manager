# Verse compiler

UEFN Transaction Manager compiles generated Verse through the local UEFN Verse Workflow Server. The compiler client is an interoperability layer for an installed UEFN editor; it does not launch VS Code, expose a remote service, or replace project gameplay code.

## Transport contract

The client uses the local Workflow Server protocol:

- TCP on loopback only.
- LSP-style `Content-Length` framing.
- A `compileProject` JSON request with an empty parameter object.
- A final response with `type: 2`, `command: "compileProject"`, and numeric `result.numErrors`.
- `numErrors: 0` is the only clean-compile result. Warnings and compiler messages remain available to callers.

A successful TCP connection is not treated as a successful compile. The client validates the framed response and reports transport, protocol, compiler, warning, and error outcomes separately.

## Session discovery

The compiler core selects a local session in this order:

1. `UEM_VERSE_COMPILER_ENDPOINT`, when it is a valid loopback `host:port` override for tests or advanced local diagnostics.
2. Loopback listeners owned by the selected UEFN process, with the known Epic port ordered first.
3. A narrow `127.0.0.1:1962` compatibility candidate only when UEFN is running but no owned listener is enumerable.
4. A structured unavailable or ambiguous result.

The UEM bridge supplies the authoritative UEFN process ID and project path when available. Callers may also provide a project path or preferred process ID. Project paths are compared case-insensitively after slash normalization, including paths with spaces, apostrophes, Unicode, and non-C drives.

The implementation considers only loopback listeners owned by the selected UEFN process. It does not scan all ports or accept an arbitrary network endpoint. If multiple UEFN processes cannot be matched authoritatively to the requested project, discovery fails closed with `multiple-sessions-ambiguous`.

Discovery reports structured states including `uefn-not-running`, `project-not-loaded`, `project-mismatch`, `compiler-not-initialized`, `multiple-sessions-ambiguous`, and `compile-request-failed`. A completed compiler response is reported as `compiled`, with success determined by `numErrors`.

## Implementation surfaces

- `server/verseCompiler.ts` contains session discovery, endpoint validation, protocol transport, diagnostic normalization, and compile result handling.
- `server/workflowClient.ts` remains a compatibility facade for existing UTM imports.
- `scripts/verse-compiler-cli.ts` exposes the local CLI:

  ```text
  npm run verse-compile -- discover --json
  npm run verse-compile -- status --project <path>
  npm run verse-compile -- compile --project <path> --process-id <pid> --json
  ```

- The packaged `compile-verse` skill uses the same discovery and fail-closed selection rules through its independent local helper.

The UEM renderer-to-server bridge is a separate local transport. Its dynamic port and security allowlist must not be confused with the UEFN Workflow Server compiler session.

## Security boundary

The compiler client connects to loopback only. It does not bind a port, expose a LAN address, accept renderer URLs, launch arbitrary processes, or accept remote compiler endpoints. Endpoint overrides are validated before use. No Epic binaries, extension sources, tokens, cookies, or captured secrets are stored in the repository.

## Verification boundary

Automated coverage exercises endpoint validation, process-owned listener selection, project matching, ambiguity, path normalization, alternate ports, warnings, errors, malformed protocol responses, and clean results. A clean generated-Verse compile proves compiler compatibility only; it does not prove gameplay behavior, Marketplace approval, placed-device wiring, live purchases, grants, consumption, saved state, or rejoin behavior. Those boundaries require the appropriate real UEFN acceptance checks.
