import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogDomainError, CatalogSession, defaultProjectConfig } from '../src/services/catalogSession';
import { buildBundleCreatePayload, buildBundleUpdatePayload, buildEntitlementCreatePayload, buildEntitlementUpdatePayload, buildStorefrontUpdatePayload } from '../src/services/catalogMutationPayloads';

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

test('UTM allocates and preserves managed Verse keys across nested alternate edits', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: {
    name: 'Starter',
    alternateOffers: [{ id: 'mobile', name: 'Mobile price', priceVBucks: 150 }],
  } }, '1');
  const item = created.snapshot.entitlements[0];
  assert.equal(item.verseKey, 'starter');
  assert.equal(item.alternateOffers?.[0]?.verseKey, 'starter_alternate_1');
  const alternateKey = item.alternateOffers?.[0]?.verseKey;
  const updated = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: {
    name: 'Renamed Starter',
    alternateOffers: [{ id: 'mobile', name: 'Mobile price updated' }],
  } }, '2');
  assert.equal(updated.snapshot.entitlements[0].verseKey, item.verseKey);
  assert.equal(updated.snapshot.entitlements[0].alternateOffers?.[0]?.verseKey, alternateKey);
});

test('generic catalog creates reject supplied identity instead of silently ignoring it', () => {
  const catalog = session();
  assert.throws(() => catalog.mutate({ type: 'create_entitlement', data: { name: 'Starter', verseKey: 'legacy_starter' } }, '1'), (error: unknown) => {
    assert.ok(error instanceof CatalogDomainError);
    assert.equal(error.code, 'CATALOG_IDENTITY_IMPORT_REQUIRED');
    return true;
  });
  assert.equal(catalog.snapshot().entitlements.length, 0);
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
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Variants', alternateOffers: [{ id: 'alt-1', name: 'Alt' }] } }, '1');
  const item = created.snapshot.entitlements[0];
  const alternateKey = item.alternateOffers?.[0]?.verseKey;
  catalog.mutate({ type: 'set_storefront_membership', storefrontId: 'all', data: { entries: [{ entitlementId: item.id, offerVerseKey: alternateKey }] } }, '2');
  const updated = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: { alternateOffers: [] } }, '3');
  assert.equal(updated.snapshot.storefrontMembership.allOffers.length, 0);
  assert.ok(updated.cascades.some(value => value.includes('storefront')));
  assert.ok(alternateKey && updated.snapshot.retiredVerseKeys.includes(alternateKey));
});

test('ordinary updates tolerate an echoed identity and discard it in favor of authoritative server state', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Echoed', alternateOffers: [{ name: 'Mobile' }] } }, '1');
  const item = created.snapshot.entitlements[0];
  const alternate = item.alternateOffers![0];
  const updated = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: { ...item, name: 'Echoed edit', alternateOffers: [{ ...alternate, name: 'Mobile edit' }] } }, '2');
  assert.equal(updated.snapshot.entitlements[0].name, 'Echoed edit');
  assert.equal(updated.snapshot.entitlements[0].verseKey, item.verseKey);
  assert.equal(updated.snapshot.entitlements[0].alternateOffers![0].verseKey, alternate.verseKey);
});

test('identity changes are rejected atomically for top-level and nested alternate updates', () => {
  const catalog = session();
  const created = catalog.mutate({ type: 'create_entitlement', data: { name: 'Atomic', alternateOffers: [{ name: 'Mobile' }] } }, '1');
  const item = created.snapshot.entitlements[0];
  const alternate = item.alternateOffers![0];
  const before = catalog.snapshot();
  assert.throws(() => catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: { verseKey: 'changed_atomic' } }, '2'), (error: unknown) => error instanceof CatalogDomainError && error.code === 'CATALOG_IDENTITY_IMPORT_REQUIRED');
  assert.deepEqual(catalog.snapshot().entitlements, before.entitlements);
  assert.throws(() => catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: { alternateOffers: [{ id: alternate.id, verseKey: 'changed_alternate' }] } }, '2'), (error: unknown) => error instanceof CatalogDomainError && error.code === 'CATALOG_IDENTITY_IMPORT_REQUIRED');
  assert.deepEqual(catalog.snapshot().entitlements, before.entitlements);
});

test('mutation serializers omit imported identity, hydrated artwork, and file-picker metadata', () => {
  const item = {
    ...session().mutate({ type: 'create_entitlement', data: { name: 'Serialized' } }, '1').snapshot.entitlements[0],
    publicIdentity: { apiStem: 'PublishedSerialized' },
    iconImageData: 'data:image/png;base64,large',
    iconFileName: 'preview.png',
  };
  const create = buildEntitlementCreatePayload(item);
  const update = buildEntitlementUpdatePayload(item);
  assert.equal('verseKey' in create, false);
  assert.equal('publicIdentity' in create, false);
  assert.equal('iconImageData' in create, false);
  assert.equal('iconFileName' in create, false);
  assert.equal('verseKey' in update, false);
  assert.equal('publicIdentity' in update, false);
  assert.equal('iconImageData' in update, false);
  assert.equal('iconFileName' in update, false);
});

test('update payloads explicitly clear optional runtime, restriction, and duration fields', () => {
  const catalog = session();
  const createdItem = catalog.mutate({
    type: 'create_entitlement',
    data: {
      name: 'Runtime item',
      dynamicOffer: { priceBehavior: 'runtime' },
      offerRestrictions: { minimumPurchaseAge: 18, blockedCountryCodes: ['CA'], blockedPlatformFamilies: [] },
      durationDescription: 'Lasts 7 days',
      alternateOffers: [{ id: 'runtime-alt', name: 'Runtime alternate', dynamicOffer: { priceBehavior: 'runtime' } }],
    },
  }, '1');
  const item = createdItem.snapshot.entitlements[0];
  const updatePayload = buildEntitlementUpdatePayload({
    ...item,
    dynamicOffer: undefined,
    offerRestrictions: undefined,
    durationDescription: undefined,
    alternateOffers: (item.alternateOffers ?? []).map(offer => ({ ...offer, dynamicOffer: undefined, restrictions: undefined, durationDescription: undefined })),
  });
  assert.equal(updatePayload.dynamicOffer, null);
  assert.equal(updatePayload.offerRestrictions, null);
  assert.equal(updatePayload.durationDescription, null);
  assert.equal((updatePayload.alternateOffers as Array<Record<string, unknown>>)[0].dynamicOffer, null);
  assert.equal((updatePayload.alternateOffers as Array<Record<string, unknown>>)[0].restrictions, null);
  const clearedItem = catalog.mutate({ type: 'update_entitlement', entitlementId: item.id, data: updatePayload }, '2').snapshot.entitlements[0];
  assert.equal(clearedItem.dynamicOffer, undefined);
  assert.equal(clearedItem.offerRestrictions, undefined);
  assert.equal(clearedItem.durationDescription, undefined);
  assert.equal(clearedItem.alternateOffers?.[0].dynamicOffer, undefined);

  const createdBundle = catalog.mutate({
    type: 'create_bundle',
    data: {
      name: 'Runtime bundle',
      dynamicOffer: { priceBehavior: 'runtime' },
      restrictions: { minimumPurchaseAge: 18, blockedCountryCodes: ['US'], blockedPlatformFamilies: [] },
      durationDescription: 'Lasts 7 days',
      items: [{ entitlementId: item.id, quantity: 1 }],
    },
  }, '3');
  const bundle = createdBundle.snapshot.bundles[0];
  const bundlePayload = buildBundleUpdatePayload({ ...bundle, dynamicOffer: undefined, restrictions: undefined, durationDescription: undefined });
  assert.equal(bundlePayload.dynamicOffer, null);
  assert.equal(bundlePayload.restrictions, null);
  assert.equal(bundlePayload.durationDescription, null);
  const clearedBundle = catalog.mutate({ type: 'update_bundle', bundleId: bundle.id, data: bundlePayload }, '4').snapshot.bundles[0];
  assert.equal(clearedBundle.dynamicOffer, undefined);
  assert.equal(clearedBundle.restrictions, undefined);
  assert.equal(clearedBundle.durationDescription, undefined);
});

test('duplicating a bundle creates a fresh record with preserved contents', () => {
  const catalog = session();
  const item = catalog.mutate({ type: 'create_entitlement', data: { name: 'Bundle item' } }, '1').snapshot.entitlements[0];
  const original = catalog.mutate({ type: 'create_bundle', data: { name: 'Pack', items: [{ entitlementId: item.id, quantity: 1 }] } }, '2').snapshot.bundles[0];
  const copyPayload = buildBundleCreatePayload({ ...original, name: 'Pack Copy', id: 'client-copy', verseKey: original.verseKey });
  assert.equal('id' in copyPayload, false);
  assert.equal('verseKey' in copyPayload, false);
  const copied = catalog.mutate({ type: 'create_bundle', data: copyPayload }, '3').snapshot.bundles;
  assert.equal(copied.length, 2);
  assert.notEqual(copied[0].id, copied[1].id);
  assert.notEqual(copied[0].verseKey, copied[1].verseKey);
  assert.deepEqual(copied[1].items, original.items);
});

test('bundle and storefront updates preserve their own public identity', () => {
  const catalog = session();
  const bundle = catalog.mutate({ type: 'create_bundle', data: { name: 'Pack', items: [] } }, '1').snapshot.bundles[0];
  const storefront = catalog.mutate({ type: 'create_storefront', data: { name: 'Store', entries: [] } }, '2').snapshot.storefrontMembership.focused[0];
  const nextBundle = catalog.mutate({ type: 'update_bundle', bundleId: bundle.id, data: { ...bundle, name: 'Pack edit' } }, '3');
  const nextStorefront = catalog.mutate({ type: 'update_storefront', storefrontId: storefront.id, data: { ...storefront, name: 'Store edit' } }, '4');
  assert.equal(nextBundle.snapshot.bundles[0].verseKey, bundle.verseKey);
  assert.equal(nextStorefront.snapshot.storefrontMembership.focused[0].verseKey, storefront.verseKey);
  assert.equal(buildBundleCreatePayload(bundle).verseKey, undefined);
  assert.equal(buildStorefrontUpdatePayload(storefront).verseKey, undefined);
});
