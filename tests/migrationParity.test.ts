import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMigrationParityTable, type MigrationParityEntry } from '../src/services/migrationParity';

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
