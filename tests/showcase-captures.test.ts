import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createHealthyShowcaseConnection } from '../src/services/showcaseMode.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const screenshotRoot = path.join(root, 'docs', 'screenshots');

const expectedScreenshots = [
  'phase28-launcher.png',
  'phase28-catalog-overview.png',
  'phase28-offer-general-pricing.png',
  'phase28-icon-texture.png',
  'phase28-behavior-moderation.png',
  'phase28-dynamic-pricing.png',
  'phase28-bundles.png',
  'phase28-storefronts.png',
  'phase28-validation.png',
  'phase28-verse-split.png',
];

test('launcher and manager share the compact 48px Discord control geometry', () => {
  const brandSource = read('src/components/BrandControls.tsx');
  const headerSource = read('src/components/Header.tsx');
  const launcherSource = read('electron/launcher.html');
  assert.match(brandSource, /DISCORD_CONTROL_SIZE = 48/);
  assert.match(brandSource, /DISCORD_ICON_SIZE = 30/);
  assert.match(headerSource, /DISCORD_CONTROL_SIZE/);
  assert.match(headerSource, /DISCORD_ICON_SIZE/);
  assert.match(headerSource, /https:\/\/discord\.gg\/playadept/);
  assert.match(headerSource, /aria-label="Join the ADEPT Interactive Discord server"/);
  assert.match(headerSource, /title="Join Discord"/);
  assert.match(headerSource, /sr-only.*Join Discord/);
  assert.match(launcherSource, /\.discord\{[^}]*width:48px;height:48px/);
  assert.match(launcherSource, /\.discord svg\{width:30px;height:30px/);
  assert.match(launcherSource, /\.discord > span\{[^}]*clip:rect\(0,0,0,0\)/);
  assert.match(launcherSource, /href="https:\/\/discord\.gg\/playadept"[^>]*aria-label="Join the ADEPT Interactive Discord server"[^>]*title="Join Discord"/);
});

test('showcase mode supplies the complete healthy connection contract without changing production checks', () => {
  const state = createHealthyShowcaseConnection('C:/ADEPT-Showcase/Showcase.uefnproject');
  assert.equal(state.serverOnline, true);
  assert.equal(state.editorStatus.success, true);
  assert.equal(state.editorStatus.uefnRunning, true);
  assert.equal(state.editorStatus.editorConnected, true);
  assert.equal(state.editorStatus.projectActive, true);
  assert.equal(state.editorStatus.differentProjectOpen, false);
  assert.equal(state.editorStatus.pythonEnabled, true);
  assert.equal(state.editorStatus.autoConnectorInstalled, true);
  assert.equal(state.editorStatus.nativeTextureImportAvailable, true);
  assert.equal(state.editorStatus.bootstrapState, 'connected');

  const mainSource = read('electron/main.ts');
  const appSource = read('src/App.tsx');
  const fileServiceSource = read('src/services/fileService.ts');
  assert.match(mainSource, /!app\.isPackaged && process\.env\.UEM_SHOWCASE_MODE === '1'/);
  assert.match(mainSource, /showcaseMode \? BridgeSession\.start|BridgeSession\.start\([\s\S]*showcaseMode/);
  assert.match(appSource, /launchContext\.showcaseMode === true/);
  assert.match(appSource, /createHealthyShowcaseConnection\(/);
  assert.match(appSource, /FileService\.checkHealth\(\)/);
  assert.match(appSource, /FileService\.getEditorStatus\(\)/);
  assert.match(fileServiceSource, /showcaseMode\?: boolean/);
  assert.match(fileServiceSource, /projectFile\?: string/);
  assert.match(mainSource, /UEM_SHOWCASE_MODE/);
  assert.doesNotMatch(mainSource, /app\.isPackaged\s*\|\|\s*process\.env\.UEM_SHOWCASE_MODE/);
});

function pngDimensions(filePath: string) {
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length > 24, `${path.basename(filePath)} is empty or truncated`);
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, `${path.basename(filePath)} is not a PNG`);
  assert.equal(bytes.readUInt32BE(12), 0x49484452, `${path.basename(filePath)} has no PNG header`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('canonical showcase captures are complete, lossless, and free of stale image references', () => {
  const actual = fs.readdirSync(screenshotRoot).filter(fileName => /\.(?:png|jpe?g)$/i.test(fileName)).sort();
  assert.deepEqual(actual, [...expectedScreenshots].sort());
  for (const fileName of expectedScreenshots) {
    const dimensions = pngDimensions(path.join(screenshotRoot, fileName));
    if (fileName === 'phase28-launcher.png') assert.deepEqual(dimensions, { width: 1100, height: 820 });
    else assert.deepEqual(dimensions, { width: 1400, height: 1400 });
  }

  const readmes = [read('README.md'), read('docs/showcase/README.md')];
  for (const markdown of readmes) {
    for (const reference of markdown.matchAll(/(?:\.\.\/)?(?:docs\/)?screenshots\/([^)'"\s>]+)/g)) {
      const referenced = reference[1];
      assert.ok(fs.existsSync(path.join(screenshotRoot, referenced)), `stale screenshot reference: ${referenced}`);
    }
  }
  assert.doesNotMatch(read('README.md'), /screenshots\/[^\s)]+\.jpe?g/i);
  assert.doesNotMatch(read('README.md'), /template-chooser\.png|python-help\.png|phase28-main-workspace\.png/);
});
