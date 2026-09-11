export type AgentOperation =
  | 'inspect-only'
  | 'catalog-only-migration'
  | 'full-existing-project-migration'
  | 'native-icon-adoption'
  | 'managed-device-wiring'
  | 'verse-integration'
  | 'compile-validation'
  | 'live-session-inspection';

export type AgentOperationMode = 'full' | 'catalog-only';
export type CapabilityOwner = 'utm' | 'unreal';

export const AGENT_CAPABILITIES = {
  utmProjectIdentity: 'utm.project.identity',
  utmCatalogRead: 'utm.catalog.read',
  utmCatalogWrite: 'utm.catalog.write',
  utmGenerateVerse: 'utm.generate.verse',
  utmCatalogSave: 'utm.catalog.save',
  utmIconAdoption: 'utm.icon.adoption',
  utmIntegrationContract: 'utm.integration.contract',
  utmEditorReadiness: 'utm.editor.readiness',
  unrealProjectIdentity: 'unreal.project.identity',
  unrealSchemaInspection: 'unreal.schema.inspection',
  unrealAssetDiscovery: 'unreal.asset.discovery',
  unrealTexture2dDiscovery: 'unreal.texture2d.discovery',
  unrealDeviceDiscovery: 'unreal.device.discovery',
  unrealDevicePlacement: 'unreal.device.placement',
  unrealDeviceAssignment: 'unreal.device.assignment',
  unrealVerseWrite: 'unreal.verse.write',
  unrealVerseCompile: 'unreal.verse.compile',
  unrealSession: 'unreal.session',
  unrealLogs: 'unreal.logs',
} as const;

export type AgentCapability = typeof AGENT_CAPABILITIES[keyof typeof AGENT_CAPABILITIES];

export interface ProjectIdentity {
  projectName: string;
  projectFile: string;
  projectRoot: string;
  contentRoot: string;
  assetMount: string;
}

export interface CapabilityEvidence {
  available: boolean;
  schemaInspected: boolean;
  evidence?: string[];
  detail?: string;
}

export interface ExternalReadinessEvidence {
  server: {
    available: boolean;
    schemaInspected: boolean;
    name?: string;
    version?: string;
  };
  project?: ProjectIdentity;
  editorReady?: boolean;
  capabilities: Record<string, CapabilityEvidence>;
}

export interface CatalogOnlyApproval {
  approved: boolean;
  confirmation: string;
}

export interface OperationPreflightRequest {
  operation: AgentOperation;
  mode?: AgentOperationMode;
  requestedProject?: ProjectIdentity;
  requestedScope?: Record<string, unknown>;
  externalReadiness?: ExternalReadinessEvidence;
  approval?: CatalogOnlyApproval;
}

export interface OperationManifest {
  operation: AgentOperation;
  defaultMode: AgentOperationMode;
  requiresUtmMutation: boolean;
  mutationDomains: Array<'catalog' | 'icon' | 'save'>;
  utmCapabilities: AgentCapability[];
  externalCapabilities: AgentCapability[];
  requiresExternalProject: boolean;
  requiresEditorReady: boolean;
}

export interface CapabilityCheck extends CapabilityEvidence {
  capability: AgentCapability;
  owner: CapabilityOwner;
  required: boolean;
}

export interface ProjectIdentityDifference {
  field: keyof ProjectIdentity;
  expected: string;
  actual: string;
}

export interface PreflightBlocker {
  code: string;
  owner?: CapabilityOwner | 'request' | 'project';
  capability?: AgentCapability;
  message: string;
  details?: Record<string, unknown>;
}

export interface OperationPreflightReport {
  operation: AgentOperation;
  mode: AgentOperationMode;
  requestedScope?: Record<string, unknown>;
  mutationRequired: boolean;
  requiresUtmMutation: boolean;
  ready: boolean;
  safeToMutate: boolean;
  generatedAt: string;
  expiresAt: string;
  revision: string;
  project: {
    requested?: ProjectIdentity;
    utm: ProjectIdentity;
    unreal?: ProjectIdentity;
    matches: boolean | null;
    differences: ProjectIdentityDifference[];
  };
  requiredCapabilities: AgentCapability[];
  satisfiedCapabilities: AgentCapability[];
  capabilities: CapabilityCheck[];
  blockers: PreflightBlocker[];
  warnings: string[];
  externalEvidence: 'not-required' | 'agent-reported';
}

const fullMigrationUnrealCapabilities: AgentCapability[] = [
  AGENT_CAPABILITIES.unrealProjectIdentity,
  AGENT_CAPABILITIES.unrealSchemaInspection,
  AGENT_CAPABILITIES.unrealAssetDiscovery,
  AGENT_CAPABILITIES.unrealTexture2dDiscovery,
  AGENT_CAPABILITIES.unrealDeviceDiscovery,
  AGENT_CAPABILITIES.unrealDevicePlacement,
  AGENT_CAPABILITIES.unrealDeviceAssignment,
  AGENT_CAPABILITIES.unrealVerseWrite,
  AGENT_CAPABILITIES.unrealVerseCompile,
];

export const AGENT_OPERATION_MANIFESTS: Record<AgentOperation, OperationManifest> = {
  'inspect-only': {
    operation: 'inspect-only',
    defaultMode: 'full',
    requiresUtmMutation: false,
    mutationDomains: [],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity, AGENT_CAPABILITIES.utmCatalogRead],
    externalCapabilities: [],
    requiresExternalProject: false,
    requiresEditorReady: false,
  },
  'catalog-only-migration': {
    operation: 'catalog-only-migration',
    defaultMode: 'catalog-only',
    requiresUtmMutation: true,
    mutationDomains: ['catalog', 'save'],
    utmCapabilities: [
      AGENT_CAPABILITIES.utmProjectIdentity,
      AGENT_CAPABILITIES.utmCatalogRead,
      AGENT_CAPABILITIES.utmCatalogWrite,
      AGENT_CAPABILITIES.utmGenerateVerse,
      AGENT_CAPABILITIES.utmCatalogSave,
    ],
    externalCapabilities: [],
    requiresExternalProject: false,
    requiresEditorReady: false,
  },
  'full-existing-project-migration': {
    operation: 'full-existing-project-migration',
    defaultMode: 'full',
    requiresUtmMutation: true,
    mutationDomains: ['catalog', 'icon', 'save'],
    utmCapabilities: [
      AGENT_CAPABILITIES.utmProjectIdentity,
      AGENT_CAPABILITIES.utmCatalogRead,
      AGENT_CAPABILITIES.utmCatalogWrite,
      AGENT_CAPABILITIES.utmGenerateVerse,
      AGENT_CAPABILITIES.utmCatalogSave,
      AGENT_CAPABILITIES.utmIconAdoption,
      AGENT_CAPABILITIES.utmEditorReadiness,
    ],
    externalCapabilities: fullMigrationUnrealCapabilities,
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
  'native-icon-adoption': {
    operation: 'native-icon-adoption',
    defaultMode: 'full',
    requiresUtmMutation: true,
    mutationDomains: ['icon', 'save'],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity, AGENT_CAPABILITIES.utmCatalogRead, AGENT_CAPABILITIES.utmIconAdoption],
    externalCapabilities: [AGENT_CAPABILITIES.unrealProjectIdentity, AGENT_CAPABILITIES.unrealSchemaInspection, AGENT_CAPABILITIES.unrealAssetDiscovery, AGENT_CAPABILITIES.unrealTexture2dDiscovery],
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
  'managed-device-wiring': {
    operation: 'managed-device-wiring',
    defaultMode: 'full',
    requiresUtmMutation: false,
    mutationDomains: [],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity, AGENT_CAPABILITIES.utmIntegrationContract],
    externalCapabilities: [AGENT_CAPABILITIES.unrealProjectIdentity, AGENT_CAPABILITIES.unrealSchemaInspection, AGENT_CAPABILITIES.unrealDeviceDiscovery, AGENT_CAPABILITIES.unrealDevicePlacement, AGENT_CAPABILITIES.unrealDeviceAssignment],
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
  'verse-integration': {
    operation: 'verse-integration',
    defaultMode: 'full',
    requiresUtmMutation: false,
    mutationDomains: [],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity, AGENT_CAPABILITIES.utmIntegrationContract],
    externalCapabilities: [AGENT_CAPABILITIES.unrealProjectIdentity, AGENT_CAPABILITIES.unrealSchemaInspection, AGENT_CAPABILITIES.unrealVerseWrite, AGENT_CAPABILITIES.unrealVerseCompile],
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
  'compile-validation': {
    operation: 'compile-validation',
    defaultMode: 'full',
    requiresUtmMutation: false,
    mutationDomains: [],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity],
    externalCapabilities: [AGENT_CAPABILITIES.unrealProjectIdentity, AGENT_CAPABILITIES.unrealSchemaInspection, AGENT_CAPABILITIES.unrealVerseCompile],
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
  'live-session-inspection': {
    operation: 'live-session-inspection',
    defaultMode: 'full',
    requiresUtmMutation: false,
    mutationDomains: [],
    utmCapabilities: [AGENT_CAPABILITIES.utmProjectIdentity],
    externalCapabilities: [AGENT_CAPABILITIES.unrealProjectIdentity, AGENT_CAPABILITIES.unrealSchemaInspection, AGENT_CAPABILITIES.unrealSession, AGENT_CAPABILITIES.unrealLogs],
    requiresExternalProject: true,
    requiresEditorReady: true,
  },
};

export function operationManifest(operation: AgentOperation): OperationManifest {
  return AGENT_OPERATION_MANIFESTS[operation];
}

export function normalizeIdentityValue(value: string | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

export function projectIdentityFingerprint(identity: ProjectIdentity): string {
  return [identity.projectName, identity.projectFile, identity.projectRoot, identity.contentRoot, identity.assetMount]
    .map(normalizeIdentityValue)
    .join('|');
}

export function completeProjectIdentity(identity: Partial<ProjectIdentity> | undefined): identity is ProjectIdentity {
  return Boolean(identity
    && typeof identity.projectName === 'string' && identity.projectName.trim()
    && typeof identity.projectFile === 'string' && identity.projectFile.trim()
    && typeof identity.projectRoot === 'string' && identity.projectRoot.trim()
    && typeof identity.contentRoot === 'string' && identity.contentRoot.trim()
    && typeof identity.assetMount === 'string' && identity.assetMount.trim());
}

export function compareProjectIdentity(expected: ProjectIdentity, actual: ProjectIdentity): ProjectIdentityDifference[] {
  const fields: Array<keyof ProjectIdentity> = ['projectFile', 'projectRoot', 'contentRoot', 'assetMount', 'projectName'];
  return fields.flatMap(field => normalizeIdentityValue(expected[field]) === normalizeIdentityValue(actual[field])
    ? []
    : [{ field, expected: expected[field], actual: actual[field] }]);
}

export function projectIdentitiesMatch(expected: ProjectIdentity, actual: ProjectIdentity): boolean {
  return compareProjectIdentity(expected, actual).length === 0;
}

function blocker(code: string, message: string, owner?: PreflightBlocker['owner'], capability?: AgentCapability, details?: Record<string, unknown>): PreflightBlocker {
  return { code, message, ...(owner ? { owner } : {}), ...(capability ? { capability } : {}), ...(details ? { details } : {}) };
}

export function evaluateOperationPreflight(input: {
  request: OperationPreflightRequest;
  utmProject: ProjectIdentity;
  utmCapabilities: Record<string, CapabilityEvidence>;
  revision: string;
  nowMs?: number;
  ttlMs?: number;
}): OperationPreflightReport {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? 120_000;
  const manifest = operationManifest(input.request.operation);
  const mode = input.request.mode ?? manifest.defaultMode;
  const requiredCapabilities = [...manifest.utmCapabilities, ...manifest.externalCapabilities];
  const blockers: PreflightBlocker[] = [];
  const warnings: string[] = [];

  if (manifest.operation === 'full-existing-project-migration' && mode === 'catalog-only') {
    blockers.push(blocker('FULL_MIGRATION_CANNOT_DOWNGRADE', 'A full existing-project migration cannot silently downgrade to catalog-only mode. Request catalog-only-migration explicitly after reviewing the missing native work.', 'request'));
  }
  if (manifest.operation === 'catalog-only-migration' && mode !== 'catalog-only') {
    blockers.push(blocker('CATALOG_ONLY_MODE_REQUIRED', 'Catalog-only migration must be requested as an explicitly labeled partial operation.', 'request'));
  }
  if (mode === 'catalog-only' && manifest.operation !== 'catalog-only-migration' && manifest.operation !== 'full-existing-project-migration') {
    blockers.push(blocker('CATALOG_ONLY_MODE_UNSUPPORTED', `Operation ${manifest.operation} cannot be requested in catalog-only mode.`, 'request'));
  }
  if (manifest.operation === 'catalog-only-migration') {
    if (!input.request.approval?.approved || !input.request.approval.confirmation.trim()) {
      blockers.push(blocker('CATALOG_ONLY_APPROVAL_REQUIRED', 'Catalog-only migration is partial and requires explicit owner approval before any UTM mutation.', 'request'));
    } else {
      warnings.push('Partial/catalog-only mode approved. Unreal-dependent icon, device, Verse-caller, compile, and live acceptance work remains incomplete.');
    }
  }

  const capabilities: CapabilityCheck[] = [];
  for (const capability of manifest.utmCapabilities) {
    const evidence = input.utmCapabilities[capability] ?? { available: false, schemaInspected: true, detail: 'UTM did not report this capability.' };
    capabilities.push({ capability, owner: 'utm', required: true, ...evidence });
    if (!evidence.available) blockers.push(blocker('UTM_CAPABILITY_UNAVAILABLE', evidence.detail ?? `UTM capability ${capability} is unavailable.`, 'utm', capability));
    else if (!evidence.schemaInspected) blockers.push(blocker('UTM_SCHEMA_UNINSPECTED', `UTM capability ${capability} was not confirmed from the live tool surface.`, 'utm', capability));
  }

  const external = input.request.externalReadiness;
  if (manifest.externalCapabilities.length) {
    if (!external?.server.available) blockers.push(blocker('UNREAL_MCP_UNAVAILABLE', 'Epic Unreal MCP is not available to the agent session. Full operation cannot start.', 'unreal'));
    else if (!external.server.schemaInspected) blockers.push(blocker('UNREAL_MCP_SCHEMA_UNINSPECTED', 'Epic Unreal MCP is connected but its live tool schemas were not inspected.', 'unreal'));
    for (const capability of manifest.externalCapabilities) {
      const evidence = external?.capabilities?.[capability] ?? { available: false, schemaInspected: false, detail: 'No live schema evidence was supplied.' };
      capabilities.push({ capability, owner: 'unreal', required: true, ...evidence });
      if (!evidence.available) blockers.push(blocker('UNREAL_CAPABILITY_UNAVAILABLE', evidence.detail ?? `Epic Unreal MCP capability ${capability} is unavailable.`, 'unreal', capability));
      else if (!evidence.schemaInspected) blockers.push(blocker('UNREAL_SCHEMA_UNINSPECTED', `Epic Unreal MCP capability ${capability} was not confirmed from its live schema.`, 'unreal', capability));
    }
    if (manifest.requiresExternalProject && !completeProjectIdentity(external?.project)) blockers.push(blocker('UNREAL_PROJECT_IDENTITY_UNVERIFIED', 'Epic Unreal MCP did not provide a complete canonical project identity.', 'project'));
    if (manifest.requiresEditorReady && external?.editorReady !== true) blockers.push(blocker('UNREAL_EDITOR_NOT_READY', 'The exact UEFN project is not proven open and ready for this operation.', 'unreal'));
  }

  const requestedProject = input.request.requestedProject;
  if (requestedProject && !completeProjectIdentity(requestedProject)) blockers.push(blocker('REQUESTED_PROJECT_IDENTITY_INCOMPLETE', 'The requested target project identity is incomplete; provide the canonical project file, root, Content root, mount, and name.', 'project'));
  const requestedDifferences = requestedProject && completeProjectIdentity(requestedProject) ? compareProjectIdentity(input.utmProject, requestedProject) : [];
  const externalDifferences = external?.project && completeProjectIdentity(external.project) ? compareProjectIdentity(input.utmProject, external.project) : [];
  const crossServerDifferences = requestedProject && completeProjectIdentity(requestedProject) && external?.project && completeProjectIdentity(external.project)
    ? compareProjectIdentity(requestedProject, external.project)
    : [];
  const differences = [...requestedDifferences, ...externalDifferences, ...crossServerDifferences].filter((difference, index, all) => all.findIndex(candidate => candidate.field === difference.field && candidate.expected === difference.expected && candidate.actual === difference.actual) === index);
  if (differences.length) blockers.push(blocker('PROJECT_IDENTITY_MISMATCH', 'UTM, the requested target, and the Unreal-reported project do not refer to the same canonical project.', 'project', undefined, { differences }));
  const hasExternalProject = Boolean(external?.project && completeProjectIdentity(external.project));
  const hasProjectReference = Boolean((requestedProject && completeProjectIdentity(requestedProject)) || hasExternalProject);
  const matches = manifest.requiresExternalProject && !hasExternalProject ? null : hasProjectReference ? differences.length === 0 : null;

  const satisfiedCapabilities = capabilities.filter(candidate => candidate.available && candidate.schemaInspected).map(candidate => candidate.capability);
  const mutationRequired = manifest.requiresUtmMutation || manifest.mutationDomains.length > 0 || manifest.externalCapabilities.some(capability => capability.includes('assignment') || capability.includes('placement') || capability.includes('.write'));
  const ready = blockers.length === 0;
  const safeToMutate = ready && mutationRequired;
  return {
    operation: manifest.operation,
    mode,
    ...(input.request.requestedScope ? { requestedScope: input.request.requestedScope } : {}),
    mutationRequired,
    requiresUtmMutation: manifest.requiresUtmMutation,
    ready,
    safeToMutate: manifest.operation === 'inspect-only' ? false : safeToMutate,
    generatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    revision: input.revision,
    project: {
      ...(requestedProject ? { requested: requestedProject } : {}),
      utm: input.utmProject,
      ...(external?.project ? { unreal: external.project } : {}),
      matches,
      differences,
    },
    requiredCapabilities,
    satisfiedCapabilities,
    capabilities,
    blockers,
    warnings,
    externalEvidence: manifest.externalCapabilities.length ? 'agent-reported' : 'not-required',
  };
}
