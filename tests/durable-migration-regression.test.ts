import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DURABLE_STEMS,
  PersistentDurableMirror,
  ReconcileOnlyDurableMirror,
  SyntheticDurableEntitlements,
  durableMigrationFixture,
  waitFor,
} from './fixtures/durable-migration-fixture';

const player = { id: 'synthetic-player-1' };

test('sanitized fixture represents the join-only failure and the required persistent listener shape', () => {
  assert.deepEqual(durableMigrationFixture.entitlements.map(item => item.stem), ['AccessPass', 'PowerPass']);
  assert.match(durableMigrationFixture.badMigration.initialState, /OnPlayerAdded.*reconcile.*mirror/i);
  assert.match(durableMigrationFixture.badMigration.liveChange, /none|reconnect/i);
  assert.match(durableMigrationFixture.goodMigration.liveChange, /persistent.*Await<Stem>GrantedEvent.*immediately/i);
  assert.doesNotMatch(JSON.stringify(durableMigrationFixture), /Flashlight|Seeker Pass|Power Pass/i);
});

test('pre-owned durables are initialized from reconciliation at player join', async () => {
  const source = new SyntheticDurableEntitlements({ AccessPass: true });
  const adapter = new PersistentDurableMirror(source);

  await adapter.onPlayerAdded(player);

  assert.equal(adapter.flags.OwnsAccessPass, true);
  assert.equal(adapter.flags.OwnsPowerPass, false);
  assert.equal(adapter.playerAddedCalls, 1);
  assert.equal(source.reconciliationCalls, 1);
  assert.deepEqual(adapter.listenerStarts, { AccessPass: 1, PowerPass: 1 });
  await waitFor(() => source.grantedAwaitCalls.AccessPass === 1 && source.grantedAwaitCalls.PowerPass === 1);
  await waitFor(() => source.removedAwaitCalls.AccessPass === 1 && source.removedAwaitCalls.PowerPass === 1);
});

test('same-session durable grants update each matching mirror without reconnect or player reinitialization', async () => {
  const source = new SyntheticDurableEntitlements();
  const adapter = new PersistentDurableMirror(source);

  await adapter.onPlayerAdded(player);
  assert.deepEqual(adapter.flags, { OwnsAccessPass: false, OwnsPowerPass: false });

  source.grant(player, 'AccessPass');
  await waitFor(() => adapter.flags.OwnsAccessPass === true);
  assert.equal(adapter.flags.OwnsPowerPass, false);

  source.grant(player, 'PowerPass');
  await waitFor(() => adapter.flags.OwnsPowerPass === true);

  assert.deepEqual(adapter.flags, { OwnsAccessPass: true, OwnsPowerPass: true });
  assert.equal(adapter.playerAddedCalls, 1, 'same-session acquisition must not call PlayerAdded again');
  assert.equal(source.reconciliationCalls, 1, 'same-session acquisition must not rerun reconciliation');
  assert.deepEqual(adapter.listenerStarts, { AccessPass: 1, PowerPass: 1 });
  assert.deepEqual(DURABLE_STEMS, ['AccessPass', 'PowerPass']);
});

test('the join-only migration fixture remains stale after a synthetic durable grant', async () => {
  const source = new SyntheticDurableEntitlements();
  const adapter = new ReconcileOnlyDurableMirror(source);

  await adapter.onPlayerAdded(player);
  source.grant(player, 'AccessPass');
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(adapter.flags.OwnsAccessPass, false);
  assert.equal(adapter.playerAddedCalls, 1);
  assert.equal(source.reconciliationCalls, 1);
});

test('supported removal propagation updates the matching durable mirror without reconnect', async () => {
  const source = new SyntheticDurableEntitlements({ AccessPass: true, PowerPass: true });
  const adapter = new PersistentDurableMirror(source);

  await adapter.onPlayerAdded(player);
  source.remove(player, 'AccessPass');
  await waitFor(() => adapter.flags.OwnsAccessPass === false);

  assert.equal(adapter.flags.OwnsPowerPass, true);
  assert.equal(adapter.playerAddedCalls, 1);
  assert.equal(source.reconciliationCalls, 1);
});
