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
  const desktopSource = read(path.join('electron', 'main.ts'));
  assert.match(appSource, />Need Help\?<\/button>/);
  assert.doesNotMatch(verseSource, /Beginner setup/i);
  assert.doesNotMatch(titleBarSource, /uem-mark\.svg|UEFN Entitlement Manager/);
  assert.match(titleBarSource, /text-rose-400/);
  assert.match(desktopSource, /frame:\s*false/);
  assert.match(desktopSource, /uem:window:action/);
  assert.match(desktopSource, /new BrowserWindow/);
  assert.match(desktopSource, /setAppUserModelId/);
  assert.match(desktopSource, /icon:\s*iconPath/);
});

test('creator guidance and template chooser stay streamlined', () => {
  const appSource = read(path.join('src', 'App.tsx'));
  const setupSource = read(path.join('src', 'components', 'SetupPanel.tsx'));
  const chooserSource = read(path.join('src', 'components', 'EntitlementList.tsx'));
  const userFacingPythonCopy = [appSource, setupSource, read('README.md'), read('README-USER.txt'), read(path.join('server', 'index.ts')), read(path.join('electron', 'launcher.html'))].join('\n');
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
  const programSource = read(path.join('electron', 'main.ts'));
  const discoverySource = read(path.join('electron', 'projectDiscovery.ts'));
  const bridgeSource = read(path.join('electron', 'bridgeSession.ts'));
  const nativeSource = read(path.join('electron', 'nativeWindows.ts'));
  const preloadSource = read(path.join('electron', 'preload.ts'));
  const launcherMarkup = read(path.join('electron', 'launcher.html'));
  const launcherScript = read(path.join('electron', 'launcher.js'));
  const serverSource = read(path.join('server', 'index.ts'));
  assert.match(programSource, /await mainWindow\.loadURL\(launcherUrl\);[\s\S]+await loadProjectCandidates\(\);/);
  assert.match(programSource, /contextIsolation:\s*true/);
  assert.match(programSource, /nodeIntegration:\s*false/);
  assert.match(programSource, /sandbox:\s*true/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('uemDesktop'/);
  assert.match(launcherScript, /launcher\.onState\(applyState\)/);
  assert.match(launcherMarkup, /class="adept"/);
  assert.match(launcherMarkup, /uem-icon\.svg/);
  assert.doesNotMatch(launcherMarkup, /Region = new Region/);
  assert.doesNotMatch(discoverySource, /recursive:\s*true/);
  assert.match(discoverySource, /IGNORED_DIRECTORIES/);
  assert.match(discoverySource, /Successfully opened project/);
  assert.match(discoverySource, /EditorPerProjectUserSettings\.ini/);
  assert.match(discoverySource, /bEnablePythonForProject/);
  assert.match(bridgeSource, /UEM_PROJECT_FILE/);
  assert.match(bridgeSource, /active-session\.json/);
  assert.match(bridgeSource, /UEM_AUTO_CONNECTOR_BEGIN/);
  assert.match(bridgeSource, /uefn_auto_connector\.py/);
  assert.match(bridgeSource, /UEM_AUTO_CONNECTOR_INSTALLED/);
  assert.match(read('uefn_auto_connector.py'), /_session_matches_this_project/);
  assert.match(read('entitlement_manager.py'), /attach_to_standalone_session/);
  assert.match(serverSource, /selectedProjectIsActiveInUefn/);
  assert.match(serverSource, /\/api\/editor\/status/);
  assert.match(bridgeSource, /bootstrapOpenEditor/);
  assert.match(bridgeSource, /import uefn_auto_connector; uefn_auto_connector\.install\(\)/);
  assert.match(bridgeSource, /py import uefn_auto_connector/);
  assert.match(nativeSource, /FindWindowW/);
  assert.match(nativeSource, /SendInput/);
  assert.match(serverSource, /uefnIsRunning/);
  assert.match(serverSource, /differentProjectOpen/);
  assert.match(read(path.join('src', 'App.tsx')), /This project is open and fully connected/);
  assert.match(read(path.join('src', 'App.tsx')), /A different project is open in UEFN/);
  assert.match(read(path.join('src', 'App.tsx')), /UEFN is closed/);
});

test('launcher uses anti-aliased painted surfaces and a high-resolution mark', () => {
  const launcherSource = read(path.join('electron', 'launcher.html'));
  const packageSource = read(path.join('scripts', 'build-release.ps1'));
  assert.match(launcherSource, /linear-gradient/);
  assert.match(launcherSource, /uem-icon\.svg/);
  assert.match(packageSource, /electron\\assets\\uem-icon\.ico/);
});

test('ADEPT credit bubbles enlarge the visible logo rather than its transparent canvas', () => {
  const launcherSource = read(path.join('electron', 'launcher.html'));
  const headerSource = read(path.join('src', 'components', 'Header.tsx'));
  assert.match(launcherSource, /class="adept-logo"/);
  assert.match(launcherSource, /\.adept-logo\{width:42px;height:26px/);
  assert.match(launcherSource, /\.adept-logo img\{[^}]*transform:scale\(1\.5\)/);
  assert.match(headerSource, /overflow-hidden/);
  assert.match(headerSource, /scale\(1\.5\)/);
  assert.doesNotMatch(`${launcherSource}\n${headerSource}`, /scaleY\(/);
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
  const packageVersion = JSON.parse(read('package.json')).version as string;
  const expected = `UEFNEntitlementManager-${version}`;
  assert.ok(read(path.join('scripts', 'package-electron.mjs')).includes('UEFNEntitlementManager-${version}'));
  assert.ok(read(path.join('scripts', 'build-release.ps1')).includes('UEFNEntitlementManager-$appVersion.exe'));
  assert.equal(packageVersion, version);
  assert.match(expected, /^UEFNEntitlementManager-\d+\.\d+\.\d+$/);
});
