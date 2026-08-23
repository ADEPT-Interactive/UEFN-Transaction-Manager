import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogDomainError, CatalogSession, defaultProjectConfig } from '../src/services/catalogSession';

function session() {
  const config = defaultProjectConfig('C:/Demo/Content');
  return new CatalogSession({ config, entitlements: [], bundles: [], storefrontMembership: { allOffers: [], focused: [] }, retiredVerseKeys: [], projectDataDiagnostics: [] });
}

test('CatalogSession owns one revisioned draft and separates revision from saved file hash', () => {
  const catalog = session();
  assert.equal(catalog.currentRevision, '1');
  assert.equal(catalog.snapshot().dirty, false);
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Starter', itemType: 'durable' } }, '1');
  assert.equal(created.snapshot.revision, '2');
  assert.equal(created.snapshot.dirty, true);
  assert.equal(created.snapshot.savedFileHash, null);
  assert.equal(catalog.validateCurrent().some(issue => issue.ruleName === 'entitlements_min'), false);
  const saved = catalog.markSaved('a'.repeat(64));
  assert.equal(saved.revision, '2');
  assert.equal(saved.savedRevision, '2');
  assert.equal(saved.dirty, false);
  assert.equal(saved.savedFileHash, 'a'.repeat(64));
});

test('UTM allocates and preserves managed Verse keys across MCP-shaped nested alternate edits', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: {
    name: 'Starter', verseKey: 'agent_supplied_key',
    alternateOffers: [{ id: 'mobile', name: 'Mobile price', verseKey: 'agent_supplied_alt', priceVBucks: 150 }],
  } }, '1');
  const item = created.snapshot.entitlements[0];
  assert.notEqual(item.verseKey, 'agent_supplied_key');
  assert.notEqual(item.alternateOffers?.[0]?.verseKey, 'agent_supplied_alt');
  const alternateKey = item.alternateOffers?.[0]?.verseKey;
  const updated = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: {
    name: 'Renamed Starter',
    alternateOffers: [{ id: 'mobile', name: 'Mobile price updated', verseKey: 'another_agent_key' }],
  } }, '2');
  assert.equal(updated.snapshot.entitlements[0].verseKey, item.verseKey);
  assert.equal(updated.snapshot.entitlements[0].alternateOffers?.[0]?.verseKey, alternateKey);
});

test('stale revision rejects without partial mutation', () => {
  const catalog = session();
  catalog.mutate({ type: 'create_entitlement', data: { name: 'One' } }, '1');
  const before = catalog.snapshot();
  assert.throws(() => catalog.mutate({ type: 'create_entitlement', data: { name: 'Two' } }, '1'), (error: unknown) => {
    assert.ok(error instanceof CatalogDomainError);
    assert.equal(error.code, 'CATALOG_REVISION_CONFLICT');
    assert.equal(error.data.expectedRevision, '1');
    assert.equal(error.data.currentRevision, '2');
    return true;
  });
  assert.deepEqual(catalog.snapshot().entitlements, before.entitlements);
});

test('typed bulk patch is atomic, dry-run is non-mutating, and errors roll back', () => {
  const catalog = session();
  const dryRun = catalog.applyPatch([
    { type: 'create_entitlement', data: { name: 'Durable', shortDescription: 'A durable item.', description: 'A durable item.' } },
    { type: 'create_bundle', data: { name: 'Bundle', items: [] } },
  ], '1', true);
  assert.equal(dryRun.snapshot.revision, '1');
  assert.equal(catalog.snapshot().entitlements.length, 0);
  assert.equal(dryRun.operationResults.length, 2);
  assert.throws(() => catalog.applyPatch([
    { type: 'create_entitlement', data: { name: 'Durable' } },
    { type: 'update_entitlement', entitlementId: 'missing', data: { name: 'Nope' } },
  ], '1', false), (error: unknown) => error instanceof CatalogDomainError && error.code === 'CATALOG_INTEGRITY_ERROR');
  assert.equal(catalog.snapshot().entitlements.length, 0);
  const applied = catalog.applyPatch([{ type: 'create_entitlement', data: { name: 'Durable', shortDescription: 'A durable item.', description: 'A durable item.' } }], '1', false);
  assert.equal(applied.snapshot.revision, '2');
  assert.equal(applied.snapshot.entitlements[0].id, 'bulk-1-1');
});

test('entitlement deletion reports and applies bundle/storefront cascades', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Owned' } }, '1');
  const item = created.snapshot.entitlements[0];
  const bundle = catalog.mutate({ type: 'create_bundle', data: { name: 'Pack', items: [{ entitlementId: item.id, quantity: 1 }] } }, '2');
  const bundleId = bundle.snapshot.bundles[0].id;
  const deleted = catalog.mutate({ type: 'delete_entitlement', entitlementId: item.id }, '3');
  assert.equal(deleted.snapshot.entitlements.length, 0);
  assert.equal(deleted.snapshot.bundles[0].items.length, 0);
  assert.ok(deleted.cascades.some(value => value.includes('bundle')));
  assert.ok(deleted.snapshot.retiredVerseKeys.includes(item.verseKey));
  assert.equal(bundleId.startsWith('bundle-'), true);
});

test('entitlement updates use the same domain cleanup for removed alternate references', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Variants', alternateOffers: [{ id: 'alt-1', verseKey: 'variants_alt', name: 'Alt' }] } }, '1');
  const item = created.snapshot.entitlements[0];
  const alternateKey = item.alternateOffers?.[0]?.verseKey;
  catalog.mutate({ type: 'set_storefront_membership', storefrontId: 'all', data: { entries: [{ entitlementId: item.id, offerVerseKey: alternateKey }] } }, '2');
  const updated = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: { alternateOffers: [] } }, '3');
  assert.equal(updated.snapshot.storefrontMembership.allOffers.length, 0);
  assert.ok(updated.cascades.some(value => value.includes('storefront')));
  assert.ok(alternateKey && updated.snapshot.retiredVerseKeys.includes(alternateKey));
});
