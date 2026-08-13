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

UEFN Entitlement Manager is a local, project-scoped tool. Its bridge listens only on loopback, requires ephemeral session credentials, validates project paths and asset identifiers, and restricts uploads to verified PNG input. The packaged application does not require public inbound network access.

UEFN, the local Verse Workflow Server, project-specific Verse, imported assets, and Epic's publishing systems remain outside UEM's validation boundary. A successful local check or compile is not proof of gameplay correctness, moderation approval, or marketplace compliance.

## Supported versions

Security fixes are provided for the latest published release. Reproduce reports against that version whenever possible.
