import express from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import childProcess from 'child_process';
import { claimNextTextureImport, finishTextureImport, getTextureImportJob, normalizeTextureImportJob, queueTextureAdoption, queueTextureImport, resetTextureImportJob } from './textureImporter';
import { assertExistingPathInsideRoot, tokensEqual, validateIdentifier, validateVerseFileName } from './security';
import { compileVerseProject } from './workflowClient';
import { listProjectIconPreviews, resolveProjectIconPreview } from './iconPreviews';
import versionInfo from '../version.json';
import { CATALOG_ERROR_CODES, CatalogDomainError, CatalogSession, catalogForMcp, defaultProjectConfig, type CatalogDocument } from '../src/services/catalogSession';
import { parseVerseCode } from '../src/services/verseParser';
import { generateVerseCode } from '../src/services/verseGenerator';
import { isPlaceholderIconTexture, PLACEHOLDER_ICON_DATA_URL } from '../src/constants/placeholderIcon';
import { UTMcpHost, type SaveCatalogResult, type UTMProjectContext } from './utmMcp';
import { installAgentSkill, inspectAllAgentSkills, type AgentSkillInstallationStatus, type SupportedAgentId } from './agentSetup';
import { assetPackagePathFromObjectPath, collectManagedAssetReferences, missingManagedAssetReferences } from './managedAssets';

const app = express();
const port = Number(process.env.PORT || 3001);
const host = '127.0.0.1';
const sessionToken = process.env.UEM_SESSION_TOKEN;
const editorSessionToken = process.env.UEM_EDITOR_TOKEN;
const configuredRoot = process.env.UEM_CONTENT_ROOT;
const configuredAssetMount = process.env.UEM_ASSET_MOUNT;
const configuredProjectFile = process.env.UEM_PROJECT_FILE;
const projectPythonEnabled = process.env.UEM_PROJECT_PYTHON_ENABLED === '1';
const autoConnectorInstalled = process.env.UEM_AUTO_CONNECTOR_INSTALLED === '1';
const launchedUefnProcessId = Number(process.env.UEM_UEFN_PROCESS_ID || 0);
const bootstrapEligible = process.env.UEM_BOOTSTRAP_ELIGIBLE === '1';
const idleTimeoutMs = Number(process.env.UEM_IDLE_TIMEOUT_MS || 120000);

if (!sessionToken || sessionToken.length < 32) throw new Error('UEM_SESSION_TOKEN is required and must contain at least 32 characters.');
if (!editorSessionToken || editorSessionToken.length < 32) throw new Error('UEM_EDITOR_TOKEN is required and must contain at least 32 characters.');
if (!configuredRoot || !fs.existsSync(configuredRoot) || !fs.statSync(configuredRoot).isDirectory()) {
  throw new Error('UEM_CONTENT_ROOT must identify an existing UEFN Content directory.');
}
if (!configuredAssetMount || !/^\/[A-Za-z_][A-Za-z0-9_]*$/.test(configuredAssetMount)) throw new Error('UEM_ASSET_MOUNT must identify the active UEFN project mount.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an unprivileged TCP port.');

const contentRoot = fs.realpathSync(configuredRoot);
if (configuredProjectFile) {
  if (!configuredProjectFile.toLowerCase().endsWith('.uefnproject') || !fs.existsSync(configuredProjectFile) || !fs.statSync(configuredProjectFile).isFile()) {
    throw new Error('UEM_PROJECT_FILE must identify an existing .uefnproject descriptor.');
  }
  const projectDirectory = path.dirname(fs.realpathSync(configuredProjectFile));
  const mountName = configuredAssetMount.slice(1);
  const allowedContentRoots = [
    path.join(projectDirectory, 'Content'),
    path.join(projectDirectory, 'Plugins', mountName, 'Content'),
  ].filter(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()).map(candidate => fs.realpathSync(candidate).toLowerCase());
  if (!allowedContentRoots.includes(contentRoot.toLowerCase())) throw new Error('The selected Content root does not belong to UEM_PROJECT_FILE.');
}

const stateRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UEFN Entitlement Manager');
const agentIntegrationStatePath = path.join(stateRoot, 'agent-integration.json');
const defaultCatalogConfig = defaultProjectConfig(contentRoot);

interface AgentIntegrationState {
  port: number;
}

function loadAgentIntegrationState(): AgentIntegrationState {
  try {
    const parsed = JSON.parse(fs.readFileSync(agentIntegrationStatePath, 'utf8')) as Partial<AgentIntegrationState>;
    return {
      port: Number.isInteger(parsed.port) && Number(parsed.port) >= 1024 && Number(parsed.port) <= 65535 ? Number(parsed.port) : 8001,
    };
  } catch {
    return { port: 8001 };
  }
}

function saveAgentIntegrationState(state: AgentIntegrationState): void {
  fs.mkdirSync(stateRoot, { recursive: true });
  const temporary = `${agentIntegrationStatePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, agentIntegrationStatePath);
}

function readCatalogAtConfig(config: CatalogDocument['config']): { document: CatalogDocument; contentHash: string | null; managed: boolean } {
  const fileName = validateVerseFileName(config.targetVerseFileName);
  const filePath = path.join(contentRoot, fileName);
  if (fs.existsSync(filePath)) assertExistingPathInsideRoot(contentRoot, filePath);
  const empty = () => ({ document: { config, entitlements: [], bundles: [], storefrontMembership: { allOffers: [], focused: [] }, retiredVerseKeys: [], projectDataDiagnostics: [] }, contentHash: null, managed: true });
  if (!fs.existsSync(filePath)) {
    return empty();
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseVerseCode(content);
  if (!parsed.managed || parsed.error) {
    return {
      document: { config, entitlements: [], bundles: [], storefrontMembership: { allOffers: [], focused: [] }, retiredVerseKeys: [], projectDataDiagnostics: parsed.error ? [parsed.error] : [] },
      contentHash: sha256(content),
      managed: false,
    };
  }
  return {
    document: { config, entitlements: parsed.entitlements, bundles: parsed.bundles, storefrontMembership: parsed.storefrontMembership, retiredVerseKeys: parsed.retiredVerseKeys, projectDataDiagnostics: parsed.projectDataDiagnostics },
    contentHash: sha256(content),
    managed: true,
  };
}

function readInitialCatalog(): { document: CatalogDocument; contentHash: string | null; managed: boolean } {
  return readCatalogAtConfig(defaultCatalogConfig);
}

const initialCatalog = readInitialCatalog();
const catalogSession = new CatalogSession(initialCatalog.document, { savedFileHash: initialCatalog.contentHash });
let catalogManaged = initialCatalog.managed;
let catalogOpen = false;
const agentIntegration = loadAgentIntegrationState();
let mcpHost: UTMcpHost | null = null;
let mcpUnavailableReason: string | undefined;
let lastConfigurationIssuedAt: string | undefined;
let lastAgentConnection: import('./utmMcp').UTMClientConnection | undefined;
const distPath = path.join(__dirname, '..', 'dist');
let lastUiActivity = Date.now();
const uiLeases = new Set<express.Response>();
let leaseShutdownTimer: NodeJS.Timeout | undefined;
let editorSession: { contentRoot: string; assetMount: string; processId: number; projectReady: boolean; reportedAt: number } | undefined;
let bootstrapState: 'not-needed' | 'waiting' | 'attempting' | 'connected' | 'failed' = bootstrapEligible ? 'waiting' : 'not-needed';
let bootstrapMessage: string | undefined;

function editorSessionIsFresh(): boolean {
  return Boolean(editorSession && editorSession.projectReady && Date.now() - editorSession.reportedAt <= 5000 && processIdIsRunning(editorSession.processId));
}

function latestUefnProjectLifecycle(): { openedProject?: string; openedPosition: number; latestSelectionPosition: number } {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return { openedPosition: -1, latestSelectionPosition: -1 };
  const logPath = path.join(process.env.LOCALAPPDATA, 'UnrealEditorFortnite', 'Saved', 'Logs', 'UnrealEditorFortnite.log');
  try {
    if (!fs.existsSync(logPath)) return { openedPosition: -1, latestSelectionPosition: -1 };
    const stats = fs.statSync(logPath);
    const bytesToRead = Math.min(stats.size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(bytesToRead);
    const descriptor = fs.openSync(logPath, 'r');
    try { fs.readSync(descriptor, buffer, 0, bytesToRead, stats.size - bytesToRead); }
    finally { fs.closeSync(descriptor); }
    let text = buffer.toString('utf8');
    // UEFN may append a new editor startup before rotating its log. Only use
    // project-open records belonging to the latest startup block.
    const latestStartup = text.lastIndexOf('LogInit: Running DelayedAutoRegister Phase StartOfEnginePreInit');
    if (latestStartup >= 0) text = text.slice(latestStartup);
    // The project browser emits "Selected Project (Direct)" before the editor
    // has actually opened the project. Only the editor's successful-open record
    // is strong enough to establish project readiness.
    const matches = [...text.matchAll(/Successfully opened project '([^']+\.uefnproject)'/gi)];
    const latestOpen = matches.at(-1);
    return {
      openedProject: latestOpen?.[1],
      openedPosition: latestOpen?.index ?? -1,
      latestSelectionPosition: text.lastIndexOf('LogValkyrieProjectBrowser: Selected Project (Direct):'),
    };
  } catch {
    return { openedPosition: -1, latestSelectionPosition: -1 };
  }
}

function latestProjectOpenedByUefn(): string | undefined {
  return latestUefnProjectLifecycle().openedProject;
}

let cachedUefnProcessSnapshot = { checkedAt: 0, running: false };

function processIdIsRunning(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  if (process.platform === 'win32') {
    try {
      const output = childProcess.execFileSync(
        'tasklist.exe',
        ['/FI', `PID eq ${processId}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true, timeout: 1500 },
      );
      return new RegExp(`"${processId}"`).test(output);
    } catch {
      return false;
    }
  }
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function uefnIsRunning(): boolean {
  if (editorSessionIsFresh()) return true;
  if (launchedUefnProcessId > 0 && processIdIsRunning(launchedUefnProcessId)) return true;
  if (Date.now() - cachedUefnProcessSnapshot.checkedAt < 1000) return cachedUefnProcessSnapshot.running;
  let running = false;
  if (process.platform === 'win32') {
    try {
      const output = childProcess.execFileSync(
        'tasklist.exe',
        ['/FI', 'IMAGENAME eq UnrealEditorFortnite-Win64-Shipping.exe', '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true, timeout: 1500 },
      );
      running = /UnrealEditorFortnite-Win64-Shipping\.exe/i.test(output);
    } catch {
      running = false;
    }
  }
  cachedUefnProcessSnapshot = { checkedAt: Date.now(), running };
  return running;
}

function pathsEqual(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return false;
  try {
    return path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase();
  } catch {
    return false;
  }
}

function projectPythonIsEnabled(): boolean {
  if (!configuredProjectFile) return projectPythonEnabled;
  try {
    return /"bEnablePythonForProject"\s*:\s*true/i.test(fs.readFileSync(configuredProjectFile, 'utf8'));
  } catch {
    return projectPythonEnabled;
  }
}

function selectedProjectIsActiveInUefn(): boolean {
  if (!editorSessionIsFresh() || !uefnIsRunning()) return false;
  const lifecycle = latestUefnProjectLifecycle();
  if (lifecycle.openedProject && !pathsEqual(lifecycle.openedProject, configuredProjectFile)) return false;
  // The connector's editor-thread assertion is authoritative for the current
  // lifecycle. UEFN emits a later Selected Project (Direct) record during
  // normal project initialization, so selector ordering alone cannot revoke a
  // genuinely open project. A return to the browser is reported as
  // projectReady=false and then becomes stale after the connector stops.
  return true;
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  ...(process.env.UEM_ALLOW_DEV_ORIGIN === '1' ? ['http://127.0.0.1:5173', 'http://localhost:5173'] : []),
]);

function currentProjectContext(): UTMProjectContext {
  const snapshot = catalogSession.snapshot();
  const filePath = path.join(contentRoot, snapshot.config.targetVerseFileName);
  const sessionConnected = editorSessionIsFresh();
  const projectActive = selectedProjectIsActiveInUefn();
  const editorConnected = sessionConnected && projectActive;
  const pythonEnabled = projectPythonIsEnabled();
  return {
    productVersion: versionInfo.version,
    projectName: configuredProjectFile ? path.basename(configuredProjectFile, path.extname(configuredProjectFile)) : path.basename(contentRoot),
    projectFile: configuredProjectFile ?? '',
    contentRoot,
    assetMount: configuredAssetMount!,
    targetManagedVerseFile: snapshot.config.targetVerseFileName,
    configuredIconFolder: snapshot.config.assetFolderName,
    editorConnection: {
      editorConnected,
      projectActive,
      uefnRunning: uefnIsRunning(),
      processId: (editorSession?.processId ?? launchedUefnProcessId) || undefined,
    },
    nativeTextureAdoptionAvailable: editorConnected && projectActive && pythonEnabled,
    managedFileOwned: catalogManaged,
    catalogInitialization: fs.existsSync(filePath) ? 'initialized' : 'first-run',
    projectReadiness: {
      editorConnected,
      projectActive,
      pythonEnabled,
      missingManagedAssets: missingManagedAssetReferences(snapshot, configuredAssetMount!).map(reference => reference.objectPath),
    },
    ...({ generatedFile: { present: fs.existsSync(filePath), contentHash: fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null } }),
  };
}

function installedAgentSkillPath(): string {
  const packaged = path.resolve(__dirname, '..', 'resources', 'agent-skills', 'uefn-transaction-manager');
  if (fs.existsSync(path.join(packaged, 'SKILL.md'))) return packaged;
  const source = path.resolve(__dirname, '..', 'skills', 'uefn-transaction-manager');
  return fs.existsSync(path.join(source, 'SKILL.md')) ? source : 'skills/uefn-transaction-manager';
}

function agentSkillInstallations(): AgentSkillInstallationStatus[] {
  return inspectAllAgentSkills(installedAgentSkillPath(), process.env.UEM_AGENT_HOME ?? undefined);
}

function mcpClientConfiguration(): Record<string, unknown> {
  return { mcpServers: { 'utm-mcp': { type: 'http', url: `http://127.0.0.1:${agentIntegration.port}/mcp` } } };
}

function publicAgentIntegrationStatus() {
  const running = Boolean(mcpHost?.running);
  const verified = Boolean(lastAgentConnection?.verified);
  return {
    success: true,
    running,
    endpoint: `http://127.0.0.1:${agentIntegration.port}/mcp`,
    serverName: 'utm-mcp',
    port: agentIntegration.port,
    projectName: currentProjectContext().projectName,
    unavailableReason: mcpUnavailableReason,
    skillPath: installedAgentSkillPath(),
    skillInstallations: agentSkillInstallations(),
    configuration: {
      available: running,
      mode: 'loopback-url',
      issuedAt: lastConfigurationIssuedAt,
      restartRequired: Boolean(lastConfigurationIssuedAt && !verified),
    },
    clientConnection: lastAgentConnection
      ? { state: verified ? 'verified' : 'connected', ...lastAgentConnection }
      : { state: 'not-verified', message: 'Start or reload the configured coding agent, then ask it to call get_project_context.' },
  };
}

function isSupportedAgent(value: unknown): value is SupportedAgentId {
  return value === 'codex' || value === 'claude' || value === 'cursor';
}

async function adoptIconThroughBridge(request: { sourceAssetPath: string; assetFolderName: string; assetName: string }): Promise<{ success: boolean; verseAssetPath?: string; assetObjectPath?: string; imageData?: string; error?: string }> {
  if (!editorSessionIsFresh()) return { success: false, error: 'EDITOR_CONNECTION_REQUIRED: the verified UEFN editor connector is not connected.' };
  const queued = queueTextureAdoption(request.assetFolderName, request.assetName, request.sourceAssetPath);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const job = getTextureImportJob(queued.jobId);
    if (job.status === 'failed') return { success: false, error: job.error ?? 'The UEFN Texture2D adoption job failed.' };
    if (job.status !== 'completed') continue;
    let imageData: string | undefined;
    try {
      const previewPath = resolveProjectIconPreview(contentRoot, request.assetFolderName, request.assetName);
      imageData = `data:image/png;base64,${fs.readFileSync(previewPath).toString('base64')}`;
    } catch {
      // A native asset may be complete even if its optional cached preview is unavailable.
    }
    return { success: true, verseAssetPath: job.verseAssetPath, assetObjectPath: job.assetObjectPath, imageData };
  }
  return { success: false, error: 'The UEFN Texture2D adoption job did not complete within the MCP call window. The queued job remains available to the connected editor.' };
}

function catalogReadinessError(message: string, data: Record<string, unknown> = {}): CatalogDomainError {
  return new CatalogDomainError(CATALOG_ERROR_CODES.projectNotReady, `PROJECT_NOT_READY: ${message}`, data, 409);
}

async function waitForTextureImport(jobId: string, expectedObjectPath: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const job = getTextureImportJob(jobId);
    if (job.status === 'failed') throw catalogReadinessError(job.error ?? 'UEFN could not provision the required Texture2D asset.', { assetObjectPath: expectedObjectPath });
    if (job.status !== 'completed') continue;
    if (job.assetObjectPath !== expectedObjectPath) {
      throw catalogReadinessError('UEFN returned a different Texture2D object path than the generated Verse reference.', {
        expectedAssetObjectPath: expectedObjectPath,
        actualAssetObjectPath: job.assetObjectPath ?? null,
      });
    }
    const packagePath = assetPackagePathFromObjectPath(contentRoot, expectedObjectPath, configuredAssetMount!);
    if (!packagePath || !fs.existsSync(packagePath)) throw catalogReadinessError('UEFN reported the Texture2D import complete, but the exact project asset package could not be confirmed.', { assetObjectPath: expectedObjectPath });
    return;
  }
  throw catalogReadinessError('The required Texture2D import did not complete within the editor bridge window. No managed Verse was written.', { assetObjectPath: expectedObjectPath });
}

async function assertCatalogReady(document: CatalogDocument): Promise<void> {
  if (!catalogManaged) throw catalogReadinessError('the selected target Verse file is not managed by UTM and will not be overwritten.');
  const filePath = path.join(contentRoot, validateVerseFileName(document.config.targetVerseFileName));
  const firstInitialization = !fs.existsSync(filePath);
  const editorConnected = editorSessionIsFresh();
  const projectActive = selectedProjectIsActiveInUefn();
  const pythonEnabled = projectPythonIsEnabled();
  const scopedDocument: CatalogDocument = { ...document, config: { ...document.config, contentFolderPath: contentRoot } };
  const references = collectManagedAssetReferences(scopedDocument, configuredAssetMount!);
  if (firstInitialization && references.length && (!editorConnected || !projectActive || !pythonEnabled)) {
    throw catalogReadinessError(
      !editorConnected ? 'open the selected project in UEFN and wait for its verified editor connector before creating the first managed catalog.'
        : !projectActive ? 'the selected project is not the project currently open in UEFN.'
          : 'Python Editor Scripting is disabled for the selected project.',
      { initialization: 'first-run', editorConnected, projectActive, pythonEnabled, required: 'UEFN open, exact project active, verified editor bridge, Python Editor Scripting enabled' },
    );
  }

  let missing = missingManagedAssetReferences(scopedDocument, configuredAssetMount!);
  for (const reference of missing) {
    if (!isPlaceholderIconTexture(reference.expression)) {
      throw catalogReadinessError('a generated Texture2D reference is missing from the selected project. Adopt or restore the exact asset before saving.', { missingAssets: missing.map(candidate => candidate.objectPath) });
    }
    if (!editorConnected || !projectActive || !pythonEnabled) {
      throw catalogReadinessError('the required UTM placeholder Texture2D is missing. Open the selected project in UEFN with Python Editor Scripting enabled so UTM can provision it before saving.', { missingAssets: missing.map(candidate => candidate.objectPath), editorConnected, projectActive, pythonEnabled });
    }
    const segments = reference.expression.split('.');
    const assetFolderName = segments[0];
    const assetName = segments.at(-1)!;
    const sourceBuffer = Buffer.from(PLACEHOLDER_ICON_DATA_URL.slice(PLACEHOLDER_ICON_DATA_URL.indexOf(',') + 1), 'base64');
    const queued = await queueTextureImport(assetFolderName, assetName, sourceBuffer);
    await waitForTextureImport(queued.jobId, reference.objectPath);
    missing = missingManagedAssetReferences(scopedDocument, configuredAssetMount!);
  }
  if (missing.length) throw catalogReadinessError('one or more exact managed Texture2D object paths could not be confirmed.', { missingAssets: missing.map(reference => reference.objectPath) });
}

async function saveGeneratedCatalog(): Promise<SaveCatalogResult> {
  const snapshot = catalogSession.snapshot();
  if (!catalogManaged) return { success: false, code: 'PROJECT_NOT_READY', error: 'PROJECT_NOT_READY: the selected target Verse file is not managed by UTM and will not be overwritten.', status: 409 };
  const errors = snapshot.validation.filter(issue => issue.severity === 'error');
  if (errors.length) return { success: false, error: 'CATALOG_VALIDATION_FAILED: validation errors block save.', status: 422 };
  try {
    await assertCatalogReady(snapshot);
  } catch (error) {
    if (error instanceof CatalogDomainError) return { success: false, code: error.code, error: error.message, status: error.status };
    return { success: false, code: 'PROJECT_NOT_READY', error: error instanceof Error ? error.message : 'Project readiness could not be confirmed.', status: 409 };
  }
  const fileName = validateVerseFileName(snapshot.config.targetVerseFileName);
  const filePath = path.join(contentRoot, fileName);
  if (fs.existsSync(filePath)) assertExistingPathInsideRoot(contentRoot, filePath);
  const currentHash = fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
  if (currentHash !== snapshot.savedFileHash) return { success: false, currentHash: currentHash ?? undefined, error: 'The managed Verse file changed outside UTM. Reload before saving.', status: 409 } as SaveCatalogResult;
  let content: string;
  try {
    content = generateVerseCode(snapshot.entitlements, snapshot.bundles, snapshot.config, snapshot.storefrontMembership, snapshot.retiredVerseKeys);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'The generated Verse could not be produced.', status: 422 };
  }
  let backupPath: string | undefined;
  let temporaryPath = '';
  try {
    if (snapshot.config.autoBackup && fs.existsSync(filePath)) {
      const backupDir = path.join(contentRoot, '.backups');
      fs.mkdirSync(backupDir, { recursive: true });
      assertExistingPathInsideRoot(contentRoot, backupDir);
      backupPath = path.join(backupDir, `${fileName}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    }
    temporaryPath = path.join(contentRoot, `.${fileName}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
    return { success: true, fileName, filePath, backupPath, contentHash: sha256(content) } as SaveCatalogResult;
  } catch (error) {
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    return { success: false, error: error instanceof Error ? error.message : 'The managed Verse file could not be written.', status: 500 };
  }
}

async function startConfiguredMcp(): Promise<boolean> {
  if (mcpHost) return true;
  lastAgentConnection = undefined;
  const host = new UTMcpHost({
    version: versionInfo.version,
    catalog: catalogSession,
    getProjectContext: currentProjectContext,
    adoptIcon: adoptIconThroughBridge,
    saveCatalog: async () => saveGeneratedCatalog(),
    assertCatalogReady,
    onClientConnection: connection => { lastAgentConnection = connection; },
  });
  try {
    await host.start(agentIntegration.port);
    mcpHost = host;
    mcpUnavailableReason = undefined;
    return true;
  } catch (error) {
    mcpUnavailableReason = error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `MCP port ${agentIntegration.port} is already in use. Configure an alternate loopback port under Agent Integration.`
      : error instanceof Error ? error.message : 'UTM MCP could not start.';
    return false;
  }
}

async function stopConfiguredMcp(): Promise<void> {
  lastAgentConnection = undefined;
  if (!mcpHost) return;
  const host = mcpHost;
  mcpHost = null;
  await host.stop();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ success: false, error: 'Origin is not allowed.' });
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', server: 'UEFN Entitlement Manager Bridge', version: versionInfo.version, textureImport: 'uefn-editor-bridge' });
});

app.use('/api', (req, res, next) => {
  const uiAuthorized = tokensEqual(req.get('x-uem-token'), sessionToken);
  const editorAuthorized = tokensEqual(req.get('x-uem-editor-token'), editorSessionToken);
  const editorRoute = req.path === '/editor/session'
    || req.path === '/texture/import/next'
    || (req.path.startsWith('/texture/import/') && (req.path.endsWith('/normalize') || req.path.endsWith('/result')));
  if (editorRoute ? !editorAuthorized : !uiAuthorized) return res.status(401).json({ success: false, error: 'Invalid or missing bridge session token.' });
  if (!editorRoute) lastUiActivity = Date.now();
  next();
});

const requireEditorToken: express.RequestHandler = (req, res, next) => {
  if (!tokensEqual(req.get('x-uem-editor-token'), editorSessionToken)) return res.status(401).json({ success: false, error: 'Invalid or missing editor bridge token.' });
  next();
};

app.post('/api/session/heartbeat', (_req, res) => res.json({ success: true }));

app.post('/api/catalog/open', (req, res) => {
  try {
    if (catalogOpen) return res.json({ success: true, managed: catalogManaged, catalog: catalogSession.snapshot() });
    const current = catalogSession.snapshot();
    const allowInitialRecovery = current.revision === '1' && !current.dirty;
    const requestedConfig = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    const config = defaultProjectConfig(contentRoot, { ...requestedConfig, contentFolderPath: contentRoot });
    const recovery = req.body?.recovery && typeof req.body.recovery === 'object' ? req.body.recovery : undefined;
    const targetChanged = config.targetVerseFileName !== current.config.targetVerseFileName;
    if (allowInitialRecovery && targetChanged) {
      const loaded = readCatalogAtConfig(config);
      const recoveryDocument = loaded.contentHash === null && recovery ? {
        ...loaded.document,
        entitlements: Array.isArray(recovery.entitlements) ? recovery.entitlements : loaded.document.entitlements,
        bundles: Array.isArray(recovery.bundles) ? recovery.bundles : loaded.document.bundles,
        storefrontMembership: recovery.storefrontMembership ?? loaded.document.storefrontMembership,
        retiredVerseKeys: Array.isArray(recovery.retiredVerseKeys) ? recovery.retiredVerseKeys : loaded.document.retiredVerseKeys,
      } : loaded.document;
      catalogManaged = loaded.managed;
      catalogSession.initialize(recoveryDocument, { savedFileHash: loaded.contentHash, initialDirty: loaded.contentHash === null && Boolean(recovery) });
      catalogOpen = true;
      return res.json({ success: true, managed: catalogManaged, catalog: catalogSession.snapshot() });
    }
    const next: CatalogDocument = {
      ...current,
      config,
      ...(initialCatalog.contentHash === null && recovery && allowInitialRecovery ? {
        entitlements: Array.isArray(recovery.entitlements) ? recovery.entitlements : current.entitlements,
        bundles: Array.isArray(recovery.bundles) ? recovery.bundles : current.bundles,
        storefrontMembership: recovery.storefrontMembership ?? current.storefrontMembership,
        retiredVerseKeys: Array.isArray(recovery.retiredVerseKeys) ? recovery.retiredVerseKeys : current.retiredVerseKeys,
      } : {}),
    };
    if (allowInitialRecovery && (JSON.stringify(next.config) !== JSON.stringify(current.config) || next.entitlements.length !== current.entitlements.length || next.bundles.length !== current.bundles.length || initialCatalog.contentHash === null && recovery)) {
      catalogSession.replaceDocument(next, current.revision);
    }
    catalogOpen = true;
    res.json({ success: true, managed: catalogManaged, catalog: catalogSession.snapshot() });
  } catch (error) {
    res.status(error instanceof CatalogDomainError ? error.status : 400).json({ success: false, error: error instanceof Error ? error.message : 'Catalog could not be initialized.' });
  }
});

app.get('/api/catalog/snapshot', (_req, res) => res.json({ success: true, managed: catalogManaged, catalog: catalogSession.snapshot() }));

app.post('/api/catalog/replace', async (req, res) => {
  try {
    if (!req.body?.catalog || typeof req.body.catalog !== 'object' || typeof req.body.expectedRevision !== 'string') throw new Error('Catalog replacement requires a catalog and expectedRevision.');
    const currentRevision = catalogSession.snapshot().revision;
    if (currentRevision !== req.body.expectedRevision) throw new CatalogDomainError(CATALOG_ERROR_CODES.revisionConflict, 'The catalog changed before replacement.', { expectedRevision: req.body.expectedRevision, currentRevision }, 409);
    await assertCatalogReady(req.body.catalog as CatalogDocument);
    const result = catalogSession.replaceDocument(req.body.catalog as CatalogDocument, req.body.expectedRevision);
    res.json({ success: true, catalog: result.snapshot, cascades: result.cascades });
  } catch (error) {
    const status = error instanceof CatalogDomainError ? error.status : 400;
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : 'Catalog replacement failed.', ...(error instanceof CatalogDomainError ? { code: error.code, data: error.data } : {}) });
  }
});

app.post('/api/catalog/mutate', async (req, res) => {
  try {
    if (!req.body?.operation || typeof req.body.operation !== 'object' || typeof req.body.expectedRevision !== 'string') throw new Error('Catalog mutation requires an operation and expectedRevision.');
    const proposed = catalogSession.applyPatch([req.body.operation], req.body.expectedRevision, true).snapshot;
    await assertCatalogReady(proposed);
    const result = catalogSession.mutate(req.body.operation, req.body.expectedRevision);
    res.json({ success: true, catalog: result.snapshot, affected: result.affected, cascades: result.cascades });
  } catch (error) {
    const status = error instanceof CatalogDomainError ? error.status : 400;
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : 'Catalog mutation failed.', ...(error instanceof CatalogDomainError ? { code: error.code, data: error.data } : {}) });
  }
});

app.get('/api/catalog/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (snapshot = catalogSession.snapshot()) => {
    if (!res.writableEnded) res.write(`event: catalog\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };
  send();
  const unsubscribe = catalogSession.subscribe(send);
  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  req.once('close', () => { clearInterval(keepAlive); unsubscribe(); });
});

app.get('/api/agent-integration/status', (_req, res) => {
  res.json(publicAgentIntegrationStatus());
});

app.post('/api/agent-integration/config', async (req, res) => {
  try {
    if (req.body?.port !== undefined && (!Number.isInteger(req.body.port) || req.body.port < 1024 || req.body.port > 65535)) throw new Error('MCP port must be an integer between 1024 and 65535.');
    const previousPort = agentIntegration.port;
    if (req.body?.port !== undefined) agentIntegration.port = Number(req.body.port);
    if (previousPort !== agentIntegration.port) await stopConfiguredMcp();
    saveAgentIntegrationState(agentIntegration);
    await startConfiguredMcp();
    res.json({ success: true, status: publicAgentIntegrationStatus() });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Agent Integration settings could not be changed.' });
  }
});

app.post('/api/agent-integration/setup', async (req, res) => {
  try {
    if (!isSupportedAgent(req.body?.agent)) throw new Error('Choose a supported coding agent before setup.');
    const agent = req.body.agent as SupportedAgentId;
    const skill = installAgentSkill(installedAgentSkillPath(), agent, process.env.UEM_AGENT_HOME ?? undefined);
    saveAgentIntegrationState(agentIntegration);
    const running = await startConfiguredMcp();
    if (!running) {
      return res.status(503).json({ success: false, skill, error: mcpUnavailableReason ?? 'UTM MCP could not start. Resolve the listener issue, then retry setup.' });
    }
    lastConfigurationIssuedAt = new Date().toISOString();
    res.json({
      success: true,
      agent,
      skill,
      config: mcpClientConfiguration(),
      restartRequired: true,
      status: publicAgentIntegrationStatus(),
    });
  } catch (error) {
    const status = error instanceof Error && /contains files UTM does not own|unavailable/.test(error.message) ? 409 : 400;
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : 'Agent setup could not be completed.' });
  }
});

app.post('/api/agent-integration/copy-config', (_req, res) => {
  if (!mcpHost?.running) return res.status(409).json({ success: false, error: mcpUnavailableReason ?? 'UTM MCP is not running. Resolve the listener issue before copying configuration.' });
  lastConfigurationIssuedAt = new Date().toISOString();
  res.json({ success: true, config: mcpClientConfiguration() });
});

app.post('/api/catalog/save', async (req, res) => {
  try {
    if (typeof req.body?.expectedRevision !== 'string') throw new Error('Catalog save requires expectedRevision.');
    const snapshot = catalogSession.snapshot();
    if (snapshot.revision !== req.body.expectedRevision) {
      throw new CatalogDomainError('CATALOG_REVISION_CONFLICT', 'The catalog changed before save.', { expectedRevision: req.body.expectedRevision, currentRevision: snapshot.revision }, 409);
    }
    const saved = await saveGeneratedCatalog();
    if (!saved.success || !saved.contentHash) {
      return res.status(saved.status ?? 422).json(saved);
    }
    res.json({ ...saved, catalog: catalogSession.markSaved(saved.contentHash) });
  } catch (error) {
    const status = error instanceof CatalogDomainError ? error.status : 400;
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : 'Catalog save failed.', ...(error instanceof CatalogDomainError ? { code: error.code, data: error.data } : {}) });
  }
});

app.post('/api/editor/bootstrap-status', (req, res) => {
  const allowed = new Set(['not-needed', 'waiting', 'attempting', 'connected', 'failed']);
  if (typeof req.body.state !== 'string' || !allowed.has(req.body.state)) {
    return res.status(400).json({ success: false, error: 'Invalid editor bootstrap state.' });
  }
  bootstrapState = req.body.state as typeof bootstrapState;
  bootstrapMessage = typeof req.body.message === 'string' ? req.body.message.slice(0, 500) : undefined;
  res.json({ success: true });
});

app.post('/api/editor/session', requireEditorToken, (req, res) => {
  try {
    if (typeof req.body.contentRoot !== 'string' || typeof req.body.assetMount !== 'string' || typeof req.body.projectReady !== 'boolean' || !Number.isInteger(req.body.processId) || req.body.processId <= 0) {
      throw new Error('Editor session must include its Content root, asset mount, project readiness assertion, and UEFN process identity.');
    }
    const reportedRoot = fs.realpathSync(req.body.contentRoot);
    if (path.normalize(reportedRoot).toLowerCase() !== path.normalize(contentRoot).toLowerCase() || req.body.assetMount !== configuredAssetMount) {
      return res.status(409).json({ success: false, error: 'The active UEFN editor project does not match this manager session.' });
    }
    if (!processIdIsRunning(req.body.processId)) return res.status(409).json({ success: false, error: 'The reporting UEFN editor process is not running.' });
    editorSession = { contentRoot: reportedRoot, assetMount: req.body.assetMount, processId: req.body.processId, projectReady: req.body.projectReady, reportedAt: Date.now() };
    res.json({ success: true, assetMount: configuredAssetMount });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Editor project identity could not be verified.' });
  }
});

app.get('/api/editor/status', (_req, res) => {
  const sessionConnected = editorSessionIsFresh();
  const uefnRunning = uefnIsRunning();
  const openProjectFile = uefnRunning ? latestProjectOpenedByUefn() : undefined;
  const projectActive = selectedProjectIsActiveInUefn();
  const editorConnected = sessionConnected && projectActive;
  if (editorConnected) bootstrapState = 'connected';
  res.json({
    success: true,
    uefnRunning,
    editorConnected,
    projectActive,
    differentProjectOpen: Boolean(uefnRunning && openProjectFile && !pathsEqual(openProjectFile, configuredProjectFile)),
    openProjectFile: uefnRunning ? openProjectFile : undefined,
    pythonEnabled: projectPythonIsEnabled(),
    autoConnectorInstalled,
    nativeTextureImportAvailable: editorConnected && projectActive && projectPythonIsEnabled(),
    bootstrapState,
    bootstrapMessage,
  });
});

app.get('/api/session/lease', (req, res) => {
  if (leaseShutdownTimer) {
    clearTimeout(leaseShutdownTimer);
    leaseShutdownTimer = undefined;
  }
  uiLeases.add(res);
  lastUiActivity = Date.now();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.write('connected\n');
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write('ping\n');
  }, 10000);
  const release = () => {
    clearInterval(keepAlive);
    uiLeases.delete(res);
    if (uiLeases.size === 0 && !leaseShutdownTimer) {
      leaseShutdownTimer = setTimeout(() => shutdownBridge(), 5000);
    }
  };
  req.once('close', release);
  res.once('error', release);
});

app.post('/api/project/scan', (_req, res) => {
  try {
    const entries = fs.readdirSync(contentRoot, { withFileTypes: true });
    const assetFolderName = validateIdentifier(_req.body?.assetFolderName ?? 'EntitlementIcons', 'Asset folder');
    res.json({
      success: true,
      folderPath: contentRoot,
      verseFiles: entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.verse')).map(entry => entry.name),
      subDirs: entries.filter(entry => entry.isDirectory() && entry.name !== '.uem-icon-previews').map(entry => entry.name),
      iconPreviews: listProjectIconPreviews(contentRoot, assetFolderName),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to scan Content directory.' });
  }
});

app.get('/api/project/icon-preview/:assetFolderName/:assetName', (req, res) => {
  try {
    const assetFolderName = validateIdentifier(req.params.assetFolderName, 'Asset folder');
    const assetName = validateIdentifier(req.params.assetName, 'Asset name');
    const filePath = resolveProjectIconPreview(contentRoot, assetFolderName, assetName);
    res.type('png').sendFile(filePath);
  } catch (error) {
    res.status(404).json({ success: false, error: error instanceof Error ? error.message : 'Project icon preview was not found.' });
  }
});

app.post('/api/verse/load', (req, res) => {
  try {
    const fileName = validateVerseFileName(req.body.fileName);
    const filePath = path.join(contentRoot, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ success: false, error: 'Verse file not found.' });
    assertExistingPathInsideRoot(contentRoot, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, content, contentHash: sha256(content), filePath });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to load Verse file.' });
  }
});

app.post('/api/verse/save', (req, res) => {
  let temporaryPath = '';
  try {
    const fileName = validateVerseFileName(req.body.fileName);
    if (fileName === catalogSession.snapshot().config.targetVerseFileName || fileName.toLowerCase() === 'managed_transactions.verse') {
      return res.status(409).json({ success: false, code: 'PROJECT_NOT_READY', error: 'The managed transaction Verse file can only be written through catalog save after managed Texture2D readiness has been confirmed.' });
    }
    if (typeof req.body.content !== 'string') throw new Error('Verse content must be a string.');
    if (!Object.prototype.hasOwnProperty.call(req.body, 'expectedHash') || (req.body.expectedHash !== null && typeof req.body.expectedHash !== 'string')) {
      throw new Error('Verse save requires the expected content hash, or null when creating a new file.');
    }
    const filePath = path.join(contentRoot, fileName);
    const createBackup = req.body.createBackup !== false;
    let backupPath: string | undefined;

    if (fs.existsSync(filePath)) assertExistingPathInsideRoot(contentRoot, filePath);
    const currentHash = fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
    if (req.body.expectedHash !== currentHash) {
      return res.status(409).json({ success: false, currentHash, error: 'The Verse file changed after it was loaded. Reload it before saving so no work is overwritten.' });
    }

    if (createBackup && fs.existsSync(filePath)) {
      const backupDir = path.join(contentRoot, '.backups');
      fs.mkdirSync(backupDir, { recursive: true });
      assertExistingPathInsideRoot(contentRoot, backupDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = path.join(backupDir, `${fileName}.${timestamp}.bak`);
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    }

    temporaryPath = path.join(contentRoot, `.${fileName}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(temporaryPath, req.body.content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
    temporaryPath = '';
    if (fileName === catalogSession.snapshot().config.targetVerseFileName) catalogSession.markSaved(sha256(req.body.content));
    res.json({ success: true, filePath, backupPath, contentHash: sha256(req.body.content), message: 'Verse file written atomically.' });
  } catch (error) {
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to save Verse file.' });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 },
  fileFilter: (_req, file, callback) => callback(null, /^image\/(png|jpeg|webp|gif|avif|tiff)$/i.test(file.mimetype)),
});

app.post('/api/texture/import', upload.single('image'), async (req, res) => {
  try {
    if (!editorSessionIsFresh()) {
      return res.status(409).json({
        success: false,
        error: projectPythonEnabled
          ? autoConnectorInstalled
            ? 'The automatic native-import connector is not attached. Keep this Transaction Manager window open and reopen the linked UEFN project so its project connector can start.'
            : 'Transaction Manager could not install its automatic native-import connector. Check that the project Content/Python folder is writable, then relink the project.'
          : 'Native texture import needs Python Editor Scripting. Enable it for this UEFN project; Transaction Manager detects it immediately and attaches automatically.',
      });
    }
    if (!req.file) throw new Error('A supported image file is required.');
    const assetFolderName = validateIdentifier(req.body.assetFolderName, 'Asset folder');
    const assetName = validateIdentifier(req.body.assetName, 'Asset name');
    res.status(202).json(await queueTextureImport(assetFolderName, assetName, req.file.buffer));
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to queue texture import.' });
  }
});

app.post('/api/texture/adopt', async (req, res) => {
  try {
    if (!editorSessionIsFresh()) return res.status(409).json({ success: false, error: 'The verified UEFN editor session is not connected.' });
    const assetFolderName = validateIdentifier(req.body.assetFolderName, 'Asset folder');
    const assetName = validateIdentifier(req.body.assetName, 'Asset name');
    if (typeof req.body.sourceAssetPath !== 'string') throw new Error('An existing UEFN Texture2D object path is required.');
    res.status(202).json(queueTextureAdoption(assetFolderName, assetName, req.body.sourceAssetPath));
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to queue Texture2D adoption.' });
  }
});

// The launcher registers a UEFN Slate tick callback that claims one job, calls
// Unreal's AssetTools import API on the editor thread, and posts the result back.
app.get('/api/texture/import/next', requireEditorToken, (_req, res) => {
  res.json({ success: true, job: claimNextTextureImport() });
});

app.get('/api/texture/import/:jobId', (req, res) => {
  try {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
    res.json(getTextureImportJob(jobId));
  } catch (error) {
    res.status(404).json({ success: false, error: error instanceof Error ? error.message : 'Texture import job was not found.' });
  }
});

app.post('/api/texture/import/:jobId/normalize', requireEditorToken, async (req, res) => {
  try {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
    res.json(await normalizeTextureImportJob(jobId));
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to normalize the adopted texture.' });
  }
});

app.post('/api/texture/import/:jobId/result', requireEditorToken, (req, res) => {
  try {
    if (typeof req.body.success !== 'boolean') throw new Error('Import result must include a boolean success value.');
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
    res.json(finishTextureImport(jobId, {
      success: req.body.success,
      destinationPath: typeof req.body.destinationPath === 'string' ? req.body.destinationPath : undefined,
      assetObjectPath: typeof req.body.assetObjectPath === 'string' ? req.body.assetObjectPath : undefined,
      error: typeof req.body.error === 'string' ? req.body.error : undefined,
    }, contentRoot));
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to record texture import result.' });
  }
});

app.post('/api/texture/import/:jobId/retry', (req, res) => {
  try {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
    res.json(resetTextureImportJob(jobId));
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Texture import could not be retried.' });
  }
});

app.post('/api/verse/compile', async (req, res) => {
  try {
    const fileName = validateVerseFileName(req.body.fileName);
    if (typeof req.body.expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(req.body.expectedHash)) throw new Error('Compilation requires the saved file hash.');
    const filePath = path.join(contentRoot, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(409).json({ success: false, connected: false, error: 'The generated Verse file is not present in the verified project.' });
    assertExistingPathInsideRoot(contentRoot, filePath);
    const currentHash = sha256(fs.readFileSync(filePath));
    if (currentHash !== req.body.expectedHash) return res.status(409).json({ success: false, connected: false, error: 'The generated Verse file changed before compilation. Save it again.' });
    if (!editorSessionIsFresh() && !selectedProjectIsActiveInUefn()) {
      return res.status(409).json({ success: false, connected: false, error: 'Open the linked project in UEFN before compiling. Transaction Manager could not verify that the active editor matches this project.' });
    }
  } catch (error) {
    return res.status(400).json({ success: false, connected: false, error: error instanceof Error ? error.message : 'Compilation preflight failed.' });
  }
  const result = await compileVerseProject({ projectFile: configuredProjectFile, preferredProcessId: launchedUefnProcessId || undefined });
  res.status(result.success ? 200 : 422).json({ ...result, fileName: req.body.fileName, contentHash: req.body.expectedHash, assetMount: configuredAssetMount });
});

app.post('/api/session/shutdown', (_req, res) => {
  res.json({ success: true });
  setTimeout(() => { void shutdownBridge(); }, 25);
});

if (fs.existsSync(distPath)) app.use(express.static(distPath, { etag: false, maxAge: 0 }));
app.get('*', (_req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(503).send('Frontend build unavailable. Run npm run build.');
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : error.message });
  return res.status(500).json({ success: false, error: 'Unexpected bridge error.' });
});

const server = app.listen(port, host, () => {
  console.log(`[UEFN Entitlement Manager Bridge] listening on http://${host}:${port}`);
  void startConfiguredMcp();
});

async function shutdownBridge() {
  if (leaseShutdownTimer) {
    clearTimeout(leaseShutdownTimer);
    leaseShutdownTimer = undefined;
  }
  for (const lease of uiLeases) lease.end();
  uiLeases.clear();
  clearInterval(idleTimer);
  await stopConfiguredMcp();
  server.close(() => process.exit(0));
}

const idleTimer = setInterval(() => {
  if (uiLeases.size === 0 && Date.now() - lastUiActivity > idleTimeoutMs) {
    shutdownBridge();
  }
}, Math.min(15000, Math.max(1000, Math.floor(idleTimeoutMs / 4))));
idleTimer.unref();
