import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock


class EntitlementManagerPathTests(unittest.TestCase):
    def test_auto_connector_only_claims_the_matching_open_project(self):
        import uefn_auto_connector

        with tempfile.TemporaryDirectory() as temp_dir:
            active_content = os.path.join(temp_dir, "Active", "Content")
            other_content = os.path.join(temp_dir, "Other", "Content")
            os.makedirs(active_content)
            os.makedirs(other_content)
            connector = types.SimpleNamespace(
                get_uefn_content_dir=lambda: active_content,
                get_uefn_asset_mount=lambda: "/ActiveProject",
            )
            self.assertTrue(uefn_auto_connector._session_matches_this_project(connector, {
                "contentRoot": active_content,
                "assetMount": "/ActiveProject",
            }))
            self.assertFalse(uefn_auto_connector._session_matches_this_project(connector, {
                "contentRoot": other_content,
                "assetMount": "/OtherProject",
            }))

    def test_local_launcher_skips_editor_texture_callback_without_unreal(self):
        import entitlement_manager

        with mock.patch.dict(sys.modules, {"unreal": None}):
            self.assertIsNone(entitlement_manager.install_texture_import_bridge(43210, "editor-secret"))

    def test_uefn_mount_resolves_project_content_instead_of_host_content(self):
        import entitlement_manager

        with tempfile.TemporaryDirectory() as temp_dir:
            host_content = os.path.join(temp_dir, "FortniteGame", "Content")
            project_content = os.path.join(temp_dir, "UEFNProject", "Content")
            os.makedirs(host_content)
            os.makedirs(project_content)

            unreal = types.SimpleNamespace(
                Paths=types.SimpleNamespace(
                    project_content_dir=lambda: host_content,
                    project_dir=lambda: os.path.dirname(host_content),
                    convert_relative_path_to_full=lambda path: path,
                ),
                EditorAssetLibrary=types.SimpleNamespace(
                    get_project_root_asset_directory=lambda: "/UEFNProject/",
                ),
                PluginBlueprintLibrary=types.SimpleNamespace(
                    get_plugin_content_dir=lambda name: project_content if name == "UEFNProject" else None,
                ),
            )

            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                self.assertEqual(entitlement_manager.get_uefn_content_dir(), os.path.normpath(project_content))

    def test_uefn_project_plugin_fallback_resolves_mount_when_root_reports_game(self):
        import entitlement_manager

        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = os.path.join(temp_dir, "Fortnite Projects", "UEFNProject")
            plugin_dir = os.path.join(project_dir, "Plugins", "UEFNProject")
            project_content = os.path.join(plugin_dir, "Content")
            host_content = os.path.join(temp_dir, "FortniteGame", "Content")
            os.makedirs(project_content)
            os.makedirs(host_content)
            open(os.path.join(project_dir, "UEFNProject.uefnproject"), "w").close()

            plugin_library = types.SimpleNamespace(
                get_enabled_plugin_names=lambda: ["UEFNProject"],
                get_plugin_base_dir=lambda name: plugin_dir if name == "UEFNProject" else None,
                get_plugin_content_dir=lambda name: project_content if name == "UEFNProject" else None,
            )
            unreal = types.SimpleNamespace(
                Paths=types.SimpleNamespace(
                    project_content_dir=lambda: host_content,
                    project_dir=lambda: os.path.dirname(host_content),
                    convert_relative_path_to_full=lambda path: path,
                ),
                EditorAssetLibrary=types.SimpleNamespace(get_project_root_asset_directory=lambda: "/Game/"),
                PluginBlueprintLibrary=plugin_library,
            )

            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                self.assertEqual(entitlement_manager.get_uefn_content_dir(), os.path.normpath(project_content))
                self.assertEqual(entitlement_manager.get_uefn_asset_mount(), "/UEFNProject")

    def test_uefn_mount_normalizes_bare_project_root_reported_by_live_editor(self):
        import entitlement_manager

        unreal = types.SimpleNamespace(
            EditorAssetLibrary=types.SimpleNamespace(
                get_project_root_asset_directory=lambda: "Asset_Sandbox",
            ),
        )

        with mock.patch.dict(sys.modules, {"unreal": unreal}):
            self.assertEqual(entitlement_manager.get_uefn_asset_mount(), "/Asset_Sandbox")

    def test_standard_unreal_project_uses_project_content_directory(self):
        import entitlement_manager

        with tempfile.TemporaryDirectory() as project_dir:
            project_content = os.path.join(project_dir, "Content")
            os.makedirs(project_content)
            unreal = types.SimpleNamespace(
                Paths=types.SimpleNamespace(
                    project_content_dir=lambda: project_content,
                    project_dir=lambda: project_dir,
                    convert_relative_path_to_full=lambda path: path,
                ),
                EditorAssetLibrary=types.SimpleNamespace(
                    get_project_root_asset_directory=lambda: "/Game/",
                ),
            )

            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                self.assertEqual(entitlement_manager.get_uefn_content_dir(), os.path.normpath(project_content))

    def test_confirmed_texture_uses_editor_asset_tools_and_saves_content_browser_asset(self):
        import entitlement_manager

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as source:
            source.write(b"png")
            source_path = source.name

        imported_paths = []
        saved_paths = []
        synced_paths = []

        class AssetImportTask:
            imported_object_paths = []

        class EditorAssetLibrary:
            @staticmethod
            def get_project_root_asset_directory():
                return "/UEFNProject/"

            @staticmethod
            def make_directory(path):
                imported_paths.append(f"mkdir:{path}")

            @staticmethod
            def does_asset_exist(path):
                return path == "/UEFNProject/EntitlementIcons/VipPass.VipPass"

            @staticmethod
            def load_asset(path):
                return object() if path == "/UEFNProject/EntitlementIcons/VipPass.VipPass" else None

            @staticmethod
            def save_asset(path):
                saved_paths.append(path)
                return True

            @staticmethod
            def sync_browser_to_objects(paths):
                synced_paths.extend(paths)

        class AssetTools:
            @staticmethod
            def import_asset_tasks(tasks):
                tasks[0].imported_object_paths = ["/UEFNProject/EntitlementIcons/VipPass.VipPass"]

        unreal = types.SimpleNamespace(
            EditorAssetLibrary=EditorAssetLibrary,
            AssetImportTask=AssetImportTask,
            AssetToolsHelpers=types.SimpleNamespace(get_asset_tools=lambda: AssetTools()),
            log=lambda _message: None,
        )

        try:
            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                result = entitlement_manager.import_texture_job({
                    "assetFolderName": "EntitlementIcons",
                    "assetName": "VipPass",
                    "sourcePath": source_path,
                })
            self.assertEqual(result["assetObjectPath"], "/UEFNProject/EntitlementIcons/VipPass.VipPass")
            self.assertEqual(imported_paths, ["mkdir:/UEFNProject/EntitlementIcons"])
            self.assertEqual(saved_paths, ["/UEFNProject/EntitlementIcons/VipPass.VipPass"])
            self.assertEqual(synced_paths, saved_paths)
        finally:
            os.unlink(source_path)

    def test_existing_texture_adoption_exports_through_unreal_before_import(self):
        import entitlement_manager

        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = os.path.join(temp_dir, "adopted.png")
            imported_paths = []

            class TextureClass:
                @staticmethod
                def get_name():
                    return "Texture2D"

            class Texture:
                @staticmethod
                def get_class():
                    return TextureClass()

            class AssetImportTask:
                imported_object_paths = []

            class EditorAssetLibrary:
                @staticmethod
                def get_project_root_asset_directory():
                    return "/ProjectMount/"

                @staticmethod
                def load_asset(path):
                    return Texture() if path in {
                        "/ProjectMount/OldShopIcons/Vip.Vip",
                        "/ProjectMount/EntitlementIcons/VipPass.VipPass",
                    } else None

                @staticmethod
                def make_directory(_path):
                    pass

                @staticmethod
                def does_asset_exist(path):
                    return path.endswith("VipPass.VipPass")

                @staticmethod
                def save_asset(_path):
                    return True

                @staticmethod
                def sync_browser_to_objects(_paths):
                    pass

            class AssetTools:
                @staticmethod
                def import_asset_tasks(tasks):
                    tasks[0].imported_object_paths = ["/ProjectMount/EntitlementIcons/VipPass.VipPass"]
                    imported_paths.append(tasks[0].filename)

            class RenderingLibrary:
                @staticmethod
                def export_texture2d(_world, _texture, directory, filename):
                    with open(os.path.join(directory, filename + ".png"), "wb") as exported:
                        exported.write(b"png")

            unreal = types.SimpleNamespace(
                EditorAssetLibrary=EditorAssetLibrary,
                RenderingLibrary=RenderingLibrary,
                AssetImportTask=AssetImportTask,
                AssetToolsHelpers=types.SimpleNamespace(get_asset_tools=lambda: AssetTools()),
                log=lambda _message: None,
            )
            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                result = entitlement_manager.import_texture_job({
                    "assetFolderName": "EntitlementIcons",
                    "assetName": "VipPass",
                    "sourcePath": source_path,
                    "sourceKind": "uefn-texture",
                    "sourceAssetPath": "/ProjectMount/OldShopIcons/Vip.Vip",
                })
            self.assertEqual(result["assetObjectPath"], "/ProjectMount/EntitlementIcons/VipPass.VipPass")
            self.assertEqual(imported_paths, [source_path])

    def test_editor_bridge_requests_use_the_editor_session_header(self):
        import entitlement_manager

        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"{}"
        with mock.patch.object(entitlement_manager.urllib.request, "urlopen", return_value=response) as urlopen:
            entitlement_manager._bridge_request(43210, "editor-secret", "/api/texture/import/next")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("X-uem-editor-token"), "editor-secret")
        self.assertIsNone(request.get_header("X-uem-token"))

    def test_python_connector_attaches_to_matching_standalone_session(self):
        import entitlement_manager

        with tempfile.TemporaryDirectory() as temp_dir:
            content_dir = os.path.join(temp_dir, "Project", "Content")
            state_dir = os.path.join(temp_dir, "UEFN Entitlement Manager")
            os.makedirs(content_dir)
            os.makedirs(state_dir)
            with open(os.path.join(state_dir, "active-session.json"), "w", encoding="utf-8") as session_file:
                json.dump({
                    "schemaVersion": 1,
                    "port": 43210,
                    "editorToken": "editor-secret".ljust(48, "x"),
                    "contentRoot": content_dir,
                    "assetMount": "/StandaloneTest",
                }, session_file)

            with mock.patch.dict(os.environ, {"LOCALAPPDATA": temp_dir}):
                with mock.patch.object(entitlement_manager, "verify_health", return_value=True):
                    with mock.patch.object(entitlement_manager, "install_texture_import_bridge", return_value="handle") as install:
                        self.assertTrue(entitlement_manager.attach_to_standalone_session(content_dir, "/StandaloneTest"))
                        install.assert_called_once_with(43210, "editor-secret".ljust(48, "x"), content_dir, "/StandaloneTest")

    def test_editor_tick_callback_is_retained_by_the_unreal_module(self):
        import entitlement_manager

        unreal = types.SimpleNamespace(
            register_slate_post_tick_callback=lambda callback: "callback-handle",
            log=lambda _message: None,
            log_warning=lambda _message: None,
        )
        with mock.patch.object(entitlement_manager, "_bridge_request", return_value={"job": None}):
            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                self.assertEqual(entitlement_manager.install_texture_import_bridge(43210, "editor-secret"), "callback-handle")
                self.assertTrue(callable(unreal._uem_texture_import_callback))
                self.assertEqual(unreal._uem_texture_import_callback_handle, "callback-handle")
                unreal._uem_texture_import_stop_event.set()

    def test_editor_tick_bridge_replaces_previous_callback_without_network_on_tick(self):
        import entitlement_manager

        registered = []
        unregistered = []

        def register(callback):
            handle = f"callback-{len(registered) + 1}"
            registered.append((handle, callback))
            return handle

        unreal = types.SimpleNamespace(
            register_slate_post_tick_callback=register,
            unregister_slate_post_tick_callback=lambda handle: unregistered.append(handle),
            log=lambda _message: None,
            log_warning=lambda _message: None,
        )
        with mock.patch.object(entitlement_manager, "_bridge_request", return_value={"job": None}) as bridge_request:
            with mock.patch.dict(sys.modules, {"unreal": unreal}):
                entitlement_manager.install_texture_import_bridge(43210, "first-secret")
                first_stop = unreal._uem_texture_import_stop_event
                entitlement_manager.install_texture_import_bridge(43211, "second-secret")
                calls_before_tick = bridge_request.call_count
                unreal._uem_texture_import_callback(0.016)
                self.assertEqual(bridge_request.call_count, calls_before_tick)
                second_stop = unreal._uem_texture_import_stop_event

        self.assertEqual(unregistered, ["callback-1"])
        self.assertTrue(first_stop.is_set())
        second_stop.set()


if __name__ == "__main__":
    unittest.main()
