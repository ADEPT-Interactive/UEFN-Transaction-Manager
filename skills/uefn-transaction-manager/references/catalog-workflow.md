# Ordinary catalog work

Use `catalog-edit` for new catalogs or routine UTM-owned edits. Importing an existing implementation is a migration instead. Inspect the live operation contract; older builds without `catalog-edit` need an update, not a fabricated partial-migration approval.

## Smallest complete edit

For “change the existing Access Pass price to 150 V-Bucks and save”:

1. `begin_activity` with `operation: catalog-edit`, `mode: read-only`; retain its discovery ID.
2. `get_project_context`, then `get_catalog_snapshot`. Confirm the intended project and uniquely identify the existing record. Read its stable ID, fields, dirty state, and revision. Clarify only genuine ambiguity.
3. `preflight_operation` with `operation: catalog-edit` and the canonical requested project. No Epic evidence or catalog-only approval is needed. Honor readiness blockers.
4. End discovery as success; begin a mutating activity with the same operation and returned `preflightToken`.
5. `update_entitlement` with the existing `entitlementId`, `data: {priceVBucks: 150}`, and `expectedRevision`, `preflightToken`, `activityId`. Unmentioned fields remain intact. Use the returned `snapshot.revision` next.
6. `validate_catalog`; resolve relevant errors. `save_catalog` with the latest revision, token, and activity.
7. Reread the snapshot. Confirm the same ID, requested price, preserved unrelated fields, `dirty: false`, and equal `revision`/`savedRevision`. End the mutating activity as success. Report catalog persistence, without claiming compilation or gameplay testing.

Keep these calls on the same initialized MCP connection; tokens and activities are connection-owned. Never guess IDs or tokens. Use the live tool schema for exact arguments.

## Record fields

- `create_entitlement` data includes `name`, `shortDescription`, `description`, `priceVBucks`, `itemType`, `maxCount`, `autoConsume`, `flags`, and `triggers`. Durable: `itemType: durable`, `maxCount: 1`, `autoConsume: false`. Inventory consumable: deliberate cap and `autoConsume: false`. Immediate-use consumable: `autoConsume: true`.
- `create_alternate_offer` uses the parent entitlement ID. Another offer purchases the same ownership/inventory.
- `create_bundle` entries reference returned entitlement/bundle IDs with deliberate quantities. Inspect dynamic/nested-entry validation before using them.
- `create_storefront` and `set_storefront_membership` select concrete primary, alternate, and bundle offers; a storefront is not one bundled purchase.

Let UTM allocate IDs and Verse keys. Inspect returned defaults and validation. Prices are V-Bucks; quantities are transaction inventory counts. Derive commercial flags, restrictions, and auto-use semantics from the request or confirmed source. Do not invent an icon expression to bypass first-run provisioning.

For related atomic edits, use `apply_catalog_patch` with explicit stable operation IDs and `dryRun: true` first. Dry-run allocations are previews, not committed records. Commit with `dryRun: false` explicitly; its default is true. Inspect committed results before referencing them. `migration.mode: new-catalog` describes ordinary UTM-owned edits and does not authorize legacy/public identity adoption.

## Persistence and concurrency

The UI and MCP share a draft, including unsaved UI changes. `get_catalog_snapshot` is authoritative; an older generated file or cached agent plan is not. Never hand-edit managed Verse to persist a catalog change.

A token advances with successful own writes; use their returned revisions. Concurrent changes, expired leases, reconnects, or project/session transitions require a fresh snapshot/preflight and reconciliation. Heartbeat keeps the activity alive, not an idle token. End old activities rather than leaving discovery or failed work active.

Initialized catalogs with confirmed icons need no Epic MCP/open editor for catalog-only edits. First-run readiness, managed-file ownership, native asset confirmation, validation, and file-hash compare-and-swap still apply. Save is distinct from compile or wiring. Use the integration contract if external callers are also requested.
