import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerseCode } from '../src/services/verseGenerator';
import { parseManagedData } from '../src/services/projectSchema';
import { parseVerseCode } from '../src/services/verseParser';
import { validateEntireProject } from '../src/services/validator';
import {
  createVerseKeyAllocator,
  draftVerseKeyForName,
  isValidVerseIdentifier,
  sanitizeVerseIdentifier,
} from '../src/services/verseIdentity';
import { publicApiConfig, publicApiItems } from './public-api-fixture';

test('canonical allocator uses readable case-insensitive keys and deterministic suffixes', () => {
  const allocator = createVerseKeyAllocator();
  assert.equal(allocator.allocate('VIP Pass'), 'vip_pass');
  assert.equal(allocator.allocate('VIP-Pass'), 'vip_pass_2');
  assert.equal(allocator.allocate('VIP  Pass'), 'vip_pass_3');
  assert.equal(allocator.allocate('vip pass'), 'vip_pass_4');
});

test('sanitization handles punctuation, Unicode, leading numbers, empty names, and keywords defensively', () => {
  assert.equal(sanitizeVerseIdentifier("Player's Bundle"), 'player_s_bundle');
  assert.equal(sanitizeVerseIdentifier('123 Coins'), 'item_123_coins');
  assert.equal(sanitizeVerseIdentifier('!!!'), 'item');
  assert.equal(sanitizeVerseIdentifier(''), 'item');
  assert.equal(sanitizeVerseIdentifier('Café Bundle'), 'cafe_bundle');
  assert.equal(sanitizeVerseIdentifier('Class'), 'item_class');
  assert.equal(sanitizeVerseIdentifier('Offer'), 'offer');
  for (const value of ['player_s_bundle', 'item_123_coins', 'item', 'item_class', 'offer']) assert.equal(isValidVerseIdentifier(value), true);
  assert.equal(isValidVerseIdentifier('class'), false);
});

test('one allocator protects the generated symbol scope across object types', () => {
  const allocator = createVerseKeyAllocator(['vip', 'vip_alternate_1']);
  assert.equal(allocator.allocate('VIP'), 'vip_2');
  assert.equal(allocator.allocate('VIP'), 'vip_3');
  assert.equal(allocator.allocateAlternate('vip'), 'vip_alternate_2');
  assert.equal(allocator.allocateAlternate('vip'), 'vip_alternate_3');
});

test('alternate numbering follows the parent key and does not reuse an occupied ordinal', () => {
  const allocator = createVerseKeyAllocator(['consumable_entitlement_alternate_1', 'consumable_entitlement_alternate_3']);
  assert.equal(allocator.allocateAlternate('consumable_entitlement'), 'consumable_entitlement_alternate_2');
  assert.equal(allocator.allocateAlternate('consumable_entitlement'), 'consumable_entitlement_alternate_4');
});

test('draft names may update a draft key but never a persisted key', () => {
  assert.equal(draftVerseKeyForName('starter_bundle', 'Starter Bundle', 'Ultimate Starter Pack', true), 'starter_bundle');
  assert.equal(draftVerseKeyForName('starter_bundle', 'Starter Bundle', 'Ultimate Starter Pack', false), 'ultimate_starter_pack');
  assert.equal(draftVerseKeyForName('custom_key', 'Starter Bundle', 'Ultimate Starter Pack', false), 'custom_key');
});

test('retired keys prevent delete and recreate from silently reassigning an identity', () => {
  const allocator = createVerseKeyAllocator([], ['vip_pass']);
  assert.equal(allocator.allocate('VIP Pass'), 'vip_pass_2');
  assert.equal(allocator.allocate('Starter Bundle'), 'starter_bundle');
});

test('project validation rejects explicit reuse of a retired key', () => {
  const item = parseManagedData({ schemaVersion: 4, entitlements: [publicApiItems[0]], bundles: [] }).entitlements[0];
  item.verseKey = 'vip_pass';
  const issues = validateEntireProject([item], [], publicApiConfig, [], ['vip_pass']);
  assert.ok(issues.some(issue => issue.ruleName === 'retired_verse_key_reuse'));
});

test('managed parsing preserves legacy keys and deterministically repairs unusable or duplicate keys', () => {
  const parsed = parseManagedData({
    schemaVersion: 4,
    retiredVerseKeys: ['retired_key'],
    entitlements: [
      { id: 'legacy', verseKey: 'starter_bundle2213124124', name: 'Renamed Legacy Offer' },
      { id: 'missing', name: 'VIP Pass' },
      { id: 'keyword', verseKey: 'class', name: 'Class' },
      { id: 'duplicate', verseKey: 'starter_bundle2213124124', name: 'Replacement Offer' },
    ],
    bundles: [{ id: 'bundle', name: 'Starter Bundle' }],
  });

  assert.equal(parsed.entitlements[0].verseKey, 'starter_bundle2213124124');
  assert.equal(parsed.entitlements[1].verseKey, 'vip_pass');
  assert.equal(parsed.entitlements[2].verseKey, 'item_class');
  assert.equal(parsed.entitlements[3].verseKey, 'replacement_offer');
  assert.equal(parsed.bundles[0].verseKey, 'starter_bundle');
  assert.deepEqual(parsed.retiredVerseKeys, ['retired_key']);
});

test('manifest round trip preserves active and retired keys exactly', () => {
  const item = structuredClone(publicApiItems[0]);
  item.verseKey = 'starter_bundle2213124124';
  const source = generateVerseCode([item], [], publicApiConfig, [], ['vip_pass', 'old_store']);
  const parsed = parseVerseCode(source);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.entitlements[0].verseKey, 'starter_bundle2213124124');
  assert.deepEqual(parsed.retiredVerseKeys, ['vip_pass', 'old_store']);
});

test('representative generated identifiers remain unique and avoid timestamp-style allocation', () => {
  const allocator = createVerseKeyAllocator(['starter_bundle2213124124']);
  const keys = [
    allocator.allocate('Starter Bundle'),
    allocator.allocate('Starter Bundle'),
    allocator.allocate('Coin Store'),
    allocator.allocate('VIP Pass'),
    allocator.allocateAlternate('vip_pass'),
  ];
  assert.deepEqual(keys, ['starter_bundle', 'starter_bundle_2', 'coin_store', 'vip_pass', 'vip_pass_alternate_1']);
  assert.equal(new Set(keys.map(key => key.toLowerCase())).size, keys.length);
  assert.equal(keys.some(key => /\d{8,}/.test(key)), false);
});
