import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { CatalogDocument, CatalogPatchOperation, CatalogSession } from '../src/services/catalogSession';
import { CatalogDomainError, catalogForMcp } from '../src/services/catalogSession';
import { describeIntegrationContract } from '../src/services/integrationContract';
import { validateMigrationParityTable, type MigrationParityEntry } from '../src/services/migrationParity';

export interface UTMProjectContext {
  productVersion: string;
  projectName: string;
  projectFile: string;
  contentRoot: string;
  assetMount: string;
  targetManagedVerseFile: string;
  configuredIconFolder: string;
  editorConnection: Record<string, unknown>;
  nativeTextureAdoptionAvailable: boolean;
  managedFileOwned?: boolean;
  catalogInitialization?: 'first-run' | 'initialized';
  projectReadiness?: Record<string, unknown>;
}

export interface AdoptIconRequest {
  sourceAssetPath: string;
  assetFolderName: string;
  assetName: string;
}

export interface AdoptIconResult {
  success: boolean;
  verseAssetPath?: string;
  assetObjectPath?: string;
  imageData?: string;
  error?: string;
}

export interface SaveCatalogResult {
  success: boolean;
  contentHash?: string;
  fileName?: string;
  filePath?: string;
  backupPath?: string;
  currentHash?: string;
  code?: string;
  error?: string;
  status?: number;
}

export interface UTMHostOptions {
  version: string;
  catalog: CatalogSession;
  getProjectContext: () => UTMProjectContext;
  adoptIcon: (request: AdoptIconRequest) => Promise<AdoptIconResult>;
  saveCatalog: () => Promise<SaveCatalogResult>;
  assertCatalogReady?: (document: CatalogDocument) => Promise<void>;
  onClientConnection?: (connection: UTMClientConnection) => void;
}

export interface UTMClientConnection {
  clientName?: string;
  clientVersion?: string;
  verified: boolean;
  connectedAt: string;
  verifiedAt?: string;
}

type McpResponse = {
  content: [{ type: 'text'; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const expectedRevision = z.string().min(1).describe('Opaque catalog revision returned by get_catalog_snapshot.');
const data = z.record(z.unknown()).optional().describe('Fields to create or patch. Internal IDs are allocated by UTM unless explicitly supplied.');
const targetId = z.string().min(1);
const migrationParityEntrySchema = z.object({
  legacySourceIdentity: z.string().min(1),
  proposedId: z.string().min(1),
  kind: z.enum(['entitlement', 'alternate_offer', 'bundle']),
  status: z.enum(['confirmed', 'inferred', 'ambiguous', 'absent']),
  name: z.object({ legacy: z.string(), proposed: z.string() }),
  description: z.object({ legacy: z.string(), proposed: z.string() }),
  shortDescription: z.object({ legacy: z.string(), proposed: z.string() }),
  itemType: z.object({ legacy: z.enum(['durable', 'consumable']), proposed: z.enum(['durable', 'consumable']) }),
  maxCount: z.object({ legacy: z.number(), proposed: z.number() }),
  immediateConsume: z.object({ legacy: z.boolean(), proposed: z.boolean() }),
  autoConsume: z.object({ legacy: z.boolean(), proposed: z.boolean() }),
  priceVBucks: z.object({ legacy: z.number(), proposed: z.number() }),
  restrictions: z.object({ legacy: z.unknown(), proposed: z.unknown() }),
  iconSource: z.object({ legacy: z.string(), proposed: z.string() }),
  gameplayConsequence: z.object({ legacy: z.string(), proposed: z.string() }),
  consequenceBoundary: z.object({ legacy: z.enum(['grant', 'successful-consumption', 'removal', 'reconciliation', 'other']), proposed: z.enum(['grant', 'successful-consumption', 'removal', 'reconciliation', 'other']) }),
  repeatedPurchaseBehavior: z.object({ legacy: z.string(), proposed: z.string() }),
  relationships: z.object({ legacy: z.string(), proposed: z.string() }),
});
const migrationPolicy = z.object({
  preserveUnmatchedExisting: z.boolean().default(true).describe('Keep existing UTM records unless replacement is proven or deletion is explicitly authorized.'),
  authorizedDeletionIds: z.array(z.string().min(1)).default([]).describe('IDs explicitly authorized for deletion during this migration.'),
  mode: z.enum(['new-catalog', 'existing-project']).default('new-catalog').describe('Use existing-project for a legacy transaction migration; that mode requires an explicit parity table.'),
  parity: z.array(migrationParityEntrySchema).optional().describe('Required in existing-project mode. One explicit legacy-to-UTM comparison row per migrated transaction or offer.'),
}).default({ preserveUnmatchedExisting: true, authorizedDeletionIds: [], mode: 'new-catalog' });
const patchOperationSchema = z.object({
  type: z.enum([
    'create_entitlement', 'update_entitlement', 'delete_entitlement',
    'create_alternate_offer', 'update_alternate_offer', 'delete_alternate_offer',
    'create_bundle', 'update_bundle', 'delete_bundle',
    'create_storefront', 'update_storefront', 'delete_storefront', 'set_storefront_membership',
  ]),
  data: z.record(z.unknown()).optional(),
  entitlementId: z.string().optional(),
  alternateOfferId: z.string().optional(),
  bundleId: z.string().optional(),
  storefrontId: z.string().optional(),
}).passthrough();

function jsonResult(value: unknown, isError = false): McpResponse {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(error: unknown): McpResponse {
  if (error instanceof CatalogDomainError) return jsonResult({ error: { code: error.code, message: error.message, data: error.data } }, true);
  return jsonResult({ error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'UTM MCP operation failed.' } }, true);
}

function targetKind(value: unknown): 'entitlement' | 'alternate_offer' | 'bundle' {
  if (value === 'primary' || value === 'entitlement') return 'entitlement';
  if (value === 'alternate' || value === 'alternate_offer') return 'alternate_offer';
  if (value === 'bundle') return 'bundle';
  throw new CatalogDomainError('CATALOG_INTEGRITY_ERROR', 'Icon target kind must be entitlement, alternate_offer, or bundle.', {}, 400);
}

function migrationTargetId(operation: CatalogPatchOperation): string | undefined {
  const operationData = operation.data && typeof operation.data === 'object' && !Array.isArray(operation.data) ? operation.data as Record<string, unknown> : {};
  const value = operation.entitlementId ?? operation.alternateOfferId ?? operation.bundleId ?? operation.storefrontId ?? operationData.id;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function assertMigrationDeletionPolicy(operations: CatalogPatchOperation[], policy: { preserveUnmatchedExisting: boolean; authorizedDeletionIds: string[] }): void {
  if (!policy.preserveUnmatchedExisting) return;
  const deletions = operations.filter(operation => operation.type.startsWith('delete_'));
  const unauthorized = deletions
    .map(operation => ({ operation: operation.type, id: migrationTargetId(operation) }))
    .filter(entry => !entry.id || !policy.authorizedDeletionIds.includes(entry.id));
  if (unauthorized.length) {
    throw new CatalogDomainError('CATALOG_INTEGRITY_ERROR', 'Migration patches preserve existing UTM records by default. Prove replacement or explicitly authorize each deletion before retrying.', { unauthorized }, 409);
  }
}

function registerTools(server: McpServer, options: UTMHostOptions): void {
  const { catalog } = options;
  const assertProjectReady = () => {
    if (options.getProjectContext().managedFileOwned === false) {
      throw new CatalogDomainError('PROJECT_NOT_READY', 'The selected target Verse file is not managed by UTM. Choose a new managed target in the human interface before mutating.', {}, 409);
    }
  };
  const assertCatalogReady = async (document: CatalogDocument) => {
    assertProjectReady();
    await options.assertCatalogReady?.(document);
  };
  const mutate = async (operation: CatalogPatchOperation, revision: string, dryRun = false): Promise<McpResponse> => {
    try {
      assertProjectReady();
      if (dryRun) return jsonResult(catalog.applyPatch([operation], revision, true));
      const proposed = catalog.applyPatch([operation], revision, true).snapshot;
      await assertCatalogReady(proposed);
      return jsonResult(catalog.mutate(operation, revision));
    } catch (error) {
      return errorResult(error);
    }
  };

  server.registerTool('get_project_context', {
    title: 'Get project context',
    description: 'Read-only. Returns the verified project identity and UTM bridge/editor health. It does not change the catalog, files, or UEFN editor.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => jsonResult({ ...options.getProjectContext(), catalog: { revision: catalog.currentRevision, dirty: catalog.snapshot().dirty } }));

  server.registerTool('get_catalog_snapshot', {
    title: 'Get catalog snapshot',
    description: 'Read-only. Returns the shared live UTM draft used by the human interface and MCP. It does not save to disk or compile Verse.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => jsonResult(catalogForMcp(catalog.snapshot())));

  server.registerTool('validate_catalog', {
    title: 'Validate catalog',
    description: 'Read-only. Runs the authoritative UTM validator against the current shared draft. It does not mutate or save the catalog.',
    inputSchema: { candidate: z.record(z.unknown()).optional().describe('Reserved for a future dry-run candidate; omit to validate the live draft.') },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => jsonResult({ revision: catalog.currentRevision, issues: catalog.validateCurrent() }));

  server.registerTool('validate_migration_parity', {
    title: 'Validate migration parity',
    description: 'Read-only. Validates the required legacy-to-UTM semantic parity table before an existing-project patch. It does not mutate, save, or compile anything.',
    inputSchema: {
      entries: z.array(migrationParityEntrySchema),
      operations: z.array(patchOperationSchema).default([]),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async args => {
    const report = validateMigrationParityTable(args.entries as MigrationParityEntry[], args.operations as CatalogPatchOperation[]);
    return jsonResult({ revision: catalog.currentRevision, ...report }, !report.valid);
  });

  server.registerTool('describe_integration_contract', {
    title: 'Describe integration contract',
    description: 'Read-only. Derives current generated Verse symbols and usage examples from UTM generator metadata. It does not edit Verse or the catalog.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => {
    const snapshot = catalog.snapshot();
    return jsonResult(describeIntegrationContract(snapshot.config, snapshot.entitlements, snapshot.bundles, snapshot.storefrontMembership, options.version));
  });

  server.registerTool('create_entitlement', {
    title: 'Create entitlement',
    description: 'Mutates the shared draft by creating one entitlement and allocating its internal ID and stable Verse key. It does not save to disk or compile Verse. Requires expectedRevision.',
    inputSchema: { expectedRevision, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'create_entitlement', data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('update_entitlement', {
    title: 'Update entitlement',
    description: 'Mutates only the provided fields of one entitlement in the shared draft. It does not save to disk or compile Verse. Requires expectedRevision.',
    inputSchema: { expectedRevision, entitlementId: targetId, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'update_entitlement', entitlementId: args.entitlementId, data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('delete_entitlement', {
    title: 'Delete entitlement',
    description: 'Destructive shared-draft mutation. Removes the entitlement, its alternate offers, bundle references, and storefront references. It does not save to disk. Requires expectedRevision; use dryRun to inspect cascades.',
    inputSchema: { expectedRevision, entitlementId: targetId, dryRun: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async args => mutate({ type: 'delete_entitlement', entitlementId: args.entitlementId }, args.expectedRevision, args.dryRun));

  server.registerTool('create_alternate_offer', {
    title: 'Create alternate offer',
    description: 'Creates an alternate purchase path under an existing entitlement and allocates its ID and stable Verse key. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, entitlementId: targetId, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'create_alternate_offer', entitlementId: args.entitlementId, data: { ...(args.data ?? {}), entitlementId: args.entitlementId } }, args.expectedRevision));

  server.registerTool('update_alternate_offer', {
    title: 'Update alternate offer',
    description: 'Patches only provided fields of an alternate offer in the shared draft. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, entitlementId: targetId, alternateOfferId: targetId, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'update_alternate_offer', entitlementId: args.entitlementId, alternateOfferId: args.alternateOfferId, data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('delete_alternate_offer', {
    title: 'Delete alternate offer',
    description: 'Destructive shared-draft mutation. Removes an alternate offer and storefront references to it. It does not save or compile. Requires expectedRevision; use dryRun to inspect cascades.',
    inputSchema: { expectedRevision, entitlementId: targetId, alternateOfferId: targetId, dryRun: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async args => mutate({ type: 'delete_alternate_offer', entitlementId: args.entitlementId, alternateOfferId: args.alternateOfferId }, args.expectedRevision, args.dryRun));

  server.registerTool('create_bundle', {
    title: 'Create bundle',
    description: 'Creates a transaction bundle and allocates its ID and stable Verse key. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'create_bundle', data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('update_bundle', {
    title: 'Update bundle',
    description: 'Patches only provided bundle fields in the shared draft. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, bundleId: targetId, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'update_bundle', bundleId: args.bundleId, data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('delete_bundle', {
    title: 'Delete bundle',
    description: 'Destructive shared-draft mutation. Removes a bundle and its storefront references. It does not save or compile. Requires expectedRevision; use dryRun to inspect cascades.',
    inputSchema: { expectedRevision, bundleId: targetId, dryRun: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async args => mutate({ type: 'delete_bundle', bundleId: args.bundleId }, args.expectedRevision, args.dryRun));

  server.registerTool('create_storefront', {
    title: 'Create storefront',
    description: 'Creates a storefront in the shared draft and allocates its ID and stable Verse key. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'create_storefront', data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('update_storefront', {
    title: 'Update storefront',
    description: 'Patches only provided focused-storefront fields in the shared draft. It does not save or compile. Requires expectedRevision.',
    inputSchema: { expectedRevision, storefrontId: targetId, data },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'update_storefront', storefrontId: args.storefrontId, data: args.data ?? {} }, args.expectedRevision));

  server.registerTool('delete_storefront', {
    title: 'Delete storefront',
    description: 'Destructive shared-draft mutation. Removes one storefront. It does not save or compile. Requires expectedRevision; use dryRun to inspect the result.',
    inputSchema: { expectedRevision, storefrontId: targetId, dryRun: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async args => mutate({ type: 'delete_storefront', storefrontId: args.storefrontId }, args.expectedRevision, args.dryRun));

  server.registerTool('set_storefront_membership', {
    title: 'Set storefront membership',
    description: 'Replaces one storefront membership list in the shared draft. It does not save or compile. Use storefrontId all for All Offers. Requires expectedRevision.',
    inputSchema: { expectedRevision, storefrontId: z.string().default('all'), entries: z.array(z.record(z.unknown())) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => mutate({ type: 'set_storefront_membership', storefrontId: args.storefrontId, data: { entries: args.entries } }, args.expectedRevision));

  server.registerTool('apply_catalog_patch', {
    title: 'Apply catalog patch',
    description: 'Atomically evaluates typed transaction-domain operations against a cloned shared draft, normalizes and validates them, and either applies the full patch or nothing. Requires expectedRevision. dryRun never mutates or saves. Migration patches preserve existing UTM records unless replacement is proven or deletion is explicitly authorized.',
    inputSchema: { expectedRevision, dryRun: z.boolean().default(true), operations: z.array(patchOperationSchema), migration: migrationPolicy },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async args => {
    try {
      assertProjectReady();
      assertMigrationDeletionPolicy(args.operations as CatalogPatchOperation[], args.migration);
      if (args.migration.mode === 'existing-project') {
        if (!args.migration.parity?.length) throw new CatalogDomainError('MIGRATION_PARITY_REQUIRED', 'Existing-project migration requires a pre-apply semantic parity table. Call validate_migration_parity with one row for every migrated transaction or offer, then include the same table here.', {}, 422);
        const parity = validateMigrationParityTable(args.migration.parity as MigrationParityEntry[], args.operations as CatalogPatchOperation[], true);
        if (!parity.valid) throw new CatalogDomainError('MIGRATION_PARITY_FAILED', 'The migration parity table is incomplete or changes legacy commercial/gameplay semantics. Resolve every issue before applying the patch.', { parity }, 422);
      }
      if (args.dryRun) return jsonResult(catalog.applyPatch(args.operations as CatalogPatchOperation[], args.expectedRevision, true));
      const proposed = catalog.applyPatch(args.operations as CatalogPatchOperation[], args.expectedRevision, true).snapshot;
      await assertCatalogReady(proposed);
      return jsonResult(catalog.applyPatch(args.operations as CatalogPatchOperation[], args.expectedRevision, false));
    }
    catch (error) { return errorResult(error); }
  });

  server.registerTool('adopt_icon', {
    title: 'Adopt Texture2D icon',
    description: 'Mutates one icon reference after adopting a real Texture2D object path discovered through Epic unreal-mcp and the controlled UEFN import pipeline. It never reads arbitrary files or edits .uasset files. Requires expectedRevision; it does not compile.',
    inputSchema: {
      expectedRevision,
      target: z.object({ kind: z.enum(['primary', 'entitlement', 'alternate', 'alternate_offer', 'bundle']), id: targetId, parentId: z.string().optional() }),
      sourceAssetPath: z.string().min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => {
    try {
      assertProjectReady();
      if (!/^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*\.[A-Za-z_][A-Za-z0-9_]*$/.test(args.sourceAssetPath)) throw new CatalogDomainError('ASSET_ADOPTION_FAILED', 'sourceAssetPath must be a real project Texture2D object path returned by Epic MCP.', {}, 400);
      const kind = targetKind(args.target.kind);
      const snapshot = catalog.snapshot();
      if (snapshot.revision !== args.expectedRevision) throw new CatalogDomainError('CATALOG_REVISION_CONFLICT', 'The catalog changed before icon adoption started. Reload the snapshot before retrying.', { expectedRevision: args.expectedRevision, currentRevision: snapshot.revision, guidance: 'Call get_catalog_snapshot, then retry adopt_icon with the returned revision.' }, 409);
      const item = kind === 'entitlement' ? snapshot.entitlements.find(candidate => candidate.id === args.target.id)
        : kind === 'bundle' ? snapshot.bundles.find(candidate => candidate.id === args.target.id)
          : snapshot.entitlements.find(candidate => candidate.id === args.target.parentId)?.alternateOffers?.find(candidate => candidate.id === args.target.id);
      if (!item) throw new CatalogDomainError('ASSET_ADOPTION_FAILED', 'The icon target does not exist in the current catalog.', {}, 400);
      await assertCatalogReady(snapshot);
      const result = await options.adoptIcon({ sourceAssetPath: args.sourceAssetPath, assetFolderName: snapshot.config.assetFolderName, assetName: `${item.verseKey}_Icon` });
      if (!result.success || !result.verseAssetPath) throw new CatalogDomainError('ASSET_ADOPTION_FAILED', result.error ?? 'The controlled Texture2D adoption did not complete.', {}, 422);
      return jsonResult(catalog.assignIcon({ kind, id: args.target.id, parentId: args.target.parentId }, result.verseAssetPath, result.imageData, args.expectedRevision));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('save_catalog', {
    title: 'Save catalog',
    description: 'Validates and atomically persists the current shared catalog through UTM generation and managed-file hash compare-and-swap. It does not compile Verse or modify external project Verse. Requires expectedRevision.',
    inputSchema: { expectedRevision },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async args => {
    try {
      assertProjectReady();
      const snapshot = catalog.snapshot();
      if (snapshot.revision !== args.expectedRevision) throw new CatalogDomainError('CATALOG_REVISION_CONFLICT', 'The catalog changed before save.', { expectedRevision: args.expectedRevision, currentRevision: snapshot.revision }, 409);
      const errors = snapshot.validation.filter(issue => issue.severity === 'error');
      if (errors.length) throw new CatalogDomainError('CATALOG_VALIDATION_FAILED', 'Save is blocked until validation errors are resolved.', { issues: snapshot.validation }, 422);
      await assertCatalogReady(snapshot);
      const saved = await options.saveCatalog();
      if (!saved.success || !saved.contentHash) throw new CatalogDomainError(saved.code === 'PROJECT_NOT_READY' ? 'PROJECT_NOT_READY' : saved.status === 409 ? 'MANAGED_FILE_CHANGED' : 'CATALOG_VALIDATION_FAILED', saved.error ?? 'The catalog could not be saved.', { currentHash: saved.currentHash ?? null, fileName: saved.fileName }, saved.status ?? 422);
      return jsonResult({ ...saved, snapshot: catalog.markSaved(saved.contentHash) });
    } catch (error) { return errorResult(error); }
  });
}

export class UTMcpHost {
  private listener: http.Server | null = null;
  private port = 0;
  private readonly transports = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; client?: UTMClientConnection }>();

  constructor(private readonly options: UTMHostOptions) {}

  get running(): boolean { return this.listener !== null; }
  get boundPort(): number { return this.port; }

  async start(port: number): Promise<void> {
    if (this.listener) return;
    const listener = http.createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { listener.off('listening', onListening); listener.close(() => undefined); reject(error); };
      const onListening = () => { listener.off('error', onError); resolve(); };
      listener.once('error', onError);
      listener.once('listening', onListening);
      listener.listen(port, '127.0.0.1');
    });
    this.listener = listener;
    this.port = port;
  }

  async stop(): Promise<void> {
    const transports = [...this.transports.values()];
    this.transports.clear();
    await Promise.all(transports.map(async entry => { await entry.transport.close().catch(() => undefined); await entry.server.close().catch(() => undefined); }));
    const listener = this.listener;
    this.listener = null;
    this.port = 0;
    if (listener) await new Promise<void>(resolve => listener.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const allowedHosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`]);
    if (url.pathname !== '/mcp') { res.writeHead(404).end(); return; }
    if (!allowedHosts.has(req.headers.host ?? '')) { res.writeHead(403).end(JSON.stringify({ error: 'Host is not allowed.' })); return; }
    const origin = req.headers.origin;
    if (origin && !new Set([`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`]).has(origin)) { res.writeHead(403).end(JSON.stringify({ error: 'Origin is not allowed.' })); return; }
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try { body = JSON.parse(raw); }
        catch { res.writeHead(400).end(JSON.stringify({ error: 'MCP request body must be JSON.' })); return; }
      }
    }
    const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
    let entry = sessionId ? this.transports.get(sessionId) : undefined;
    if (!entry) {
      if (req.method !== 'POST') { res.writeHead(404).end(JSON.stringify({ error: 'MCP session was not found. Reinitialize.' })); return; }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
      const server = new McpServer({ name: 'utm-mcp', title: 'UEFN Transaction Manager', version: this.options.version });
      registerTools(server, this.options);
      transport.onclose = () => { if (transport.sessionId) this.transports.delete(transport.sessionId); };
      await server.connect(transport);
      entry = { transport, server };
      if (transport.sessionId) this.transports.set(transport.sessionId, entry);
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const request = body as { method?: unknown; params?: unknown };
      if (request.method === 'initialize') {
        const clientInfo = request.params && typeof request.params === 'object' ? (request.params as { clientInfo?: { name?: unknown; version?: unknown } }).clientInfo : undefined;
        entry.client = {
          clientName: typeof clientInfo?.name === 'string' ? clientInfo.name : undefined,
          clientVersion: typeof clientInfo?.version === 'string' ? clientInfo.version : undefined,
          verified: false,
          connectedAt: new Date().toISOString(),
        };
        this.options.onClientConnection?.(entry.client);
      } else if (request.method === 'tools/call') {
        const params = request.params && typeof request.params === 'object' ? request.params as { name?: unknown } : undefined;
        if (params?.name === 'get_project_context' && entry.client) {
          entry.client = { ...entry.client, verified: true, verifiedAt: new Date().toISOString() };
          this.options.onClientConnection?.(entry.client);
        }
      }
    }
    await entry.transport.handleRequest(req, res, body);
    if (entry.transport.sessionId && !this.transports.has(entry.transport.sessionId)) this.transports.set(entry.transport.sessionId, entry);
  }
}
