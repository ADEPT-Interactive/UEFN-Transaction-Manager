# Icon files and Texture2D adoption

## Newly generated artwork

Keep original artwork in a temporary/artwork directory outside the project's mounted Content folders. UTM's PNG file importer normalizes the image before native import and stages it outside the project; it does not require a separate source Texture2D.

UTM MCP `adopt_icon` accepts an existing Unreal object path, not an image file. When using that route for new artwork, prepare the normalized RGBA PNG outside Content first, then use the available Epic import tool to import only that ready image into the intended icon folder. Use power-of-two dimensions, preserve proportions and alpha, and verify the resulting Texture2D before adoption. Do not first import an oversized/noncompliant original into a `Source` folder just to make it discoverable: unused source textures can still trigger project validation warnings. Retain the original outside Content for later artwork revisions. Existing source assets may have other consumers; this does not authorize deleting them.

## Existing Texture2D

Use the two-server boundary:

1. Ask Epic MCP to discover a real `Texture2D` object and return its exact Unreal object path.
2. Call UTM `adopt_icon` with the current `expectedRevision`, target kind/ID, and that exact path.
3. UTM routes the path through the authenticated internal editor connector. The Unreal editor connector must export the verified source as an actual RGBA PNG with `TextureExporterPNG`/`AssetExportTask`; it rejects HDR/RGB-only output before normalization or import. The normalizer preserves alpha through power-of-two padding, then the configured icon folder and hidden preview persistence are updated. It updates the catalog only after the controlled job completes.
4. If the catalog revision changes while adoption is running, preserve the imported asset but return the conflict. Reload and explicitly reassign it.

Never use `RenderingLibrary.export_texture2d`/Radiance HDR for native adoption, add a filesystem search fallback, invent object paths, copy or mutate `.uasset` files, or use a base64 preview as proof that a native Texture2D exists. A successful import alone is not visual-fidelity proof; compare source and managed pixels/alpha and inspect the resulting Texture2D details.
