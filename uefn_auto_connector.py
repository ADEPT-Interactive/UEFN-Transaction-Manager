"""Project-installed Transaction Manager connector loaded automatically by UEFN Python tooling."""

import importlib.util
import json
import os
import threading
import time
import urllib.request

try:
    import unreal
except ImportError:
    unreal = None


STATE_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "UEFN Entitlement Manager",
    "active-session.json",
)


def _read_ready_session():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as state_file:
            state = json.load(state_file)
        port = int(state.get("port", 0))
        token = state.get("editorToken", "")
        connector = state.get("connectorScript", "")
        if state.get("schemaVersion") != 1 or not 1024 <= port <= 65535:
            return None
        if not isinstance(token, str) or len(token) < 32 or not os.path.isfile(connector):
            return None
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.75) as response:
            health = json.loads(response.read().decode("utf-8"))
        if response.status != 200 or health.get("server") != "UEFN Entitlement Manager Bridge":
            return None
        return state
    except Exception:
        return None


def _load_connector(script_path):
    module_name = "uem_editor_connector_runtime"
    specification = importlib.util.spec_from_file_location(module_name, script_path)
    if specification is None or specification.loader is None:
        raise RuntimeError("Transaction Manager editor connector could not be loaded.")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def _session_matches_this_project(connector, state):
    """Prevent another open UEFN editor from claiming this project's Transaction Manager session."""
    active_content = os.path.normcase(os.path.realpath(connector.get_uefn_content_dir()))
    expected_content = os.path.normcase(os.path.realpath(state["contentRoot"]))
    active_mount = str(connector.get_uefn_asset_mount()).rstrip("/")
    expected_mount = str(state["assetMount"]).rstrip("/")
    return active_content == expected_content and active_mount.casefold() == expected_mount.casefold()


def install():
    """Start one background discovery worker and attach on the UEFN editor thread."""
    if unreal is None:
        return False
    previous_stop = getattr(unreal, "_uem_auto_connector_stop_event", None)
    if previous_stop is not None:
        previous_stop.set()
    previous_handle = getattr(unreal, "_uem_auto_connector_tick_handle", None)
    if previous_handle is not None:
        try:
            unreal.unregister_slate_post_tick_callback(previous_handle)
        except Exception:
            pass

    stop_event = threading.Event()
    pending_lock = threading.Lock()
    pending = {"state": None}
    attached_signature = {"value": None}

    def discover():
        while not stop_event.wait(1.0):
            state = _read_ready_session()
            if state is None:
                continue
            signature = (state.get("desktopProcessId"), state.get("port"), state.get("editorToken"))
            if signature == attached_signature["value"]:
                continue
            with pending_lock:
                pending["state"] = state

    def tick(_delta_seconds):
        with pending_lock:
            state = pending["state"]
            pending["state"] = None
        if state is None:
            return
        signature = (state.get("desktopProcessId"), state.get("port"), state.get("editorToken"))
        try:
            connector = _load_connector(state["connectorScript"])
            if not _session_matches_this_project(connector, state):
                return
            connector.install_texture_import_bridge(
                int(state["port"]),
                state["editorToken"],
                state["contentRoot"],
                state["assetMount"],
            )
            attached_signature["value"] = signature
            unreal.log("[TransactionManager] Automatically attached native texture importing to the standalone Transaction Manager session.")
        except Exception as error:
            unreal.log_warning(f"[TransactionManager] Automatic editor attachment failed: {error}")

    worker = threading.Thread(target=discover, name="UEMAutoConnector", daemon=True)
    worker.start()
    handle = unreal.register_slate_post_tick_callback(tick)
    unreal._uem_auto_connector_stop_event = stop_event
    unreal._uem_auto_connector_thread = worker
    unreal._uem_auto_connector_tick_callback = tick
    unreal._uem_auto_connector_tick_handle = handle
    unreal.log("[TransactionManager] Automatic standalone connector is monitoring for Transaction Manager sessions.")
    return True
