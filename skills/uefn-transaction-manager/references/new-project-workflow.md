# Greenfield transaction workflow

1. Verify both MCP servers target the same project and inspect the current UTM snapshot.
2. If the managed Verse file is absent, stop until the exact project is open in UEFN, the authenticated editor bridge is fresh, and Python Editor Scripting is enabled. The first mutation must provision UTM's native placeholder and confirm its exact object path before the catalog can be persisted.
3. Create entitlements, alternate offers, bundles, and storefront membership through UTM MCP. Let UTM allocate IDs and stable Verse keys.
4. Discover real Texture2D objects through Epic MCP. Adopt them with UTM `adopt_icon`; never invent paths or copy `.uasset` files.
5. Call `validate_catalog`, resolve errors, and use `save_catalog` with the current revision. Save is blocked if any primary, alternate, or bundle icon cannot be resolved to a confirmed project asset.
6. Call `describe_integration_contract`. Generate project-specific caller/device Verse outside the managed file using the returned symbols and examples.
7. Use Epic MCP to write and compile project Verse. Place/configure the managed device only for fields proven writable by the current Epic MCP.
8. Run the strongest safe session verification available. Do not perform a real purchase. Audit that the managed file remains manager-owned and gameplay logic remains external.
