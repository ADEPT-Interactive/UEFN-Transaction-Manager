import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CAPABILITIES,
  evaluateOperationPreflight,
  type CapabilityEvidence,
  type ExternalReadinessEvidence,
  type ProjectIdentity,
} from '../shared/agentWorkflow';
import { OperationPreflightManager, deriveUtmCapabilities, projectIdentityFromContext } from '../server/agentPreflight';

const project: ProjectIdentity = {
  projectName: 'Flashlight Tag',
  projectFile: 'C:/UEFN/Flashlight Tag/Flashlight Tag.uefnproject',
  projectRoot: 'C:/UEFN/Flashlight Tag',
  contentRoot: 'C:/UEFN/Flashlight Tag/Content',
  assetMount: '/FlashlightTag',
};

function evidence(capability: string, available = true, schemaInspected = true): CapabilityEvidence {
  return { available, schemaInspected, evidence: [`synthetic schema for ${capability}`] };
}

function allCapabilities(available = true, schemaInspected = true): Record<string, CapabilityEvidence> {
  return Object.fromEntries(Object.values(AGENT_CAPABILITIES).map(capability => [capability, evidence(capability, available, schemaInspected)]));
}

function external(overrides: Partial<ExternalReadinessEvidence> = {}): ExternalReadinessEvidence {
  return {
    server: { available: true, schemaInspected: true, name: 'unreal-mcp', version: 'synthetic' },
    project,
    editorReady: true,
    capabilities: allCapabilities(),
    ...overrides,
  };
}

test('full Flashlight Tag migration blocks immediately when Unreal MCP is unavailable', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'full-existing-project-migration', requestedProject: project },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.equal(report.safeToMutate, false);
  assert.equal(report.mutationRequired, true);
  assert.ok(report.blockers.some(blocker => blocker.code === 'UNREAL_MCP_UNAVAILABLE'));
  assert.ok(report.blockers.some(blocker => blocker.code === 'UNREAL_CAPABILITY_UNAVAILABLE'));
  assert.equal(report.project.matches, null);
});

test('full migration blocks when UTM is absent even if an Unreal MCP-looking report exists', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'full-existing-project-migration', externalReadiness: external() },
    utmProject: project,
    utmCapabilities: allCapabilities(false),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(blocker => blocker.code === 'UTM_CAPABILITY_UNAVAILABLE'));
  assert.equal(report.safeToMutate, false);
});

test('full migration blocks when the native icon capability is missing', () => {
  const capabilities = allCapabilities();
  capabilities[AGENT_CAPABILITIES.utmIconAdoption] = evidence(AGENT_CAPABILITIES.utmIconAdoption, false);
  const report = evaluateOperationPreflight({
    request: { operation: 'full-existing-project-migration', externalReadiness: external() },
    utmProject: project,
    utmCapabilities: capabilities,
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(blocker => blocker.code === 'UTM_CAPABILITY_UNAVAILABLE' && blocker.capability === AGENT_CAPABILITIES.utmIconAdoption));
  assert.equal(report.safeToMutate, false);
});

test('full migration succeeds only with both live capability sets and matching canonical identity', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'full-existing-project-migration', requestedProject: project, externalReadiness: external() },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, true);
  assert.equal(report.safeToMutate, true);
  assert.equal(report.project.matches, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(new Set(report.satisfiedCapabilities).size, report.requiredCapabilities.length);
});

test('inspect-only preflight remains read-only and requires no mutation capability', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'inspect-only' },
    utmProject: project,
    utmCapabilities: {
      [AGENT_CAPABILITIES.utmProjectIdentity]: evidence(AGENT_CAPABILITIES.utmProjectIdentity),
      [AGENT_CAPABILITIES.utmCatalogRead]: evidence(AGENT_CAPABILITIES.utmCatalogRead),
    },
    revision: '17',
  });

  assert.equal(report.ready, true);
  assert.equal(report.safeToMutate, false);
  assert.equal(report.mutationRequired, false);
  assert.equal(report.requiredCapabilities.includes(AGENT_CAPABILITIES.utmCatalogWrite), false);
});

test('catalog-only mode is reserved for the explicitly approved catalog migration operation', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'native-icon-adoption', mode: 'catalog-only', externalReadiness: external() },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(blocker => blocker.code === 'CATALOG_ONLY_MODE_UNSUPPORTED'));
});

test('full migration never silently downgrades to catalog-only', () => {
  const report = evaluateOperationPreflight({
    request: {
      operation: 'full-existing-project-migration',
      mode: 'catalog-only',
      requestedProject: project,
      approval: { approved: true, confirmation: 'synthetic approval must not change full operation semantics' },
    },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(blocker => blocker.code === 'FULL_MIGRATION_CANNOT_DOWNGRADE'));
});

test('catalog-only migration requires explicit owner approval and stays labeled partial', () => {
  const blocked = evaluateOperationPreflight({
    request: { operation: 'catalog-only-migration', mode: 'catalog-only' },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.some(item => item.code === 'CATALOG_ONLY_APPROVAL_REQUIRED'));

  const approved = evaluateOperationPreflight({
    request: { operation: 'catalog-only-migration', mode: 'catalog-only', approval: { approved: true, confirmation: 'I approve the explicitly partial catalog-only migration.' } },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });
  assert.equal(approved.ready, true);
  assert.equal(approved.safeToMutate, true);
  assert.match(approved.warnings.join('\n'), /partial\/catalog-only/i);
  assert.deepEqual(approved.project.differences, []);
});

test('wrong canonical project identity blocks even when every capability is available', () => {
  const wrongProject = { ...project, projectFile: 'C:/UEFN/Other/Other.uefnproject', projectRoot: 'C:/UEFN/Other', projectName: 'Other' };
  const report = evaluateOperationPreflight({
    request: { operation: 'full-existing-project-migration', requestedProject: wrongProject, externalReadiness: external({ project }) },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(item => item.code === 'PROJECT_IDENTITY_MISMATCH'));
  assert.deepEqual(new Set(report.project.differences.map(item => item.field)), new Set(['projectFile', 'projectRoot', 'projectName']));
});

test('uninspected live schemas are not capability proof', () => {
  const report = evaluateOperationPreflight({
    request: {
      operation: 'full-existing-project-migration',
      externalReadiness: external({ server: { available: true, schemaInspected: false }, capabilities: { ...allCapabilities(), [AGENT_CAPABILITIES.unrealAssetDiscovery]: evidence(AGENT_CAPABILITIES.unrealAssetDiscovery, true, false) } }),
    },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(item => item.code === 'UNREAL_MCP_SCHEMA_UNINSPECTED'));
  assert.ok(report.blockers.some(item => item.code === 'UNREAL_SCHEMA_UNINSPECTED' && item.capability === AGENT_CAPABILITIES.unrealAssetDiscovery));
});

test('operation manifests do not require unrelated capabilities', () => {
  const report = evaluateOperationPreflight({
    request: { operation: 'compile-validation', externalReadiness: external() },
    utmProject: project,
    utmCapabilities: allCapabilities(),
    revision: '17',
  });

  assert.equal(report.ready, true);
  assert.equal(report.safeToMutate, false);
  assert.equal(report.mutationRequired, false);
  assert.ok(report.requiredCapabilities.includes(AGENT_CAPABILITIES.unrealVerseCompile));
  assert.equal(report.requiredCapabilities.includes(AGENT_CAPABILITIES.unrealDevicePlacement), false);
});

test('preflight lease is project-, revision-, operation-, scope-, and owner-bound', () => {
  let now = 1_000;
  let revision = '17';
  let context = {
    productVersion: '4.3.0',
    projectName: project.projectName,
    projectFile: project.projectFile,
    projectRoot: project.projectRoot,
    contentRoot: project.contentRoot,
    assetMount: project.assetMount,
    editorConnection: { editorConnected: true },
    nativeTextureAdoptionAvailable: true,
    managedFileOwned: true,
    catalogInitialization: 'initialized' as const,
  };
  const manager = new OperationPreflightManager(() => context, () => revision, { now: () => now, ttlMs: 100 });
  const request = { operation: 'catalog-only-migration' as const, mode: 'catalog-only' as const, approval: { approved: true, confirmation: 'synthetic owner approval' } };
  const report = manager.evaluate(request);
  const lease = manager.issue(report, request, 'connection-a');

  assert.equal(manager.assert(lease.token, 'connection-a', 'catalog-only-migration', 'catalog').token, lease.token);
  assert.throws(() => manager.assert(lease.token, 'connection-b', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_OWNERSHIP' });
  assert.throws(() => manager.assert(lease.token, 'connection-a', 'native-icon-adoption', 'icon'), { code: 'OPERATION_PREFLIGHT_OPERATION_MISMATCH' });
  assert.throws(() => manager.assert(lease.token, 'connection-a', 'catalog-only-migration', 'icon'), { code: 'OPERATION_PREFLIGHT_SCOPE' });

  revision = '18';
  assert.throws(() => manager.assert(lease.token, 'connection-a', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_STALE' });

  revision = '17';
  now += 101;
  assert.throws(() => manager.assert(lease.token, 'connection-a', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_STALE' });

  now = 2_000;
  const freshReport = manager.evaluate(request);
  const freshLease = manager.issue(freshReport, request, 'connection-a');
  context = { ...context, projectName: 'Other' };
  assert.throws(() => manager.assert(freshLease.token, 'connection-a', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_STALE' });
  context = { ...context, projectName: project.projectName };
  assert.throws(() => manager.assert(freshLease.token, 'connection-a', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_STALE' });

  const expiringLease = manager.issue(manager.evaluate(request), request, 'connection-a');
  now += 101;
  assert.throws(() => manager.advance(expiringLease.token, 'connection-a', revision), { code: 'OPERATION_PREFLIGHT_STALE' });
});

test('UTM capability derivation blocks first-run persistence until editor/native readiness exists', () => {
  const firstRun = {
    productVersion: '4.3.0',
    projectName: project.projectName,
    projectFile: project.projectFile,
    projectRoot: project.projectRoot,
    contentRoot: project.contentRoot,
    assetMount: project.assetMount,
    editorConnection: { editorConnected: false },
    nativeTextureAdoptionAvailable: false,
    managedFileOwned: true,
    catalogInitialization: 'first-run' as const,
  };
  const capabilities = deriveUtmCapabilities(firstRun);
  assert.equal(capabilities[AGENT_CAPABILITIES.utmCatalogSave].available, false);
  assert.equal(completeIdentity(projectIdentityFromContext(firstRun)), true);
});

test('preflight lease is invalidated when the authenticated editor process changes', () => {
  let processId = 101;
  const context = {
    productVersion: '4.3.0',
    projectName: project.projectName,
    projectFile: project.projectFile,
    projectRoot: project.projectRoot,
    contentRoot: project.contentRoot,
    assetMount: project.assetMount,
    editorConnection: { editorConnected: true, processId },
    nativeTextureAdoptionAvailable: true,
    managedFileOwned: true,
    catalogInitialization: 'initialized' as const,
  };
  const manager = new OperationPreflightManager(() => context, () => '17');
  const request = { operation: 'catalog-only-migration' as const, mode: 'catalog-only' as const, approval: { approved: true, confirmation: 'synthetic owner approval' } };
  const lease = manager.issue(manager.evaluate(request), request, 'connection-a');
  processId = 102;
  context.editorConnection = { editorConnected: true, processId };
  assert.throws(() => manager.assert(lease.token, 'connection-a', 'catalog-only-migration', 'catalog'), { code: 'OPERATION_PREFLIGHT_STALE' });
});

function completeIdentity(identity: Partial<ProjectIdentity>): boolean {
  return Object.values(identity).every(value => typeof value === 'string' && value.length > 0);
}
