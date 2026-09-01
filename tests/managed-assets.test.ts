import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetObjectPathFromVerseExpression, assetPackagePathFromObjectPath, collectManagedAssetReferences, missingManagedAssetReferences } from '../server/managedAssets';
import { defaultProjectConfig, type CatalogDocument } from '../src/services/catalogSession';

function documentFor(root: string, iconTexture = 'EntitlementIcons.UTM_PlaceholderIcon'): CatalogDocument {
  const config = defaultProjectConfig(root);
  return {
    config,
    entitlements: [{
      id: 'ent-1', verseKey: 'offer', name: 'Offer', shortDescription: 'Offer', description: 'Offer', priceVBucks: 100,
      itemType: 'durable', maxCount: 1, autoConsume: false, iconTexture,
      flags: { paidRandomItem: false, paidRandomItemOdds: '', paidArea: false, consequentialToGameplay: true },
      triggers: { generateTriggerBinding: true, generateButtonBinding: false },
    }],
    bundles: [],
    storefrontMembership: { allOffers: [{ entitlementId: 'ent-1' }], focused: [] },
    retiredVerseKeys: [],
    projectDataDiagnostics: [],
  };
}

test('managed asset references resolve to exact project object and package paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-managed-assets-'));
  try {
    const document = documentFor(root, 'EntitlementIcons.Storefront.Special');
    const objectPath = assetObjectPathFromVerseExpression('EntitlementIcons.Storefront.Special', '/TaB');
    assert.equal(objectPath, '/TaB/EntitlementIcons/Storefront/Special.Special');
    assert.equal(assetPackagePathFromObjectPath(root, objectPath!, '/TaB'), path.join(root, 'EntitlementIcons', 'Storefront', 'Special.uasset'));
    const references = collectManagedAssetReferences(document, '/TaB');
    assert.deepEqual(references.map(reference => reference.objectPath), [objectPath]);
    assert.equal(missingManagedAssetReferences(document, '/TaB').length, 1);
    fs.mkdirSync(path.join(root, 'EntitlementIcons', 'Storefront'), { recursive: true });
    fs.writeFileSync(path.join(root, 'EntitlementIcons', 'Storefront', 'Special.uasset'), 'confirmed package');
    assert.equal(missingManagedAssetReferences(document, '/TaB').length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('managed asset path conversion rejects a different project mount', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-managed-assets-mount-'));
  try {
    assert.equal(assetPackagePathFromObjectPath(root, '/Other/EntitlementIcons/Icon.Icon', '/TaB'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
