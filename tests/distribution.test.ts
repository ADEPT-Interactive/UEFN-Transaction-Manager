import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('4.2.0 distribution contract uses the ADEPT generic updater and renamed human aliases', () => {
  const version = JSON.parse(read('version.json')).version as string;
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const builder = JSON.parse(read('electron-builder.json'));
  const readme = read('README.md');
  const userReadme = read('README-USER.txt');
  assert.equal(version, '4.2.0');
  assert.equal(pkg.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.deepEqual(builder.publish[0], { provider: 'generic', url: 'https://updates.adeptinteractive.net/uem/stable/' });
  assert.ok(readme.includes('UEFN-Transaction-Manager-Setup.exe'));
  assert.ok(readme.includes('UEFN-Transaction-Manager-Portable.zip'));
  assert.ok(userReadme.includes('UEFN-Transaction-Manager-Setup.exe'));
  assert.ok(userReadme.includes('ADEPT update-service'));
  assert.doesNotMatch(readme, /stable GitHub Releases updates|GrantedEvent\.Subscribe|RemovedEvent\.Subscribe|ReconciledEvent\.Subscribe/);
  assert.doesNotMatch(read('docs/GENERATED_PUBLIC_API_CONTRACT.md'), /GrantedEvent<public>:event|GrantedEvent\.Subscribe/);
  assert.match(read('scripts/verify-release.ps1'), /version\.json/);
  assert.doesNotMatch(read('scripts/verify-release.ps1'), /4\.0\.0/);
});

test('Discord README identity is static metadata, not a hardcoded presence count', () => {
  const readme = read('README.md');
  assert.match(readme, /https:\/\/discord\.gg\/playadept/);
  assert.match(readme, /discord\/790712680482603038\?label=Discord/);
  assert.doesNotMatch(readme, /online|members?\s*[:=]\s*\d+/i);
  assert.doesNotMatch(readme, /Authorization|Bot\s+[A-Za-z0-9._-]+/i);
});

test('release workflows separate draft human release assets from final R2 promotion', () => {
  const release = read('.github/workflows/release.yml');
  const promotion = read('.github/workflows/promote-update.yml');
  assert.match(release, /publish-updates\.mjs stage/);
  assert.match(release, /UEFN-Transaction-Manager-Setup\.exe/);
  assert.match(release, /UEFN-Transaction-Manager-Portable\.zip/);
  assert.doesNotMatch(release, /release\/latest\.yml.*gh release|release\/.*blockmap.*gh release/s);
  assert.match(promotion, /types: \[published\]/);
  assert.match(promotion, /publish-updates\.mjs promote/);
});
