import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('interactive confirmations are app-rendered rather than browser-native', () => {
  const componentSources = fs.readdirSync(path.join(root, 'src', 'components'))
    .filter(fileName => fileName.endsWith('.tsx'))
    .map(fileName => read(path.join('src', 'components', fileName)))
    .join('\n');
  const appSource = read(path.join('src', 'App.tsx'));
  assert.doesNotMatch(`${appSource}\n${componentSources}`, /window\.(?:alert|confirm|prompt)\s*\(/);
  assert.match(componentSources, /role="alertdialog"/);
});

test('the supplied V-Bucks icon is bundled and rendered as a colorable mask', () => {
  const iconPath = path.join(root, 'public', 'vbucks-icon.png');
  assert.ok(fs.statSync(iconPath).size > 0);
  assert.ok(fs.statSync(iconPath).size < 20_000);
  assert.match(read(path.join('src', 'components', 'VBucksIcon.tsx')), /maskImage: 'url\(\/vbucks-icon\.png\)'/);
});

test('help is globally available and desktop chrome is app-rendered', () => {
  const appSource = read(path.join('src', 'App.tsx'));
  const verseSource = read(path.join('src', 'components', 'VersePreview.tsx'));
  const titleBarSource = read(path.join('src', 'components', 'DesktopTitleBar.tsx'));
  const desktopSource = read(path.join('desktop', 'Program.cs'));
  assert.match(appSource, />Need Help\?<\/button>/);
  assert.doesNotMatch(verseSource, /Beginner setup/i);
  assert.doesNotMatch(titleBarSource, /uem-mark\.svg|UEFN Entitlement Manager/);
  assert.match(titleBarSource, /text-rose-400/);
  assert.match(desktopSource, /FormBorderStyle = FormBorderStyle\.None/);
  assert.match(desktopSource, /window-action\|/);
  assert.match(desktopSource, /WindowNcHitTest/);
  assert.match(desktopSource, /SetCurrentProcessExplicitAppUserModelID/);
  assert.match(desktopSource, /ShowInTaskbar = true/);
  assert.match(read(path.join('desktop', 'UEFNEntitlementManager.Desktop.csproj')), /<ApplicationIcon>uem-icon\.ico<\/ApplicationIcon>/);
});

test('creator guidance and template chooser stay streamlined', () => {
  const appSource = read(path.join('src', 'App.tsx'));
  const setupSource = read(path.join('src', 'components', 'SetupPanel.tsx'));
  const chooserSource = read(path.join('src', 'components', 'EntitlementList.tsx'));
  const userFacingPythonCopy = [appSource, setupSource, read('README.md'), read('README-USER.txt'), read(path.join('server', 'index.ts')), read(path.join('desktop', 'ProjectLauncher.cs'))].join('\n');
  assert.doesNotMatch(userFacingPythonCopy, /restart UEFN/i);
  assert.match(setupSource, /palm tree icon/);
  assert.match(setupSource, /detects it immediately/);
  assert.doesNotMatch(setupSource, /Reward handling|legacy-named/);
  assert.doesNotMatch(chooserSource, /Starting price/);
  assert.match(chooserSource, /aria-expanded=\{selected\}/);
  assert.match(chooserSource, /whitespace-nowrap/);
  assert.match(chooserSource, /Use this template/);
});

test('standalone startup paints before discovery and automatically installs its UEFN connector', () => {
  const programSource = read(path.join('desktop', 'Program.cs'));
  const launcherSource = read(path.join('desktop', 'ProjectLauncher.cs'));
  const launcherMarkup = read(path.join('desktop', 'launcher.html'));
  const serverSource = read(path.join('server', 'index.ts'));
  assert.match(programSource, /new WebProjectLinkForm\(\)/);
  assert.match(launcherSource, /new WebView2/);
  assert.match(launcherSource, /NavigateToString\(document\)/);
  assert.match(launcherSource, /PostWebMessageAsJson\(SerializeState\(\)\)/);
  assert.match(launcherSource, /Task\.Run\(ProjectDiscovery\.Discover\)/);
  assert.match(launcherSource, /await RenderPageAsync\(\);\s+await LoadProjectsAsync\(\);/);
  assert.match(launcherMarkup, /addEventListener\('message',[^\n]+setLauncherState/);
  assert.doesNotMatch(launcherMarkup, /__INITIAL_STATE__/);
  assert.match(launcherMarkup, /class="adept"/);
  assert.match(launcherMarkup, /open-adept/);
  assert.match(launcherMarkup, /uem-icon\.svg/);
  assert.doesNotMatch(launcherMarkup, /Region = new Region/);
  assert.doesNotMatch(programSource, /new ProjectLinkForm\(ProjectDiscovery\.Discover\(\)\)/);
  assert.doesNotMatch(launcherSource, /EnumerateFiles\([^\n]+SearchOption\.AllDirectories/);
  assert.match(launcherSource, /ProjectScanIgnoredDirectories/);
  assert.match(launcherSource, /Successfully opened project/);
  assert.match(launcherSource, /EditorPerProjectUserSettings\.ini/);
  assert.match(launcherSource, /bEnablePythonForProject/);
  assert.match(launcherSource, /UEM_PROJECT_FILE/);
  assert.match(launcherSource, /active-session\.json/);
  assert.match(launcherSource, /UEM_AUTO_CONNECTOR_BEGIN/);
  assert.match(launcherSource, /uefn_auto_connector\.py/);
  assert.match(launcherSource, /UEM_AUTO_CONNECTOR_INSTALLED/);
  assert.match(read('uefn_auto_connector.py'), /_session_matches_this_project/);
  assert.match(read('entitlement_manager.py'), /attach_to_standalone_session/);
  assert.match(serverSource, /selectedProjectIsActiveInUefn/);
  assert.match(serverSource, /\/api\/editor\/status/);
  assert.match(launcherSource, /EditorBootstrap\.Begin/);
  assert.match(launcherSource, /import uefn_auto_connector; uefn_auto_connector\.install\(\)/);
  assert.match(launcherSource, /py import uefn_auto_connector/);
  assert.match(launcherSource, /GetForegroundWindow/);
  assert.match(launcherSource, /SendInput/);
  assert.match(serverSource, /uefnIsRunning/);
  assert.match(serverSource, /differentProjectOpen/);
  assert.match(read(path.join('src', 'App.tsx')), /This project is open and fully connected/);
  assert.match(read(path.join('src', 'App.tsx')), /A different project is open in UEFN/);
  assert.match(read(path.join('src', 'App.tsx')), /UEFN is closed/);
});

test('launcher uses anti-aliased painted surfaces and a high-resolution mark', () => {
  const launcherSource = read(path.join('desktop', 'ProjectLauncher.cs'));
  const projectSource = read(path.join('desktop', 'UEFNEntitlementManager.Desktop.csproj'));
  assert.match(launcherSource, /internal sealed class WebProjectLinkForm/);
  assert.match(projectSource, /<Content Include="uem-icon\.svg">/);
  assert.match(projectSource, /<Content Include="launcher\.html">/);
});

test('country flags use a guttered, lossless atlas rather than sampling adjacent tiles', () => {
  const spriteBuilder = read(path.join('scripts', 'build-flag-sprite.mjs'));
  const restrictionEditor = read(path.join('src', 'components', 'OfferRestrictionsEditor.tsx'));
  assert.match(spriteBuilder, /const gutter = 2/);
  assert.match(spriteBuilder, /lossless: true/);
  assert.match(restrictionEditor, /const cellWidth = 26/);
  assert.match(restrictionEditor, /const gutter = 1/);
});

test('release shell uses the exact versioned executable name', () => {
  const version = JSON.parse(read('version.json')).version as string;
  const expected = `UEFNEntitlementManager-${version}`;
  assert.ok(read(path.join('desktop', 'UEFNEntitlementManager.Desktop.csproj')).includes(`<AssemblyName>${expected}</AssemblyName>`));
  assert.doesNotMatch(read(path.join('scripts', 'build-release.ps1')), /UEFNEntitlementManager\.Desktop\.exe/);
});
