import type { CatalogPatchOperation } from './catalogSession';

export type MigrationParityKind = 'entitlement' | 'alternate_offer' | 'bundle';
export type MigrationParityStatus = 'confirmed' | 'inferred' | 'ambiguous' | 'absent';
export type MigrationConsequenceBoundary = 'grant' | 'successful-consumption' | 'removal' | 'reconciliation' | 'other';

export interface MigrationParityPair<T = unknown> {
  legacy: T;
  proposed: T;
}

/**
 * The required pre-apply comparison for an existing-project migration.
 * Values are deliberately explicit pairs: a migration must show what the
 * legacy source said and what UTM will persist, rather than relying on
 * normalizeEntitlement defaults.
 */
export interface MigrationParityEntry {
  legacySourceIdentity: string;
  proposedId: string;
  kind: MigrationParityKind;
  status: MigrationParityStatus;
  name: MigrationParityPair<string>;
  description: MigrationParityPair<string>;
  shortDescription: MigrationParityPair<string>;
  itemType: MigrationParityPair<'durable' | 'consumable'>;
  maxCount: MigrationParityPair<number>;
  immediateConsume: MigrationParityPair<boolean>;
  autoConsume: MigrationParityPair<boolean>;
  priceVBucks: MigrationParityPair<number>;
  restrictions: MigrationParityPair<unknown>;
  iconSource: MigrationParityPair<string>;
  gameplayConsequence: MigrationParityPair<string>;
  consequenceBoundary: MigrationParityPair<MigrationConsequenceBoundary>;
  repeatedPurchaseBehavior: MigrationParityPair<string>;
  relationships: MigrationParityPair<string>;
}

export interface MigrationParityIssue {
  legacySourceIdentity?: string;
  proposedId?: string;
  field: string;
  message: string;
}

export interface MigrationParityReport {
  valid: boolean;
  confirmed: boolean;
  entries: number;
  issues: MigrationParityIssue[];
  warnings: MigrationParityIssue[];
}

const operationKinds = new Set([
  'create_entitlement', 'update_entitlement',
  'create_alternate_offer', 'update_alternate_offer',
  'create_bundle', 'update_bundle',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function pair(entry: MigrationParityEntry, field: keyof MigrationParityEntry): MigrationParityPair | undefined {
  const value = entry[field];
  return isRecord(value) && 'legacy' in value && 'proposed' in value
    ? value as MigrationParityPair
    : undefined;
}

function addMissingPairIssue(entry: MigrationParityEntry, field: string, issues: MigrationParityIssue[]): void {
  const value = pair(entry, field as keyof MigrationParityEntry);
  if (!value) {
    issues.push({ legacySourceIdentity: text(entry.legacySourceIdentity), proposedId: text(entry.proposedId), field, message: `The ${field} comparison must contain both legacy and proposed values.` });
    return;
  }
  if (typeof value.legacy === 'string' && !value.legacy.trim()) issues.push({ legacySourceIdentity: text(entry.legacySourceIdentity), proposedId: text(entry.proposedId), field: `${field}.legacy`, message: `Legacy ${field} is blank; do not replace known source metadata with a default.` });
  if (typeof value.proposed === 'string' && !value.proposed.trim()) issues.push({ legacySourceIdentity: text(entry.legacySourceIdentity), proposedId: text(entry.proposedId), field: `${field}.proposed`, message: `Proposed ${field} is blank.` });
}

function operationTarget(operation: CatalogPatchOperation): string | undefined {
  const data = isRecord(operation.data) ? operation.data : {};
  const value = operation.entitlementId ?? operation.alternateOfferId ?? operation.bundleId ?? operation.id ?? data.id;
  return text(value) || undefined;
}

export function validateMigrationParityTable(entries: MigrationParityEntry[], operations: CatalogPatchOperation[] = [], requireConfirmed = false): MigrationParityReport {
  const issues: MigrationParityIssue[] = [];
  const warnings: MigrationParityIssue[] = [];
  const seenIds = new Set<string>();
  const fields: Array<keyof MigrationParityEntry> = [
    'name', 'description', 'shortDescription', 'itemType', 'maxCount',
    'immediateConsume', 'autoConsume', 'priceVBucks', 'restrictions',
    'iconSource', 'gameplayConsequence', 'consequenceBoundary',
    'repeatedPurchaseBehavior', 'relationships',
  ];

  if (!entries.length) issues.push({ field: 'entries', message: 'Existing-project migration requires one parity row for every migrated transaction or offer.' });
  for (const entry of entries) {
    const source = text(entry.legacySourceIdentity);
    const proposedId = text(entry.proposedId);
    if (!source) issues.push({ field: 'legacySourceIdentity', message: 'Every parity row must identify its legacy declaration or transaction.' });
    if (!proposedId) issues.push({ legacySourceIdentity: source || undefined, field: 'proposedId', message: 'Every parity row must identify the exact proposed UTM record ID.' });
    const idKey = proposedId.toLowerCase();
    if (idKey && seenIds.has(idKey)) issues.push({ legacySourceIdentity: source || undefined, proposedId, field: 'proposedId', message: `Proposed UTM record ID ${proposedId} appears more than once in the parity table.` });
    if (idKey) seenIds.add(idKey);
    if (!['entitlement', 'alternate_offer', 'bundle'].includes(entry.kind)) issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'kind', message: 'Parity kind must identify an entitlement, alternate offer, or bundle.' });
    if (entry.status === 'ambiguous' || entry.status === 'absent') issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'status', message: `A ${entry.status} migration row cannot be applied; resolve the source evidence or omit the transaction.` });
    if (entry.status === 'inferred') {
      const finding = { legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'status', message: 'Inferred source evidence requires owner review before release acceptance.' };
      (requireConfirmed ? issues : warnings).push(finding);
    }
    for (const field of fields) addMissingPairIssue(entry, field, issues);

    const immediate = pair(entry, 'immediateConsume');
    const proposedAutoConsume = pair(entry, 'autoConsume');
    if (immediate && !sameValue(immediate.legacy, immediate.proposed)) {
      issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'immediateConsume', message: 'The proposed immediate-use classification differs from the confirmed legacy behavior.' });
    }
    if (proposedAutoConsume && immediate && typeof immediate.legacy === 'boolean' && typeof proposedAutoConsume.proposed === 'boolean' && immediate.legacy !== proposedAutoConsume.proposed) {
      issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'autoConsume', message: `autoConsume must match the proven legacy immediate-use behavior (${String(immediate.legacy)}).` });
    }
    if (proposedAutoConsume && typeof proposedAutoConsume.legacy === 'boolean' && typeof proposedAutoConsume.proposed === 'boolean' && proposedAutoConsume.legacy !== proposedAutoConsume.proposed) {
      issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'autoConsume', message: 'The proposed auto-consume behavior differs from the confirmed legacy behavior.' });
    }
    const type = pair(entry, 'itemType');
    const maxCount = pair(entry, 'maxCount');
    if (type && maxCount && type.proposed === 'durable' && maxCount.proposed !== 1) issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'maxCount', message: 'Durable migration rows must propose MaxCount 1.' });
    const boundary = pair(entry, 'consequenceBoundary');
    if (boundary && boundary.legacy !== boundary.proposed) issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: 'consequenceBoundary', message: 'The gameplay consequence boundary changed between legacy and proposed integration.' });

    for (const exactField of ['name', 'description', 'shortDescription', 'itemType', 'maxCount', 'priceVBucks', 'restrictions'] as const) {
      const values = pair(entry, exactField);
      if (values && !sameValue(values.legacy, values.proposed)) issues.push({ legacySourceIdentity: source || undefined, proposedId: proposedId || undefined, field: exactField, message: `Legacy and proposed ${exactField} differ; preserve the source value or stop for an owner decision.` });
    }
  }

  for (const operation of operations) {
    if (!operationKinds.has(operation.type)) continue;
    const target = operationTarget(operation);
    if (!target) {
      issues.push({ field: `operations.${operation.type}`, message: 'Existing-project migration operations must carry explicit stable IDs so parity rows can be matched before UTM allocates or normalizes anything.' });
    } else if (!seenIds.has(target.toLowerCase())) {
      issues.push({ proposedId: target, field: 'operations', message: `No parity row covers migration operation target ${target}.` });
    }
  }

  return { valid: issues.length === 0, confirmed: entries.length > 0 && entries.every(entry => entry.status === 'confirmed'), entries: entries.length, issues, warnings };
}
