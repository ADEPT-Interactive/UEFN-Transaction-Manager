import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultProjectConfig } from '../src/services/catalogSession';
import { validateMigrationParityTable, type MigrationParityEntry } from '../src/services/migrationParity';
import { derivePublicIdentity } from '../src/services/publicIdentity';

function parityEntry(overrides: Partial<MigrationParityEntry> = {}): MigrationParityEntry {
  return {
    legacySourceIdentity: 'legacy.item',
    proposedId: 'utm-item',
    kind: 'entitlement',
    status: 'confirmed',
    name: { legacy: 'Item', proposed: 'Item' },
    description: { legacy: 'A useful item.', proposed: 'A useful item.' },
    shortDescription: { legacy: 'Useful item.', proposed: 'Useful item.' },
    itemType: { legacy: 'consumable', proposed: 'consumable' },
    maxCount: { legacy: 10, proposed: 10 },
    immediateConsume: { legacy: false, proposed: false },
    autoConsume: { legacy: false, proposed: false },
    priceVBucks: { legacy: 100, proposed: 100 },
    restrictions: { legacy: { blockedCountryCodes: [], blockedPlatformFamilies: [] }, proposed: { blockedCountryCodes: [], blockedPlatformFamilies: [] } },
    iconSource: { legacy: '/Game/Icons/Item.Item', proposed: 'EntitlementIcons.Item_Icon' },
    gameplayConsequence: { legacy: 'Player uses the item later.', proposed: 'External Verse handles the deliberate use.' },
    consequenceBoundary: { legacy: 'other', proposed: 'other' },
    repeatedPurchaseBehavior: { legacy: 'Quantity accumulates up to MaxCount.', proposed: 'Quantity remains available up to MaxCount.' },
    relationships: { legacy: 'Primary offer in All Offers.', proposed: 'Primary entitlement in All Offers.' },
    runtimePropagation: {
      legacy: {
        initialState: { source: 'legacy player-join reconciliation', mode: 'reconciliation' },
        liveChange: { source: 'legacy entitlement delta listener', mode: 'persistent-granted-event' },
        externalState: { description: 'Inventory quantity mirror.', mode: 'mirrored' },
      },
      proposed: {
        initialState: { source: 'AwaitItemReconciledEvent plus GetItemCount during player initialization', mode: 'reconciliation' },
        liveChange: { source: 'persistent AwaitItemGrantedEvent loop updates the inventory mirror', mode: 'persistent-granted-event' },
        externalState: { description: 'Inventory quantity mirror.', mode: 'mirrored' },
      },
    },
    ...overrides,
  };
}

test('migration parity fixture distinguishes inventory consumable, immediate-use consumable, and durable semantics', () => {
  const entries = [
    parityEntry(),
    parityEntry({
      legacySourceIdentity: 'legacy.toss_levels', proposedId: 'utm-toss-levels',
      name: { legacy: '+10 Strength Levels', proposed: '+10 Strength Levels' },
      description: { legacy: 'Use ten strength levels.', proposed: 'Use ten strength levels.' },
      shortDescription: { legacy: 'Ten strength levels.', proposed: 'Ten strength levels.' },
      maxCount: { legacy: 1, proposed: 1 },
      immediateConsume: { legacy: true, proposed: true },
      autoConsume: { legacy: true, proposed: true },
      gameplayConsequence: { legacy: 'Grant toss strength after successful consumption.', proposed: 'External Verse awaits the Consumed event and grants toss strength.' },
      consequenceBoundary: { legacy: 'successful-consumption', proposed: 'successful-consumption' },
      repeatedPurchaseBehavior: { legacy: 'Repeated purchases are immediately used.', proposed: 'Repeated grants auto-consume and do not accumulate.' },
      runtimePropagation: {
        legacy: {
          initialState: { source: 'legacy immediate-use purchase path', mode: 'none' },
          liveChange: { source: 'legacy successful-use event', mode: 'persistent-consumed-event' },
          externalState: { description: 'One-shot gameplay effect.', mode: 'event-driven' },
        },
        proposed: {
          initialState: { source: 'No initial inventory state; effect is event-driven.', mode: 'none' },
          liveChange: { source: 'persistent AwaitTossLevelsConsumedEvent loop applies the effect', mode: 'persistent-consumed-event' },
          externalState: { description: 'One-shot gameplay effect.', mode: 'event-driven' },
        },
      },
    }),
    parityEntry({
      legacySourceIdentity: 'legacy.vip_pass', proposedId: 'utm-vip-pass', kind: 'entitlement',
      name: { legacy: 'VIP Pass', proposed: 'VIP Pass' },
      description: { legacy: 'Permanent VIP access.', proposed: 'Permanent VIP access.' },
      shortDescription: { legacy: 'Permanent VIP.', proposed: 'Permanent VIP.' },
      itemType: { legacy: 'durable', proposed: 'durable' },
      maxCount: { legacy: 1, proposed: 1 },
      immediateConsume: { legacy: false, proposed: false },
      autoConsume: { legacy: false, proposed: false },
      gameplayConsequence: { legacy: 'VIP access while owned.', proposed: 'External Verse checks durable ownership.' },
      consequenceBoundary: { legacy: 'grant', proposed: 'grant' },
      repeatedPurchaseBehavior: { legacy: 'Ownership is capped at one.', proposed: 'Durable MaxCount remains one.' },
      runtimePropagation: {
        legacy: {
          initialState: { source: 'legacy player-join ownership reconciliation', mode: 'reconciliation' },
          liveChange: { source: 'legacy durable ownership listener', mode: 'persistent-granted-event' },
          externalState: { description: 'VIP access mirror.', mode: 'mirrored' },
        },
        proposed: {
          initialState: { source: 'AwaitVipPassReconciledEvent and HasVipPass during player initialization', mode: 'reconciliation' },
          liveChange: { source: 'persistent AwaitVipPassGrantedEvent loop updates the VIP access mirror', mode: 'persistent-granted-event' },
          externalState: { description: 'VIP access mirror.', mode: 'mirrored' },
        },
      },
    }),
  ];
  const report = validateMigrationParityTable(entries, [
    { type: 'create_entitlement', data: { id: 'utm-item' } },
    { type: 'create_entitlement', data: { id: 'utm-toss-levels' } },
    { type: 'create_entitlement', data: { id: 'utm-vip-pass' } },
  ], true);
  assert.equal(report.valid, true);
  assert.equal(report.confirmed, true);
});

test('migration parity rejects metadata loss and premature immediate-use mapping', () => {
  const report = validateMigrationParityTable([parityEntry({
    name: { legacy: 'Known source name', proposed: '' },
    description: { legacy: 'Known source description', proposed: 'Default description' },
    immediateConsume: { legacy: true, proposed: true },
    autoConsume: { legacy: true, proposed: false },
    consequenceBoundary: { legacy: 'successful-consumption', proposed: 'grant' },
  })], [], true);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.field === 'name.proposed'));
  assert.ok(report.issues.some(issue => issue.field === 'description'));
  assert.ok(report.issues.some(issue => issue.field === 'autoConsume'));
  assert.ok(report.issues.some(issue => issue.field === 'consequenceBoundary'));
});

test('migration parity rejects silently changing the legacy immediate-use classification', () => {
  const report = validateMigrationParityTable([parityEntry({
    immediateConsume: { legacy: true, proposed: false },
    autoConsume: { legacy: true, proposed: true },
  })], [], true);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.field === 'immediateConsume'));
});

test('migration parity requires explicit stable operation coverage', () => {
  const report = validateMigrationParityTable([parityEntry()], [{ type: 'create_entitlement', data: { name: 'No stable id' } }], true);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.field === 'operations.create_entitlement'));
});

test('migration parity rejects a durable mirror that only reconciles at join', () => {
  const report = validateMigrationParityTable([parityEntry({
    itemType: { legacy: 'durable', proposed: 'durable' },
    maxCount: { legacy: 1, proposed: 1 },
    gameplayConsequence: { legacy: 'Access is enabled while owned.', proposed: 'External Verse reads OwnsPass.' },
    runtimePropagation: {
      legacy: {
        initialState: { source: 'legacy player-join reconciliation', mode: 'reconciliation' },
        liveChange: { source: 'no live path; reconnect reconciles again', mode: 'none' },
        externalState: { description: 'OwnsPass mirror.', mode: 'mirrored' },
      },
      proposed: {
        initialState: { source: 'AwaitPassReconciledEvent and HasPass at player join', mode: 'reconciliation' },
        liveChange: { source: 'reconnect only; no persistent listener', mode: 'none' },
        externalState: { description: 'OwnsPass mirror.', mode: 'mirrored' },
      },
    },
  })], [], true);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.field === 'runtimePropagation.proposed.liveChange'));
  assert.ok(report.issues.some(issue => /same-session|persistent Granted/i.test(issue.message)));
});

test('migration parity permits a durable with no mirror when it is queried ad hoc from authoritative state', () => {
  const report = validateMigrationParityTable([parityEntry({
    itemType: { legacy: 'durable', proposed: 'durable' },
    maxCount: { legacy: 1, proposed: 1 },
    gameplayConsequence: { legacy: 'No live state; query ownership when needed.', proposed: 'No cached state; query HasPass at use time.' },
    runtimePropagation: {
      legacy: {
        initialState: { source: 'No cached state.', mode: 'authoritative-query' },
        liveChange: { source: 'Query authoritative ownership when needed.', mode: 'authoritative-ad-hoc' },
        externalState: { description: 'No project-owned mirror.', mode: 'authoritative-ad-hoc' },
      },
      proposed: {
        initialState: { source: 'HasPass is queried when the feature is used.', mode: 'authoritative-query' },
        liveChange: { source: 'HasPass remains authoritative at each use.', mode: 'authoritative-ad-hoc' },
        externalState: { description: 'No project-owned mirror.', mode: 'authoritative-ad-hoc' },
      },
    },
  })], [], true);
  assert.equal(report.valid, true);
});

test('migration parity rejects a consumable immediate-use consequence wired to Granted', () => {
  const report = validateMigrationParityTable([parityEntry({
    immediateConsume: { legacy: true, proposed: true },
    autoConsume: { legacy: true, proposed: true },
    runtimePropagation: {
      legacy: {
        initialState: { source: 'No initial inventory state.', mode: 'none' },
        liveChange: { source: 'legacy successful-use event', mode: 'persistent-consumed-event' },
        externalState: { description: 'One-shot gameplay effect.', mode: 'event-driven' },
      },
      proposed: {
        initialState: { source: 'No initial inventory state.', mode: 'none' },
        liveChange: { source: 'persistent AwaitItemGrantedEvent loop applies the effect', mode: 'persistent-granted-event' },
        externalState: { description: 'One-shot gameplay effect.', mode: 'event-driven' },
      },
    },
  })], [], true);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(issue => issue.field === 'runtimePropagation.proposed.liveChange'));
  assert.ok(report.issues.some(issue => /Consumed.*not.*Granted/i.test(issue.message)));
});

test('migration parity requires exact structured public identity for adoption and supports storefront rows', () => {
  const config = defaultProjectConfig('C:/Demo/Content', { deviceClassName: 'PublishedDevice', entitlementsModuleName: 'PublishedEntitlements' });
  const identity = derivePublicIdentity({
    id: 'utm-item',
    verseKey: 'published_item',
    publicIdentity: {
      apiStem: 'PublishedItem',
      metadataStem: 'PublishedItemMetadata',
      entitlementStem: 'published_item',
      priceStem: 'published_item',
      offerStem: 'published_item',
    },
  }, config, 'entitlement');
  const complete = validateMigrationParityTable([parityEntry({ publicIdentity: { legacy: identity, proposed: identity } })], [{
    type: 'adopt_existing_identity',
    kind: 'entitlement',
    targetId: 'utm-item',
  }], true);
  assert.equal(complete.valid, true, JSON.stringify(complete, null, 2));

  const missing = validateMigrationParityTable([parityEntry()], [{ type: 'adopt_existing_identity', kind: 'entitlement', targetId: 'utm-item' }], true);
  assert.equal(missing.valid, false);
  assert.ok(missing.issues.some(issue => issue.field === 'publicIdentity'));

  const mismatched = validateMigrationParityTable([parityEntry({ publicIdentity: { legacy: identity, proposed: { ...identity, apiStem: 'DifferentItem' } } })], [{
    type: 'adopt_existing_identity',
    kind: 'entitlement',
    targetId: 'utm-item',
  }], true);
  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.issues.some(issue => issue.field === 'publicIdentity'));

  const storefront = derivePublicIdentity({ id: 'utm-store', verseKey: 'published_store', publicIdentity: { apiStem: 'PublishedStore' } }, config, 'storefront');
  const storefrontEntry = parityEntry({
    proposedId: 'utm-store',
    kind: 'storefront',
    publicIdentity: { legacy: storefront, proposed: storefront },
  });
  const storefrontReport = validateMigrationParityTable([storefrontEntry], [{ type: 'adopt_existing_identity', kind: 'storefront', targetId: 'utm-store' }], true);
  assert.equal(storefrontReport.valid, true, JSON.stringify(storefrontReport, null, 2));
});
