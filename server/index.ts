import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import childProcess from 'child_process';
import { claimNextTextureImport, finishTextureImport, getTextureImportJob, normalizeTextureImportJob, queueTextureAdoption, queueTextureImport, resetTextureImportJob } from './textureImporter';
import { assertExistingPathInsideRoot, tokensEqual, validateIdentifier, validateVerseFileName } from './security';
import { compileVerseProject } from './workflowClient';
import { listProjectIconPreviews, resolveProjectIconPreview } from './iconPreviews';
import versionInfo from '../version.json';

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
const distPath = path.join(__dirname, '..', 'dist');
let lastUiActivity = Date.now();
const uiLeases = new Set<express.Response>();
let leaseShutdownTimer: NodeJS.Timeout | undefined;
let editorSession: { contentRoot: string; assetMount: string; processId: number; reportedAt: number } | undefined;
let bootstrapState: 'not-needed' | 'waiting' | 'attempting' | 'connected' | 'failed' = bootstrapEligible ? 'waiting' : 'not-needed';
let bootstrapMessage: string | undefined;

function editorSessionIsFresh(): boolean {
  return Boolean(editorSession && Date.now() - editorSession.reportedAt <= 5000 && processIdIsRunning(editorSession.processId));
}

function latestProjectOpenedByUefn(): string | undefined {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return undefined;
  const logPath = path.join(process.env.LOCALAPPDATA, 'UnrealEditorFortnite', 'Saved', 'Logs', 'UnrealEditorFortnite.log');
  try {
    if (!fs.existsSync(logPath)) return undefined;
    const stats = fs.statSync(logPath);
    const bytesToRead = Math.min(stats.size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(bytesToRead);
    const descriptor = fs.openSync(logPath, 'r');
    try { fs.readSync(descriptor, buffer, 0, bytesToRead, stats.size - bytesToRead); }
    finally { fs.closeSync(descriptor); }
    const matches = [...buffer.toString('utf8').matchAll(/Successfully opened project '([^']+\.uefnproject)'/gi)];
    return matches.length ? matches[matches.length - 1][1] : undefined;
  } catch {
    return undefined;
  }
}

let cachedUefnProcessSnapshot = { checkedAt: 0, running: false };

function processIdIsRunning(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function uefnIsRunning(): boolean {
  if (editorSessionIsFresh()) return true;
  if (launchedUefnProcessId > 0) return processIdIsRunning(launchedUefnProcessId);
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
  return uefnIsRunning() && pathsEqual(latestProjectOpenedByUefn(), configuredProjectFile);
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  ...(process.env.UEM_ALLOW_DEV_ORIGIN === '1' ? ['http://127.0.0.1:5173', 'http://localhost:5173'] : []),
]);

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
  const editorRoute = req.path === '/editor/session' || req.path === '/texture/import/next' || (req.path.startsWith('/texture/import/') && req.path.endsWith('/result'));
  if (editorRoute ? !editorAuthorized : !uiAuthorized) return res.status(401).json({ success: false, error: 'Invalid or missing bridge session token.' });
  if (!editorRoute) lastUiActivity = Date.now();
  next();
});

const requireEditorToken: express.RequestHandler = (req, res, next) => {
  if (!tokensEqual(req.get('x-uem-editor-token'), editorSessionToken)) return res.status(401).json({ success: false, error: 'Invalid or missing editor bridge token.' });
  next();
};

app.post('/api/session/heartbeat', (_req, res) => res.json({ success: true }));

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
    if (typeof req.body.contentRoot !== 'string' || typeof req.body.assetMount !== 'string' || !Number.isInteger(req.body.processId) || req.body.processId <= 0) {
      throw new Error('Editor session must include its Content root, asset mount, and UEFN process identity.');
    }
    const reportedRoot = fs.realpathSync(req.body.contentRoot);
    if (path.normalize(reportedRoot).toLowerCase() !== path.normalize(contentRoot).toLowerCase() || req.body.assetMount !== configuredAssetMount) {
      return res.status(409).json({ success: false, error: 'The active UEFN editor project does not match this manager session.' });
    }
    if (!processIdIsRunning(req.body.processId)) return res.status(409).json({ success: false, error: 'The reporting UEFN editor process is not running.' });
    editorSession = { contentRoot: reportedRoot, assetMount: req.body.assetMount, processId: req.body.processId, reportedAt: Date.now() };
    res.json({ success: true, assetMount: configuredAssetMount });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Editor project identity could not be verified.' });
  }
});

app.get('/api/editor/status', (_req, res) => {
  const sessionConnected = editorSessionIsFresh();
  const uefnRunning = uefnIsRunning();
  const openProjectFile = uefnRunning ? latestProjectOpenedByUefn() : undefined;
  const editorConnected = sessionConnected && (!configuredProjectFile || !openProjectFile || pathsEqual(openProjectFile, configuredProjectFile));
  const projectActive = editorConnected || (uefnRunning && pathsEqual(openProjectFile, configuredProjectFile));
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
    nativeTextureImportAvailable: editorConnected && projectActive,
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
  setTimeout(() => shutdownBridge(), 25);
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
});

function shutdownBridge() {
  if (leaseShutdownTimer) {
    clearTimeout(leaseShutdownTimer);
    leaseShutdownTimer = undefined;
  }
  for (const lease of uiLeases) lease.end();
  uiLeases.clear();
  clearInterval(idleTimer);
  server.close(() => process.exit(0));
}

const idleTimer = setInterval(() => {
  if (uiLeases.size === 0 && Date.now() - lastUiActivity > idleTimeoutMs) {
    shutdownBridge();
  }
}, Math.min(15000, Math.max(1000, Math.floor(idleTimeoutMs / 4))));
idleTimer.unref();
