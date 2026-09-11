import crypto from 'node:crypto';
import {
  AGENT_CAPABILITIES,
  AGENT_OPERATION_MANIFESTS,
  completeProjectIdentity,
  evaluateOperationPreflight,
  projectIdentityFingerprint,
  type CapabilityEvidence,
  type OperationPreflightReport,
  type OperationPreflightRequest,
  type ProjectIdentity,
} from '../shared/agentWorkflow';

export interface UTMPreflightContext {
  projectName: string;
  projectFile: string;
  projectRoot?: string;
  contentRoot: string;
  assetMount: string;
  editorConnection?: Record<string, unknown>;
  nativeTextureAdoptionAvailable?: boolean;
  managedFileOwned?: boolean;
  catalogInitialization?: 'first-run' | 'initialized';
  projectReadiness?: Record<string, unknown>;
}

export class OperationPreflightError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(readonly code: string, message: string, data: Record<string, unknown> = {}, status = 409) {
    super(message);
    this.name = 'OperationPreflightError';
    this.status = status;
    this.data = data;
  }
}

export interface PreflightLease {
  token: string;
  ownerId: string;
  operation: OperationPreflightRequest['operation'];
  mode: NonNullable<OperationPreflightRequest['mode']>;
  revision: string;
  projectFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  mutationDomains: Array<'catalog' | 'icon' | 'save'>;
}

interface LeaseRecord extends PreflightLease {
  request: OperationPreflightRequest;
  sessionFingerprint: string;
}

function pathDirectory(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '';
}

export function projectIdentityFromContext(context: UTMPreflightContext): ProjectIdentity {
  return {
    projectName: context.projectName,
    projectFile: context.projectFile,
    projectRoot: context.projectRoot ?? (pathDirectory(context.projectFile) || pathDirectory(context.contentRoot)),
    contentRoot: context.contentRoot,
    assetMount: context.assetMount,
  };
}

function missingManagedAssetCount(context: UTMPreflightContext): number {
  const missing = context.projectReadiness?.missingManagedAssets;
  return Array.isArray(missing) ? missing.length : 0;
}

function sessionFingerprint(context: UTMPreflightContext): string {
  const connection = context.editorConnection ?? {};
  const processId = typeof connection.processId === 'number' && Number.isInteger(connection.processId) && connection.processId > 0
    ? String(connection.processId)
    : '';
  const generation = typeof connection.connectionGeneration === 'string' ? connection.connectionGeneration.trim() : '';
  const sessionId = typeof connection.sessionId === 'string' ? connection.sessionId.trim() : '';
  const parts = [processId, generation, sessionId].filter(Boolean);
  return parts.length ? parts.join('|') : 'no-editor-session';
}

export function deriveUtmCapabilities(context: UTMPreflightContext): Record<string, CapabilityEvidence> {
  const identity = projectIdentityFromContext(context);
  const identityReady = completeProjectIdentity(identity);
  const editorConnected = context.editorConnection?.editorConnected === true;
  const needsEditor = context.catalogInitialization === 'first-run' || missingManagedAssetCount(context) > 0;
  const managed = context.managedFileOwned !== false;
  return {
    [AGENT_CAPABILITIES.utmProjectIdentity]: { available: identityReady, schemaInspected: true, detail: identityReady ? 'UTM returned a complete canonical project identity.' : 'UTM project identity is incomplete.' },
    [AGENT_CAPABILITIES.utmCatalogRead]: { available: true, schemaInspected: true, detail: 'UTM catalog snapshot is available.' },
    [AGENT_CAPABILITIES.utmCatalogWrite]: { available: managed, schemaInspected: true, detail: managed ? 'The target catalog is managed by UTM.' : 'The selected target Verse file is not managed by UTM.' },
    [AGENT_CAPABILITIES.utmGenerateVerse]: { available: true, schemaInspected: true, detail: 'UTM generated Verse support is available.' },
    [AGENT_CAPABILITIES.utmCatalogSave]: { available: managed && (!needsEditor || editorConnected), schemaInspected: true, detail: managed && (!needsEditor || editorConnected) ? 'UTM can validate and persist this catalog state.' : 'UTM cannot persist this catalog until the required editor/native asset readiness is confirmed.' },
    [AGENT_CAPABILITIES.utmIconAdoption]: { available: context.nativeTextureAdoptionAvailable === true, schemaInspected: true, detail: context.nativeTextureAdoptionAvailable === true ? 'The verified native Texture2D adoption bridge is available.' : 'The verified native Texture2D adoption bridge is unavailable.' },
    [AGENT_CAPABILITIES.utmIntegrationContract]: { available: true, schemaInspected: true, detail: 'UTM can describe its generated integration contract.' },
    [AGENT_CAPABILITIES.utmEditorReadiness]: { available: editorConnected, schemaInspected: true, detail: editorConnected ? 'The UTM editor bridge reports the exact project ready.' : 'The UTM editor bridge does not report the exact project ready.' },
  };
}

export class OperationPreflightManager {
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly getProjectContext: () => UTMPreflightContext,
    private readonly getRevision: () => string,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = Math.max(1, options.ttlMs ?? 120_000);
    this.now = options.now ?? (() => Date.now());
  }

  evaluate(request: OperationPreflightRequest): OperationPreflightReport {
    const context = this.getProjectContext();
    const report = evaluateOperationPreflight({
      request,
      utmProject: projectIdentityFromContext(context),
      utmCapabilities: deriveUtmCapabilities(context),
      revision: this.getRevision(),
      nowMs: this.now(),
      ttlMs: this.ttlMs,
    });
    return report;
  }

  issue(report: OperationPreflightReport, request: OperationPreflightRequest, ownerId: string): PreflightLease {
    if (!ownerId?.trim()) throw new OperationPreflightError('OPERATION_PREFLIGHT_OWNERSHIP', 'An MCP connection identity is required for a mutation lease.', {}, 400);
    if (!report.ready || !report.safeToMutate || !report.requiresUtmMutation) {
      throw new OperationPreflightError('OPERATION_PREFLIGHT_REQUIRED', 'A successful UTM mutation-capable operation preflight is required before UTM state can change.', { operation: report.operation, blockers: report.blockers });
    }
    const currentProject = projectIdentityFromContext(this.getProjectContext());
    if (this.getRevision() !== report.revision || projectIdentityFingerprint(currentProject) !== projectIdentityFingerprint(report.project.utm)) {
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The project or catalog changed before the preflight lease was issued. Run preflight_operation again.', { reportRevision: report.revision, currentRevision: this.getRevision() });
    }
    const now = this.now();
    const lease: LeaseRecord = {
      token: crypto.randomUUID(),
      ownerId,
      operation: report.operation,
      mode: report.mode,
      revision: report.revision,
      projectFingerprint: projectIdentityFingerprint(report.project.utm),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      mutationDomains: [...AGENT_OPERATION_MANIFESTS[report.operation].mutationDomains],
      request,
      sessionFingerprint: sessionFingerprint(this.getProjectContext()),
    };
    this.leases.set(lease.token, lease);
    return this.publicLease(lease);
  }

  assert(token: string | undefined, ownerId: string, operation: OperationPreflightRequest['operation'] | undefined, domain?: 'catalog' | 'icon' | 'save'): PreflightLease {
    this.sweep();
    if (!token) throw new OperationPreflightError('OPERATION_PREFLIGHT_REQUIRED', 'This UTM mutation requires a successful operation preflight token.', { operation: operation ?? 'unknown', domain });
    const lease = this.leases.get(token);
    if (!lease) throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The operation preflight token is missing, expired, or already invalidated. Run preflight_operation again.', { operation: operation ?? 'unknown', domain });
    if (lease.ownerId !== ownerId) throw new OperationPreflightError('OPERATION_PREFLIGHT_OWNERSHIP', 'The operation preflight token belongs to a different MCP connection.', { operation: operation ?? 'unknown', domain });
    if (operation && lease.operation !== operation) throw new OperationPreflightError('OPERATION_PREFLIGHT_OPERATION_MISMATCH', 'The operation preflight token does not authorize this operation.', { preflightOperation: lease.operation, operation, domain });
    if (domain && !lease.mutationDomains.includes(domain)) throw new OperationPreflightError('OPERATION_PREFLIGHT_SCOPE', 'The operation preflight token does not authorize this UTM mutation domain.', { preflightOperation: lease.operation, operation: operation ?? 'unknown', domain, allowedDomains: lease.mutationDomains });
    const currentRevision = this.getRevision();
    if (currentRevision !== lease.revision) {
      this.leases.delete(token);
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The catalog changed after preflight. Reload the current snapshot and run preflight_operation again before retrying.', { preflightRevision: lease.revision, currentRevision });
    }
    const context = this.getProjectContext();
    const currentProject = projectIdentityFromContext(context);
    if (projectIdentityFingerprint(currentProject) !== lease.projectFingerprint) {
      this.leases.delete(token);
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The selected project changed after preflight. Run preflight_operation again for the current project.', { preflightProject: lease.projectFingerprint, currentProject: projectIdentityFingerprint(currentProject) });
    }
    if (sessionFingerprint(context) !== lease.sessionFingerprint) {
      this.leases.delete(token);
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The authenticated UEFN editor session changed after preflight. Run preflight_operation again before retrying.', { preflightSession: lease.sessionFingerprint, currentSession: sessionFingerprint(context) });
    }
    const currentReport = this.evaluate(lease.request);
    if (!currentReport.ready || !currentReport.safeToMutate) {
      this.leases.delete(token);
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'A required readiness or capability changed after preflight. Run preflight_operation again before retrying.', { blockers: currentReport.blockers, warnings: currentReport.warnings });
    }
    return this.publicLease(lease);
  }

  advance(token: string, ownerId: string, revision: string): void {
    const lease = this.leases.get(token);
    if (!lease || lease.ownerId !== ownerId) throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The mutation lease is no longer valid.', { token });
    const now = this.now();
    if (now >= Date.parse(lease.expiresAt)) {
      this.leases.delete(token);
      throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The mutation lease expired before the mutation completed. Run preflight_operation again before retrying.', { token });
    }
    if (revision !== this.getRevision()) throw new OperationPreflightError('OPERATION_PREFLIGHT_STALE', 'The catalog revision returned by the mutation is not current.', { revision, currentRevision: this.getRevision() });
    lease.revision = revision;
    lease.expiresAt = new Date(now + this.ttlMs).toISOString();
  }

  invalidateOwner(ownerId: string): void {
    for (const [token, lease] of this.leases) if (lease.ownerId === ownerId) this.leases.delete(token);
  }

  sweep(): void {
    const now = this.now();
    for (const [token, lease] of this.leases) if (now >= Date.parse(lease.expiresAt)) this.leases.delete(token);
  }

  private publicLease(lease: LeaseRecord): PreflightLease {
    const { request: _request, sessionFingerprint: _sessionFingerprint, ...publicLease } = lease;
    return publicLease;
  }
}
