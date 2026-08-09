"""UEFN Entitlement Manager — In-Island Transactions & Verse Generator by ADEPT Interactive.

Run directly inside UEFN via:
    Tools > Execute Python Script...  ->  entitlement_manager.py

What this script does:
1. Automatically hooks into the active UEFN project and retrieves the Content/ directory.
2. Ensures the local Entitlement Manager bridge server is running in the background.
3. Opens a self-contained, dedicated application window focused on the active project.
"""

import os
import sys
import time
import urllib.request
import urllib.parse
import subprocess
import shutil

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_PORT = 3001
SERVER_HEALTH_URL = f"http://localhost:{SERVER_PORT}/api/health"

def get_uefn_content_dir():
    """Detect active UEFN project content directory via Unreal Python API."""
    try:
        import unreal
        # 1. Try project_content_dir
        content_dir = unreal.Paths.project_content_dir()
        if content_dir:
            full_path = unreal.Paths.convert_relative_path_to_full(content_dir)
            norm = os.path.normpath(full_path).rstrip("/\\")
            if os.path.isdir(norm):
                print(f"[EntitlementManager] Auto-detected UEFN Content Directory: {norm}")
                return norm

        # 2. Try project_dir + Content
        proj_dir = unreal.Paths.project_dir()
        if proj_dir:
            full_proj = unreal.Paths.convert_relative_path_to_full(proj_dir)
            candidate = os.path.normpath(os.path.join(full_proj, "Content")).rstrip("/\\")
            if os.path.isdir(candidate):
                print(f"[EntitlementManager] Auto-detected UEFN Content Directory: {candidate}")
                return candidate
    except Exception as e:
        print(f"[EntitlementManager] Unreal API notice: {e}")
    
    # Fallback to standard project paths if testing outside editor
    candidates = [
        r"<project-root>\TaB\Content",
        os.path.abspath(os.path.join(TOOL_DIR, "..", "Content")),
        os.path.abspath(os.path.join(os.getcwd(), "Content"))
    ]
    for c in candidates:
        if os.path.isdir(c):
            norm = os.path.normpath(c).rstrip("/\\")
            print(f"[EntitlementManager] Using fallback directory: {norm}")
            return norm
    return candidates[0]

def is_server_running():
    """Check if the backend bridge server is responding."""
    try:
        req = urllib.request.Request(SERVER_HEALTH_URL, method="GET")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            return resp.status == 200
    except Exception:
        return False

def find_node_executable():
    """Locate node.exe on Windows."""
    node_in_path = shutil.which("node")
    if node_in_path:
        return node_in_path
    
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\nodejs\node.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\node.exe"),
        os.path.expandvars(r"%LocalAppData%\Programs\node\node.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return "node"

def start_server_background():
    """Start the bundled node server in the background if not already running."""
    if is_server_running():
        print("[EntitlementManager] Bridge server is already active on port 3001.")
        return True

    print("[EntitlementManager] Starting local bridge server...")
    
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

    node_bin = find_node_executable()
    bundled_server = os.path.join(TOOL_DIR, "dist", "server.cjs")
    
    if os.path.isfile(bundled_server):
        cmd = [node_bin, bundled_server]
    else:
        # Fallback to npx tsx
        npx_bin = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
        cmd = [npx_bin, "tsx", os.path.join(TOOL_DIR, "server", "index.ts")]

    try:
        subprocess.Popen(
            cmd,
            cwd=TOOL_DIR,
            creationflags=flags,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            close_fds=True
        )
    except Exception as e:
        print(f"[EntitlementManager] Subprocess start notice: {e}")


    # Wait up to 5 seconds for health check
    for _ in range(10):
        time.sleep(0.5)
        if is_server_running():
            print("[EntitlementManager] Bridge server is ready.")
            return True

    print("[EntitlementManager] Bridge server initialized.")
    return True

def launch_app_window(content_dir):
    """Open a self-contained, dedicated desktop app window."""
    encoded_dir = urllib.parse.quote(content_dir)
    app_url = f"http://localhost:{SERVER_PORT}/?contentDir={encoded_dir}&assetFolder=EntitlementIcons&verseFile=managed_transactions.verse"

    browsers = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]

    for browser_exe in browsers:
        if os.path.isfile(browser_exe):
            cmd = [
                browser_exe,
                f"--app={app_url}",
                "--window-size=1400,900",
                "--window-position=100,50"
            ]
            try:
                subprocess.Popen(cmd)
                print(f"[EntitlementManager] Launched dedicated app window.")
                return
            except Exception:
                pass

    # Fallback to default web browser
    import webbrowser
    webbrowser.open(app_url)
    print(f"[EntitlementManager] Opened Entitlement Manager in browser at {app_url}")

def main():
    print("====================================================================")
    print(" UEFN Entitlement Manager | ADEPT Interactive")
    print("====================================================================")
    
    content_dir = get_uefn_content_dir()
    start_server_background()
    launch_app_window(content_dir)

if __name__ == "__main__":
    main()
