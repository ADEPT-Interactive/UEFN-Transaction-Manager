# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability.

Send a private report through the contact channel at [adeptinteractive.net](https://adeptinteractive.net) with:

- the affected version;
- a concise description of the issue and its impact;
- reproducible steps or a minimal proof of concept;
- relevant logs with project paths, account data, and tokens removed; and
- any suggested remediation, if available.

ADEPT Interactive will acknowledge a complete report as soon as practical, investigate it, and coordinate disclosure when a fix is ready. Please avoid accessing data that is not yours, disrupting services, or publishing exploit details before remediation.

## Trust boundary

UEFN Transaction Manager is a local, project-scoped tool. Its UI/editor bridge listens only on loopback, requires its internal session credentials, validates project paths and asset identifiers, and restricts uploads to verified PNG input. The packaged application does not require public inbound network access.

UTM MCP is a separate local project bridge connection. It binds explicitly to `127.0.0.1`, accepts only the exact `127.0.0.1:<port>` or `localhost:<port>` Host values, and rejects foreign Origins. Its constrained tools still require same-project identity, expected catalog revisions, validated catalog data, verified managed assets, and first-run readiness. UTM MCP has no LAN, remote, or public endpoint.

The internal UTM UI/editor bridge remains separately authenticated with `UEM_SESSION_TOKEN` and `UEM_EDITOR_TOKEN` where applicable. Those credentials protect UI and editor operations; they are not client requirements for the local UTM MCP connection.

The Verse compiler client is also local-only. It discovers listeners owned by the active UEFN process, matches the selected project where possible, rejects ambiguous sessions, and does not accept LAN or arbitrary remote endpoint overrides. `UEM_VERSE_COMPILER_ENDPOINT` is a loopback-only development and test override.

UEFN, the local Verse Workflow Server, project-specific Verse, imported assets, and Epic's publishing systems remain outside Transaction Manager's validation boundary. A successful local check or compile is not proof of gameplay correctness, moderation approval, or marketplace compliance.

## Supported versions

Security fixes are provided for the latest published release. Reproduce reports against that version whenever possible.
