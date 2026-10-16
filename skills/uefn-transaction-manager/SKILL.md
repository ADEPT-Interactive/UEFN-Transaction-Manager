---
name: uefn-transaction-manager
description: Create, edit, migrate, and integrate UEFN transaction catalogs through UTM MCP; use Epic Unreal MCP when the task also needs assets, external Verse, devices, or compilation.
metadata:
  short-description: Project-scoped UTM catalog and Verse workflows
---

# UEFN Transaction Manager

UTM is a desktop catalog editor with a project-scoped MCP server. An agent and the UI edit the **same draft**. UTM owns transaction declarations and generated Marketplace plumbing. Project-authored Verse owns gameplay, eligibility, calculations, UI, and persistent state. UEFN Ducky is optional; it is not the UTM catalog owner or a requirement for catalog MCP access.

- An **entitlement** is owned inventory or durable access. An **offer** is a purchase path; alternate offers share the underlying entitlement. A **bundle** purchases multiple entries. A **storefront** displays concrete offers; membership is not ownership.
- UTM allocates new stable IDs and `verseKey` values. Use returned IDs. Renaming a display label does not authorize changing published Verse identity.
- Catalog tools change the draft. `save_catalog` validates, generates, and persists the managed Verse file. It **does not compile** or wire devices.
- `describe_integration_contract` supplies exact public names, types, events, runtime options, examples, and editable arrays. Never derive symbols from display names.
- Never hand-edit the managed file named by `get_project_context`. Keep gameplay in separate Verse. UTM cannot read arbitrary files or edit `.uasset` binaries.

## First connection

Open the intended project in UTM and keep its window running. The **Agent** panel installs/updates this skill and prepares the current MCP entry. Installing the skill does not configure or activate an MCP connection. Add/replace only the UTM client entry, then reload the client when required. Use that project's displayed URL; `http://127.0.0.1:8001/mcp` is only the default. Local loopback Streamable HTTP needs no credential/header; private UI/editor tokens are never needed by an agent.

Discover live tools and call `describe_operation_contract` for this build's manifests. On older builds, inspect the live `preflight_operation` enum; never send unsupported operations. See [agent-setup.md](references/agent-setup.md) for setup and reload details. A listener or another client's connection does not prove this agent session has UTM tools. Do not open localhost in a browser or substitute desktop automation for catalog MCP calls.

## Choose scope

| Request | Preflight operation | Epic Unreal MCP |
| --- | --- | --- |
| Read catalog, validation, or contract | `inspect-only` | Not required |
| Create/edit ordinary UTM records and save | `catalog-edit` | Not required |
| Explicitly requested partial catalog migration | `catalog-only-migration`, `mode: catalog-only` | Not required |
| Full existing-project migration | `full-existing-project-migration` | Required |
| Adopt Texture2D icons | `native-icon-adoption` | Asset discovery and project identity |
| Place/assign devices | `managed-device-wiring` | Supported device operations |
| Write external callers | `verse-integration` | Verse writing and compilation |
| Compile | `compile-validation` | Compilation |
| Inspect an authorized session | `live-session-inspection` | Session/log capabilities |

For UTM-only work, compare the intended target with UTM's canonical identity and omit unrelated `externalReadiness`. **Do not require both servers for catalog edits or catalog-only migration.** Initialized catalogs with confirmed assets can be edited/saved while UEFN is closed. First-run catalogs or missing assets still require the exact ready project, Python enabled in both Project Settings and Tools → Enable Python, and confirmed native asset provisioning. Narrow scope does not bypass these checks.

For cross-server work, inspect relevant Epic schemas, obtain its strongest project/editor context, and compare canonical project file/root, Content root, mount, and name with UTM. Capability availability is not project readiness: ports, retained heartbeats, and the project browser are insufficient. Supply actual agent-reported external evidence to preflight. Read [tool-discovery.md](references/tool-discovery.md).

A full migration must never silently downgrade to catalog-only. If the user already explicitly requested/approved partial catalog work, record that actual instruction in `approval.confirmation`; do not ask again or invent consent. Otherwise obtain the scope decision before requesting the partial operation. Report catalog-only migration as partial; integration and runtime acceptance remain unproven. Confirmed parity and published identity preservation still apply.

## Operation lifecycle

`DISCOVER -> PREFLIGHT -> USER BLOCKER/APPROVAL IF NEEDED -> ACTIVITY TRANSITION -> MUTATE -> VERIFY -> COMPLETE`

1. Choose scope; `begin_activity` with that operation and `mode: read-only`. Call `get_project_context` and `get_catalog_snapshot`. Inspect any dirty draft and preserve unrelated UI work. Retain its opaque `revision`.
2. Call `preflight_operation` with the operation and canonical `requestedProject`, supplying external evidence only when required. If blocked, make no changes, end the activity as failed, and report the actual blocker. Settle approval/scope changes before that new operation's preflight.
3. UTM mutations require `ready: true` and `preflightToken`. End discovery as success, then start **one new** mutating activity with the same operation/token. Retain its `activityId`.
4. Every UTM write carries `preflightToken`, `activityId`, and the latest `expectedRevision`. Successful own writes return `snapshot.revision` and advance the lease; use that returned revision on the next call. Do not restart preflight just because your own acknowledged write advanced it. Dry runs change nothing and need the current revision, but no mutation token/activity.
5. Heartbeat before the activity's returned `expiresAt` and update its user-safe phase. Activity heartbeat does not extend the separate idle preflight lease. For operations that only change state through Epic, keep UTM activity read-only: those preflights issue no UTM mutation token.
6. Validate, save catalog changes, and reread the snapshot. Confirm `dirty: false`, `revision == savedRevision`, and the saved file/hash. Distinguish saved, compiled, wired, structurally verified, and live-tested evidence. Run external checks within the requested scope.
7. End **each** activity exactly once as success, failed, or cancelled. On `CATALOG_REVISION_CONFLICT`, `MANAGED_FILE_CHANGED`, stale lease, reconnect, or project/session transition: refresh context/snapshot, end the old activity, re-preflight, and reconcile only the intended change. Never overwrite a newer draft or unmanaged file, or replay uncertain creations.

Read [catalog-workflow.md](references/catalog-workflow.md) for the smallest complete edit and record fields, or [new-project-workflow.md](references/new-project-workflow.md) for an empty project.

## Existing-project migration

Read [existing-project-adoption.md](references/existing-project-adoption.md). Inventory source evidence, preserve unmatched UTM records, and build a confirmed source-to-proposed semantic parity table. Call `validate_migration_parity`, then dry-run `apply_catalog_patch` with `migration.mode: existing-project`, that same table, and captured module configuration. Use `adopt_existing_identity` for published names; generic creation/update rejects `verseKey`/`publicIdentity` hints. `catalog-edit` cannot authorize an existing-project migration patch. Stop when ambiguity could change commercial or gameplay semantics.

### Gameplay lifecycle

**Reconciliation establishes initial truth. Generated delta events keep current truth current.**

For a gameplay-affecting durable with mirrored state, initialize ownership from reconciliation/authoritative `Has` or `GetCount`, then maintain a persistent `Granted` listener so same-session durable acquisition updates that state without reconnecting. A join-only flag is incomplete integration. Handle supported `Removed` notifications when relevant. An authoritative ad-hoc query without a mirror needs no needless listener; record that exception in migration parity.

Use the contract's callback API or a persistent listener loop for `Await<Stem>GrantedEvent()`. Callbacks do not replay prior events, must not suspend, and return UTM handles with `Cancel()`. Register early, query current ownership when attaching late, and cancel when the listener ends. `Await<Stem>ReconciledEvent()` establishes initial state. `Await<Stem>RemovedEvent()` is not proof of explicit use. Consumable effects follow `Await<Stem>ConsumedEvent()` or its callback, for manual-use and auto-use items. Use the generated Consume wrapper to retain intent correlation.

Read [transaction-semantics.md](references/transaction-semantics.md) and [verification.md](references/verification.md) for complete lifecycle/evidence rules. The real purchase boundary is owner-only: do not automate purchases or call synthetic evidence live acceptance. Do not start Fortnite/session flows unless requested.

## References and recovery

- [dynamic-transactions.md](references/dynamic-transactions.md): runtime price/quantity, fill-to-max, external calculations.
- [asset-adoption.md](references/asset-adoption.md): exact Texture2D discovery and controlled icon adoption.
- [verification.md](references/verification.md): compilation, structural integration, manual UEFN wiring, and owner acceptance. Generation does not prove device assignment; use live-supported representations.
- UTM missing: diagnose endpoint/configuration/reload. Epic missing: continue only already-authorized UTM-only work; never claim external verification.
- Python disabled, wrong project, browser/loading state: restore required readiness, then refresh preflight. Preserve catalog/files while native prerequisites are absent.
- Validation/compile failure: inspect structured diagnostics and the generated contract. Keep gameplay external and unresolved evidence explicit.
