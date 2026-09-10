import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('4.3.0 development line preserves the ADEPT distribution contract and renamed human aliases', () => {
  const version = JSON.parse(read('version.json')).version as string;
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const builder = JSON.parse(read('electron-builder.json'));
  const installerScript = read('electron/installer.nsh');
  const readme = read('README.md');
  const userReadme = read('README-USER.txt');
  assert.equal(version, '4.3.0');
  assert.equal(pkg.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.deepEqual(builder.publish[0], { provider: 'generic', url: 'https://updates.adeptinteractive.net/uem/stable/' });
  assert.equal(builder.appId, 'AD3PTInteractive.UEFNEntitlementManager');
  assert.equal(builder.nsis.createDesktopShortcut, true);
  assert.equal(builder.nsis.include, 'electron/installer.nsh');
  assert.match(installerScript, /!macro customInstall/);
  assert.match(installerScript, /\$appExe/);
  assert.match(installerScript, /\$newStartMenuLink/);
  assert.match(installerScript, /\$newDesktopLink/);
  assert.match(installerScript, /SetLnkAUMI/);
  assert.match(read('scripts/build-release.ps1'), /electron\\installer\.nsh/);
  assert.ok(readme.includes('UEFN-Transaction-Manager-Installer.exe'));
  assert.ok(readme.includes('UEFN-Transaction-Manager-Portable.zip'));
  assert.ok(userReadme.includes('UEFN-Transaction-Manager-Installer.exe'));
  assert.ok(userReadme.includes('ADEPT update-service'));
  assert.doesNotMatch(readme, /stable GitHub Releases updates|GrantedEvent\.Subscribe|RemovedEvent\.Subscribe|ReconciledEvent\.Subscribe/);
  assert.doesNotMatch(read('docs/GENERATED_PUBLIC_API_CONTRACT.md'), /GrantedEvent<public>:event|GrantedEvent\.Subscribe/);
  assert.match(read('scripts/verify-release.ps1'), /version\.json/);
  assert.doesNotMatch(read('scripts/verify-release.ps1'), /4\.0\.0/);
  const upgradeGate = read('scripts/verify-installer-upgrade.ps1');
  assert.match(upgradeGate, /BaselineInstaller/);
  assert.match(upgradeGate, /CandidateInstaller/);
  assert.match(upgradeGate, /NaturalPath/);
  assert.match(upgradeGate, /Refusing to run the installer upgrade gate while a UTM installation/);
  assert.match(upgradeGate, /4\\\.2\\\.0/);
  assert.match(upgradeGate, /4\\\.3\\\.0/);
  assert.match(upgradeGate, /Start-FromShortcut/);
  assert.match(upgradeGate, /Invoke-Uninstall/);
  assert.match(upgradeGate, /PendingConsumeIntents/);
  assert.match(read('scripts/verify-release.ps1'), /projectReady/);
});

test('creator-facing MCP terminology separates human product prose from technical server identifiers', () => {
  const creatorFacingFiles = [
    'README.md',
    'README-USER.txt',
    'docs/AGENT_INTEGRATION.md',
    'docs/assets/utm-mcp-workflow.svg',
    'docs/assets/utm-mcp-workflow-mobile.svg',
    'docs/RELEASE-DISTRIBUTION.md',
    'docs/DISTRIBUTION.md',
  ];
  const integrationFiles = [
    'README.md',
    'README-USER.txt',
    'docs/AGENT_INTEGRATION.md',
    'docs/assets/utm-mcp-workflow.svg',
    'docs/assets/utm-mcp-workflow-mobile.svg',
  ];
  const terminologyExamples: Array<[string, boolean]> = [
    ['UTM works alongside Unreal MCP.', true],
    ['Confirm `utm-mcp` and `unreal-mcp` are installed.', true],
    ['UTM works alongside UEFN MCP.', false],
    ['renaming literal server configuration `unreal-mcp` to "Unreal MCP"', false],
  ];
  const followsContract = (text: string) => {
    if (/(?<![A-Za-z0-9-])UEFN MCP(?!\s+Toolsets\b)/i.test(text)) return false;
    if (text.split('\n').some((line) => /`unreal-mcp`[^\n]*Unreal MCP/i.test(line)
      && /(?:renam(?:e|ed|ing)|call(?:ed)?|label(?:ed)?|server configuration)/i.test(line))) return false;
    return true;
  };
  for (const [example, expected] of terminologyExamples) assert.equal(followsContract(example), expected, example);
  for (const file of creatorFacingFiles) {
    const content = read(file);
    assert.equal(followsContract(content), true, `${file} contains a stale human-facing name or humanized technical identifier`);
  }
  for (const file of integrationFiles) {
    const content = read(file);
    assert.match(content, /Unreal MCP/, `${file} should name the creator-facing integration`);
    assert.doesNotMatch(content, /`Unreal MCP`/, `${file} must not use the display name as a server key`);
  }
  const integrationGuide = read('docs/AGENT_INTEGRATION.md');
  assert.match(integrationGuide, /`utm-mcp`/);
  assert.match(integrationGuide, /`unreal-mcp`/);
  const mobileWorkflow = read('docs/assets/utm-mcp-workflow-mobile.svg');
  assert.match(mobileWorkflow, /<desc[^>]*>[^<]*Unreal MCP/);
  assert.match(mobileWorkflow, />Unreal MCP</);
  assert.doesNotMatch(mobileWorkflow, /Review and compile|Your gameplay stays in your project/);
  assert.equal((mobileWorkflow.match(/Your UEFN Project/g) ?? []).length, 1);
});

test('Discord README identity is static metadata, not a hardcoded presence count', () => {
  const readme = read('README.md');
  assert.match(readme, /https:\/\/discord\.gg\/playadept/);
  assert.match(readme, /discord\/790712680482603038\?label=Discord/);
  assert.doesNotMatch(readme, /online|members?\s*[:=]\s*\d+/i);
  assert.doesNotMatch(readme, /private credential|static header|credential rotation/i);
});

test('release workflows separate draft human release assets from final R2 promotion', () => {
  const release = read('.github/workflows/release.yml');
  const promotion = read('.github/workflows/promote-update.yml');
  assert.match(release, /publish-updates\.mjs stage/);
  assert.match(release, /UEFN-Transaction-Manager-Installer\.exe/);
  assert.match(release, /UEFN-Transaction-Manager-Portable\.zip/);
  assert.match(release, /portable-latest\.json/);
  assert.doesNotMatch(release, /release\/latest\.yml.*gh release|release\/.*blockmap.*gh release/s);
  assert.match(promotion, /types: \[published\]/);
  assert.match(promotion, /publish-updates\.mjs promote/);
  assert.match(promotion, /UEFN-Transaction-Manager-Installer\.exe/);
});

test('portable updater is marker-driven, uses separate metadata, and cannot fall through to NSIS', () => {
  const manager = read('electron/updateManager.ts');
  const helper = read('electron/portable-update-helper.ps1');
  const release = read('scripts/build-release.ps1');
  assert.match(manager, /detectDistributionMode|distributionMode/);
  assert.match(manager, /portable-latest\.json/);
  assert.match(manager, /if \(this\.isPortable\(\)\) return this\.startPortableReplacement\(\);/);
  assert.match(manager, /autoUpdater\.quitAndInstall\(false, true\);/);
  assert.match(helper, /rollback|Write-Result|relaunch/i);
  assert.match(release, /distribution = "portable"/);
  assert.match(release, /managedFiles/);
});
