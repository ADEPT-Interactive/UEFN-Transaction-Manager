import {
  BundleOffer,
  EntitlementItem,
  OfferDisplayEntry,
  OfferDisplayGroup,
  ProjectConfig,
  PublicIdentityOverrides,
  StorefrontMembership,
  ValidationIssue,
} from '../types/entitlement';
import {
  cleanManagedData,
  normalizeBundle,
  normalizeEntitlement,
  normalizeOfferDisplayGroup,
  normalizeProjectConfig,
  normalizeStorefrontMembership,
} from './projectSchema';
import { createVerseKeyAllocator, isValidVerseIdentifier, normalizeRetiredVerseKeys } from './verseIdentity';
import { validateEntireProject } from './validator';
import {
  derivePublicIdentity,
  normalizePublicIdentityOverrides,
  publicIdentitiesEqual,
  type IdentityRecord,
  type DerivedPublicIdentity,
  type PublicIdentityKind,
  validatePublicIdentityOverrides,
} from './publicIdentity';

export const CATALOG_ERROR_CODES = {
  revisionConflict: 'CATALOG_REVISION_CONFLICT',
  validationFailed: 'CATALOG_VALIDATION_FAILED',
  integrity: 'CATALOG_INTEGRITY_ERROR',
  projectNotReady: 'PROJECT_NOT_READY',
  managedFileChanged: 'MANAGED_FILE_CHANGED',
  assetAdoptionFailed: 'ASSET_ADOPTION_FAILED',
  editorConnectionRequired: 'EDITOR_CONNECTION_REQUIRED',
  migrationParityRequired: 'MIGRATION_PARITY_REQUIRED',
  migrationParityFailed: 'MIGRATION_PARITY_FAILED',
  identityImportRequired: 'CATALOG_IDENTITY_IMPORT_REQUIRED',
  publicIdentityInvalid: 'CATALOG_PUBLIC_IDENTITY_INVALID',
  publicIdentityConflict: 'CATALOG_PUBLIC_IDENTITY_CONFLICT',
  publicIdentityMismatch: 'CATALOG_PUBLIC_IDENTITY_MISMATCH',
  operationPreflightRequired: 'OPERATION_PREFLIGHT_REQUIRED',
  operationPreflightStale: 'OPERATION_PREFLIGHT_STALE',
  operationPreflightScope: 'OPERATION_PREFLIGHT_SCOPE',
  operationPreflightOwnership: 'OPERATION_PREFLIGHT_OWNERSHIP',
  agentActivityRequired: 'AGENT_ACTIVITY_REQUIRED',
  agentActivityInvalid: 'AGENT_ACTIVITY_INVALID',
  agentActivityConflict: 'AGENT_ACTIVITY_CONFLICT',
} as const;

export type CatalogErrorCode = typeof CATALOG_ERROR_CODES[keyof typeof CATALOG_ERROR_CODES];

export interface CatalogDocument {
  config: ProjectConfig;
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  storefrontMembership: StorefrontMembership;
  retiredVerseKeys: string[];
  projectDataDiagnostics: string[];
}

export interface CatalogSnapshot extends CatalogDocument {
  revision: string;
  savedRevision: string;
  dirty: boolean;
  savedFileHash: string | null;
  managedFileHash: string | null;
  validation: ValidationIssue[];
}

export interface CatalogMutationResult {
  snapshot: CatalogSnapshot;
  affected?: unknown;
  cascades: string[];
}

export interface CatalogPatchOperation {
  type: string;
  [key: string]: unknown;
}

export interface CatalogPatchOptions {
  existingProject?: boolean;
  moduleConfiguration?: Partial<Pick<ProjectConfig, 'deviceClassName' | 'infoModuleName' | 'entitlementsModuleName' | 'pricesModuleName' | 'offersModuleName'>>;
}

interface OperationResult {
  affected?: unknown;
  cascades: string[];
  identityEvidence?: {
    targetId: string;
    kind: PublicIdentityKind;
    current: DerivedPublicIdentity;
    requested: DerivedPublicIdentity;
    effective: DerivedPublicIdentity;
    identityChanged: boolean;
    currentCatalogIdentityChanged: boolean;
    reason: string;
  };
}

export class CatalogDomainError extends Error {
  readonly code: CatalogErrorCode;
  readonly data: Record<string, unknown>;
  readonly status: number;

  constructor(code: CatalogErrorCode, message: string, data: Record<string, unknown> = {}, status = 409) {
    super(message);
    this.name = 'CatalogDomainError';
    this.code = code;
    this.data = data;
    this.status = status;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueId(preferred: unknown, prefix: string, used: Set<string>): string {
  const base = text(preferred) ?? `${prefix}-${uuid()}`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}-${index++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function activeKeys(document: CatalogDocument): string[] {
  return [
    ...document.entitlements.flatMap(item => [item.verseKey, ...(item.alternateOffers ?? []).map(offer => offer.verseKey)]),
    ...document.bundles.map(bundle => bundle.verseKey),
    ...document.storefrontMembership.focused.map(group => group.verseKey),
  ];
}

function withEntryId(entries: OfferDisplayEntry[], id: string): OfferDisplayEntry[] {
  return entries.filter(entry => entry.entitlementId !== id && entry.bundleId !== id);
}

function normalizeDocument(input: CatalogDocument, fallbackConfig: ProjectConfig): CatalogDocument {
  const entitlements = (Array.isArray(input.entitlements) ? input.entitlements : []).map((value, index) => normalizeEntitlement(value, index));
  const bundles = (Array.isArray(input.bundles) ? input.bundles : []).map((value, index) => normalizeBundle(value, index));
  const normalizedStorefront = normalizeStorefrontMembership(input.storefrontMembership, entitlements, bundles);
  return {
    config: normalizeProjectConfig(input.config, fallbackConfig),
    entitlements,
    bundles,
    storefrontMembership: normalizedStorefront.membership,
    retiredVerseKeys: normalizeRetiredVerseKeys(input.retiredVerseKeys),
    projectDataDiagnostics: [...new Set([...(input.projectDataDiagnostics ?? []), ...normalizedStorefront.projectDataDiagnostics])],
  };
}

function validation(document: CatalogDocument): ValidationIssue[] {
  return validateEntireProject(
    document.entitlements,
    document.bundles,
    document.config,
    document.storefrontMembership,
    document.retiredVerseKeys,
  );
}

function integrity(document: CatalogDocument): string[] {
  const problems: string[] = [];
  const recordIds = new Map<string, string>();
  const verseKeys = new Map<string, string>();
  const check = (value: unknown, label: string, map: Map<string, string>) => {
    const normalized = text(value)?.toLowerCase();
    if (!normalized) {
      problems.push(`${label} is missing.`);
      return;
    }
    const previous = map.get(normalized);
    if (previous) problems.push(`${label} duplicates ${previous}.`);
    else map.set(normalized, label);
  };
  for (const item of document.entitlements) {
    check(item.id, `entitlement ${item.id || '(unknown)'} id`, recordIds);
    check(item.verseKey, `entitlement ${item.id || '(unknown)'} Verse key`, verseKeys);
    for (const offer of item.alternateOffers ?? []) {
      check(offer.id, `alternate offer ${offer.id || '(unknown)'} id`, recordIds);
      check(offer.verseKey, `alternate offer ${offer.id || '(unknown)'} Verse key`, verseKeys);
    }
  }
  for (const bundle of document.bundles) {
    check(bundle.id, `bundle ${bundle.id || '(unknown)'} id`, recordIds);
    check(bundle.verseKey, `bundle ${bundle.id || '(unknown)'} Verse key`, verseKeys);
  }
  for (const group of document.storefrontMembership.focused) {
    check(group.id, `storefront ${group.id || '(unknown)'} id`, recordIds);
    check(group.verseKey, `storefront ${group.id || '(unknown)'} Verse key`, verseKeys);
  }
  const entitlementIds = new Set(document.entitlements.map(item => item.id));
  const bundleIds = new Set(document.bundles.map(bundle => bundle.id));
  const checkEntry = (entry: OfferDisplayEntry, label: string) => {
    if (entry.entitlementId && !entitlementIds.has(entry.entitlementId)) problems.push(`${label} references missing entitlement ${entry.entitlementId}.`);
    if (entry.bundleId && !bundleIds.has(entry.bundleId)) problems.push(`${label} references missing bundle ${entry.bundleId}.`);
    if (entry.entitlementId && entry.bundleId) problems.push(`${label} references both an entitlement and a bundle.`);
    if (!entry.entitlementId && !entry.bundleId) problems.push(`${label} has no offer reference.`);
  };
  document.storefrontMembership.allOffers.forEach((entry, index) => checkEntry(entry, `All Offers entry ${index + 1}`));
  document.storefrontMembership.focused.forEach(group => group.entries.forEach((entry, index) => checkEntry(entry, `Storefront ${group.id} entry ${index + 1}`)));
  return problems;
}

function applyEntitlementCreate(document: CatalogDocument, payload: Record<string, unknown>, identity?: { id?: string; verseKey?: string }): EntitlementItem {
  const ids = new Set(document.entitlements.map(item => item.id).concat(document.bundles.map(item => item.id)).concat(document.storefrontMembership.focused.map(item => item.id)).concat(document.entitlements.flatMap(item => (item.alternateOffers ?? []).map(offer => offer.id))));
  const allocator = createVerseKeyAllocator(activeKeys(document), document.retiredVerseKeys);
  const name = text(payload.name) ?? 'Entitlement';
  // Verse keys are UTM-managed identity. Create operations may carry a stale
  // client hint, but it must never override the canonical allocator.
  const verseKey = allocator.allocate(name);
  const managedPayload = withManagedAlternateKeys({
    ...payload,
    iconTexture: text(payload.iconTexture) ?? `${document.config.assetFolderName}.UTM_PlaceholderIcon`,
  }, verseKey, allocator);
  const item = normalizeEntitlement({ ...managedPayload, id: uniqueId(identity?.id ?? payload.id, 'ent', ids), verseKey, name }, document.entitlements.length);
  document.entitlements.push(item);
  if (!document.storefrontMembership.allOffers.some(entry => entry.entitlementId === item.id)) document.storefrontMembership.allOffers.push({ entitlementId: item.id });
  return item;
}

function applyAlternateCreate(document: CatalogDocument, payload: Record<string, unknown>, identity?: { id?: string; verseKey?: string }): unknown {
  const parentId = text(payload.entitlementId);
  const parent = document.entitlements.find(item => item.id === parentId);
  if (!parent) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Entitlement ${parentId ?? '(missing)'} does not exist.`, {}, 400);
  const ids = new Set(document.entitlements.flatMap(item => (item.alternateOffers ?? []).map(offer => offer.id)));
  const allocator = createVerseKeyAllocator(activeKeys(document), document.retiredVerseKeys);
  const name = text(payload.name) ?? `${parent.name} Alternate`;
  const verseKey = allocator.allocateAlternate(parent.verseKey);
  const alternate = {
    ...payload,
    iconTexture: text(payload.iconTexture) ?? `${document.config.assetFolderName}.UTM_PlaceholderIcon`,
    id: uniqueId(identity?.id ?? payload.id, 'offer', ids),
    verseKey,
    name,
  };
  const normalized = normalizeEntitlement({ ...parent, alternateOffers: [...(parent.alternateOffers ?? []), alternate] }, document.entitlements.indexOf(parent)).alternateOffers?.at(-1);
  if (!normalized) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The alternate offer could not be normalized.', {}, 400);
  parent.alternateOffers = [...(parent.alternateOffers ?? []), normalized];
  return normalized;
}

function applyBundleCreate(document: CatalogDocument, payload: Record<string, unknown>, identity?: { id?: string; verseKey?: string }): BundleOffer {
  const ids = new Set(document.bundles.map(item => item.id).concat(document.entitlements.map(item => item.id)).concat(document.storefrontMembership.focused.map(item => item.id)));
  const allocator = createVerseKeyAllocator(activeKeys(document), document.retiredVerseKeys);
  const name = text(payload.name) ?? 'Bundle';
  const bundle = normalizeBundle({ ...payload, iconTexture: text(payload.iconTexture) ?? `${document.config.assetFolderName}.UTM_PlaceholderIcon`, id: uniqueId(identity?.id ?? payload.id, 'bundle', ids), verseKey: allocator.allocate(name), name }, document.bundles.length);
  document.bundles.push(bundle);
  if (!bundle.dynamicOffer && !bundle.dynamicRemaining && !document.storefrontMembership.allOffers.some(entry => entry.bundleId === bundle.id)) document.storefrontMembership.allOffers.push({ bundleId: bundle.id });
  return bundle;
}

function applyStorefrontCreate(document: CatalogDocument, payload: Record<string, unknown>, identity?: { id?: string; verseKey?: string }): OfferDisplayGroup {
  const ids = new Set(document.storefrontMembership.focused.map(group => group.id).concat(document.entitlements.map(item => item.id)).concat(document.bundles.map(item => item.id)));
  const allocator = createVerseKeyAllocator(activeKeys(document), document.retiredVerseKeys);
  const name = text(payload.name) ?? 'Storefront';
  const group = normalizeOfferDisplayGroup({ ...payload, id: uniqueId(identity?.id ?? payload.id, 'store', ids), verseKey: allocator.allocate(name), name }, document.storefrontMembership.focused.length);
  document.storefrontMembership.focused.push(group);
  return group;
}

function patchObject<T extends Record<string, unknown>>(current: T, patch: Record<string, unknown>): T {
  const next = { ...current } as T;
  for (const [key, value] of Object.entries(patch)) if (!['id', 'verseKey', 'entitlementId', 'alternateOfferId', 'bundleId', 'storefrontId', 'type'].includes(key)) (next as Record<string, unknown>)[key] = value;
  return next;
}

function withManagedAlternateKeys(
  payload: Record<string, unknown>,
  parentVerseKey: string,
  allocator: ReturnType<typeof createVerseKeyAllocator>,
  existing: EntitlementItem['alternateOffers'] = [],
): Record<string, unknown> {
  if (!Array.isArray(payload.alternateOffers)) return payload;
  const existingById = new Map((existing ?? []).map(offer => [offer.id, offer]));
  return {
    ...payload,
    alternateOffers: payload.alternateOffers.map(value => {
      const candidate = record(value);
      const candidateId = text(candidate.id);
      const prior = candidateId ? existingById.get(candidateId) : undefined;
      return {
        ...candidate,
        ...(prior ? { id: prior.id, verseKey: prior.verseKey } : { verseKey: allocator.allocateAlternate(parentVerseKey) }),
      };
    }),
  };
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rejectImplicitIdentityImport(operation: CatalogPatchOperation): void {
  const data = record(operation.data);
  const payload = { ...operation, ...data };
  const genericIdentityOperation = /^(create|update)_(entitlement|alternate_offer|bundle|storefront)$/.test(operation.type);
  if (!genericIdentityOperation) return;
  const nestedIdentity = Array.isArray(payload.alternateOffers)
    && payload.alternateOffers.some(value => {
      const candidate = record(value);
      return hasOwn(candidate, 'verseKey') || hasOwn(candidate, 'publicIdentity');
    });
  if (!hasOwn(operation, 'verseKey') && !hasOwn(data, 'verseKey') && !hasOwn(operation, 'publicIdentity') && !hasOwn(data, 'publicIdentity') && !nestedIdentity) return;
  throw new CatalogDomainError(
    CATALOG_ERROR_CODES.identityImportRequired,
    `Operation ${operation.type} cannot supply a Verse key or public identity. Use adopt_existing_identity in an existing-project migration so identity adoption is explicit and parity-checked.`,
    { operationType: operation.type, guidance: 'Generic create/update operations allocate or preserve UTM-managed identity. Existing published identities require adopt_existing_identity.' },
    400,
  );
}

function locateIdentityTarget(document: CatalogDocument, operation: CatalogPatchOperation, payload: Record<string, unknown>): {
  kind: PublicIdentityKind;
  target: IdentityRecord & Record<string, unknown>;
  parent?: EntitlementItem;
} {
  const kind = text(operation.kind ?? payload.kind) as PublicIdentityKind | undefined;
  const targetId = text(operation.targetId ?? payload.targetId ?? operation.id ?? payload.id);
  if (!kind || !['entitlement', 'alternate_offer', 'bundle', 'storefront'].includes(kind)) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityInvalid, 'adopt_existing_identity requires a supported identity kind.', { kind }, 400);
  }
  if (!targetId) throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityInvalid, 'adopt_existing_identity requires targetId.', {}, 400);
  if (kind === 'entitlement') {
    const target = document.entitlements.find(item => item.id === targetId);
    if (!target) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Entitlement ${targetId} does not exist.`, {}, 400);
    return { kind, target: target as unknown as IdentityRecord & Record<string, unknown> };
  }
  if (kind === 'bundle') {
    const target = document.bundles.find(bundle => bundle.id === targetId);
    if (!target) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Bundle ${targetId} does not exist.`, {}, 400);
    return { kind, target: target as unknown as IdentityRecord & Record<string, unknown> };
  }
  if (kind === 'storefront') {
    const target = document.storefrontMembership.focused.find(group => group.id === targetId);
    if (!target) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Storefront ${targetId} does not exist.`, {}, 400);
    return { kind, target: target as unknown as IdentityRecord & Record<string, unknown> };
  }
  const parentId = text(operation.parentId ?? payload.parentId ?? operation.entitlementId ?? payload.entitlementId);
  const parent = document.entitlements.find(item => item.id === parentId);
  const target = parent?.alternateOffers?.find(offer => offer.id === targetId);
  if (!parent || !target) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Alternate offer ${targetId} does not exist.`, {}, 400);
  return { kind, target: target as unknown as IdentityRecord & Record<string, unknown>, parent };
}

function identityRecords(document: CatalogDocument): Array<{ kind: PublicIdentityKind; record: IdentityRecord; parent?: EntitlementItem }> {
  const result: Array<{ kind: PublicIdentityKind; record: IdentityRecord; parent?: EntitlementItem }> = [];
  for (const item of document.entitlements) {
    result.push({ kind: 'entitlement', record: item });
    for (const offer of item.alternateOffers ?? []) result.push({ kind: 'alternate_offer', record: offer, parent: item });
  }
  for (const bundle of document.bundles) result.push({ kind: 'bundle', record: bundle });
  for (const group of document.storefrontMembership.focused) result.push({ kind: 'storefront', record: group });
  return result;
}

function assertPublicIdentitySet(document: CatalogDocument): void {
  const paths = new Map<string, string>();
  for (const entry of identityRecords(document)) {
    const identity = derivePublicIdentity(entry.record, document.config, entry.kind, entry.parent);
    for (const [pathKind, path] of Object.entries(identity.paths)) {
      if (!path || (entry.kind === 'alternate_offer' && pathKind === 'entitlement')) continue;
      const previous = paths.get(path);
      if (previous && previous !== identity.stableId) {
        throw new CatalogDomainError(
          CATALOG_ERROR_CODES.publicIdentityConflict,
          `Public Verse identity path ${path} is claimed by both ${previous} and ${identity.stableId}.`,
          { path, firstStableId: previous, secondStableId: identity.stableId, pathKind },
          422,
        );
      }
      paths.set(path, identity.stableId);
    }
  }
}

function replaceOfferVerseKeyReferences(document: CatalogDocument, entitlementId: string, previousKey: string, nextKey: string): void {
  const replace = (entry: OfferDisplayEntry): OfferDisplayEntry => entry.entitlementId === entitlementId && entry.offerVerseKey?.toLowerCase() === previousKey.toLowerCase()
    ? { ...entry, offerVerseKey: nextKey }
    : entry;
  for (const bundle of document.bundles) bundle.items = bundle.items.map(entry => {
    const next = replace(entry);
    return { ...entry, ...(next.offerVerseKey !== entry.offerVerseKey ? { offerVerseKey: next.offerVerseKey } : {}) };
  });
  document.storefrontMembership.allOffers = document.storefrontMembership.allOffers.map(replace);
  document.storefrontMembership.focused = document.storefrontMembership.focused.map(group => ({ ...group, entries: group.entries.map(replace) }));
}

function applyExistingIdentityAdoption(
  document: CatalogDocument,
  operation: CatalogPatchOperation,
  options: CatalogPatchOptions | undefined,
): OperationResult {
  if (!options?.existingProject) {
    throw new CatalogDomainError(
      CATALOG_ERROR_CODES.identityImportRequired,
      'adopt_existing_identity is only available in an existing-project migration.',
      { operationType: operation.type, guidance: 'Set migration.mode to existing-project and provide confirmed migration parity.' },
      400,
    );
  }
  const operationData = record(operation.data);
  const payload = Object.keys(operationData).length ? { ...operation, ...operationData } : operation;
  const located = locateIdentityTarget(document, operation, payload);
  const requestedVerseKey = text(operation.verseKey ?? payload.verseKey);
  if (!requestedVerseKey || !isValidVerseIdentifier(requestedVerseKey)) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityInvalid, 'adopt_existing_identity requires a valid Verse key.', { targetId: located.target.id, verseKey: requestedVerseKey }, 400);
  }
  const identityProblems = validatePublicIdentityOverrides(operation.publicIdentity ?? payload.publicIdentity, located.kind, located.target.id);
  if (identityProblems.length) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityInvalid, 'The requested public identity is incomplete or invalid.', { targetId: located.target.id, problems: identityProblems }, 400);
  }
  const overrides = normalizePublicIdentityOverrides(operation.publicIdentity ?? payload.publicIdentity)!;
  const currentIdentity = derivePublicIdentity(located.target, document.config, located.kind, located.parent);
  const occupiedKeys = activeKeys(document)
    .filter(key => key.toLowerCase() !== located.target.verseKey.toLowerCase())
    .map(key => key.toLowerCase());
  if (occupiedKeys.includes(requestedVerseKey.toLowerCase())) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityConflict, `Verse key ${requestedVerseKey} is already assigned to another managed record.`, { targetId: located.target.id, verseKey: requestedVerseKey }, 422);
  }
  if (document.retiredVerseKeys.some(key => key.toLowerCase() === requestedVerseKey.toLowerCase() && key.toLowerCase() !== located.target.verseKey.toLowerCase())) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityConflict, `Verse key ${requestedVerseKey} is retired and cannot be reissued during identity adoption.`, { targetId: located.target.id, verseKey: requestedVerseKey }, 422);
  }

  const requestedRecord = { ...located.target, verseKey: requestedVerseKey, publicIdentity: overrides } as IdentityRecord;
  const requestedIdentity = derivePublicIdentity(requestedRecord, document.config, located.kind, located.parent);
  const previousKey = located.target.verseKey;
  if (previousKey.toLowerCase() !== requestedVerseKey.toLowerCase()) {
    document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, previousKey]);
    if (located.kind === 'entitlement' || located.kind === 'alternate_offer') replaceOfferVerseKeyReferences(document, located.parent?.id ?? located.target.id, previousKey, requestedVerseKey);
  }
  located.target.verseKey = requestedVerseKey;
  located.target.publicIdentity = overrides;
  const effectiveIdentity = derivePublicIdentity(located.target, document.config, located.kind, located.parent);
  const identityChanged = !publicIdentitiesEqual(requestedIdentity, effectiveIdentity);
  if (identityChanged) {
    throw new CatalogDomainError(CATALOG_ERROR_CODES.publicIdentityMismatch, `The effective generated identity for ${located.target.id} does not exactly match the requested identity.`, { targetId: located.target.id, requested: requestedIdentity, effective: effectiveIdentity }, 422);
  }
  return {
    affected: located.target,
    cascades: previousKey.toLowerCase() === requestedVerseKey.toLowerCase() ? [] : [`Adopted ${located.kind} identity for ${located.target.id}; retired former Verse key ${previousKey}.`],
    identityEvidence: {
      targetId: located.target.id,
      kind: located.kind,
      current: currentIdentity,
      requested: requestedIdentity,
      effective: effectiveIdentity,
      identityChanged,
      currentCatalogIdentityChanged: !publicIdentitiesEqual(currentIdentity, effectiveIdentity),
      reason: previousKey.toLowerCase() === requestedVerseKey.toLowerCase()
        ? 'Explicit existing-project identity adoption confirmed without changing the catalog key.'
        : `Explicit existing-project identity adoption preserved the requested public paths while correcting the catalog key from ${previousKey} to ${requestedVerseKey}.`,
    },
  };
}

function applyOperation(document: CatalogDocument, operation: CatalogPatchOperation, identity?: { id?: string; verseKey?: string }, options?: CatalogPatchOptions): OperationResult {
  const operationData = record(operation.data);
  const payload = Object.keys(operationData).length ? { ...operation, ...operationData } : operation;
  const cascades: string[] = [];
  if (operation.type === 'adopt_existing_identity') return applyExistingIdentityAdoption(document, operation, options);
  rejectImplicitIdentityImport(operation);
  switch (operation.type) {
    case 'create_entitlement': return { affected: applyEntitlementCreate(document, payload, identity), cascades };
    case 'update_entitlement': {
      const id = text(operation.entitlementId ?? payload.id);
      const current = document.entitlements.find(item => item.id === id);
      if (!current) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Entitlement ${id ?? '(missing)'} does not exist.`, {}, 400);
      const previousKey = current.verseKey;
      const previousAlternates = current.alternateOffers ?? [];
      const allocator = createVerseKeyAllocator(activeKeys(document), document.retiredVerseKeys);
      const nextPayload = withManagedAlternateKeys(patchObject(current as unknown as Record<string, unknown>, payload), current.verseKey, allocator, previousAlternates);
      const next = normalizeEntitlement(nextPayload, document.entitlements.indexOf(current));
      const retired = next.verseKey !== previousKey ? [previousKey] : [];
      for (const previousOffer of previousAlternates) {
        const nextOffer = next.alternateOffers?.find(offer => offer.id === previousOffer.id);
        if (!nextOffer || nextOffer.verseKey !== previousOffer.verseKey) retired.push(previousOffer.verseKey);
      }
      if (retired.length) document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, ...retired]);
      Object.assign(current, next);
      const validOfferKeys = new Set([current.verseKey, ...(current.alternateOffers ?? []).map(offer => offer.verseKey)]);
      const before = document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0);
      document.storefrontMembership.allOffers = document.storefrontMembership.allOffers.filter(entry => entry.entitlementId !== current.id || !entry.offerVerseKey || validOfferKeys.has(entry.offerVerseKey));
      document.storefrontMembership.focused = document.storefrontMembership.focused.map(group => ({ ...group, entries: group.entries.filter(entry => entry.entitlementId !== current.id || !entry.offerVerseKey || validOfferKeys.has(entry.offerVerseKey)) }));
      const after = document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0);
      if (before !== after) cascades.push(`Removed ${before - after} storefront reference(s) for offers no longer present on ${current.id}.`);
      return { affected: current, cascades };
    }
    case 'delete_entitlement': {
      const id = text(operation.entitlementId ?? payload.id);
      const index = document.entitlements.findIndex(item => item.id === id);
      if (index < 0) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Entitlement ${id ?? '(missing)'} does not exist.`, {}, 400);
      const [removed] = document.entitlements.splice(index, 1);
      document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, removed.verseKey, ...(removed.alternateOffers ?? []).map(offer => offer.verseKey)]);
      document.bundles = document.bundles.map(bundle => ({ ...bundle, items: bundle.items.filter(entry => entry.entitlementId !== id) }));
      const before = document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0);
      document.storefrontMembership.allOffers = document.storefrontMembership.allOffers.filter(entry => entry.entitlementId !== id);
      document.storefrontMembership.focused = document.storefrontMembership.focused.map(group => ({ ...group, entries: group.entries.filter(entry => entry.entitlementId !== id) }));
      cascades.push(`Deleted entitlement ${id} and its ${(removed.alternateOffers ?? []).length} alternate offer(s).`, `Removed ${before - (document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0))} storefront reference(s).`, 'Removed the entitlement from every bundle.');
      return { affected: removed, cascades };
    }
    case 'create_alternate_offer': return { affected: applyAlternateCreate(document, payload, identity), cascades };
    case 'update_alternate_offer': {
      const parent = document.entitlements.find(item => item.id === text(operation.entitlementId ?? payload.entitlementId));
      const alternate = parent?.alternateOffers?.find(offer => offer.id === text(operation.alternateOfferId ?? payload.alternateOfferId ?? payload.id));
      if (!parent || !alternate) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The alternate offer does not exist.', {}, 400);
      const previousKey = alternate.verseKey;
      const next = normalizeEntitlement({ ...parent, alternateOffers: [patchObject(alternate as unknown as Record<string, unknown>, payload)] }, document.entitlements.indexOf(parent)).alternateOffers?.[0];
      if (!next) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The alternate offer could not be normalized.', {}, 400);
      if (next.verseKey !== previousKey) document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, previousKey]);
      Object.assign(alternate, next);
      return { affected: alternate, cascades };
    }
    case 'delete_alternate_offer': {
      const parent = document.entitlements.find(item => item.id === text(operation.entitlementId ?? payload.entitlementId));
      const alternateId = text(operation.alternateOfferId ?? payload.alternateOfferId ?? payload.id);
      const index = parent?.alternateOffers?.findIndex(offer => offer.id === alternateId) ?? -1;
      if (!parent || index < 0) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The alternate offer does not exist.', {}, 400);
      const [removed] = parent.alternateOffers!.splice(index, 1);
      document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, removed.verseKey]);
      const removeVariant = (entry: OfferDisplayEntry) => entry.entitlementId === parent.id && entry.offerVerseKey === removed.verseKey;
      const before = document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0);
      document.storefrontMembership.allOffers = document.storefrontMembership.allOffers.filter(entry => !removeVariant(entry));
      document.storefrontMembership.focused = document.storefrontMembership.focused.map(group => ({ ...group, entries: group.entries.filter(entry => !removeVariant(entry)) }));
      cascades.push(`Removed ${before - (document.storefrontMembership.allOffers.length + document.storefrontMembership.focused.reduce((sum, group) => sum + group.entries.length, 0))} storefront reference(s).`);
      return { affected: removed, cascades };
    }
    case 'create_bundle': return { affected: applyBundleCreate(document, payload, identity), cascades };
    case 'update_bundle': {
      const id = text(operation.bundleId ?? payload.id);
      const current = document.bundles.find(bundle => bundle.id === id);
      if (!current) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Bundle ${id ?? '(missing)'} does not exist.`, {}, 400);
      const previousKey = current.verseKey;
      const next = normalizeBundle(patchObject(current as unknown as Record<string, unknown>, payload), document.bundles.indexOf(current));
      if (next.verseKey !== previousKey) document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, previousKey]);
      Object.assign(current, next);
      return { affected: current, cascades };
    }
    case 'delete_bundle': {
      const id = text(operation.bundleId ?? payload.id);
      if (!id) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'Bundle id is required.', {}, 400);
      const index = document.bundles.findIndex(bundle => bundle.id === id);
      if (index < 0) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Bundle ${id ?? '(missing)'} does not exist.`, {}, 400);
      const [removed] = document.bundles.splice(index, 1);
      document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, removed.verseKey]);
      document.storefrontMembership.allOffers = withEntryId(document.storefrontMembership.allOffers, id);
      document.storefrontMembership.focused = document.storefrontMembership.focused.map(group => ({ ...group, entries: withEntryId(group.entries, id) }));
      cascades.push(`Removed bundle ${id} from every storefront.`);
      return { affected: removed, cascades };
    }
    case 'create_storefront': return { affected: applyStorefrontCreate(document, payload, identity), cascades };
    case 'update_storefront': {
      const id = text(operation.storefrontId ?? payload.id);
      const current = document.storefrontMembership.focused.find(group => group.id === id);
      if (!current) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Storefront ${id ?? '(missing)'} does not exist.`, {}, 400);
      const previousKey = current.verseKey;
      const next = normalizeOfferDisplayGroup(patchObject(current as unknown as Record<string, unknown>, payload), document.storefrontMembership.focused.indexOf(current));
      if (next.verseKey !== previousKey) document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, previousKey]);
      Object.assign(current, next);
      return { affected: current, cascades };
    }
    case 'delete_storefront': {
      const id = text(operation.storefrontId ?? payload.id);
      const index = document.storefrontMembership.focused.findIndex(group => group.id === id);
      if (index < 0) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Storefront ${id ?? '(missing)'} does not exist.`, {}, 400);
      const [removed] = document.storefrontMembership.focused.splice(index, 1);
      document.retiredVerseKeys = normalizeRetiredVerseKeys([...document.retiredVerseKeys, removed.verseKey]);
      cascades.push(`Deleted storefront ${id}. Its membership did not affect the All Offers storefront.`);
      return { affected: removed, cascades };
    }
    case 'set_storefront_membership': {
      const id = text(operation.storefrontId ?? payload.storefrontId);
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      if (id === 'all' || id === 'all-offers' || !id) document.storefrontMembership.allOffers = entries as OfferDisplayEntry[];
      else {
        const group = document.storefrontMembership.focused.find(candidate => candidate.id === id);
        if (!group) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Storefront ${id} does not exist.`, {}, 400);
        group.entries = entries as OfferDisplayEntry[];
      }
      return { affected: id ?? 'all', cascades };
    }
    default: throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Unsupported catalog operation: ${operation.type}.`, {}, 400);
  }
}

export function defaultProjectConfig(contentFolderPath: string, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return normalizeProjectConfig({
    contentFolderPath,
    targetVerseFileName: 'managed_transactions.verse',
    assetFolderName: 'EntitlementIcons',
    deviceClassName: 'managed_transactions_device',
    infoModuleName: 'ManagedEntitlementInfo',
    entitlementsModuleName: 'ManagedEntitlements',
    pricesModuleName: 'ManagedTransactionPrices',
    offersModuleName: 'ManagedOffers',
    autoBackup: true,
    enableVerseWorkflowServer: true,
    generateStorefrontBinding: false,
    ...overrides,
  }, {
    contentFolderPath,
    targetVerseFileName: 'managed_transactions.verse',
    assetFolderName: 'EntitlementIcons',
    deviceClassName: 'managed_transactions_device',
    infoModuleName: 'ManagedEntitlementInfo',
    entitlementsModuleName: 'ManagedEntitlements',
    pricesModuleName: 'ManagedTransactionPrices',
    offersModuleName: 'ManagedOffers',
    autoBackup: true,
    enableVerseWorkflowServer: true,
    generateStorefrontBinding: false,
  });
}

export class CatalogSession {
  private document: CatalogDocument;
  private revisionNumber = 1;
  private savedRevisionValue = '1';
  private savedFileHashValue: string | null = null;
  private managedFileHashValue: string | null = null;
  private readonly listeners = new Set<(snapshot: CatalogSnapshot) => void>();

  constructor(initial: CatalogDocument, options: { savedFileHash?: string | null; initialDirty?: boolean } = {}) {
    this.document = normalizeDocument(clone(initial), initial.config);
    this.savedFileHashValue = options.savedFileHash ?? null;
    this.managedFileHashValue = options.savedFileHash ?? null;
    if (options.initialDirty) this.savedRevisionValue = '0';
  }

  initialize(initial: CatalogDocument, options: { savedFileHash?: string | null; initialDirty?: boolean } = {}): CatalogSnapshot {
    if (this.currentRevision !== '1' || this.snapshot().dirty) {
      throw new CatalogDomainError(CATALOG_ERROR_CODES.projectNotReady, 'The catalog session is already initialized and cannot be replaced during project use.', {}, 409);
    }
    this.document = normalizeDocument(clone(initial), initial.config);
    this.savedFileHashValue = options.savedFileHash ?? null;
    this.managedFileHashValue = options.savedFileHash ?? null;
    this.savedRevisionValue = options.initialDirty ? '0' : this.currentRevision;
    this.emit();
    return this.snapshot();
  }

  get currentRevision(): string { return String(this.revisionNumber); }

  subscribe(listener: (snapshot: CatalogSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const value = this.snapshot();
    for (const listener of this.listeners) listener(value);
  }

  snapshot(): CatalogSnapshot {
    const document = clone(this.document);
    return {
      ...document,
      revision: this.currentRevision,
      savedRevision: this.savedRevisionValue,
      dirty: this.currentRevision !== this.savedRevisionValue,
      savedFileHash: this.savedFileHashValue,
      managedFileHash: this.managedFileHashValue,
      validation: validation(document),
    };
  }

  documentForGeneration(): CatalogDocument {
    return clone(this.document);
  }

  validateCurrent(): ValidationIssue[] {
    return validation(this.document);
  }

  replaceDocument(next: CatalogDocument, expectedRevision: string): CatalogMutationResult {
    this.assertRevision(expectedRevision);
    const normalized = normalizeDocument(clone(next), this.document.config);
    const problems = integrity(normalized);
    if (problems.length) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The proposed catalog contains structural integrity errors.', { problems }, 400);
    this.document = normalized;
    this.bump();
    return { snapshot: this.snapshot(), cascades: [] };
  }

  mutate(operation: CatalogPatchOperation, expectedRevision: string): CatalogMutationResult {
    this.assertRevision(expectedRevision);
    const next = clone(this.document);
    const result = applyOperation(next, operation);
    const normalized = normalizeDocument(next, this.document.config);
    const problems = integrity(normalized);
    if (problems.length) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The catalog mutation would corrupt project state.', { problems }, 400);
    this.document = normalized;
    this.bump();
    return { snapshot: this.snapshot(), affected: result.affected, cascades: result.cascades };
  }

  applyPatch(operations: CatalogPatchOperation[], expectedRevision: string, dryRun: boolean, options: CatalogPatchOptions = {}): CatalogMutationResult & { proposedRevision: string; operationResults: unknown[] } {
    this.assertRevision(expectedRevision);
    const next = clone(this.document);
    if (options.moduleConfiguration) {
      if (!options.existingProject) {
        throw new CatalogDomainError(CATALOG_ERROR_CODES.identityImportRequired, 'Module identity adoption is only available in an existing-project migration.', { guidance: 'Set migration.mode to existing-project before changing generated module identities.' }, 400);
      }
      next.config = normalizeProjectConfig({ ...next.config, ...options.moduleConfiguration }, next.config);
    }
    const operationResults: unknown[] = [];
    const allCascades: string[] = [];
    operations.forEach((operation, index) => {
      const operationData = record(operation.data);
      const requestedId = text(operation.id ?? operationData.id);
      const identity = { id: requestedId ?? `bulk-${expectedRevision}-${index + 1}` };
      const result = applyOperation(next, operation, identity, options);
      operationResults.push({ index, affected: result.affected, cascades: result.cascades, ...(result.identityEvidence ? { identityEvidence: result.identityEvidence } : {}) });
      allCascades.push(...result.cascades);
    });
    const normalized = normalizeDocument(next, next.config);
    const problems = integrity(normalized);
    if (problems.length) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, 'The catalog patch contains structural integrity errors.', { problems }, 400);
    assertPublicIdentitySet(normalized);
    const issues = validation(normalized);
    if (!dryRun && issues.some(issue => issue.severity === 'error')) {
      throw new CatalogDomainError(CATALOG_ERROR_CODES.validationFailed, 'The catalog patch was rejected because validation contains errors.', { issues }, 422);
    }
    if (dryRun) return { snapshot: { ...this.snapshot(), ...normalized, validation: issues }, proposedRevision: this.currentRevision, operationResults, cascades: allCascades };
    this.document = normalized;
    this.bump();
    return { snapshot: this.snapshot(), proposedRevision: this.currentRevision, operationResults, cascades: allCascades };
  }

  assignIcon(target: { kind: 'entitlement' | 'alternate_offer' | 'bundle'; id: string; parentId?: string }, iconTexture: string, iconImageData?: string, expectedRevision?: string): CatalogMutationResult {
    this.assertRevision(expectedRevision ?? '');
    const next = clone(this.document);
    if (target.kind === 'entitlement') {
      const item = next.entitlements.find(candidate => candidate.id === target.id);
      if (!item) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Entitlement ${target.id} does not exist.`, {}, 400);
      item.iconTexture = iconTexture;
      item.iconImageData = iconImageData;
    } else if (target.kind === 'bundle') {
      const bundle = next.bundles.find(candidate => candidate.id === target.id);
      if (!bundle) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Bundle ${target.id} does not exist.`, {}, 400);
      bundle.iconTexture = iconTexture;
      bundle.iconImageData = iconImageData;
    } else {
      const parent = next.entitlements.find(candidate => candidate.id === target.parentId);
      const offer = parent?.alternateOffers?.find(candidate => candidate.id === target.id);
      if (!offer) throw new CatalogDomainError(CATALOG_ERROR_CODES.integrity, `Alternate offer ${target.id} does not exist.`, {}, 400);
      offer.iconTexture = iconTexture;
      offer.iconImageData = iconImageData;
    }
    this.document = normalizeDocument(next, this.document.config);
    this.bump();
    return { snapshot: this.snapshot(), affected: target, cascades: [] };
  }

  markSaved(contentHash: string): CatalogSnapshot {
    this.savedRevisionValue = this.currentRevision;
    this.savedFileHashValue = contentHash;
    this.managedFileHashValue = contentHash;
    this.emit();
    return this.snapshot();
  }

  setManagedFileHash(hash: string | null): void {
    this.managedFileHashValue = hash;
  }

  private assertRevision(expectedRevision: string): void {
    if (expectedRevision !== this.currentRevision) {
      throw new CatalogDomainError(CATALOG_ERROR_CODES.revisionConflict, 'The catalog changed since this client read it. Reload the snapshot and reconcile before retrying.', {
        expectedRevision,
        currentRevision: this.currentRevision,
        guidance: 'Call get_catalog_snapshot, reconcile the intended change, then retry with the returned revision.',
      });
    }
  }

  private bump(): void {
    this.revisionNumber += 1;
    this.emit();
  }
}

export function catalogForMcp(snapshot: CatalogSnapshot): Record<string, unknown> {
  const clean = cleanManagedData(snapshot.entitlements, snapshot.bundles, snapshot.storefrontMembership, snapshot.retiredVerseKeys);
  return {
    revision: snapshot.revision,
    savedRevision: snapshot.savedRevision,
    dirty: snapshot.dirty,
    config: { ...snapshot.config, contentFolderPath: '' },
    entitlements: clean.entitlements,
    alternateOffers: clean.entitlements.flatMap(item => (item.alternateOffers ?? []).map(offer => ({ ...offer, entitlementId: item.id }))),
    bundles: clean.bundles,
    storefronts: clean.storefrontMembership.focused,
    storefrontMembership: clean.storefrontMembership,
    retiredVerseKeys: clean.retiredVerseKeys ?? [],
    projectDataDiagnostics: snapshot.projectDataDiagnostics,
    validation: snapshot.validation,
    acknowledgedWarnings: [],
  };
}
