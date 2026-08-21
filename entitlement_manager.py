"""Attach optional UEFN editor automation to an active Transaction Manager session."""

import json
import os
import re
import tempfile
import time
import urllib.request

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_IDENTITY = "UEFN Entitlement Manager Bridge"
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
    with urllib.request.urlopen(request, timeout=1.5) as response:
        return json.loads(response.read().decode("utf-8"))


def import_texture_job(job):
    """Import one queued PNG through UEFN's editor APIs on the editor thread."""
    import unreal

    asset_folder = str(job.get("assetFolderName", ""))
    asset_name = str(job.get("assetName", ""))
    source_path = str(job.get("sourcePath", ""))
    if not VERSE_IDENTIFIER_PATTERN.fullmatch(asset_folder) or not VERSE_IDENTIFIER_PATTERN.fullmatch(asset_name):
        raise RuntimeError("The texture job contains an invalid UEFN asset identifier.")
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


def install_texture_import_bridge(port, editor_token, content_dir=None, asset_mount=None):
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
        "shutdown_requested": False,
        "last_error": None,
        "last_identity_report": 0.0,
    }
    handle_holder = {"value": None}

    def bridge_worker():
        while not stop_event.is_set():
            try:
                now = time.monotonic()
                if content_dir and asset_mount and now - state["last_identity_report"] >= 2.0:
                    _bridge_request(
                        port,
                        editor_token,
                        "/api/editor/session",
                        "POST",
                        {"contentRoot": content_dir, "assetMount": asset_mount, "processId": os.getpid()},
                    )
                    state["last_identity_report"] = now
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

    def on_editor_tick(delta_seconds):
        del delta_seconds
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
            results.put(import_texture_job(job))
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
    worker.start()
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

        install_texture_import_bridge(port, editor_token, content_dir, asset_mount)
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
