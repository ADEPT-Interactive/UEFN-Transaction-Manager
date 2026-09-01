# Texture2D icon adoption

Use the two-server boundary:

1. Ask Epic MCP to discover a real `Texture2D` object and return its exact Unreal object path.
2. Call UTM `adopt_icon` with the current `expectedRevision`, target kind/ID, and that exact path.
3. UTM routes the path through the authenticated internal editor connector, normalization, configured icon folder, and hidden preview persistence. It updates the catalog only after the controlled job completes.
4. If the catalog revision changes while adoption is running, preserve the imported asset but return the conflict. Reload and explicitly reassign it.

Never add a filesystem search fallback, invent object paths, copy or mutate `.uasset` files, or use a base64 preview as proof that a native Texture2D exists.
