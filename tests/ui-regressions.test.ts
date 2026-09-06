import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isNewCreationRequest } from '../src/services/creationIntent';
import { readActiveProjectFromCurrentLog } from '../electron/projectDiscovery';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('UEFN discovery accepts normal post-open project-browser selection but stays fail-closed without an open record', () => {
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-project-discovery-'));
  const logDirectory = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  const projectFile = path.join(localAppData, 'TaB', 'TaB.uefnproject').replaceAll('\\', '/');
  const logPath = path.join(logDirectory, 'UnrealEditorFortnite.log');
  try {
    process.env.LOCALAPPDATA = localAppData;
    fs.writeFileSync(logPath, `Successfully opened project '${projectFile}'\nLogValkyrieProjectBrowser: Selected Project (Direct): {}`);
    assert.equal(readActiveProjectFromCurrentLog(), projectFile);
    fs.writeFileSync(logPath, 'LogValkyrieProjectBrowser: Selected Project (Direct): {}');
    assert.equal(readActiveProjectFromCurrentLog(), null);
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
});

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

test('offer creation is an explicit one-shot intent and cannot be replayed by workspace remounts', () => {
  const chooserSource = read(path.join('src', 'components', 'EntitlementList.tsx'));
  const appSource = read(path.join('src', 'App.tsx'));
  let lastConsumedRequest = 0;

  // Case 1 / 3: an explicit new-entitlement request opens once, then the
  // same request is inert after the chooser/editor flow closes.
  assert.equal(isNewCreationRequest(1, lastConsumedRequest), true);
  lastConsumedRequest = 1;
  assert.equal(isNewCreationRequest(1, lastConsumedRequest), false);

  // Case 2: the direct Create Offer controls remain local explicit actions.
  assert.match(chooserSource, /onClick=\{\(\) => setIsCreationMenuOpen\(true\)\}/);

  // Case 4 / 5: revision refreshes and Catalog/Catalog + Verse remounts do
  // not replay the already-consumed request id.
  assert.equal(isNewCreationRequest(1, 1), false);
  assert.match(chooserSource, /const lastCreationRequestRef = useRef\(creationRequest\)/);
  assert.match(chooserSource, /isNewCreationRequest\(creationRequest, lastCreationRequestRef\.current\)/);
  assert.doesNotMatch(chooserSource, /if \(creationRequest > 0\) setIsCreationMenuOpen/);

  // Case 6: a new App/project starts with no pending event, so an old
  // project request cannot leak into it.
  assert.equal(isNewCreationRequest(0, 0), false);
  assert.match(appSource, /const \[creationChooserRequest, setCreationChooserRequest\]/);
  assert.match(appSource, /const requestOfferCreation = \(\) => setCreationChooserRequest\(request => request \+ 1\)/);

  // Case 7: merely having an entitlement without an offer is not an opener;
  // no derived catalog condition is allowed to drive the chooser effect.
  assert.doesNotMatch(chooserSource, /entitlements\.length[\s\S]{0,160}setIsCreationMenuOpen\(true\)/);
});

test('paid-random guidance separates the optional Transaction Manager field from the required island disclosure', () => {
  const modalSource = read(path.join('src', 'components', 'EntitlementModal.tsx'));
  const cardSource = read(path.join('src', 'components', 'EntitlementCard.tsx'));
  const presetSource = read(path.join('src', 'constants', 'presets.ts'));
  const readmeSource = read('README.md');
  assert.match(modalSource, /Optional odds disclosure/);
  assert.match(modalSource, /Accurate numerical odds are required before purchase/);
  assert.match(modalSource, /optional: enter them here/);
  assert.match(modalSource, /elsewhere in your island and clearly direct players there/);
  assert.match(modalSource, /Leaving it empty is allowed in Transaction Manager/);
  assert.match(cardSource, /No odds entered in Transaction Manager/);
  assert.match(presetSource, /optional Transaction Manager odds disclosure field/);
  assert.match(readmeSource, /Transaction Manager's odds field is optional/);
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
  assert.match(bridgeSource, /watchForEditorBootstrap/);
  assert.match(bridgeSource, /projectIsOpen\(projectFile/);
  assert.match(bridgeSource, /editorBootstrapWatcher = setInterval/);
  assert.match(bridgeSource, /retryDelays = \[0, 2_000, 5_000/);
  assert.match(bridgeSource, /editorBootstrapExhausted/);
  assert.match(discoverySource, /latestStartup/);
  assert.match(serverSource, /latestStartup/);
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
  assert.match(launcherSource, /\.adept-logo\{display:flex;align-items:center;justify-content:center;width:46px;height:26px/);
  assert.match(launcherSource, /\.adept-logo img\{[^}]*width:42px;height:42px/);
  assert.doesNotMatch(launcherSource, /\.adept-logo img\{[^}]*transform:/);
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

test('release shell uses stable application identity and versioned artifacts', () => {
  const version = JSON.parse(read('version.json')).version as string;
  const packageVersion = JSON.parse(read('package.json')).version as string;
  const builder = JSON.parse(read('electron-builder.json')) as { appId: string; productName: string; executableName: string; nsis: { artifactName: string; oneClick: boolean; perMachine: boolean; createDesktopShortcut: boolean }; win: { electronLanguages: string[] } };
  const releaseScript = read(path.join('scripts', 'build-release.ps1'));
  assert.equal(builder.appId, 'AD3PTInteractive.UEFNEntitlementManager');
  assert.equal(builder.productName, 'UEFN Transaction Manager');
  assert.equal(builder.executableName, 'UEFN Transaction Manager');
  assert.equal(builder.nsis.artifactName, 'UEFN-Transaction-Manager-Setup-${version}.${ext}');
  assert.equal(builder.nsis.oneClick, true);
  assert.equal(builder.nsis.perMachine, false);
  assert.equal(builder.nsis.createDesktopShortcut, false);
  assert.deepEqual(builder.win.electronLanguages, ['en-US']);
  assert.ok(releaseScript.includes('UEFN-Transaction-Manager-Setup-$appVersion.exe'));
  assert.ok(releaseScript.includes('UEFN-Transaction-Manager-$appVersion-Portable.zip'));
  assert.ok(releaseScript.includes('UEFN-Transaction-Manager-Installer.exe'));
  assert.ok(releaseScript.includes('portable.json'));
  assert.equal(packageVersion, version);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});
