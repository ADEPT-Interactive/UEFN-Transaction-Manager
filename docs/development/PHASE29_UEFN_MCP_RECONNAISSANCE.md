# Phase 29 UEFN MCP reconnaissance

Status: complete reconnaissance, no Phase 29 product implementation

Date: 2026-08-22

This report records live tests against the user-enabled UEFN MCP server in the `UEM_Demo` project and an architecture audit of UEFN Transaction Manager 4.2.0. It is development research, not normal user documentation. The companion schema snapshot is [unreal-mcp-tool-schemas.json](phase29/unreal-mcp-tool-schemas.json).

Official references consulted:

- [UEFN MCP](https://dev.epicgames.com/documentation/fortnite/uefn-mcp)
- [42.00 Fortnite ecosystem updates and release notes](https://dev.epicgames.com/documentation/fortnite/42-00-fortnite-ecosystem-updates-and-release-notes)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

## Executive conclusion

The architecture hypothesis is valid, with one important refinement:

- Epic's `unreal-mcp` owns UEFN editor operations: Verse files and compilation, Creative and Verse-authored devices, Scene Graph, assets and Texture2D discovery, UMG, sessions, and editor logs.
- A future UTM MCP should own UTM catalog truth, validation, generated managed Verse persistence, controlled icon adoption, project-scoped draft state, and revision-safe catalog mutations.
- UTM should not duplicate Epic's generic asset, device, Scene Graph, UMG, or session tools. Live asset tests proved that Epic MCP can find Texture2D assets, return object paths, read image data, and export PNG files.
- The current UTM renderer owns the unsaved draft in React state. Phase 29 must first move that draft into the existing authenticated per-project bridge process, then make both the renderer and MCP handlers clients of that one catalog session. A second MCP database would create unsafe divergence.
- UEFN MCP can discover and place `managed_transactions_device`, inspect its generated `@editable` schema, and edit a primitive boolean. Assigning a real Creative trigger object to its generated trigger-device array was rejected by the live server's type validation. Reference-array setup therefore remains an explicit compatibility test or manual fallback until the exact accepted reference representation is established.
- Session startup and editor-side game state work. The tested session reached `Running`, but no Fortnite client log was available and `PushChanges` returned `The Refresh command is not currently available.` The full play-in-client and hot Verse refresh path needs one further focused test.

## 1. Server, protocol, and client setup

### Live endpoint and identity

| Item | Live result |
|---|---|
| Endpoint | `http://127.0.0.1:8000/mcp` |
| Transport | Streamable HTTP style JSON-RPC over POST |
| Initialize status | HTTP 200 |
| Negotiated protocol | `2025-06-18` |
| Capabilities | `resources: {}`, `tools: { listChanged: true }` |
| `serverInfo.name` | Empty string in the running 42.00 server |
| `serverInfo.title` | Empty string |
| `serverInfo.version` | Empty string |
| Authentication | No token required by the live endpoint |
| Required Origin | No Origin accepted; trusted loopback Origins accepted |
| Session header | `Mcp-Session-Id` returned by initialize and required for later requests |

UEFN's log confirmed the server was started on port 8000 with path `/mcp`. The server's observed identity differs from the official documentation's expected `unreal-mcp` name, so a future client must verify the actual endpoint and should not rely only on `serverInfo.name`.

### HTTP and session behavior

- `POST /mcp` with a valid initialize request returned JSON and a session ID.
- `notifications/initialized` returned HTTP 202 with no body.
- `GET /mcp` returned HTTP 405.
- `OPTIONS /mcp` returned HTTP 404.
- An invalid session ID returned HTTP 404 with JSON-RPC error `-32600` and the message that the client should reinitialize.
- Multiple independently initialized sessions succeeded, so multiple MCP clients can connect at the same time at least at the connection level.
- `Origin: http://127.0.0.1:8000` and `Origin: http://localhost:8000` were accepted.
- `Origin: http://evil.example` returned HTTP 403 with no response body.
- An arbitrary `Host: evil.example` header still received HTTP 200. UEFN's current server should therefore be treated as lacking strict Host validation even though it binds to loopback.
- No bearer token or other authentication challenge was observed.
- `prompts/list` returned HTTP 400 with JSON-RPC `-32601`, `Call to unknown method "prompts/list"`.
- `resources/list` returned HTTP 200 with an empty list.

### Codex client configuration

The project-local configuration created in the demo project is `.mcp.json`:

```json
{
  "mcpServers": {
    "unreal-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

The Codex CLI also accepted a global `unreal-mcp` entry using its Streamable HTTP transport. A temporary second server entry with a bearer-token environment variable was accepted by the CLI, proving that the client configuration supports multiple HTTP servers and static bearer-token configuration. The temporary entry was removed. The project `.mcp.json` remains in the demo project and was not added to the public UTM repository.

The active Luna session did not hot-load newly created MCP configuration, so a small standards-compliant local MCP client was used to initialize, discover, and call the live server. This exercised the real UEFN server rather than a fixture.

## 2. Tool Search and complete toolset inventory

`tools/list` returned exactly three top-level meta-tools:

| Meta-tool | Input | Behavior |
|---|---|---|
| `list_toolsets` | `{}` | Returns the available toolset names and descriptions |
| `describe_toolset` | `{ toolset_name: string }` | Returns tool names, descriptions, input schemas, and output schemas as serialized JSON text |
| `call_tool` | `{ toolset_name?: string, tool_name: string, arguments?: object }` | Calls a discovered tool by toolset and unprefixed tool name |

Concrete tools were not listed directly. The discovery sequence is therefore `tools/list` -> `list_toolsets` -> `describe_toolset` -> `call_tool`. The schema snapshot records the relevant live input schemas without committing the much larger raw response dump.

The running server exposed 29 toolsets:

1. `GameplayTagsToolset.GameplayTagsToolset`
2. `EditorToolset.EditorAppToolset`
3. `EditorToolset.LogsToolset`
4. `MVVMToolset.MVVMToolset`
5. `NiagaraToolsets.NiagaraToolset_Info`
6. `NiagaraToolsets.NiagaraToolset_Component`
7. `NiagaraToolsets.NiagaraToolset_System`
8. `NiagaraToolsets.NiagaraToolset_Assets`
9. `PhysicsToolsets.PhysicsAssetToolset`
10. `VerseFieldsToolset.VerseFieldsToolset`
11. `WidgetAnimationToolset.WidgetAnimationToolset`
12. `UMGToolSet.UMGToolSet`
13. `ValkyrieToolset.ValkyriePythonToolset`
14. `ValkyrieToolset.VerseToolset`
15. `ValkyrieToolset.SessionToolset`
16. `ValkyrieToolset.DeviceToolset`
17. `ValkyrieToolset.EntityToolset`
18. `editor_toolset.toolsets.actor.ActorTools`
19. `editor_toolset.toolsets.asset.AssetTools`
20. `editor_toolset.toolsets.curve_table.CurveTableTools`
21. `editor_toolset.toolsets.data_table.DataTableTools`
22. `editor_toolset.toolsets.material.MaterialTools`
23. `editor_toolset.toolsets.material_instance.MaterialInstanceTools`
24. `editor_toolset.toolsets.object.ObjectTools`
25. `editor_toolset.toolsets.primitive.PrimitiveTools`
26. `editor_toolset.toolsets.scene.SceneTools`
27. `editor_toolset.toolsets.skeletal_mesh.SkeletalMeshTools`
28. `editor_toolset.toolsets.static_mesh.StaticMeshTools`
29. `editor_toolset.toolsets.texture.TextureTools`

### Relevant toolset matrix

| Toolset | Exact relevant tools | Live-tested | Major limitation or result |
|---|---|---:|---|
| `ValkyrieToolset.VerseToolset` | `ListFiles`, `ReadFile`, `Grep`, `WriteFile`, `Replace`, `Move`, `Copy`, `Delete`, `CreateDirectory`, `BuildAll` | Yes | Project-mounted Verse paths only; BuildAll returns a diagnostics array rather than `numErrors`/`numWarnings` |
| `ValkyrieToolset.DeviceToolset` | `ListDeviceAssets`, `PlaceDevice`, `ListDeviceProperties`, `GetDeviceProperties`, `SetDeviceProperty`, `ListEventBindings`, `GetBindingOptions`, `AddEventBinding`, `RemoveEventBinding` | Yes | Generated Verse devices are discoverable; reference-array assignment needs exact compatible references |
| `ValkyrieToolset.EntityToolset` | `ListEntityClasses`, `CreateEntity`, `FindEntities`, `GetEntityTransform`, `SetEntityTransform`, `GetComponents`, `ListComponentClasses`, `ListComponentProperties`, `GetComponentProperty`, `SetComponentProperty`, `AddComponent`, `RemoveComponent`, `DeleteEntity` | Yes | Component properties can be read-only even when entity transforms are writable |
| `ValkyrieToolset.SessionToolset` | `StartSession`, `GetSessionStatus`, `StartGame`, `GetGameState`, `PushChanges`, `GetClientLogEntries`, `StopGame`, `StopSession` | Yes | Running editor session did not expose a client log and PushChanges was unavailable |
| `editor_toolset.toolsets.asset.AssetTools` | `find_assets`, `get_asset_class`, `load_asset`, `get_dependencies`, `get_referencers`, `is_dirty`, `save_assets`, `get_metadata_tags`, `get_asset_tags`, `list_folders`, `exists`, `move`, `duplicate`, `delete` | Yes | `list_folders` requires `root_path`; exact schemas must be discovered |
| `editor_toolset.toolsets.texture.TextureTools` | `find_assets` plus `get_size`, `read_texture`, `export_png`, `import_file` | Yes | Can discover Texture2D object paths and image data; safe mutation still requires deliberate asset policy |
| `editor_toolset.toolsets.object.ObjectTools` | `list_properties`, `get_properties`, `set_properties`, `reset_properties`, `get_class`, `search_subclasses` | Yes | Exact property names must be discovered before writes |
| `editor_toolset.toolsets.scene.SceneTools` | `get_current_level`, `find_actors`, `add_to_scene_from_asset`, `add_to_scene_from_class`, `remove_from_scene`, `get_actor_asset_path` | Yes | `find_actors` requires a `collision_channels` array even when empty |
| `EditorToolset.EditorAppToolset` | `GetContentBrowserPath`, `GetSelectedActors`, `GetSelectedAssets`, `GetOpenAssets`, `GetAssetThumbnails`, `CaptureAssetImage`, `CaptureEditorImage`, `GetCameraTransform` | Yes | Useful editor context, not a substitute for project identity validation |
| `EditorToolset.LogsToolset` | `GetLogEntries`, `GetLogCategories`, `GetVerbosity`, `SetVerbosity` | Schema inspected | Generic editor log access exists; the session client-log path had a separate limitation |
| `UMGToolSet.UMGToolSet` | `ListWidgetBlueprints`, `ListWidgetClasses`, `GetWidgets`, `GetWidgetDescription`, `GetWidgetTreeDepth`, create/edit/move/remove/compile tools | Yes, discovery only | No project Widget Blueprints were present in the demo project |
| `VerseFieldsToolset.VerseFieldsToolset` | `AddVerseField`, `EditVerseField`, `RemoveVerseField`, `DuplicateVerseField`, `ListVerseFields`, `BindWidgetPropertyToVerseField` | Schema inspected | Applies to Widget Blueprints, not UTM's generated transaction device |
| Other exposed toolsets | Gameplay Tags, MVVM, Niagara, Physics, Widget Animation, actor, curve/data tables, materials, material instances, primitives, static/skeletal meshes, Python | Inventory/discovery | Epic-owned domains outside the UTM boundary |

## 3. Verse MCP findings

### File discovery and reads

`ListFiles` with an empty root returned the mounted project and engine/plugin roots, including:

- `/UEM_Demo`
- `/adeptinteractive@fortnite.com/UEM_Demo (UEM_Demo/Assets)`
- `/Verse.org`
- `/UnrealEngine.com`
- `/Fortnite.com`

Recursive listing under `/UEM_Demo` found `/UEM_Demo/managed_transactions.verse`. `Grep` found `managed_transactions_device` at the generated class declaration. `ReadFile` returned exact line spans and exposed generated editables including `EnableDebugLogging`, `CoreEntitlement_PurchaseTriggers`, and `CoreEntitlement_PurchaseButtons`.

### Writes, edits, deletion, and compilation

A temporary Verse device file was created with `WriteFile`, read back, and changed with `Replace`. Replacing its function body with `THIS_IS_NOT_VALID` produced a structured diagnostic from `BuildAll`:

```json
{
  "severity": "Error",
  "code": 3506,
  "message": "Unknown identifier ... Used inside function ...",
  "filePath": "/UEM_Demo/phase29_recon_temp.verse",
  "span": {
    "startLine": 5,
    "startCharacter": 8,
    "endLine": 5,
    "endCharacter": 25
  }
}
```

After restoring valid Verse, `BuildAll` returned `{"returnValue":[]}`. The temporary file was then deleted. No warning was intentionally introduced. `Move`, `Copy`, and directory tools were schema-discovered but were not needed for the final reversible test.

### Sandboxing and path handling

- `/UEM_Demo` is the correct mounted project root for this server. `Content` and `/Game` were rejected as unresolved roots.
- `/UEM_Demo/../escape.verse` was rejected because it escaped the project's Verse content root.
- `C:\Windows\phase29.verse` was rejected because it was not under a mounted Verse content root.
- Writes are whole-file writes unless the optional source span is used; `Replace` provides targeted string editing.
- No file-size limit was measured. The future skill should treat the live schema and server limits as authoritative.

The server therefore provides useful project-scoped Verse editing, but the future agent must still use narrow paths, preserve hashes or revisions in its own workflow, and avoid treating a successful HTTP response as a successful compile.

## 4. Verse-authored device findings

This was the critical UTM test.

### Discovery and placement

`ValkyrieToolset.DeviceToolset.ListDeviceAssets` with a `managed` filter returned:

```text
displayName: managed_transactions_device
assetPath.refPath: /UEM_Demo/_Verse.managed_transactions_device
bIsVerseDevice: true
```

`PlaceDevice` successfully placed a temporary instance of that Verse-authored device. The server returned a level object reference of the `VerseDevice_C` class. This proves that the current UEFN MCP can discover and place the generated UTM device; it does not treat the device as invisible merely because it came from Verse.

### Editable inspection and primitive mutation

`ListDeviceProperties` returned the generated property schema. The schema used lower-camel names such as `enableDebugLogging` and described array element types such as `/CreativeCoreDevices/_Verse.trigger_device`. `GetDeviceProperties` accepted the generated property names and returned values such as:

```json
{
  "EnableDebugLogging": false,
  "CoreEntitlement_PurchaseTriggers": [],
  "CoreEntitlement_PurchaseButtons": []
}
```

`SetDeviceProperty` changed `EnableDebugLogging` to `true`, and a subsequent read verified the change. It was restored to `false` before cleanup.

### Device references and arrays

A temporary Creative Trigger was placed. Assigning its returned object reference to `CoreEntitlement_PurchaseTriggers` using an array of `{ "refPath": "..." }` objects failed with a strict Verse type error stating that the object was not a valid `trigger_device` for the generated property.

The test therefore establishes:

- generated `@editable` fields are visible;
- primitive editable mutation works;
- the tool has a type-checking path for Verse fields;
- successful assignment of UTM's trigger/button arrays was not proven;
- the failure may mean that the exact reference representation must be a Verse-compatible object rather than the placed Creative actor reference, or it may be a current DeviceToolset limitation.

`ListEventBindings` and `GetBindingOptions` returned empty source/target lists for the generated device. The temporary managed device, trigger, and button were removed. The genuine demo UTM device was not removed or changed.

### Phase 29 consequence

The Agent Skill may automate discovery, placement, primitive settings, and read-back. It must not claim that it can configure UTM's device-reference arrays until a focused test proves the accepted representation. A safe first implementation should return a clear manual-configuration state when array assignment is rejected, rather than retrying with guessed object paths.

## 5. Creative Device findings

`ListDeviceAssets` found known Creative devices including:

- `PID_Device_Trigger` at `/CreativeCoreDevices/SetupAssets/PID_Device_Trigger.PID_Device_Trigger`
- `PID_Device_Button` at `/CreativeCoreDevices/SetupAssets/PID_Device_Button.PID_Device_Button`

Both were placed temporarily. `ObjectTools.list_properties` discovered their actual property names. `ObjectTools.get_properties` and `set_properties` then verified harmless primitive edits:

- Trigger `timesCanTrigger`: `1` -> `2` -> read back `2`
- Button `interactTime`: `0` -> `0.5` -> read back `0.5`

Both temporary devices were removed with `SceneTools.remove_from_scene`. The practical pattern is catalog discovery -> placement -> property schema discovery -> exact-property mutation -> read-back -> cleanup. Future automation must not guess Unreal property names.

## 6. Scene Graph findings

The Entity toolset exposed Scene Graph classes including `/VerseUI/_Verse/VNI/VerseUISceneGraph.UI_widget` and component classes including transform and description components.

A temporary `UI_widget` entity was created, found by name, inspected, moved from `(2000,1000,1000)` to `(2100,1100,1100)` with rotation `(10,20,30)` and scale `(2,2,2)`, and read back successfully. A description component was added and then the entity was deleted. Transform component properties were visible but read-only through the tested component-property route.

Epic MCP already owns this domain. UTM should call it only when the migration or setup workflow genuinely needs Scene Graph work.

## 7. Play session findings

### Observed lifecycle

The live workflow was:

1. `GetSessionStatus` -> `Disconnected`.
2. `GetGameState` -> `Unconnected`.
3. `StartSession` began content validation, module upload, matchmaking/session assignment, and cooking. The first call did not return within the practical wait window; status logs showed `UpdatingContent` and game state `CanStart`.
4. The first session was stopped safely.
5. A second `StartSession` reached `Connected` after the cached/warm path.
6. `StartGame` returned `Completed`.
7. After a wait, `GetSessionStatus` was `Connected` and `GetGameState` was `Running`.
8. `StopGame` returned `Completed`.
9. `StopSession` returned successfully and final status returned to `Disconnected` / `Unconnected`.

### Verse refresh and logs

- `GetClientLogEntries` requires a non-empty pattern. With a pattern for errors/warnings/test text, it returned `No client log was found; start a play-in-client session first.`
- The editor session reached `Running`, but that did not prove a connected Fortnite client.
- `PushChanges` with `bVerseOnly: true` returned `The Refresh command is not currently available.` while the tested session was running.
- UEFN logs showed session assignment and cooking for client/server platforms, but the test did not reach a usable client-log state.

### Best-practice loop inferred from live behavior

```text
Edit Verse -> BuildAll -> fix diagnostics -> StartSession -> wait for Connected
-> StartGame -> verify Running -> make a small edit -> PushChanges
-> query client/editor logs -> StopGame -> StopSession
```

`PushChanges` and client log search must be capability-checked at runtime. If no play-in-client connection is present, the agent must report that it tested editor session state only.

## 8. Asset and Texture2D findings

Epic MCP does provide the discovery needed for future icon migration.

Live calls used `AssetTools.find_assets` with the project mount and a Texture2D asset type. It found:

```text
/UEM_Demo/EntitlementIcons/UEM_PlaceholderIcon.UEM_PlaceholderIcon
```

`get_asset_class` returned `Texture2D`. `TextureTools.get_size` returned `{ "x": 1, "y": 1 }` for the placeholder. `TextureTools.read_texture` returned a text reference plus a separate `image/png` MCP content block containing image data. `export_png` successfully wrote a 70-byte PNG to a temporary local path.

Therefore UTM does not need a required `search_project_textures` tool in Phase 29. The evidence-backed path is:

```text
unreal-mcp AssetTools.find_assets(asset_type=Texture2D)
-> source object path
-> UTM adopt_icon(sourceAssetPath)
-> UTM controlled editor import/adoption job
-> read-back and generated Verse verification
```

UTM can offer a convenience search later, but it should not duplicate Epic's asset registry. No `.uasset` files were copied, moved, or edited directly.

## 9. UMG findings

The actual `UMGToolSet.UMGToolSet` was present and exposed widget Blueprint listing, description, tree inspection, creation, child manipulation, property-oriented workflows, and compile operations. `VerseFieldsToolset.VerseFieldsToolset` exposed Verse field and MVVM binding authoring.

The demo project returned no Widget Blueprints under `/UEM_Demo` and no matching user widget classes, so no UMG mutation was needed. UMG and Widget Blueprint authoring remain Epic-owned capabilities and are not part of UTM MCP.

## 10. Project and editor context

Live context calls established:

- project mount: `/UEM_Demo`;
- current level: `/UEM_Demo/UEM_Demo`;
- Content Browser path during the test: `/UEM_Demo/EntitlementIcons`;
- selected actor: the genuine UTM managed device;
- selected assets: none at the final context check.

UEFN MCP did not provide an absolute `.uefnproject` path in the tested context. A future two-server safety check must therefore compare more than project display names:

1. UTM MCP returns its canonical project file real path, canonical Content root real path, mount, project descriptor identity, and a project-scoped session ID.
2. UEFN MCP returns its mount and current level; the agent verifies the expected mount and, where available, asks UEFN for an editor/session marker or project descriptor identity.
3. The agent requires the active UEFN project mount and current level to agree with the UTM project mount and expected generated file path.
4. If only names agree, mutation is refused and the agent asks for a project switch or explicit human confirmation.

UTM's current bridge already implements the stronger local half of this model: it receives the project descriptor, verifies the selected Content root belongs to that descriptor, records the asset mount, checks the latest UEFN-opened project from the editor log, and rejects mismatched editor connector sessions.

## 11. Multi-MCP behavior

Codex accepted two HTTP MCP server entries simultaneously, including a second entry configured with a bearer-token environment variable. Server names are client configuration keys; toolset names are exposed inside each server and are not automatically globally unique. A future skill should refer to the two servers by explicit configured names such as `unreal-mcp` and `utm-mcp` and always include the server name in its own routing instructions.

The project `.mcp.json` format is suitable for generic project-local clients. Codex's active CLI configuration is global, so the installation flow must account for clients that require a restart after configuration changes. The active Luna session did not hot-reload a newly created server, which is why the direct local client was used for live calls.

Static bearer headers are practical for clients that support an environment-backed bearer token. UTM should support an optional per-session token, but must remain safe when the client provides no token by binding to loopback, validating Host and Origin, requiring a project-scoped session, and rejecting cross-project requests.

## 12. UTM 4.2.0 architecture audit

### Current canonical data flow

- `src/App.tsx` currently owns the live React draft: configuration, entitlements, bundles, storefront membership, retired Verse keys, validation state, generated Verse text, dirty state, and loaded file hash.
- Browser `localStorage` is a per-project draft/cache convenience. It is not a sufficient MCP source of truth.
- Initialization loads the managed Verse file through `FileService`, parses the manifest-backed data, hydrates project icon previews, and records the loaded content hash.
- `isDirty` is the difference between the current normalized snapshot and `lastSavedSnapshot`.
- Save preflights validation, verifies the target is managed, re-reads the current file, compares its hash with the loaded revision, and then calls the bridge save API.
- `server/index.ts` writes the full managed Verse file through a temporary file and atomic rename. Existing files can receive a backup. A changed expected hash produces HTTP 409 rather than an overwrite.
- Compile requires a saved file hash and a verified active UEFN project, then calls the shared Verse compiler discovery/Workflow Server implementation.
- Generator and validator logic lives in the existing services, including the dynamic offer model and generated API contract. Phase 29 must call these services rather than reproduce naming rules.

### Existing project and editor boundary

The Electron main process discovers a project, starts a per-project bridge on a loopback port, creates high-entropy UI/editor tokens, and writes an active-session record containing the project descriptor, Content root, mount, and connector information. The bridge requires the project descriptor and verifies that the Content root belongs to it.

The bridge's editor connector reports Content root, asset mount, process ID, and a heartbeat. The bridge rejects mismatched roots, mounts, or non-running editor processes. The texture importer accepts a validated UEFN object path, queues a job, and relies on the editor-thread connector to perform controlled AssetTools import/adoption. This is the correct boundary for future `adopt_icon` behavior.

### Recommended MCP location

Add the future UTM MCP handler to the existing authenticated per-project bridge process, or to a second loopback listener in that same process if a separate endpoint is required. The Electron main process should continue to own lifecycle, project selection, tokens, and shutdown. The bridge process should own one catalog session service shared by:

- renderer-facing catalog APIs;
- MCP read and mutation handlers;
- existing validation, generator, save, and icon-adoption services.

Do not create a second catalog database and do not let MCP mutate React state or `localStorage` directly.

## 13. Proposed state and concurrency design

The minimum reliable design is a project-scoped `CatalogSession` in the existing bridge process:

```text
Electron main: project identity, lifecycle, token/session bootstrap
       |
Bridge process: CatalogSession + validator + generator + save CAS + adoption jobs
       |                                      |
Renderer UI: subscription/read/mutation API             UTM MCP: same service/API
```

The session should contain the normalized catalog, configuration, retired keys, current managed-file hash, dirty status, and a monotonic draft revision. The renderer subscribes to snapshots and mutation events. MCP reads and mutates the same snapshot, so an agent-created offer becomes visible in the open UI and marks the same session dirty.

### Revision and conflict rules

- `get_catalog_snapshot` returns project identity, `revision`, `snapshotHash`, dirty state, and normalized catalog data.
- Every mutation accepts `expectedRevision`; mutation without it is rejected except for explicitly read-only or session bootstrap calls.
- A revision changes on each accepted in-memory catalog mutation. The snapshot hash is a deterministic hash of the normalized catalog and configuration.
- If the revision is stale, return a structured conflict containing the current revision, current snapshot hash, and enough current data for the agent to reload. Do not partially apply.
- `save_catalog` additionally uses the existing managed-file content hash as a filesystem compare-and-swap precondition. A file changed outside UTM returns the existing 409-style conflict and leaves the draft intact.
- `apply_catalog_patch` builds a candidate copy, validates every operation and the complete candidate, then swaps the in-memory draft once. If validation fails, no operation is applied.
- A successful save atomically replaces the complete managed file and returns the new content hash and revision. Dirty state clears only after the write succeeds.
- Project identity is part of the session key. A session token cannot be reused for another project.

This design preserves UTM's existing safety model while making unsaved agent edits immediately visible to the human UI.

## 14. Proposed UTM MCP contract

The following is the recommended Phase 29 surface. Names are intentionally UTM-specific and should not duplicate Epic's generic tools.

| Tool | Kind | Purpose | Revision / dry-run behavior |
|---|---|---|---|
| `get_project_context` | Read | Return canonical project descriptor identity, Content root identity, mount, managed filename, editor connection, dirty state, and MCP session scope | No revision required |
| `get_catalog_snapshot` | Read | Return normalized catalog, configuration, retired keys, revision, snapshot hash, and managed-file hash | No revision required |
| `validate_catalog` | Read | Run the same complete validator used by the UI and return errors, warnings, normalized issue IDs, and whether generation is allowed | Optional `revision`; stale read may be reported |
| `describe_integration_contract` | Read | Return generated Verse symbols and concise usage examples from the current generator contract | Includes revision and generated-file identity |
| `create_entitlement` | Mutation | Create one durable or consumable transaction record | Requires `expectedRevision`; optional `dryRun` |
| `update_entitlement` | Mutation | Update one stable-key transaction without changing its identity accidentally | Requires `expectedRevision`; optional `dryRun` |
| `delete_entitlement` | Mutation | Remove or retire one stable-key transaction according to existing UTM semantics | Requires `expectedRevision`; optional `dryRun` |
| `create_alternate_offer` | Mutation | Add an alternate purchase path to an existing entitlement | Requires `expectedRevision`; optional `dryRun` |
| `update_alternate_offer` | Mutation | Update alternate-offer pricing/eligibility data | Requires `expectedRevision`; optional `dryRun` |
| `delete_alternate_offer` | Mutation | Remove an alternate offer | Requires `expectedRevision`; optional `dryRun` |
| `create_bundle` | Mutation | Create a bundle using stable entitlement references | Requires `expectedRevision`; optional `dryRun` |
| `update_bundle` | Mutation | Update bundle members and presentation data | Requires `expectedRevision`; optional `dryRun` |
| `delete_bundle` | Mutation | Delete a bundle | Requires `expectedRevision`; optional `dryRun` |
| `create_storefront` | Mutation | Create a storefront definition | Requires `expectedRevision`; optional `dryRun` |
| `update_storefront` | Mutation | Update storefront metadata and behavior | Requires `expectedRevision`; optional `dryRun` |
| `delete_storefront` | Mutation | Delete a storefront | Requires `expectedRevision`; optional `dryRun` |
| `set_storefront_membership` | Mutation | Add/remove stable entitlements and bundles from a storefront | Requires `expectedRevision`; optional `dryRun` |
| `apply_catalog_patch` | Bulk mutation | Apply multiple create/update/delete operations against a stable-ID catalog candidate | Requires `expectedRevision`; `dryRun` is recommended and validates the full candidate before any swap |
| `adopt_icon` | Mutation/job | Adopt an existing UEFN Texture2D object path or a controlled image source into UTM's canonical icon workflow | Requires `expectedRevision` for catalog assignment; returns an adoption job and can support `dryRun` preflight |
| `save_catalog` | Mutation | Generate and atomically save managed Verse after validation | Requires `expectedRevision` and current managed-file hash; no partial save |

`search_project_textures` is not required for the first Phase 29 implementation. Epic MCP already provides the tested discovery path. A later UTM convenience wrapper may be justified if a client cannot reliably call both servers, but it should delegate to a controlled source path rather than scan arbitrary files.

`preview_generated_verse` is optional. It is useful only if the Agent Skill needs a bounded diff or generated output preview before save. It must call the existing generator and never become a second generation implementation.

Every mutation should return the resulting revision, snapshot hash, changed stable IDs, validation summary, dirty state, and any required next action. Validation errors should be structured by stable issue ID and field/path. Conflicts should be a distinct error class from validation failures.

## 15. `describe_integration_contract` design

The response should be generated from the same generator metadata and normalized catalog used to produce `managed_transactions.verse`. It should contain:

- UTM product/generator version;
- project mount, generated Verse filename, generated device class, and managed-file ownership status;
- each stable product key, record type, display label, and generated Verse stem;
- primary purchase helper and alternate purchase helper names;
- dynamic runtime options type, dynamic offer factory, and runtime purchase helper where applicable;
- ownership, count, grant, and consumable `Consume` helper signatures/return semantics;
- await-event functions for grant, remove, and reconciliation behavior;
- storefront open helpers;
- generated device `@editable` field names and types that the agent may need to configure through Epic MCP;
- required imports/modules;
- short exact usage examples generated from the current symbols;
- current revision, generated content hash, and any warnings that make integration incomplete.

The source of truth must be a generator-owned metadata function or a structured generator result, not a second list maintained by the skill. This prevents the future Agent Skill from hardcoding symbol names that change with the product contract.

## 16. Existing-project adoption workflow

The evidence-backed workflow is:

1. Connect to `utm-mcp` and `unreal-mcp`; discover both servers' live tool names and schemas.
2. Call `get_project_context` and UEFN context tools. Compare project mount, current level, project descriptor identity where available, generated filename, and editor session identity. Stop on mismatch.
3. Call `get_catalog_snapshot` and retain its revision.
4. Use `unreal-mcp` `Grep` and `ReadFile` to inventory Verse declarations, call sites, Marketplace construction, ownership checks, grant/consume behavior, display strings, icon references, bundle arrays, storefront arrays, related devices, comments, and unused candidates.
5. Search Epic assets for referenced Texture2D objects and record actual object paths. Never invent an Unreal path.
6. Produce a migration plan that separates high-confidence mappings from semantic ambiguities.
7. Ask for human clarification only after the project evidence is exhausted and the ambiguity could change product or purchase semantics.
8. Call `apply_catalog_patch` with `dryRun: true` and the retained revision. Resolve validation errors and conflicts.
9. Apply the accepted patch with the same expected revision.
10. Adopt icons through `adopt_icon` using the object paths found by Epic MCP. Verify the resulting icon assignment and asset reference.
11. Call `save_catalog` to generate and atomically save `managed_transactions.verse`.
12. Call `describe_integration_contract` and use its current exact symbols.
13. Rewrite only external project Verse through Epic `WriteFile`/`Replace`. Preserve game-specific calculations, eligibility, UI, grants, and consequences in project Verse.
14. Run Epic `BuildAll` and iterate until its diagnostic array is empty. Do not confuse transport success with compile success.
15. Discover `managed_transactions_device` through Epic MCP. If placement is supported, inspect and configure safe primitive fields. Treat reference-array configuration as capability-checked and stop for manual setup when the live type check rejects it.
16. Start a session, wait for the observed connected state, start the game, and use `PushChanges` only if the live session exposes the refresh command. Inspect logs where a client log exists.
17. Stop the game and session cleanly.
18. Search Verse again for leftover raw Marketplace plumbing and report any remaining semantic code intentionally preserved.
19. Run a final UTM validation, generated-file ownership check, project identity check, and semantic migration audit.

UTM owns catalog and generated transaction plumbing. `unreal-mcp` owns editor, assets, devices, Verse file operations, compilation, sessions, and logs. Project Verse retains game-specific business logic. The agent must not silently rewrite gameplay semantics to make a mechanical migration compile.

## 17. Ambiguity policy

The future skill should classify each candidate as `confirmed`, `inferred`, `ambiguous`, or `manual`. Evidence should include declaration, call sites, Marketplace APIs, ownership/grant/consume behavior, comments, display text, icons, bundles, storefront membership, and related devices.

The agent must stop for human clarification when two mappings could change:

- whether products are separate durable entitlements;
- whether an offer is an alternate purchase path or a separate entitlement;
- whether an old offer is still intentionally sold;
- whether runtime price/quantity calculation is semantic gameplay logic;
- whether a grant or consume side effect is product plumbing or game-specific behavior.

The plan should state the evidence found, competing interpretations, the proposed non-destructive action, and the exact answer needed. It must not resolve ambiguity by guessing names, prices, quantities, or ownership semantics.

## 18. Asset adoption workflow

The tested preferred flow is:

```text
Verse/icon reference
  -> unreal-mcp AssetTools.find_assets with Texture2D class
  -> actual Texture2D object path
  -> utm-mcp adopt_icon(sourceAssetPath, expectedRevision)
  -> existing controlled editor adoption job
  -> UEFN editor imports/normalizes through the bridge
  -> UTM verifies the returned object path and preview
  -> save_catalog assigns the canonical Verse texture reference
```

The agent must never copy, move, parse, or rewrite `.uasset` binaries directly, and must never invent object paths. If Epic asset discovery is unavailable in a particular client, the operation should be reported as blocked or use a future explicitly controlled UTM convenience search; it must not fall back to arbitrary filesystem scanning.

## 19. Agent Skill design

The current Codex skill convention is a directory containing `SKILL.md` with YAML frontmatter `name` and `description`, with optional `references/`, `scripts/`, and `templates/` resources. Progressive disclosure means the entrypoint should contain routing and safety rules, while detailed workflows live in references.

Recommended Phase 29 structure:

```text
skills/
  uefn-transaction-manager/
    SKILL.md
    references/
      new-project-workflow.md
      existing-project-adoption.md
      transaction-semantics.md
      dynamic-transactions.md
      asset-adoption.md
      verification.md
      tool-discovery.md
```

The skill should:

- require both MCP servers and discover their live schemas at the start of a task;
- refer to configured server names rather than assuming global tool names;
- call `describe_integration_contract` rather than hardcoding generated Verse symbols;
- enforce same-project checks, expected revisions, dry runs, ambiguity stops, and cleanup;
- distinguish UTM catalog operations from Epic editor operations;
- document that MCP dependencies are configured by the host client, not declared as a portable skill dependency;
- explain project-local `.mcp.json` and client-specific installation/restart behavior;
- include scripts only for deterministic validation or report generation, never for direct Unreal binary manipulation.

The final skill should target UTM 4.3.0 after implementation. It should not be created during reconnaissance.

## 20. Minimal UTM Agent Integration UI

A small `Tools -> Agent Integration` view is justified after the MCP server exists. It should show:

- UTM MCP running/stopped;
- the loopback endpoint and a copy-configuration action;
- the bound project identity;
- UEFN MCP detected/not detected;
- a concise link to install or open the Agent Skill.

UTM should remain a transaction manager, not become an AI dashboard. The UI should not expose generic UEFN tools that Epic already owns.

## 21. Security recommendation

The future UTM MCP should:

- bind only to `127.0.0.1`, never `0.0.0.0`;
- use a separate project-scoped loopback endpoint or route, with an endpoint that is written into generated client configuration;
- strictly validate Host against the exact loopback host and port, correcting the weakness observed in the UEFN server;
- accept no unexpected Origin and allow only absent/loopback Origins required by supported clients;
- support a high-entropy per-session bearer token where the client supports environment-backed headers, while remaining usable in a controlled loopback-only no-token mode only if the project session token is otherwise protected;
- bind every request to the verified project descriptor, Content root, asset mount, editor process/session, and session token;
- expose no arbitrary filesystem, shell, network proxy, or secret-reading tool;
- route icon adoption through the existing controlled job and editor connector;
- reuse UI validation and generated-file ownership checks exactly;
- require `expectedRevision` for catalog mutations and reject stale writes;
- reject cross-project or missing-project context before any mutation;
- keep UTM MCP and UEFN MCP as separate server namespaces so an agent cannot mistake a generic Epic tool for a catalog mutation.

The official MCP transport guidance supports loopback binding and Origin validation to reduce DNS-rebinding risk. UTM should follow that guidance even though the current UEFN server accepted arbitrary Host values.

## 22. Phase 29 implementation recommendation

Target version: 4.3.0. Do not start a development version bump during reconnaissance.

Recommended work order:

1. Extract a project-scoped catalog session service from the renderer's current state model, preserving the existing normalized schema, validator, generator, image adoption, managed-file ownership, and hash-conflict behavior.
2. Add renderer subscription/mutation IPC or authenticated bridge APIs so the open UI and external calls share one draft and dirty state.
3. Add a loopback Streamable HTTP MCP endpoint in the same per-project bridge process, with client configuration generation and project/session tokens.
4. Implement read tools and `describe_integration_contract` from generator-owned metadata.
5. Implement single-object mutations with expected revisions and dry-run validation.
6. Implement atomic `apply_catalog_patch` and conflict responses.
7. Add controlled `adopt_icon` using source object paths discovered by Epic MCP.
8. Add `save_catalog`, generated-file hash compare-and-swap, and renderer update notifications.
9. Add the Agent Skill and project migration references only after the live UEFN boundary is encoded.
10. Add optional managed-device setup automation after the reference-array representation is proven.

Acceptance tests should cover:

- two clients reading the same project snapshot;
- agent mutation appearing immediately in the open UI;
- UI mutation appearing immediately to MCP;
- stale `expectedRevision` rejection with no partial change;
- dry-run validation with no state change;
- atomic multi-operation patch rollback on one invalid operation;
- managed-file external-edit conflict;
- generator contract matching actual generated Verse;
- project A versus project B rejection;
- source Texture2D adoption through the existing editor bridge;
- no arbitrary filesystem/shell capability;
- MCP disconnect/reconnect and session expiry;
- compile and generated Verse checks through live UEFN MCP;
- device placement/read-back and explicit manual fallback when array reference assignment is unsupported.

Explicitly deferred:

- generic UEFN device, Scene Graph, UMG, asset, and session duplication;
- direct `.uasset` manipulation;
- automatic gameplay-semantic decisions;
- automatic real purchase testing or publishing;
- claiming full play-in-client refresh support until the focused session test passes;
- final Agent Skill implementation during reconnaissance.

## 23. Reconnaissance artifacts

- Markdown report: `docs/development/PHASE29_UEFN_MCP_RECONNAISSANCE.md`
- Scoped live schema snapshot: `docs/development/phase29/unreal-mcp-tool-schemas.json`
- Post-release research commit: created locally as `Document Phase 29 UEFN MCP reconnaissance`
- Research commit push: not pushed, by design; `origin/main` remains the public 4.2.0 release commit
- Project-local `.mcp.json`: remains in the demo project, outside the public UTM repository

## 24. Demo project cleanup

Temporary reconnaissance changes were removed:

- temporary Verse file and invalid diagnostic body;
- temporary generated UTM device instance;
- temporary Creative Trigger and Button devices;
- temporary Scene Graph entity and added component;
- temporary editor/session test changes;
- temporary exported Texture2D PNG outside the project.

The genuine UTM demo content and existing managed device remain. UEFN MCP remains enabled. The project-local `.mcp.json` remains because it is useful for future project-scoped testing and contains no machine-specific public-repository configuration.

## 25. Remaining unknowns

Only these items remain materially unresolved after live testing:

1. The exact object/reference representation required for assigning Creative Trigger/Button devices to generated Verse `[]trigger_device` and `[]button_device` editables. The live test proved the attempted actor reference was rejected, but did not distinguish a tool limitation from a required Verse-compatible reference wrapper.
2. A full play-in-client run with a connected Fortnite client, usable `GetClientLogEntries`, and successful `PushChanges` was not completed. The editor session lifecycle and failure response are known; the client-refresh path needs one focused test.
3. The current server emits blank `serverInfo` fields and accepts arbitrary Host values. These are observed 42.00 behaviors, not missing local evidence; a future integration should fail safely around them.

No unresolved asset-discovery blocker remains. Epic MCP's live Texture2D search/read/export path is sufficient for the first UTM MCP design.

