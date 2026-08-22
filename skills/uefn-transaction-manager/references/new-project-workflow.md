# Greenfield transaction workflow

1. Verify both MCP servers target the same project and inspect the current UTM snapshot.
2. Create entitlements, alternate offers, bundles, and storefront membership through UTM MCP. Let UTM allocate IDs and stable Verse keys.
3. Discover real Texture2D objects through Epic MCP. Adopt them with UTM `adopt_icon`; never invent paths or copy `.uasset` files.
4. Call `validate_catalog`, resolve errors, and use `save_catalog` with the current revision.
5. Call `describe_integration_contract`. Generate project-specific caller/device Verse outside the managed file using the returned symbols and examples.
6. Use Epic MCP to write and compile project Verse. Place/configure the managed device only for fields proven writable by the current Epic MCP.
7. Run the strongest safe session verification available. Do not perform a real purchase. Audit that the managed file remains manager-owned and gameplay logic remains external.

