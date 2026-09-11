import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentActivityManager } from '../server/agentActivity';
import type { ProjectIdentity } from '../shared/agentWorkflow';

const firstProject: ProjectIdentity = {
  projectName: 'Flashlight Tag',
  projectFile: 'C:/UEFN/Flashlight Tag/Flashlight Tag.uefnproject',
  projectRoot: 'C:/UEFN/Flashlight Tag',
  contentRoot: 'C:/UEFN/Flashlight Tag/Content',
  assetMount: '/FlashlightTag',
};

const secondProject: ProjectIdentity = {
  projectName: 'Other Project',
  projectFile: 'C:/UEFN/Other Project/Other Project.uefnproject',
  projectRoot: 'C:/UEFN/Other Project',
  contentRoot: 'C:/UEFN/Other Project/Content',
  assetMount: '/OtherProject',
};

test('activity is server-owned, user-safe, and exposes exact inspection/modification labels', () => {
  let now = 10_000;
  const manager = new AgentActivityManager(() => firstProject, { now: () => now, ttlMs: 100, recentTtlMs: 300, autoExpire: false });
  const readOnly = manager.begin({ operation: 'full-existing-project-migration', mode: 'read-only', phase: 'Discovering MCP schemas' }, 'connection-a');

  assert.equal(readOnly.label, 'Agent is inspecting UTM');
  assert.equal(readOnly.status, 'active');
  assert.equal(manager.getState().state, 'active');
  assert.equal(manager.getState().current?.activityId, readOnly.activityId);

  const secondReadOnly = manager.begin({ operation: 'inspect-only', mode: 'read-only' }, 'connection-b');
  assert.equal(secondReadOnly.label, 'Agent is inspecting UTM');
  assert.equal(manager.getState().activities.length, 2);

  const mutating = manager.begin({ operation: 'catalog-only-migration', mode: 'mutating', phase: 'Applying approved catalog patch' }, 'connection-c');
  assert.equal(mutating.label, 'Agent is modifying your UTM catalog');
  assert.equal(manager.getState().current?.activityId, mutating.activityId);
  assert.equal(manager.getState().activities.length, 3);
  manager.dispose();
});

test('only one mutating activity may own a project and activity ownership cannot be crossed', () => {
  let now = 10_000;
  const manager = new AgentActivityManager(() => firstProject, { now: () => now, ttlMs: 100, autoExpire: false });
  const active = manager.begin({ operation: 'catalog-only-migration', mode: 'mutating' }, 'connection-a');

  assert.throws(() => manager.begin({ operation: 'catalog-only-migration', mode: 'mutating' }, 'connection-b'), { code: 'AGENT_ACTIVITY_CONFLICT' });
  assert.throws(() => manager.heartbeat(active.activityId, 'connection-b'), { code: 'AGENT_ACTIVITY_OWNERSHIP' });
  assert.throws(() => manager.assertMutating(active.activityId, 'connection-a', 'native-icon-adoption'), { code: 'AGENT_ACTIVITY_OPERATION_MISMATCH' });
  assert.doesNotThrow(() => manager.assertMutating(active.activityId, 'connection-a', 'catalog-only-migration'));
  manager.dispose();
});

test('heartbeat refreshes TTL, phase changes are bounded, and ended activity cannot be revived', () => {
  let now = 20_000;
  const manager = new AgentActivityManager(() => firstProject, { now: () => now, ttlMs: 100, autoExpire: false });
  const active = manager.begin({ operation: 'catalog-only-migration', mode: 'mutating' }, 'connection-a');
  const originalExpiry = Date.parse(active.expiresAt);
  now += 90;
  const refreshed = manager.heartbeat(active.activityId, 'connection-a');
  assert.ok(Date.parse(refreshed.expiresAt) > originalExpiry);
  const phased = manager.updatePhase(active.activityId, 'connection-a', 'A\nphase\tthat is safe', 'Description\nwith control whitespace');
  assert.equal(phased.phase, 'A phase that is safe');
  assert.equal(phased.description, 'Description with control whitespace');
  const ended = manager.end(active.activityId, 'connection-a', 'success', 'Verified synthetic migration');
  assert.equal(ended.status, 'success');
  assert.equal(manager.getState().recent?.outcome, 'Verified synthetic migration');
  assert.throws(() => manager.heartbeat(active.activityId, 'connection-a'), { code: 'AGENT_ACTIVITY_NOT_ACTIVE' });
  manager.dispose();
});

test('TTL expiry is terminal and recent status is retained only for the configured window', () => {
  let now = 30_000;
  const manager = new AgentActivityManager(() => firstProject, { now: () => now, ttlMs: 100, recentTtlMs: 300, autoExpire: false });
  const active = manager.begin({ operation: 'full-existing-project-migration', mode: 'read-only' }, 'connection-a');
  now += 101;
  const expired = manager.getState();
  assert.equal(expired.state, 'recent');
  assert.equal(expired.active, false);
  assert.equal(expired.recent?.status, 'expired');
  assert.throws(() => manager.heartbeat(active.activityId, 'connection-a'), { code: 'AGENT_ACTIVITY_NOT_ACTIVE' });

  const finished = manager.begin({ operation: 'inspect-only', mode: 'read-only' }, 'connection-a');
  manager.end(finished.activityId, 'connection-a', 'failed', 'Synthetic failure');
  assert.equal(manager.getState().state, 'recent');
  now += 301;
  assert.equal(manager.getState().state, 'idle');
  manager.dispose();
});

test('project changes expire active work and hide activities belonging to another project', () => {
  let selected = firstProject;
  const manager = new AgentActivityManager(() => selected, { ttlMs: 100, autoExpire: false });
  const active = manager.begin({ operation: 'catalog-only-migration', mode: 'mutating' }, 'connection-a');
  selected = secondProject;
  assert.throws(() => manager.heartbeat(active.activityId, 'connection-a'), { code: 'AGENT_ACTIVITY_PROJECT_MISMATCH' });
  assert.equal(manager.getState().state, 'idle');
  selected = firstProject;
  assert.equal(manager.getState().state, 'recent');
  assert.equal(manager.getState().recent?.status, 'expired');
  manager.dispose();
});

test('disconnect cancellation is terminal and owner-scoped', () => {
  const manager = new AgentActivityManager(() => firstProject, { ttlMs: 100, autoExpire: false });
  const first = manager.begin({ operation: 'inspect-only', mode: 'read-only' }, 'connection-a');
  const second = manager.begin({ operation: 'inspect-only', mode: 'read-only' }, 'connection-b');
  manager.cancelOwner('connection-a');
  assert.equal(manager.getState().recent?.activityId, first.activityId);
  assert.ok(manager.getState().activities.every(activity => activity.activityId !== first.activityId));
  assert.equal(manager.getState().activities.some(activity => activity.activityId === second.activityId), true);
  manager.dispose();
});
