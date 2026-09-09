"""Attach optional UEFN editor automation to an active Transaction Manager session."""

import json
import os
import re
import tempfile
import time
import urllib.request

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_IDENTITY = "UEFN Entitlement Manager Bridge"
# Native Texture2D export/import runs on the UEFN editor thread and can exceed
# the short readiness-handshake window on a loaded project. Keep the request
# bounded, but allow the real editor job to finish before the connector fails.
BRIDGE_REQUEST_TIMEOUT_SECONDS = 30.0
EDITOR_HEARTBEAT_INTERVAL_SECONDS = 2.0
TRANSACTION_DEVICE_CHECK_INTERVAL_SECONDS = 2.0
TRANSACTION_DEVICE_MARKER_PROPERTIES = (
    "enableDebugLogging",
    "EnableDebugLogging",
    "enable_debug_logging",
)
TRANSACTION_REFERENCE_PROPERTIES = (
    "transactions",
    "Transactions",
    "transaction",
)
DEFAULT_MANAGED_VERSE_FILE = "managed_transactions.verse"
DEFAULT_MANAGED_DEVICE_CLASS = "managed_transactions_device"
with open(os.path.join(TOOL_DIR, "version.json"), "r", encoding="utf-8") as version_file:
    SERVER_VERSION = json.load(version_file)["version"]
VERSE_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def get_uefn_content_dir():
    """Resolve the active project Content directory; never use Fortnite's host Content."""
    unreal_loaded = False
    try:
        import unreal
        unreal_loaded = True

        # UEFN runs on FortniteGame as its Unreal host. Consequently,
        # Paths.project_content_dir() can validly return the Fortnite install's
        # Content directory even while another UEFN project is open. The active
        # UEFN mount and its filesystem location are exposed by these editor APIs.
        root_asset_directory = getattr(unreal, "EditorAssetLibrary", None)
        get_root_asset_directory = getattr(root_asset_directory, "get_project_root_asset_directory", None)
        root_asset_path = get_root_asset_directory() if get_root_asset_directory else ""
        root_asset_path = str(root_asset_path or "").strip().replace("\\", "/")
        root_parts = [part for part in root_asset_path.split("/") if part]
        print(f"[TransactionManager] UEFN root asset directory: {root_asset_path or '<empty>'}")

        if root_parts and root_parts[0].lower() != "game":
            project_name = root_parts[0]
            plugin_library = getattr(unreal, "PluginBlueprintLibrary", None)
            get_plugin_content_dir = getattr(plugin_library, "get_plugin_content_dir", None)
            if get_plugin_content_dir:
                plugin_content_dir = get_plugin_content_dir(project_name)
                print(f"[TransactionManager] UEFN project plugin {project_name} Content API returned: {plugin_content_dir or '<empty>'}")
                normalized = _normalize_existing_dir(unreal, plugin_content_dir)
                print(f"[TransactionManager] UEFN project plugin Content normalized to: {normalized or '<missing>'}")
                if normalized:
                    print(f"[TransactionManager] Active UEFN Content directory: {normalized}")
                    return normalized

            raise RuntimeError(
                f"UEFN project mount '/{project_name}' was detected, but its filesystem Content directory could not be resolved."
            )

        # Some UEFN editor states briefly report /Game even though the active
        # project is mounted as a project plugin. Resolve that plugin before
        # falling back to FortniteGame/Content, which is not writable project content.
        project_plugin = _find_uefn_project_plugin(unreal)
        if project_plugin:
            normalized = _normalize_existing_dir(unreal, project_plugin[1])
            if normalized:
                print(f"[TransactionManager] Active UEFN project plugin Content directory: {normalized}")
                return normalized

        # Ordinary Unreal projects use the host project's Content directory.
        candidates = [getattr(unreal.Paths, "project_content_dir", lambda: "")()]
        project_dir = getattr(unreal.Paths, "project_dir", lambda: "")()
        if project_dir:
            candidates.append(os.path.join(project_dir, "Content"))
        for candidate in candidates:
            normalized = _normalize_existing_dir(unreal, candidate)
            if normalized:
                print(f"[TransactionManager] Active Content directory: {normalized}")
                return normalized
    except Exception as error:
        print(f"[TransactionManager] Unreal project detection unavailable: {error}")
        if unreal_loaded:
            raise RuntimeError("The active UEFN project was detected, but its Content directory could not be resolved.") from error

    explicit_root = os.environ.get("UEM_CONTENT_ROOT", "").strip()
    if explicit_root and os.path.isdir(explicit_root):
        return os.path.normpath(explicit_root).rstrip("/\\")
    raise RuntimeError("No active UEFN Content directory was found. Run this script inside the intended project or set UEM_CONTENT_ROOT for local development.")


def _normalize_existing_dir(unreal, candidate):
    """Return a normalized existing directory, expanding Unreal path tokens when available."""
    if not candidate:
        return ""
    converter = getattr(getattr(unreal, "Paths", None), "convert_relative_path_to_full", None)
    full_path = converter(candidate) if converter else candidate
    normalized = os.path.normpath(os.path.abspath(str(full_path))).rstrip("/\\")
    return normalized if os.path.isdir(normalized) else ""


def _has_uefn_project_file(directory):
    """Recognize a project plugin by finding its .uefnproject ancestor."""
    current = os.path.normpath(directory)
    for _ in range(5):
        if os.path.isdir(current):
            try:
                if any(name.lower().endswith(".uefnproject") for name in os.listdir(current)):
                    return True
            except OSError:
                pass
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return False


def _find_uefn_project_plugin(unreal):
    """Find the active UEFN project plugin when the root API temporarily reports /Game/."""
    plugin_library = getattr(unreal, "PluginBlueprintLibrary", None)
    list_plugins = getattr(plugin_library, "get_enabled_plugin_names", None)
    get_content = getattr(plugin_library, "get_plugin_content_dir", None)
    get_base = getattr(plugin_library, "get_plugin_base_dir", None)
    if not list_plugins or not get_content or not get_base:
        return None

    candidates = []
    for plugin_name in list_plugins() or []:
        name = str(plugin_name)
        base_dir = get_base(name)
        content_dir = get_content(name)
        if not base_dir or not content_dir:
            continue
        base_dir = os.path.normpath(os.path.abspath(str(base_dir)))
        content_dir = _normalize_existing_dir(unreal, content_dir)
        if not content_dir:
            continue
        lower_base = base_dir.lower().replace("/", "\\")
        if _has_uefn_project_file(base_dir) or ("fortnite projects" in lower_base and "\\plugins\\" in lower_base):
            candidates.append((name, content_dir))
    return candidates[0] if candidates else None


def get_uefn_asset_mount():
    """Resolve the active project's Unreal asset mount, not FortniteGame's /Game mount."""
    try:
        import unreal
        editor_asset_library = getattr(unreal, "EditorAssetLibrary", None)
        getter = getattr(editor_asset_library, "get_project_root_asset_directory", None)
        root = str(getter() if getter else "").strip().replace("\\", "/")
        root_parts = [part for part in root.split("/") if part]
        if root_parts:
            normalized_root = "/" + root_parts[0]
            if normalized_root.lower() != "/game":
                return normalized_root
            project_plugin = _find_uefn_project_plugin(unreal)
            if project_plugin:
                return f"/{project_plugin[0]}"
            if os.environ.get("UEM_CONTENT_ROOT", "").strip():
                return "/Game"
            raise RuntimeError("UEFN reported /Game instead of its project mount and no active project plugin could be resolved.")
    except Exception as error:
        print(f"[TransactionManager] Unreal asset mount detection unavailable: {error}")
        if os.environ.get("UEM_CONTENT_ROOT", "").strip():
            return "/Game"
        raise RuntimeError("The active UEFN asset mount could not be resolved safely.") from error

    if os.environ.get("UEM_CONTENT_ROOT", "").strip():
        return "/Game"
    raise RuntimeError("UEFN did not report an active project asset mount.")


def _bridge_request(port, token, route, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        data=data,
        method=method,
        headers={
            "X-UEM-Editor-Token": token,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=BRIDGE_REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _export_existing_texture(job, unreal):
    """Export a verified Texture2D as an alpha-safe PNG through Unreal's editor API."""
    source_asset_path = str(job.get("sourceAssetPath", ""))
    if not source_asset_path.startswith("/") or "." not in source_asset_path.rsplit("/", 1)[-1]:
        raise RuntimeError("The existing source must be a project Texture2D object path.")
    editor_asset_library = getattr(unreal, "EditorAssetLibrary", None)
    load_asset = getattr(editor_asset_library, "load_asset", None) if editor_asset_library else None
    if not load_asset:
        raise RuntimeError("UEFN does not expose the verified editor asset loader required for Texture2D adoption.")
    texture = load_asset(source_asset_path)
    if texture is None:
        raise RuntimeError(f"UEFN could not load the existing texture asset {source_asset_path}.")
    texture_class = str(getattr(getattr(texture, "get_class", lambda: "")(), "get_name", lambda: "")())
    if texture_class and texture_class.lower() != "texture2d":
        raise RuntimeError(f"The selected asset is {texture_class}, not a Texture2D.")
    destination = str(job.get("sourcePath", ""))
    directory = os.path.dirname(destination)
    if not directory or not destination.lower().endswith(".png"):
        raise RuntimeError("The Texture2D adoption staging path must be an explicit PNG file.")

    # RenderingLibrary.export_texture2d is not suitable here: on supported
    # editor versions it exports Radiance HDR, which has no alpha channel and
    # causes the old RGB-only decoder to alter both transparency and color.
    # TextureExporterPNG + AssetExportTask stays inside Unreal's exporter and
    # writes the source Texture2D as an actual RGBA PNG. Do not fall back to
    # HDR or to arbitrary filesystem/.uasset reads if this API is unavailable.
    exporter_class = getattr(unreal, "TextureExporterPNG", None)
    export_task_class = getattr(unreal, "AssetExportTask", None)
    exporter_api = getattr(unreal, "Exporter", None)
    run_export_task = getattr(exporter_api, "run_asset_export_task", None) if exporter_api else None
    if not exporter_class or not export_task_class or not run_export_task:
        raise RuntimeError("UEFN does not expose the alpha-safe TextureExporterPNG AssetExportTask required for Texture2D adoption.")

    # Only clear exporter-owned files in the private staging directory. This
    # prevents a failed retry from accidentally accepting stale output.
    for candidate in (destination, destination + ".png"):
        try:
            if os.path.isfile(candidate):
                os.remove(candidate)
        except OSError as error:
            raise RuntimeError(f"UEFN could not prepare the Texture2D adoption staging path: {error}") from error

    task = export_task_class()
    task.object = texture
    task.filename = destination
    task.exporter = exporter_class()
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    export_result = run_export_task(task)
    if export_result is False:
        raise RuntimeError(f"UEFN's TextureExporterPNG failed for {source_asset_path}.")

    # TextureExporterPNG should honor the explicit .png filename. Accept one
    # exporter-added .png suffix for editor-version compatibility, but never
    # accept HDR, a bare unknown file, or project .uasset bytes.
    candidates = [destination, destination + ".png"]
    exported = next((candidate for candidate in candidates if os.path.isfile(candidate)), None)
    if not exported:
        raise RuntimeError(f"UEFN did not export Texture2D {source_asset_path} as a PNG to the adoption staging path.")
    if exported != destination:
        os.replace(exported, destination)

    try:
        with open(destination, "rb") as exported_file:
            header = exported_file.read(33)
        # PNG color type 6 is RGBA. Requiring it makes an alpha-bearing source
        # fail closed instead of silently becoming an RGB/DXT1 import. The
        # Unreal PNG exporter emits this channel-safe representation for opaque
        # textures too, which keeps the opaque path supported without forcing a
        # UEFN compression setting.
        if len(header) < 33 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR" or header[25] != 6:
            raise RuntimeError("UEFN's TextureExporterPNG did not produce an RGBA PNG; adoption stopped before import.")
    except OSError as error:
        raise RuntimeError(f"UEFN's exported Texture2D PNG could not be inspected: {error}") from error


def import_texture_job(job, normalize_adopted_texture=None):
    """Import one queued PNG through UEFN's editor APIs on the editor thread."""
    import unreal

    asset_folder = str(job.get("assetFolderName", ""))
    asset_name = str(job.get("assetName", ""))
    source_path = str(job.get("sourcePath", ""))
    if not VERSE_IDENTIFIER_PATTERN.fullmatch(asset_folder) or not VERSE_IDENTIFIER_PATTERN.fullmatch(asset_name):
        raise RuntimeError("The texture job contains an invalid UEFN asset identifier.")
    if job.get("sourceKind") == "uefn-texture":
        _export_existing_texture(job, unreal)
        if normalize_adopted_texture is not None:
            normalized = normalize_adopted_texture(job.get("jobId"))
            if not normalized or normalized.get("success") is False:
                raise RuntimeError((normalized or {}).get("error", "The adopted texture could not be normalized before import."))
    if not os.path.isfile(source_path):
        raise RuntimeError("The confirmed PNG is no longer available to the UEFN editor bridge.")

    mount = get_uefn_asset_mount()
    destination_path = f"{mount}/{asset_folder}"
    editor_asset_library = getattr(unreal, "EditorAssetLibrary", None)
    make_directory = getattr(editor_asset_library, "make_directory", None)
    if make_directory:
        make_directory(destination_path)
    unreal.log(f"[TransactionManager] Importing confirmed texture into {destination_path}: {asset_name}")

    task = unreal.AssetImportTask()
    task.filename = source_path
    task.destination_path = destination_path
    task.destination_name = asset_name
    task.replace_existing = True
    task.automated = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    asset_registry_helpers = getattr(unreal, "AssetRegistryHelpers", None)
    get_asset_registry = getattr(asset_registry_helpers, "get_asset_registry", None)
    if get_asset_registry:
        asset_registry = get_asset_registry()
        scan_paths = getattr(asset_registry, "scan_paths_synchronously", None)
        if scan_paths:
            scan_paths([destination_path])

    imported_paths = [str(asset_path) for asset_path in (getattr(task, "imported_object_paths", None) or [])]
    if not imported_paths:
        expected_asset_path = f"{destination_path}/{asset_name}.{asset_name}"
        if editor_asset_library and editor_asset_library.does_asset_exist(expected_asset_path):
            imported_paths = [expected_asset_path]
    if not imported_paths:
        raise RuntimeError(f"UEFN did not produce a Texture2D asset at {destination_path}/{asset_name}.")

    for asset_path in imported_paths:
        does_asset_exist = getattr(editor_asset_library, "does_asset_exist", None) if editor_asset_library else None
        if does_asset_exist and not does_asset_exist(asset_path):
            raise RuntimeError(f"UEFN reported an imported path that is not present in the Content Browser: {asset_path}.")
        load_asset = getattr(editor_asset_library, "load_asset", None) if editor_asset_library else None
        loaded_asset = load_asset(asset_path) if load_asset else None
        if load_asset and loaded_asset is None:
            raise RuntimeError(f"UEFN could not load the imported asset from the Content Browser: {asset_path}.")
        if editor_asset_library and hasattr(editor_asset_library, "save_asset"):
            save_result = editor_asset_library.save_asset(asset_path)
            if save_result is False and (not does_asset_exist or not does_asset_exist(asset_path)):
                raise RuntimeError(f"UEFN could not save imported asset {asset_path}.")
        unreal.log(f"[TransactionManager] Imported and verified Content Browser asset: {asset_path}")
    if editor_asset_library and hasattr(editor_asset_library, "sync_browser_to_objects"):
        editor_asset_library.sync_browser_to_objects(imported_paths)

    return {
        "success": True,
        "destinationPath": destination_path,
        "assetObjectPath": imported_paths[0],
    }


def _editor_project_readiness(unreal, expected_project_file=None, expected_asset_mount=None):
    """Return a fail-closed readiness result with a diagnostic reason."""
    if not expected_project_file:
        return {"ready": False, "reason": "expected-project-missing"}
    try:
        paths = getattr(unreal, "Paths", None)
        expected_project = os.path.normcase(os.path.realpath(str(expected_project_file)))
        project_file_path = getattr(paths, "project_file_path", None) if paths else None
        project_dir = getattr(paths, "project_dir", None) if paths else None
        if callable(project_file_path):
            current_project = os.path.normcase(os.path.realpath(str(project_file_path())))
            if current_project != expected_project:
                return {"ready": False, "reason": "project-path-mismatch"}
        elif not callable(project_dir):
            return {"ready": False, "reason": "project-path-unavailable"}

        editor_level_library = getattr(unreal, "EditorLevelLibrary", None)
        get_editor_world = getattr(editor_level_library, "get_editor_world", None) if editor_level_library else None
        editor_world = get_editor_world() if callable(get_editor_world) else None
        subsystem_class = getattr(unreal, "UnrealEditorSubsystem", None)
        get_editor_subsystem = getattr(unreal, "get_editor_subsystem", None)
        subsystem_world = None
        if subsystem_class and callable(get_editor_subsystem):
            subsystem = get_editor_subsystem(subsystem_class)
            get_world = getattr(subsystem, "get_editor_world", None)
            subsystem_world = get_world() if callable(get_world) else None
        world = editor_world or subsystem_world
        if world is None:
            return {"ready": False, "reason": "editor-world-missing"}
        if expected_asset_mount:
            get_path_name = getattr(world, "get_path_name", None)
            world_path = str(get_path_name() if callable(get_path_name) else world).replace("\\", "/")
            mount = str(expected_asset_mount).rstrip("/")
            first_asset_path = world_path[world_path.find("/"):] if "/" in world_path else world_path
            if not first_asset_path.casefold().startswith(f"{mount.casefold()}/"):
                return {"ready": False, "reason": "editor-world-mount-mismatch", "worldPath": world_path}
            return {"ready": True, "reason": "verified", "worldPath": world_path}
        return {"ready": True, "reason": "verified", "worldPath": str(getattr(world, "get_path_name", lambda: world)())}
    except Exception as error:
        return {"ready": False, "reason": "readiness-check-error", "error": str(error)[:160]}


def _editor_project_is_ready(unreal, expected_project_file=None, expected_asset_mount=None):
    """Return true only when the current editor thread has the expected project world."""
    return bool(_editor_project_readiness(unreal, expected_project_file, expected_asset_mount)["ready"])


def _editor_object_identity(value):
    """Return stable Unreal object identity strings without relying on repr()."""
    if value is None or value is False:
        return ""
    if isinstance(value, str):
        identity = value.strip()
        return identity.replace("\\", "/") if identity else ""
    for method_name in ("get_path_name", "get_name"):
        method = getattr(value, method_name, None)
        if not callable(method):
            continue
        try:
            identity = str(method()).strip()
        except Exception:
            continue
        if identity and identity.casefold() not in {"none", "null", "invalid"}:
            return identity.replace("\\", "/")
    return ""


def _read_editor_property(value, property_names):
    """Read the first property exposed by Unreal, preserving API availability."""
    getter = getattr(value, "get_editor_property", None)
    if not callable(getter):
        return False, None, ""
    for property_name in property_names:
        try:
            return True, getter(property_name), property_name
        except Exception:
            continue
    return False, None, ""


def _editor_property_variants(property_name):
    """Return source and UEFN Details-panel spellings for a Verse field."""
    if not property_name:
        return ()
    lower_camel = property_name[0].lower() + property_name[1:]
    return tuple(dict.fromkeys((property_name, lower_camel, property_name.replace("_", ""))))


def _editor_level_actors(unreal):
    """Use supported editor actor APIs, with the legacy library as a fallback."""
    get_editor_subsystem = getattr(unreal, "get_editor_subsystem", None)
    subsystem_class = getattr(unreal, "EditorActorSubsystem", None)
    if callable(get_editor_subsystem) and subsystem_class is not None:
        try:
            subsystem = get_editor_subsystem(subsystem_class)
            get_all = getattr(subsystem, "get_all_level_actors", None)
            if callable(get_all):
                return True, list(get_all() or [])
        except Exception:
            pass

    editor_level_library = getattr(unreal, "EditorLevelLibrary", None)
    get_all = getattr(editor_level_library, "get_all_level_actors", None) if editor_level_library else None
    if callable(get_all):
        try:
            return True, list(get_all() or [])
        except Exception:
            return False, []
    return False, []


def _managed_device_schema(content_dir, verse_file_name=DEFAULT_MANAGED_VERSE_FILE, device_class_name=DEFAULT_MANAGED_DEVICE_CLASS):
    """Read the generated device's editable signature without mutating project content."""
    if not content_dir:
        return {"status": "not-available", "properties": []}

    root = os.path.normpath(str(content_dir))
    preferred_path = os.path.join(root, verse_file_name)
    candidate_paths = []
    if os.path.isfile(preferred_path):
        candidate_paths.append(preferred_path)
    try:
        for entry in os.scandir(root):
            if entry.is_file() and entry.name.casefold().endswith(".verse") and os.path.normcase(entry.path) != os.path.normcase(preferred_path):
                candidate_paths.append(entry.path)
    except OSError:
        return {"status": "not-available", "properties": []}

    matches = []
    class_pattern = re.compile(rf"(?m)^\s*{re.escape(device_class_name)}\s*:=\s*class\(creative_device\):")
    generated_class_pattern = re.compile(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*class\(creative_device\):")
    for path in candidate_paths:
        try:
            with open(path, "r", encoding="utf-8") as source_file:
                source = source_file.read()
        except (OSError, UnicodeError):
            continue
        class_matches = list(class_pattern.finditer(source))
        if not class_matches and "Generated and managed by ADEPT Interactive UEFN Transaction Manager" in source:
            class_matches = list(generated_class_pattern.finditer(source))
        for class_match in class_matches:
            editable_names = []
            pending_editable = False
            for line in source[class_match.end():].splitlines():
                stripped = line.strip()
                if stripped == "@editable:":
                    pending_editable = True
                    continue
                if pending_editable:
                    property_match = re.match(r"^\s{4,}([A-Za-z_][A-Za-z0-9_]*)\s*:", line)
                    if property_match:
                        editable_names.append(property_match.group(1))
                        pending_editable = False
                        continue
                    if stripped and not line.startswith(" "):
                        pending_editable = False
            if "EnableDebugLogging" not in editable_names:
                continue
            matches.append({"path": path, "properties": editable_names})

    preferred_matches = [match for match in matches if os.path.normcase(match["path"]) == os.path.normcase(preferred_path)]
    if len(preferred_matches) == 1:
        return {"status": "verified", **preferred_matches[0]}
    if len(matches) == 1:
        return {"status": "verified", **matches[0]}
    if len(matches) > 1:
        return {"status": "ambiguous", "properties": []}
    return {"status": "not-found", "properties": []}


def _editor_objects_match(left, right):
    """Match an actor reference to its nested Verse property object path."""
    if left is right:
        return True
    left_identity = _editor_object_identity(left).rstrip(".")
    right_identity = _editor_object_identity(right).rstrip(".")
    if not left_identity or not right_identity:
        return False
    left_key = left_identity.casefold()
    right_key = right_identity.casefold()
    return left_key == right_key or left_key.startswith(f"{right_key}.") or right_key.startswith(f"{left_key}.")


def _managed_device_readiness(unreal, content_dir=None, verse_file_name=DEFAULT_MANAGED_VERSE_FILE, device_class_name=DEFAULT_MANAGED_DEVICE_CLASS):
    """Inspect the placed generated device and its project caller wiring without changing editor state."""
    api_available, actors = _editor_level_actors(unreal)
    if not api_available:
        return {
            "status": "not-verifiable",
            "devicePlaced": False,
            "callerFound": False,
            "transactionsAssigned": False,
            "deviceCount": 0,
            "reason": "editor-actor-api-unavailable",
        }

    schema = _managed_device_schema(content_dir, verse_file_name, device_class_name)
    signature_properties = [
        property_name for property_name in schema.get("properties", [])
        if property_name.casefold() != "enabledebuglogging"
    ]
    managed_devices = []
    marker_candidates_without_signature = 0
    for actor in actors:
        marker_available, _marker_value, _marker_name = _read_editor_property(actor, TRANSACTION_DEVICE_MARKER_PROPERTIES)
        if not marker_available:
            continue
        if signature_properties and not any(_read_editor_property(actor, _editor_property_variants(property_name))[0] for property_name in signature_properties):
            marker_candidates_without_signature += 1
            continue
        managed_devices.append(actor)

    if schema.get("status") == "ambiguous":
        return {
            "status": "not-verifiable",
            "devicePlaced": False,
            "callerFound": False,
            "transactionsAssigned": False,
            "deviceCount": 0,
            "reason": "multiple-generated-managed-device-schemas-found-in-content",
        }
    if len(managed_devices) == 0:
        reason = "managed-transactions-device-not-placed-in-current-level"
        if marker_candidates_without_signature:
            reason = "current-managed-transactions-device-schema-not-found-in-level"
        return {
            "status": "missing-device",
            "devicePlaced": False,
            "callerFound": False,
            "transactionsAssigned": False,
            "deviceCount": 0,
            "reason": reason,
        }
    if len(managed_devices) > 1:
        return {
            "status": "ambiguous",
            "devicePlaced": True,
            "callerFound": False,
            "transactionsAssigned": False,
            "deviceCount": len(managed_devices),
            "devicePath": _editor_object_identity(managed_devices[0]),
            "reason": "multiple-managed-transactions-devices-found-in-current-level",
        }

    managed_device = managed_devices[0]
    managed_path = _editor_object_identity(managed_device)
    reference_api_available = False
    caller_found = False
    transactions_assigned = False
    assigned_path = ""
    for actor in actors:
        property_available, reference, _property_name = _read_editor_property(actor, TRANSACTION_REFERENCE_PROPERTIES)
        if not property_available:
            continue
        reference_api_available = True
        caller_found = True
        if reference is not None and reference is not False and _editor_objects_match(reference, managed_device):
            transactions_assigned = True
            assigned_path = _editor_object_identity(reference)

    if transactions_assigned:
        return {
            "status": "ready",
            "devicePlaced": True,
            "deviceCount": 1,
            "callerFound": caller_found,
            "transactionsAssigned": True,
            "devicePath": managed_path,
            "linkedDevicePath": assigned_path or managed_path,
            "reason": "managed-device-placed-and-linked",
        }
    if not reference_api_available:
        return {
            "status": "not-verifiable",
            "devicePlaced": True,
            "deviceCount": 1,
            "callerFound": False,
            "transactionsAssigned": False,
            "devicePath": managed_path,
            "reason": "transaction-reference-property-unavailable",
        }
    return {
        "status": "missing-wiring",
        "devicePlaced": True,
        "deviceCount": 1,
        "callerFound": caller_found,
        "transactionsAssigned": False,
        "devicePath": managed_path,
        "reason": "in-island-transactions-device-reference-is-not-linked-to-managed-device",
    }


def install_texture_import_bridge(port, editor_token, content_dir=None, asset_mount=None, project_file=None):
    """Keep a project import bridge alive without blocking the UEFN editor thread.

    Network polling runs on a daemon worker. The Slate callback only performs
    editor API work for jobs already received by that worker. The handle and
    stop event are retained on the Unreal module so re-running this script is
    idempotent and does not accumulate callbacks.
    """
    try:
        import unreal
    except ImportError:
        print("[TransactionManager] Unreal Python API is unavailable; running without the UEFN editor texture-import callback.")
        return None
    import queue
    import threading

    unregister = getattr(unreal, "unregister_slate_post_tick_callback", None)
    previous_stop = getattr(unreal, "_uem_texture_import_stop_event", None)
    if previous_stop is not None:
        previous_stop.set()
    previous_handle = getattr(unreal, "_uem_texture_import_callback_handle", None)
    if unregister is not None and previous_handle is not None:
        try:
            unregister(previous_handle)
        except Exception:
            pass

    stop_event = threading.Event()
    jobs = queue.Queue()
    results = queue.Queue()
    state = {
        "bridge_failures": 0,
        "heartbeat_failures": 0,
        "shutdown_requested": False,
        "last_error": None,
        "last_identity_report": 0.0,
        "project_ready": False,
        "readiness_reason": "initializing",
        "last_project_ready": None,
        "last_readiness_reason": None,
        "managed_device": {
            "status": "not-checked",
            "devicePlaced": False,
            "callerFound": False,
            "transactionsAssigned": False,
            "deviceCount": 0,
            "reason": "awaiting-verified-editor-readiness",
        },
        "last_managed_device_check": 0.0,
    }
    handle_holder = {"value": None}

    def report_editor_session():
        if not content_dir or not asset_mount:
            return
        identity_report = {
            "contentRoot": content_dir,
            "assetMount": asset_mount,
            "projectReady": state["project_ready"],
            "readinessReason": state["readiness_reason"],
            "processId": os.getpid(),
            "managedDevice": state["managed_device"],
        }
        if project_file:
            identity_report["projectFile"] = project_file
        _bridge_request(port, editor_token, "/api/editor/session", "POST", identity_report)
        state["last_identity_report"] = time.monotonic()
        state["heartbeat_failures"] = 0

    def bridge_worker():
        while not stop_event.is_set():
            try:
                response = _bridge_request(port, editor_token, "/api/texture/import/next")
                state["bridge_failures"] = 0
                state["last_error"] = None
                job = response.get("job") if isinstance(response, dict) else None
                if job:
                    jobs.put(job)
                    result = None
                    deadline = time.monotonic() + 120.0
                    while not stop_event.is_set() and time.monotonic() < deadline:
                        try:
                            result = results.get(timeout=0.25)
                            break
                        except queue.Empty:
                            continue
                    if result is None:
                        result = {"success": False, "error": "UEFN did not finish the texture import within two minutes."}
                    if not stop_event.is_set():
                        _bridge_request(port, editor_token, f"/api/texture/import/{job['jobId']}/result", "POST", result)
            except Exception as error:
                state["last_error"] = str(error)
                state["bridge_failures"] += 1
                if state["bridge_failures"] >= 3:
                    state["shutdown_requested"] = True
                    stop_event.set()
                    break
            stop_event.wait(0.5)

    def heartbeat_worker():
        while not stop_event.is_set():
            try:
                report_editor_session()
                state["last_error"] = None
            except Exception as error:
                state["last_error"] = str(error)
                state["heartbeat_failures"] += 1
                if state["heartbeat_failures"] >= 3:
                    state["shutdown_requested"] = True
                    stop_event.set()
                    break
            stop_event.wait(EDITOR_HEARTBEAT_INTERVAL_SECONDS)

    def on_editor_tick(delta_seconds):
        del delta_seconds
        readiness = _editor_project_readiness(unreal, project_file, asset_mount)
        next_project_ready = bool(readiness["ready"])
        next_readiness_reason = readiness["reason"]
        if state["last_project_ready"] is None or state["last_project_ready"] != next_project_ready or state["last_readiness_reason"] != next_readiness_reason:
            unreal.log(f"[TransactionManager] Verified project readiness changed: ready={next_project_ready}, reason={next_readiness_reason}")
            state["last_project_ready"] = next_project_ready
            state["last_readiness_reason"] = next_readiness_reason
        state["project_ready"] = next_project_ready
        state["readiness_reason"] = next_readiness_reason
        now = time.monotonic()
        if not next_project_ready:
            state["managed_device"] = {
                "status": "not-checked",
                "devicePlaced": False,
                "callerFound": False,
                "transactionsAssigned": False,
                "deviceCount": 0,
                "reason": f"project-not-ready:{next_readiness_reason}",
            }
        elif now - state["last_managed_device_check"] >= TRANSACTION_DEVICE_CHECK_INTERVAL_SECONDS:
            state["managed_device"] = _managed_device_readiness(unreal, content_dir)
            state["last_managed_device_check"] = now
        if state["shutdown_requested"]:
            stop_event.set()
            callback_handle = handle_holder["value"]
            if unregister is not None and callback_handle is not None:
                try:
                    unregister(callback_handle)
                except Exception:
                    pass
            if getattr(unreal, "_uem_texture_import_callback_handle", None) == callback_handle:
                setattr(unreal, "_uem_texture_import_callback", None)
                setattr(unreal, "_uem_texture_import_callback_handle", None)
                setattr(unreal, "_uem_texture_import_stop_event", None)
                setattr(unreal, "_uem_texture_import_worker", None)
                setattr(unreal, "_uem_texture_heartbeat_worker", None)
            if state["last_error"]:
                try:
                    unreal.log_warning(f"[TransactionManager] Texture import bridge stopped: {state['last_error']}")
                except Exception:
                    pass
            return

        try:
            job = jobs.get_nowait()
        except queue.Empty:
            return

        try:
            results.put(import_texture_job(
                job,
                lambda job_id: _bridge_request(
                    port,
                    editor_token,
                    f"/api/texture/import/{job_id}/normalize",
                    method="POST",
                    payload={},
                ),
            ))
        except Exception as error:
            results.put({"success": False, "error": str(error)})

    callback_handle = unreal.register_slate_post_tick_callback(on_editor_tick)
    handle_holder["value"] = callback_handle
    # Keep both references on the persistent Unreal Python module. This avoids
    # relying on the Execute Python Script frame retaining the callback closure.
    setattr(unreal, "_uem_texture_import_callback", on_editor_tick)
    setattr(unreal, "_uem_texture_import_callback_handle", callback_handle)
    setattr(unreal, "_uem_texture_import_stop_event", stop_event)
    worker = threading.Thread(target=bridge_worker, name="UEM-TextureBridge", daemon=True)
    setattr(unreal, "_uem_texture_import_worker", worker)
    heartbeat = threading.Thread(target=heartbeat_worker, name="UEM-EditorHeartbeat", daemon=True)
    setattr(unreal, "_uem_texture_heartbeat_worker", heartbeat)
    worker.start()
    heartbeat.start()
    unreal.log("[TransactionManager] Texture import editor bridge registered.")
    return callback_handle


def verify_health(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1.0) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return response.status == 200 and payload.get("server") == SERVER_IDENTITY and payload.get("version") == SERVER_VERSION
    except Exception:
        return False


def attach_to_standalone_session(content_dir, asset_mount):
    """Attach editor-only imports to an already linked standalone Transaction Manager session."""
    state_root = os.environ.get("LOCALAPPDATA", tempfile.gettempdir())
    session_path = os.path.join(state_root, "UEFN Entitlement Manager", "active-session.json")
    if not os.path.isfile(session_path):
        return False

    try:
        with open(session_path, "r", encoding="utf-8") as session_file:
            session = json.load(session_file)
        port = int(session.get("port", 0))
        editor_token = session.get("editorToken", "")
        linked_root = session.get("contentRoot", "")
        linked_mount = session.get("assetMount", "")
        linked_project_file = session.get("projectFile", "")
        if session.get("schemaVersion") != 1 or not 1024 <= port <= 65535 or not isinstance(editor_token, str) or len(editor_token) < 32:
            return False
        if not verify_health(port):
            return False

        normalized_active = os.path.normcase(os.path.realpath(content_dir))
        normalized_linked = os.path.normcase(os.path.realpath(linked_root))
        if normalized_active != normalized_linked or asset_mount != linked_mount:
            raise RuntimeError(
                "The open UEFN project does not match the project linked in Transaction Manager. "
                "Restart Transaction Manager and choose this project from its boot menu before attaching editor imports."
            )

        install_texture_import_bridge(port, editor_token, content_dir, asset_mount, linked_project_file)
        print("[TransactionManager] Optional editor connector attached to the existing standalone Transaction Manager window.")
        return True
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f"[TransactionManager] Standalone session could not be attached: {error}")
        return False


def main():
    print("UEFN Transaction Manager | ADEPT Interactive")
    try:
        content_dir = get_uefn_content_dir()
        asset_mount = get_uefn_asset_mount()
        if attach_to_standalone_session(content_dir, asset_mount):
            return
        raise RuntimeError(
            "No active Electron manager session is linked to this project. "
            "Open UEFN Transaction Manager, confirm this .uefnproject in its project picker, "
            "and leave the manager open while using native texture imports."
        )
    except Exception as error:
        print(f"[TransactionManager] Editor attachment failed: {error}")
        raise


if __name__ == "__main__":
    main()
