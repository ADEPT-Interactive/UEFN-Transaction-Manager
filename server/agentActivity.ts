import crypto from 'node:crypto';
import {
  compareProjectIdentity,
  projectIdentityFingerprint,
  type AgentOperation,
  type ProjectIdentity,
} from '../shared/agentWorkflow';

export type AgentActivityMode = 'read-only' | 'mutating';
export type AgentActivityStatus = 'active' | 'success' | 'failed' | 'cancelled' | 'expired';

export interface AgentActivityInput {
  operation: AgentOperation;
  mode: AgentActivityMode;
  phase?: string;
  description?: string;
  scope?: Record<string, unknown>;
}

export interface PublicAgentActivity {
  activityId: string;
  projectName: string;
  operation: AgentOperation;
  mode: AgentActivityMode;
  phase: string;
  description?: string;
  label: 'Agent is inspecting UTM' | 'Agent is modifying your UTM catalog';
  status: AgentActivityStatus;
  startedAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
  endedAt?: string;
  outcome?: string;
}

export interface PublicAgentActivityState {
  active: boolean;
  state: 'idle' | 'active' | 'recent';
  current?: PublicAgentActivity;
  recent?: PublicAgentActivity;
  activities: PublicAgentActivity[];
}

interface ActivityRecord extends PublicAgentActivity {
  ownerId: string;
  project: ProjectIdentity;
  projectFingerprint: string;
  scope?: Record<string, unknown>;
}

export class AgentActivityError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(readonly code: string, message: string, data: Record<string, unknown> = {}, status = 409) {
    super(message);
    this.name = 'AgentActivityError';
    this.status = status;
    this.data = data;
  }
}

interface AgentActivityManagerOptions {
  ttlMs?: number;
  recentTtlMs?: number;
  now?: () => number;
  autoExpire?: boolean;
}

function safeText(value: string | undefined, fallback: string, limit = 160): string {
  if (!value?.trim()) return fallback;
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
}

function cloneScope(scope: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!scope) return undefined;
  return Object.fromEntries(Object.entries(scope).filter(([key, value]) => /^[A-Za-z0-9_.-]{1,40}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 20));
}

export class AgentActivityManager {
  private readonly activities = new Map<string, ActivityRecord>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly recentTtlMs: number;
  private lastProjectFingerprint?: string;
  private expiryTimer?: NodeJS.Timeout;

  constructor(private readonly getProjectIdentity: () => ProjectIdentity, options: AgentActivityManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = Math.max(1, options.ttlMs ?? 30_000);
    this.recentTtlMs = Math.max(this.ttlMs, options.recentTtlMs ?? 60_000);
    if (options.autoExpire !== false) {
      this.expiryTimer = setInterval(() => this.sweep(), Math.min(this.ttlMs, 5_000));
      this.expiryTimer.unref?.();
    }
  }

  begin(input: AgentActivityInput, ownerId: string): PublicAgentActivity {
    this.sweep();
    this.requireOwner(ownerId);
    const project = this.currentProject();
    this.syncProject(project);
    if (input.mode === 'mutating' && [...this.activities.values()].some(activity => activity.status === 'active' && activity.mode === 'mutating' && activity.projectFingerprint === projectIdentityFingerprint(project))) {
      throw new AgentActivityError('AGENT_ACTIVITY_CONFLICT', 'A mutating agent activity is already active for this UTM project. Finish it before starting another.', { projectName: project.projectName });
    }
    const now = this.now();
    const record: ActivityRecord = {
      activityId: crypto.randomUUID(),
      ownerId,
      project,
      projectFingerprint: projectIdentityFingerprint(project),
      projectName: safeText(project.projectName, 'this UTM project', 120),
      operation: input.operation,
      mode: input.mode,
      phase: safeText(input.phase, input.mode === 'mutating' ? 'Preparing changes' : 'Inspecting project state', 100),
      ...(input.description?.trim() ? { description: safeText(input.description, '', 160) } : {}),
      ...(cloneScope(input.scope) ? { scope: cloneScope(input.scope) } : {}),
      label: input.mode === 'mutating' ? 'Agent is modifying your UTM catalog' : 'Agent is inspecting UTM',
      status: 'active',
      startedAt: new Date(now).toISOString(),
      lastHeartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
    this.activities.set(record.activityId, record);
    return this.public(record);
  }

  heartbeat(activityId: string, ownerId: string): PublicAgentActivity {
    const record = this.assertActive(activityId, ownerId);
    const now = this.now();
    record.lastHeartbeatAt = new Date(now).toISOString();
    record.expiresAt = new Date(now + this.ttlMs).toISOString();
    return this.public(record);
  }

  updatePhase(activityId: string, ownerId: string, phase: string, description?: string): PublicAgentActivity {
    const record = this.assertActive(activityId, ownerId);
    record.phase = safeText(phase, record.phase, 100);
    if (description?.trim()) record.description = safeText(description, record.description ?? '', 160);
    return this.public(record);
  }

  end(activityId: string, ownerId: string, status: Exclude<AgentActivityStatus, 'active' | 'expired'>, outcome?: string): PublicAgentActivity {
    const record = this.assertActive(activityId, ownerId);
    const now = this.now();
    record.status = status;
    record.endedAt = new Date(now).toISOString();
    record.expiresAt = record.endedAt;
    if (outcome?.trim()) record.outcome = safeText(outcome, '', 200);
    return this.public(record);
  }

  assertMutating(activityId: string, ownerId: string, operation: AgentOperation): PublicAgentActivity {
    const record = this.assertActive(activityId, ownerId);
    if (record.mode !== 'mutating') throw new AgentActivityError('AGENT_ACTIVITY_REQUIRED', 'A mutating activity is required before changing UTM state.', { activityId });
    if (record.operation !== operation) {
      throw new AgentActivityError('AGENT_ACTIVITY_OPERATION_MISMATCH', 'The active mutating activity does not match the preflight operation.', { activityId, activityOperation: record.operation, operation });
    }
    return this.public(record);
  }

  cancelOwner(ownerId: string, outcome = 'The MCP connection closed before the agent reported an outcome.'): void {
    for (const record of this.activities.values()) {
      if (record.ownerId !== ownerId || record.status !== 'active') continue;
      const now = this.now();
      record.status = 'cancelled';
      record.endedAt = new Date(now).toISOString();
      record.expiresAt = record.endedAt;
      record.outcome = safeText(outcome, 'The activity was cancelled.', 200);
    }
  }

  expireOwner(ownerId: string): void {
    for (const record of this.activities.values()) {
      if (record.ownerId !== ownerId || record.status !== 'active') continue;
      this.expire(record, 'The activity expired after its owner stopped heartbeating.');
    }
  }

  getState(): PublicAgentActivityState {
    this.sweep();
    const currentProject = this.currentProject();
    this.syncProject(currentProject);
    const currentFingerprint = projectIdentityFingerprint(currentProject);
    const visible = [...this.activities.values()].filter(record => record.projectFingerprint === currentFingerprint);
    const active = visible.filter(record => record.status === 'active').sort((a, b) => this.priority(b) - this.priority(a) || b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt));
    const recent = visible.filter(record => record.status !== 'active').sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0];
    return {
      active: active.length > 0,
      state: active.length ? 'active' : recent ? 'recent' : 'idle',
      ...(active[0] ? { current: this.public(active[0]) } : {}),
      ...(recent ? { recent: this.public(recent) } : {}),
      activities: active.map(record => this.public(record)),
    };
  }

  sweep(): void {
    const now = this.now();
    for (const record of this.activities.values()) {
      if (record.status === 'active' && now >= Date.parse(record.expiresAt)) this.expire(record, 'The activity expired after its owner stopped heartbeating.');
      if (record.status !== 'active' && record.status !== 'expired' && record.endedAt && now - Date.parse(record.endedAt) > this.recentTtlMs) this.activities.delete(record.activityId);
      if (record.status === 'expired' && record.endedAt && now - Date.parse(record.endedAt) > this.recentTtlMs) this.activities.delete(record.activityId);
    }
  }

  dispose(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  private currentProject(): ProjectIdentity {
    return this.getProjectIdentity();
  }

  private assertActive(activityId: string, ownerId: string): ActivityRecord {
    this.sweep();
    this.requireOwner(ownerId);
    const record = this.activities.get(activityId);
    if (!record) throw new AgentActivityError('AGENT_ACTIVITY_NOT_FOUND', 'The requested agent activity does not exist.', { activityId });
    if (record.ownerId !== ownerId) throw new AgentActivityError('AGENT_ACTIVITY_OWNERSHIP', 'The requested agent activity belongs to a different MCP connection.', { activityId });
    if (record.status !== 'active') throw new AgentActivityError('AGENT_ACTIVITY_NOT_ACTIVE', 'The requested agent activity is no longer active and cannot be revived.', { activityId, status: record.status });
    const current = this.currentProject();
    const differences = compareProjectIdentity(record.project, current);
    if (differences.length) {
      this.expire(record, 'The selected UTM project changed while this activity was active.');
      this.syncProject(current);
      throw new AgentActivityError('AGENT_ACTIVITY_PROJECT_MISMATCH', 'The selected UTM project changed; the previous agent activity cannot continue.', { activityId, differences });
    }
    this.syncProject(current, activityId);
    return record;
  }

  private requireOwner(ownerId: string): void {
    if (!ownerId?.trim()) throw new AgentActivityError('AGENT_ACTIVITY_OWNERSHIP', 'An MCP connection identity is required for agent activity operations.', {}, 400);
  }

  private expire(record: ActivityRecord, outcome: string): void {
    const now = this.now();
    record.status = 'expired';
    record.endedAt = new Date(now).toISOString();
    record.expiresAt = record.endedAt;
    record.outcome = safeText(outcome, 'The activity expired.', 200);
  }

  private syncProject(project: ProjectIdentity, preserveActivityId?: string): void {
    const fingerprint = projectIdentityFingerprint(project);
    if (this.lastProjectFingerprint && this.lastProjectFingerprint !== fingerprint) {
      for (const record of this.activities.values()) {
        if (record.activityId !== preserveActivityId && record.status === 'active' && record.projectFingerprint !== fingerprint) {
          this.expire(record, 'The selected UTM project changed while this activity was active.');
        }
      }
    }
    this.lastProjectFingerprint = fingerprint;
  }

  private priority(record: ActivityRecord): number {
    return record.mode === 'mutating' ? 2 : 1;
  }

  private public(record: ActivityRecord): PublicAgentActivity {
    const { ownerId: _ownerId, project: _project, projectFingerprint: _fingerprint, scope: _scope, ...publicRecord } = record;
    return publicRecord;
  }
}
