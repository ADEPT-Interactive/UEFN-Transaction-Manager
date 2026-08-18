import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, plainReleaseNotes, shouldOfferUpdate } from '../src/services/update.js';

test('semantic version comparison follows release and prerelease ordering', () => {
  assert.equal(compareSemver('4.0.0', '4.0.0'), 0);
  assert.equal(compareSemver('4.0.0', '4.0.1'), -1);
  assert.equal(compareSemver('4.0.0', '4.1.0'), -1);
  assert.equal(compareSemver('4.0.0', '5.0.0'), -1);
  assert.equal(compareSemver('4.0.0', '3.9.9'), 1);
  assert.equal(compareSemver('4.0.0-beta.2', '4.0.0-beta.10'), -1);
  assert.equal(compareSemver('4.0.0-rc.1', '4.0.0'), -1);
  assert.equal(compareSemver('4.0.0+build.1', '4.0.0+build.2'), 0);
  assert.throws(() => compareSemver('4.0', '4.0.0'), /Invalid semantic version/);
});

test('stable updater policy ignores drafts and prereleases', () => {
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.0' }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1' }), true);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '5.0.0' }), true);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '5.0.0-rc.1' }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1', isDraft: true }), false);
  assert.equal(shouldOfferUpdate('4.0.0', { version: '4.0.1', isPrerelease: true }), false);
});

test('release notes are displayed as bounded plain text', () => {
  assert.equal(plainReleaseNotes('<h2>Fixes</h2><p>Safe <strong>notes</strong></p>'), 'FixesSafe notes');
  assert.equal(plainReleaseNotes([{ note: 'First' }, { note: 'Second' }]), 'First\n\nSecond');
  assert.equal(plainReleaseNotes('   '), undefined);
});
