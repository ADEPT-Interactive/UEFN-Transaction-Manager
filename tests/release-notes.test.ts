import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('every published release has checked-in version-specific notes', () => {
  const versions = ['4.3.2', '4.3.3', '4.3.4', '4.3.5', '4.3.6', '4.3.7', '4.4.0'];
  const notes = versions.map(version => {
    const content = read(`release-notes/${version}.md`).trim();
    assert.ok(content, `${version} release notes must not be empty`);
    assert.match(content, /(?:^|\n)-\s+/, `${version} release notes must contain change bullets`);
    assert.doesNotMatch(content, /^#{1,6}\s/m, `${version} source must contain only version-specific change bullets`);
    return content;
  });
  assert.equal(new Set(notes).size, notes.length, '4.3.x release notes must not be copied generic text');

  const currentVersion = JSON.parse(read('version.json')).version as string;
  assert.equal(currentVersion, '4.4.0');
  assert.ok(fs.existsSync(path.join(root, `release-notes/${currentVersion}.md`)));
});

test('release workflow resolves exact checked-in notes and preserves distribution boilerplate', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /Join-Path\s+"release-notes"\s+"\$version\.md"/);
  assert.match(workflow, /Checked-in release notes are missing/);
  assert.match(workflow, /version-specific change bullets/);
  assert.match(workflow, /Portable copies older than 4\.3\.2/);
  assert.match(workflow, /Windows SmartScreen/);
  assert.match(workflow, /Get-FileHash/);
  assert.doesNotMatch(workflow, /releaseFixLine|elseif \(\$version -eq|4\.3\.5.*releaseFix/s);
  assert.doesNotMatch(workflow, /Build runtime-priced offers and runtime-quantity bundles/);
});
