import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeSession } from './bridgeSession.js';
import type { LauncherState, ProjectCandidate, WindowAction } from './contracts.js';
import { ProjectDiscovery, readProject } from './projectDiscovery.js';
import { isAllowedNavigation as navigationIsAllowed, isHttpExternal } from './security.js';
import { detectDistributionMode } from './distributionMode.js';
import { UpdateManager } from './updateManager.js';
import { createLauncherProtocolHandler } from './launcherProtocol.js';
import { NavigationTransaction, SerializedAsyncOperation, type ExpectedNavigation } from './navigation.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'uem-launcher', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const appRoot = app.getAppPath();
const preloadPath = path.join(appRoot, 'dist-electron', 'preload.cjs');
const iconPath = path.join(appRoot, 'electron', 'assets', 'uem-icon.ico');
const launcherAssets = new Map([
  ['/index.html', { path: path.join(appRoot, 'electron', 'launcher.html'), type: 'text/html; charset=utf-8' }],
  ['/launcher.js', { path: path.join(appRoot, 'electron', 'launcher.js'), type: 'text/javascript; charset=utf-8' }],
  ['/uem-icon.svg', { path: path.join(appRoot, 'electron', 'assets', 'uem-icon.svg'), type: 'image/svg+xml' }],
  ['/discord-icon.svg', { path: path.join(appRoot, 'electron', 'assets', 'discord-icon.svg'), type: 'image/svg+xml' }],
  ['/adept-insignia.png', { path: path.join(appRoot, 'electron', 'assets', 'adept-insignia.png'), type: 'image/png' }],
]);
const launcherUrl = 'uem-launcher://app/index.html';
const showcaseMode = !app.isPackaged && process.env.UEM_SHOWCASE_MODE === '1';
const hiddenTestMode = process.env.UEM_TEST_HIDDEN === '1';
if (showcaseMode && process.env.UEM_SHOWCASE_STATE_ROOT) {
  app.setPath('userData', path.join(process.env.UEM_SHOWCASE_STATE_ROOT, 'user-data'));
}
// Compatibility: retain the 4.0.1 user-data namespace so upgrades do not fragment logs or state.
const logRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UEFN Entitlement Manager', 'logs');
fs.mkdirSync(logRoot, { recursive: true });
const diagnosticPath = path.join(logRoot, `electron-main-${process.pid}.log`);
fs.writeFileSync(diagnosticPath, '', 'utf8');

type WindowMode = 'launcher' | 'dashboard';

interface WindowGeometry {
  bounds: Electron.Rectangle;
  maximized: boolean;
  minimized: boolean;
  visible: boolean;
}

interface WindowContext {
  window: BrowserWindow;
  mode: WindowMode;
  dashboardOrigin: string | null;
  navigationTransaction: NavigationTransaction | null;
  retiring: boolean;
  candidate: boolean;
  showWhenReady: boolean;
  allowClose: boolean;
}

let mainWindow: BrowserWindow | null = null;
let bridgeSession: BridgeSession | null = null;
const windowContexts = new WeakMap<BrowserWindow, WindowContext>();
const webContentsContexts = new WeakMap<Electron.WebContents, WindowContext>();
const windowRegistry = new Set<BrowserWindow>();
const configuredSessions = new WeakSet<Electron.Session>();
let projects = new Map<string, ProjectCandidate>();
let selectedProjectId: string | null = null;
let launcherBusy = false;
let appHasUnsavedChanges = false;
let allowWindowClose = false;
let shutdownStarted = false;
const testSwitchCycles = Math.max(1, Number.parseInt(process.env.UEM_TEST_AUTO_SWITCH_CYCLES ?? '1', 10) || 1);
let testSwitchCount = 0;
let discoverySession: ProjectDiscovery | null = null;
let discoveryActive = false;
let updateManager: UpdateManager | null = null;
let expectedNavigation: ExpectedNavigation | null = null;
let navigationGeneration = 0;
let activeNavigationTransaction: NavigationTransaction | null = null;
const switchOperation = new SerializedAsyncOperation();
let fatalErrorPromise: Promise<void> | null = null;

const projectArgumentIndex = process.argv.findIndex(argument => argument.toLowerCase() === '--project');
const preferredProjectFile = projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : undefined;
const portableUpdateResultIndex = process.argv.findIndex(argument => argument.toLowerCase() === '--portable-update-result');
const portableUpdateResultPath = portableUpdateResultIndex >= 0 ? process.argv[portableUpdateResultIndex + 1] : undefined;
const distributionMode = detectDistributionMode(process.execPath);

function diagnostic(message: string) {
  fs.appendFileSync(diagnosticPath, `${new Date().toISOString()}\n${message}\n`);
}

function readReleaseMetadata(): { version?: string; sourceRevision?: string } {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'version.json'), 'utf8')) as { version?: unknown; sourceRevision?: unknown };
    return {
      ...(typeof metadata.version === 'string' ? { version: metadata.version } : {}),
      ...(typeof metadata.sourceRevision === 'string' ? { sourceRevision: metadata.sourceRevision } : {}),
    };
  } catch {
    return {};
  }
}

const releaseMetadata = readReleaseMetadata();

function describeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid URL';
  }
}

function windowContext(window: BrowserWindow): WindowContext | null {
  return windowContexts.get(window) ?? null;
}

function activateWindow(window: BrowserWindow, context = windowContext(window)): WindowContext {
  if (!context) throw new Error('The manager window has no lifecycle context.');
  mainWindow = window;
  return context;
}

function updateWindowMode(context: WindowContext, nextMode: WindowMode, dashboardOrigin: string | null = null): void {
  context.mode = nextMode;
  context.dashboardOrigin = dashboardOrigin;
  if (mainWindow === context.window) activateWindow(context.window, context);
}

function captureWindowGeometry(window: BrowserWindow): WindowGeometry {
  return {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
    visible: window.isVisible(),
  };
}

function applyWindowGeometry(window: BrowserWindow, geometry: WindowGeometry): void {
  window.setBounds(geometry.bounds);
  if (geometry.maximized) window.maximize();
  else if (geometry.minimized) window.minimize();
}

function diagnosticNavigationEvent(window: BrowserWindow, eventName: string, url?: string, details?: string): void {
  const context = windowContext(window);
  const currentUrl = !window.isDestroyed() ? window.webContents.getURL() : '';
  diagnostic(`Navigation event ${eventName}: windowId=${window.id}; generation=${expectedNavigation?.generation ?? 0}; mode=${context?.mode ?? 'unknown'}; expectedTarget=${expectedNavigation ? describeUrl(expectedNavigation.targetUrl) : 'none'}; url=${url ? describeUrl(url) : 'none'}; currentUrl=${currentUrl ? describeUrl(currentUrl) : 'none'}${details ? `; ${details}` : ''}`);
}

function isAllowedNavigationFor(context: WindowContext, rawUrl: string): boolean {
  return navigationIsAllowed(context.mode, rawUrl, launcherUrl, context.dashboardOrigin);
}

function assertTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const context = webContentsContexts.get(event.sender);
  if (!context || context.retiring || mainWindow !== context.window || event.senderFrame !== event.sender.mainFrame || !isAllowedNavigationFor(context, event.senderFrame.url)) {
    throw new Error('Rejected desktop IPC from an untrusted renderer.');
  }
}

function trustedAgentSkillLocation(agent: unknown): string | null {
  const directories: Record<string, string> = { codex: '.agents', claude: '.claude', cursor: '.cursor' };
  if (typeof agent !== 'string' || !Object.prototype.hasOwnProperty.call(directories, agent)) return null;
  const homeDirectory = process.env.UEM_AGENT_HOME ?? os.homedir();
  const targetPath = path.resolve(homeDirectory, directories[agent], 'skills', 'uefn-transaction-manager');
  try {
    if (!fs.statSync(targetPath).isDirectory() || !fs.statSync(path.join(targetPath, 'SKILL.md')).isFile()) return null;
    return targetPath;
  } catch {
    return null;
  }
}

function publicProject(project: ProjectCandidate) {
  const { contentDirectory: _contentDirectory, assetMount: _assetMount, uefnProcessId: _uefnProcessId, uefnWindowTitle: _uefnWindowTitle, ...safe } = project;
  return safe;
}

function launcherState(status?: string): LauncherState {
  return {
    projects: [...projects.values()].map(publicProject),
    selectedId: selectedProjectId,
    status: status ?? (discoveryActive
      ? 'Scanning for more projects...'
      : projects.size === 0 ? 'No UEFN projects were found. Browse to a .uefnproject file.' : `Found ${projects.size} available UEFN project${projects.size === 1 ? '' : 's'}.`),
    busy: launcherBusy,
    scanning: discoveryActive,
    showcaseMode: showcaseMode || undefined,
  };
}

function loadShowcaseProjects(): ProjectCandidate[] {
  const fixtureRoot = path.join(appRoot, 'docs', 'showcase', 'runtime', 'Creator Commerce Demo');
  const paths = [
    path.join(fixtureRoot, 'Creator Commerce Demo.uefnproject'),
    path.join(fixtureRoot, 'launcher-projects', 'CommerceLab', 'CommerceLab.uefnproject'),
    path.join(fixtureRoot, 'launcher-projects', 'SeasonalStore', 'SeasonalStore.uefnproject'),
    path.join(fixtureRoot, 'launcher-projects', 'CreatorSandbox', 'CreatorSandbox.uefnproject'),
  ];
  return paths.map(projectFile => readProject(projectFile, 'cached', false, undefined, diagnostic)).filter((project): project is ProjectCandidate => Boolean(project));
}

function sendLauncherState(status?: string, target = mainWindow) {
  const context = target ? windowContext(target) : null;
  if (target && context && !context.retiring && context.mode === 'launcher' && !target.isDestroyed()) target.webContents.send('uem:launcher:state', launcherState(status));
}

function stopProjectDiscovery() {
  if (discoverySession) discoverySession.cancel();
  discoverySession = null;
  discoveryActive = false;
}

async function loadProjectCandidates(target = mainWindow) {
  if (!target || target.isDestroyed()) throw new Error('The launcher window is unavailable.');
  const targetContext = windowContext(target);
  if (!targetContext || targetContext.retiring) throw new Error('The launcher window is retiring.');
  stopProjectDiscovery();
  if (showcaseMode) {
    const fixtureProjects = loadShowcaseProjects();
    if (fixtureProjects.length > 0) {
      projects = new Map(fixtureProjects.map(project => [project.id, project]));
      selectedProjectId = fixtureProjects[0].id;
      discoveryActive = false;
      diagnostic(`Showcase project fixture loaded: projects=${fixtureProjects.length}`);
      sendLauncherState('Example projects ready. Select a project to continue.', target);
      return;
    }
    diagnostic('Showcase mode was requested, but its generated fixture was not found; using normal project discovery.');
  }
  const session = new ProjectDiscovery({
    writeDiagnostic: diagnostic,
    backgroundScanEnabled: process.env.UEM_TEST_MODE !== '1',
    broadScanEnabled: process.env.UEM_TEST_MODE !== '1',
  });
  discoverySession = session;
  const immediate = session.loadImmediate(preferredProjectFile);
  projects = new Map(immediate.projects.map(project => [project.id, project]));
  if (immediate.preferredProjectId && projects.has(immediate.preferredProjectId)) selectedProjectId = immediate.preferredProjectId;
  else if (!selectedProjectId || !projects.has(selectedProjectId)) selectedProjectId = projects.values().next().value?.id ?? null;
  diagnostic(`Project discovery first result delivered: projects=${projects.size}; durationMs=${immediate.durationMs}`);
  discoveryActive = true;
  sendLauncherState(undefined, target);
  void session.start({
    onProjects: discovered => {
      if (discoverySession !== session || targetContext.retiring || windowContext(target) !== targetContext || mainWindow !== target || targetContext.mode !== 'launcher') return;
      for (const project of discovered) {
        projects.set(project.id, project);
      }
      if (!selectedProjectId) selectedProjectId = projects.values().next().value?.id ?? null;
      sendLauncherState(undefined, target);
    },
    onComplete: stats => {
      if (discoverySession !== session || targetContext.retiring || windowContext(target) !== targetContext || mainWindow !== target || targetContext.mode !== 'launcher') return;
      discoveryActive = false;
      diagnostic(`Project discovery completed: drives=${stats.drivesConsidered}; targetedRoots=${stats.targetedRoots}; broadRoots=${stats.broadRoots}; directories=${stats.directoriesVisited}; candidates=${stats.candidatesFound}; inaccessible=${stats.inaccessibleDirectories}; cancelled=${stats.cancelled}; durationMs=${stats.durationMs}`);
      sendLauncherState(undefined, target);
    },
  }).catch(error => {
    if (discoverySession !== session || targetContext.retiring || windowContext(target) !== targetContext || mainWindow !== target || targetContext.mode !== 'launcher') return;
    discoveryActive = false;
    diagnostic(`Project discovery failed without aborting the launcher: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    sendLauncherState(undefined, target);
  });
}

type RendererProbe = { bodyText: number; root: boolean; error?: string };

async function probeRenderer(target: BrowserWindow, expectedMode: WindowMode): Promise<RendererProbe> {
  if (target.isDestroyed()) return { bodyText: 0, root: false, error: 'The manager window is unavailable.' };
  try {
    const result = await target.webContents.executeJavaScript(`(() => ({ text: document.body?.innerText?.trim().length || 0, root: Boolean(${expectedMode === 'launcher' ? "document.querySelector('[data-uem-launcher-ready]')" : "document.getElementById('root')?.firstElementChild"}) }))()`);
    return { bodyText: result.text, root: result.root, ...(!result.root || result.text < 20 ? { error: `The ${expectedMode} renderer is blank or missing its expected root.` } : {}) };
  } catch (error) {
    return { bodyText: 0, root: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function validateVisibleRenderer(target: BrowserWindow, expectedMode: WindowMode): Promise<void> {
  const result = await probeRenderer(target, expectedMode);
  if (!result.root || result.bodyText < 20) throw new Error(result.error ?? `The ${expectedMode} renderer is blank or missing its expected root.`);
  diagnostic(`${expectedMode === 'launcher' ? 'Project launcher' : 'Dashboard'} renderer ready: bodyText=${result.bodyText}`);
}

async function waitForRendererReady(target: BrowserWindow, url: string, expectedMode: WindowMode, transaction?: NavigationTransaction): Promise<void> {
  const deadline = Date.now() + 8000;
  let lastError = 'the expected URL has not committed';
  while (Date.now() < deadline) {
    if (target.isDestroyed()) throw new Error('The manager window was destroyed during navigation.');
    const currentUrl = target.webContents.getURL();
    if (currentUrl === url) {
      const result = await probeRenderer(target, expectedMode);
      if (result.root && result.bodyText >= 20) {
        if (transaction && !transaction.markDestinationValidated(currentUrl)) throw new Error(`The validated renderer URL did not match the expected target: ${currentUrl}`);
        diagnostic(`Navigation destination verified: generation=${transaction?.expected.generation ?? 0}; renderer=${expectedMode}; url=${describeUrl(currentUrl)}; bodyText=${result.bodyText}; root=true`);
        return;
      }
      lastError = result.error ?? `bodyText=${result.bodyText}; root=${result.root}`;
    } else if (currentUrl) {
      lastError = `currentUrl=${describeUrl(currentUrl)}`;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const currentUrl = !target.isDestroyed() ? target.webContents.getURL() : 'window-destroyed';
  throw new Error(`The ${expectedMode} renderer did not become usable at ${describeUrl(url)} within the bounded validation window; currentUrl=${describeUrl(currentUrl)}; lastObservation=${lastError}`);
}

function beginExpectedNavigation(targetUrl: string): ExpectedNavigation {
  const next = { generation: ++navigationGeneration, targetUrl };
  expectedNavigation = next;
  activeNavigationTransaction = new NavigationTransaction(next);
  diagnostic(`Expected navigation started: generation=${next.generation}, target=${describeUrl(targetUrl)}`);
  return next;
}

function endExpectedNavigation(generation: number): void {
  if (expectedNavigation?.generation !== generation) return;
  diagnostic(`Expected navigation completed: generation=${generation}, target=${describeUrl(expectedNavigation.targetUrl)}; destinationVerified=${activeNavigationTransaction?.isValidated === true}`);
  expectedNavigation = null;
  activeNavigationTransaction = null;
}

async function loadUrlExpecting(target: BrowserWindow, url: string, expectedMode: WindowMode, transaction?: NavigationTransaction): Promise<void> {
  if (target.isDestroyed()) throw new Error('The manager window is unavailable.');
  const targetContext = windowContext(target);
  if (!targetContext || targetContext.retiring) throw new Error('The manager window is retiring.');
  targetContext.navigationTransaction = transaction ?? null;
  diagnostic(`Navigation attempt started: generation=${transaction?.expected.generation ?? 0}; attempt=1/1; target=${describeUrl(url)}; windowId=${target.id}`);
  try {
    await target.loadURL(url);
    diagnostic(`Navigation loadURL promise resolved: generation=${transaction?.expected.generation ?? 0}; attempt=1; target=${describeUrl(url)}; currentUrl=${describeUrl(target.webContents.getURL())}; windowId=${target.id}`);
  } catch (error) {
    if (!transaction || !transaction.observeFailure({ error, url })) throw error;
    diagnostic(`Navigation loadURL promise rejected but destination proof remains pending: generation=${transaction.expected.generation}; attempt=1; code=${(error as { code?: unknown })?.code ?? 'unknown'}; error=${error instanceof Error ? error.message : String(error)}; windowId=${target.id}`);
  }

  try {
    await waitForRendererReady(target, url, expectedMode, transaction);
    diagnostic(`Navigation attempt completed with verified destination: generation=${transaction?.expected.generation ?? 0}; attempt=1; target=${describeUrl(url)}; windowId=${target.id}`);
  } catch (error) {
    diagnostic(`Navigation destination proof unavailable: generation=${transaction?.expected.generation ?? 0}; attempt=1; target=${describeUrl(url)}; error=${error instanceof Error ? error.message : String(error)}; windowId=${target.id}`);
    if (transaction) throw transaction.failureAfterUnverifiedDestination();
    throw error;
  } finally {
    if (targetContext.navigationTransaction === transaction) targetContext.navigationTransaction = null;
  }
}

interface LauncherLoadOptions {
  target?: BrowserWindow;
  transaction?: NavigationTransaction;
  preserveGeometry?: boolean;
  clearUnsavedChanges?: boolean;
  keepBusy?: boolean;
  allowAutoConfirm?: boolean;
}

async function loadLauncher(status?: string, options: LauncherLoadOptions = {}) {
  const target = options.target ?? mainWindow;
  if (!target || target.isDestroyed()) return;
  const context = windowContext(target);
  if (!context) throw new Error('The manager window has no lifecycle context.');
  updateWindowMode(context, 'launcher');
  if (options.clearUnsavedChanges !== false) appHasUnsavedChanges = false;
  if (!options.keepBusy) launcherBusy = false;
  target.setMinimumSize(820, 620);
  if (!options.preserveGeometry) {
    target.setSize(showcaseMode ? 1100 : 960, showcaseMode ? 820 : 720);
    target.center();
  }
  await loadUrlExpecting(target, launcherUrl, 'launcher', options.transaction);
  diagnostic(`Project launcher navigation completed: success=True; windowId=${target.id}`);
  await loadProjectCandidates(target);
  if (status) sendLauncherState(status, target);
  await validateVisibleRenderer(target, 'launcher');
  const testSwitchFinished = process.env.UEM_TEST_AUTO_SWITCH === '1' && testSwitchCount >= testSwitchCycles;
  if (options.allowAutoConfirm !== false && process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_CONFIRM === '1' && !(process.env.UEM_TEST_AUTO_EXIT === '1' && testSwitchFinished) && selectedProjectId) {
    setTimeout(() => { if (selectedProjectId && mainWindow === target && windowContext(target)?.mode === 'launcher') void confirmProject(selectedProjectId); }, 150);
  }
}

async function confirmProject(projectId: string): Promise<{ success: boolean; error?: string }> {
  if (launcherBusy) return { success: false, error: 'A project is already opening.' };
  const selected = projects.get(projectId);
  if (!selected) return { success: false, error: 'Select a currently listed UEFN project.' };
  const verified = readProject(selected.projectFile, selected.source, selected.isActive, selected.isActive ? { processId: selected.uefnProcessId, windowTitle: selected.uefnWindowTitle } : undefined, diagnostic);
  if (!verified || verified.id !== selected.id || verified.contentDirectory.toLowerCase() !== selected.contentDirectory.toLowerCase()) {
    return { success: false, error: 'The selected project changed or became unavailable. Refresh the launcher and select it again.' };
  }
  stopProjectDiscovery();
  launcherBusy = true;
  sendLauncherState('Starting the authenticated project bridge…');
  const target = mainWindow;
  const targetContext = target ? windowContext(target) : null;
  try {
    if (!target || target.isDestroyed() || !targetContext || targetContext.retiring) throw new Error('The manager window is unavailable.');
    bridgeSession = await BridgeSession.start(appRoot, verified, diagnostic, showcaseMode);
    updateWindowMode(targetContext, 'dashboard', new URL(bridgeSession.appUrl).origin);
    target.setMinimumSize(1240, 640);
    target.setSize(1400, showcaseMode ? 1200 : 900);
    target.center();
    await target.loadURL(bridgeSession.appUrl);
    diagnostic(`Dashboard navigation completed: success=True; windowId=${target.id}`);
    await validateVisibleRenderer(target, 'dashboard');
    if (process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_SWITCH === '1' && testSwitchCount < testSwitchCycles) {
      testSwitchCount += 1;
      const switchRequests = Math.max(1, Number.parseInt(process.env.UEM_TEST_AUTO_SWITCH_CLICKS ?? '1', 10) || 1);
      diagnostic(`Hidden test auto-switch scheduled: count=${testSwitchCount}; cycles=${testSwitchCycles}; rapidRequests=${switchRequests}`);
      setTimeout(() => { for (let request = 0; request < switchRequests; request += 1) void switchProject(); }, 500);
    }
    return { success: true };
  } catch (error) {
    diagnostic(`Project startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    if (bridgeSession) await bridgeSession.stop();
    bridgeSession = null;
    if (targetContext) updateWindowMode(targetContext, 'launcher');
    launcherBusy = false;
    if (target && !target.isDestroyed()) {
      await dialog.showMessageBox(target, { type: 'error', title: 'UEFN Transaction Manager', message: 'The selected project could not be opened.', detail: `${error instanceof Error ? error.message : String(error)}\n\nDiagnostic log: ${diagnosticPath}` });
      sendLauncherState('Project startup failed. Select the project and try again.', target);
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function showRecoverableSwitchError(window: BrowserWindow, error: Error): Promise<void> {
  diagnostic(`Project switch replacement failed; current dashboard retained: ${error.stack ?? error.message}`);
  if (process.env.UEM_TEST_MODE === '1') return;
  if (window.isDestroyed()) return;
  await dialog.showMessageBox(window, {
    type: 'error',
    title: 'UEFN Transaction Manager',
    message: 'The next project launcher could not be prepared.',
    detail: `${error.message}\n\nThe current project remains open. No project bridge was torn down.\n\nDiagnostic log: ${diagnosticPath}`,
  });
}

async function exerciseRetiringRenderer(window: BrowserWindow): Promise<void> {
  if (process.env.UEM_TEST_LATE_IPC !== '1' || window.isDestroyed()) return;
  try {
    await window.webContents.executeJavaScript('window.uemDesktop.launcher.getState()');
    diagnostic(`Late IPC from retiring dashboard was unexpectedly accepted: windowId=${window.id}`);
  } catch (error) {
    diagnostic(`Late IPC from retiring dashboard rejected: windowId=${window.id}; error=${error instanceof Error ? error.message : String(error)}`);
  }
}

async function switchProject(): Promise<void> {
  return switchOperation.run(async () => {
    const expected = beginExpectedNavigation(launcherUrl);
    const oldWindow = mainWindow;
    const oldContext = oldWindow ? windowContext(oldWindow) : null;
    const previousProjectId = selectedProjectId;
    const previousProject = projects.get(previousProjectId ?? '');
    const previous = previousProject?.projectFile;
    const previousGeometry = oldWindow && !oldWindow.isDestroyed() ? captureWindowGeometry(oldWindow) : null;
    const previousDirty = appHasUnsavedChanges;
    let candidate: BrowserWindow | null = null;
    let candidateContext: WindowContext | null = null;
    let bridgeWasStopped = false;
    try {
      if (!oldWindow || oldWindow.isDestroyed() || !oldContext || oldContext.mode !== 'dashboard' || !bridgeSession) throw new Error('The active project dashboard is unavailable.');
      oldContext.retiring = true;
      if (previousGeometry?.visible) oldWindow.hide();
      launcherBusy = true;
      selectedProjectId = null;

      candidate = createMainWindow({ candidate: true, showWhenReady: false });
      candidateContext = windowContext(candidate);
      if (!candidateContext) throw new Error('The replacement launcher window has no lifecycle context.');
      candidate.setMinimumSize(1240, 640);
      if (previousGeometry) applyWindowGeometry(candidate, previousGeometry);
      activateWindow(candidate, candidateContext);
      diagnostic(`Replacement launcher window created: oldWindowId=${oldWindow.id}; newWindowId=${candidate.id}; oldUrl=${describeUrl(oldWindow.webContents.getURL())}; oldVisible=${previousGeometry?.visible === true}; oldMaximized=${previousGeometry?.maximized === true}`);

      const transaction = activeNavigationTransaction;
      if (!transaction) throw new Error('The replacement launcher navigation transaction was not initialized.');
      if (process.env.UEM_TEST_FAIL_REPLACEMENT === '1') {
        diagnostic(`Synthetic replacement candidate failure requested before launcher navigation: windowId=${candidate.id}`);
        throw new Error('Synthetic replacement launcher failure for rollback verification.');
      }
      await loadLauncher('Previous project closed cleanly. Select the next project.', {
        target: candidate,
        transaction,
        preserveGeometry: true,
        clearUnsavedChanges: false,
        keepBusy: true,
        allowAutoConfirm: false,
      });
      diagnostic(`Launcher candidate validated before bridge teardown: windowId=${candidate.id}; destination=${describeUrl(candidate.webContents.getURL())}`);
      await exerciseRetiringRenderer(oldWindow);

      await bridgeSession.stop();
      bridgeWasStopped = true;
      bridgeSession = null;
      appHasUnsavedChanges = false;
      launcherBusy = false;
      candidateContext.candidate = false;
      candidateContext.retiring = false;
      if (previousGeometry?.maximized && !candidate.isMaximized()) candidate.maximize();
      if (previousGeometry?.minimized && !candidate.isMinimized()) candidate.minimize();
      if (previousGeometry?.visible && !previousGeometry.minimized && !hiddenTestMode) {
        candidate.show();
        candidate.focus();
        diagnostic(`Visible manager window transferred to verified launcher: windowId=${candidate.id}`);
      } else {
        diagnostic(`Verified launcher retained without foreground presentation: windowId=${candidate.id}; hiddenTestMode=${hiddenTestMode}; wasVisible=${previousGeometry?.visible === true}; wasMinimized=${previousGeometry?.minimized === true}`);
      }

      oldContext.allowClose = true;
      webContentsContexts.delete(oldWindow.webContents);
      if (!oldWindow.isDestroyed()) oldWindow.destroy();
      diagnostic(`Retiring dashboard window destroyed: windowId=${oldWindow.id}`);

      const autoSwitchEnabled = process.env.UEM_TEST_AUTO_SWITCH === '1';
      const finalTestSwitch = !autoSwitchEnabled || testSwitchCount >= testSwitchCycles;
      diagnostic(`Hidden test switch state: count=${testSwitchCount}; cycles=${testSwitchCycles}; autoSwitch=${autoSwitchEnabled}; final=${finalTestSwitch}; previous=${previous ?? 'none'}; matchingProject=${previous ? [...projects.values()].some(project => project.projectFile.toLowerCase() === previous.toLowerCase()) : false}`);
      if (process.env.UEM_TEST_AUTO_EXIT === '1' && finalTestSwitch) {
        diagnostic('Project switch completed');
        diagnostic('Hidden lifecycle test requested clean shutdown after verified launcher return.');
        setTimeout(() => void shutdownAndQuit(), 100);
      } else if (process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_CONFIRM === '1' && autoSwitchEnabled && testSwitchCount < testSwitchCycles && previous) {
        const nextProject = [...projects.values()].find(project => project.projectFile.toLowerCase() === previous.toLowerCase());
        if (nextProject) {
          selectedProjectId = nextProject.id;
          diagnostic('Project switch completed');
          setTimeout(() => void confirmProject(nextProject.id), 150);
        } else diagnostic('Project switch completed');
      } else diagnostic('Project switch completed');
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      stopProjectDiscovery();
      if (oldWindow) await exerciseRetiringRenderer(oldWindow);
      if (candidate && candidateContext && !candidate.isDestroyed()) {
        candidateContext.retiring = true;
        candidateContext.allowClose = true;
        webContentsContexts.delete(candidate.webContents);
        candidate.destroy();
      }
      if (oldWindow && oldContext && !oldWindow.isDestroyed() && !bridgeWasStopped) {
        activateWindow(oldWindow, oldContext);
        oldContext.retiring = false;
        oldContext.allowClose = false;
        oldContext.navigationTransaction = null;
        selectedProjectId = previousProjectId;
        appHasUnsavedChanges = previousDirty;
        launcherBusy = false;
        if (previousGeometry?.visible && !previousGeometry.minimized && !hiddenTestMode) {
          oldWindow.show();
          oldWindow.focus();
        }
        await showRecoverableSwitchError(oldWindow, normalized);
        if (process.env.UEM_TEST_FAIL_REPLACEMENT === '1' && process.env.UEM_TEST_AUTO_EXIT === '1') {
          diagnostic('Hidden lifecycle test requested clean shutdown after verified replacement rollback.');
          setTimeout(() => void shutdownAndQuit(), 100);
        }
      } else {
        bridgeSession = null;
        await showFatalError(normalized);
      }
    } finally {
      endExpectedNavigation(expected.generation);
    }
  });
}

async function shutdownAndQuit() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  allowWindowClose = true;
  stopProjectDiscovery();
  if (bridgeSession) await bridgeSession.stop();
  bridgeSession = null;
  diagnostic('Electron shutdown completed');
  for (const window of [...windowRegistry]) {
    const context = windowContext(window);
    if (context) {
      context.allowClose = true;
      context.retiring = true;
    }
    if (!window.isDestroyed()) window.destroy();
  }
  app.quit();
}

async function stopOwnedProcessesForUpdate() {
  stopProjectDiscovery();
  if (bridgeSession) await bridgeSession.stop();
  bridgeSession = null;
  if (mainWindow) {
    const context = windowContext(mainWindow);
    if (context) updateWindowMode(context, 'launcher');
  }
}

async function showFatalError(error: Error): Promise<void> {
  if (fatalErrorPromise) return fatalErrorPromise;
  fatalErrorPromise = (async () => {
    diagnostic(`Fatal error dialog: ${error.stack ?? error.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, { type: 'error', title: 'UEFN Transaction Manager', message: 'The standalone manager could not start.', detail: `${error.message}\n\nDiagnostic log: ${diagnosticPath}` });
    }
    await shutdownAndQuit();
  })().catch(fatalError => {
    diagnostic(`Fatal shutdown handling failed: ${fatalError instanceof Error ? fatalError.stack ?? fatalError.message : String(fatalError)}`);
  });
  return fatalErrorPromise;
}

function configureIpc() {
  ipcMain.handle('uem:launcher:get-state', event => { assertTrustedSender(event); return launcherState(); });
  ipcMain.handle('uem:launcher:browse', async event => {
    assertTrustedSender(event);
    const target = mainWindow;
    if (!target || windowContext(target)?.mode !== 'launcher') return launcherState();
    const result = await dialog.showOpenDialog(target, { title: 'Select a UEFN project', properties: ['openFile'], filters: [{ name: 'UEFN Project', extensions: ['uefnproject'] }] });
    if (!result.canceled && result.filePaths.length === 1) {
      const project = readProject(result.filePaths[0], 'browse', false, undefined, diagnostic);
      if (project) {
        projects.set(project.id, project);
        selectedProjectId = project.id;
        discoverySession?.recordProject(project.projectFile, true);
      } else await dialog.showMessageBox(target, { type: 'warning', title: 'UEFN Transaction Manager', message: 'That file is not a usable UEFN project.', detail: 'Select a .uefnproject descriptor whose project Content directory is accessible.' });
    }
    return launcherState();
  });
  ipcMain.handle('uem:launcher:select', (event, projectId: unknown) => {
    assertTrustedSender(event);
    if (typeof projectId === 'string' && projects.has(projectId)) selectedProjectId = projectId;
    return launcherState();
  });
  ipcMain.handle('uem:launcher:confirm', async (event, projectId: unknown) => {
    assertTrustedSender(event);
    if (!mainWindow || windowContext(mainWindow)?.mode !== 'launcher' || typeof projectId !== 'string') return { success: false, error: 'The project launcher is unavailable.' };
    return confirmProject(projectId);
  });
  ipcMain.handle('uem:external:open', async (event, rawUrl: unknown) => {
    assertTrustedSender(event);
    if (typeof rawUrl !== 'string' || !isHttpExternal(rawUrl)) {
      diagnostic('External browser request rejected because its URL was invalid or used an unsupported scheme.');
      return false;
    }
    await shell.openExternal(rawUrl, { activate: true });
    diagnostic(`External browser requested for ${new URL(rawUrl).hostname}.`);
    return true;
  });
  ipcMain.handle('uem:agent:open-skill-location', async (event, agent: unknown) => {
    assertTrustedSender(event);
    const targetPath = trustedAgentSkillLocation(agent);
    if (!targetPath) return { success: false, error: 'This Agent Skill is not installed at its verified user skill location.' };
    const openError = await shell.openPath(targetPath);
    if (openError) return { success: false, error: openError };
    diagnostic(`Verified Agent Skill location opened for ${String(agent)}.`);
    return { success: true };
  });
  ipcMain.on('uem:window:dirty', (event, dirty: unknown) => { assertTrustedSender(event); appHasUnsavedChanges = dirty === true; });
  ipcMain.handle('uem:update:get-state', event => {
    assertTrustedSender(event);
    return updateManager?.getState() ?? { status: 'idle', currentVersion: app.getVersion() };
  });
  ipcMain.handle('uem:update:check', async event => {
    assertTrustedSender(event);
    return updateManager ? updateManager.check(true) : { status: 'error', currentVersion: app.getVersion(), message: 'Updates are not available in this build.' };
  });
  ipcMain.handle('uem:update:download', async event => {
    assertTrustedSender(event);
    return updateManager?.download() ?? { success: false, error: 'Updates are not available in this build.' };
  });
  ipcMain.handle('uem:update:dismiss', event => {
    assertTrustedSender(event);
    updateManager?.dismiss();
    return updateManager?.getState() ?? { status: 'idle', currentVersion: app.getVersion() };
  });
  ipcMain.handle('uem:update:install', async (event, discardChanges: unknown) => {
    assertTrustedSender(event);
    if (!updateManager) return { success: false, error: 'Updates are not available in this build.' };
    const discard = discardChanges === true;
    if (appHasUnsavedChanges && !discard) return { success: false, error: 'Save or discard unsaved changes before installing the update.' };
    const hasUnsavedChanges = appHasUnsavedChanges;
    allowWindowClose = true;
    if (mainWindow) windowContext(mainWindow)!.allowClose = true;
    if (!updateManager.isPortable()) shutdownStarted = true;
    appHasUnsavedChanges = false;
    const result = await updateManager.install(discard, hasUnsavedChanges, async () => stopOwnedProcessesForUpdate());
    if (result.success && updateManager.isPortable()) await shutdownAndQuit();
    if (!result.success) {
      allowWindowClose = false;
      shutdownStarted = false;
    }
    return result;
  });
  ipcMain.on('uem:window:action', (event, action: unknown) => {
    assertTrustedSender(event);
    const target = mainWindow;
    if (!target || typeof action !== 'string') return;
    switch (action as WindowAction) {
      case 'request-state': target.webContents.send('uem:window:state', target.isMaximized() ? 'maximized' : 'normal'); break;
      case 'drag': break; // Native dragging is provided by -webkit-app-region.
      case 'minimize': target.minimize(); break;
      case 'toggle-maximize': target.isMaximized() ? target.unmaximize() : target.maximize(); break;
      case 'switch-project': void switchProject(); break;
      case 'close': appHasUnsavedChanges = false; void shutdownAndQuit(); break;
      default: diagnostic(`Unknown window action rejected: ${String(action)}`);
    }
  });
}

function configureWindowSession(session: Electron.Session): void {
  if (configuredSessions.has(session)) return;
  configuredSessions.add(session);
  session.protocol.handle('uem-launcher', createLauncherProtocolHandler(launcherAssets, diagnostic, () => expectedNavigation?.generation ?? 0));
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"] } });
  });
}

function createMainWindow(options: { candidate?: boolean; showWhenReady?: boolean } = {}) {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1240,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#080c14',
    icon: iconPath,
    title: 'UEFN Transaction Manager',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
      partition: 'uem-manager-session',
    },
  });
  const context: WindowContext = {
    window,
    mode: 'launcher',
    dashboardOrigin: null,
    navigationTransaction: null,
    retiring: false,
    candidate: options.candidate === true,
    showWhenReady: options.showWhenReady !== false,
    allowClose: false,
  };
  windowContexts.set(window, context);
  webContentsContexts.set(window.webContents, context);
  windowRegistry.add(window);
  window.removeMenu();
  configureWindowSession(window.webContents.session);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpExternal(url)) void shell.openExternal(url, { activate: true });
    else diagnostic(`New-window request rejected: ${describeUrl(url)}`);
    return { action: 'deny' };
  });
  window.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => diagnosticNavigationEvent(window, 'did-start-navigation', url, `mainFrame=${isMainFrame}`));
  window.webContents.on('did-start-loading', () => diagnosticNavigationEvent(window, 'did-start-loading'));
  window.webContents.on('will-navigate', (event, url) => {
    diagnosticNavigationEvent(window, 'will-navigate', url);
    if (!context.retiring && isAllowedNavigationFor(context, url)) return;
    event.preventDefault();
    if (isHttpExternal(url)) void shell.openExternal(url, { activate: true });
    else diagnostic(`Navigation rejected: ${describeUrl(url)}`);
  });
  window.webContents.on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => diagnosticNavigationEvent(window, 'did-navigate', url, `status=${httpResponseCode}; statusText=${httpStatusText || 'none'}`));
  window.webContents.on('did-frame-navigate', (_event, url, httpResponseCode, httpStatusText, isMainFrame) => diagnosticNavigationEvent(window, 'did-frame-navigate', url, `mainFrame=${isMainFrame}; status=${httpResponseCode}; statusText=${httpStatusText || 'none'}`));
  window.webContents.on('did-finish-load', () => diagnosticNavigationEvent(window, 'did-finish-load'));
  window.webContents.on('did-stop-loading', () => diagnosticNavigationEvent(window, 'did-stop-loading'));
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    diagnosticNavigationEvent(window, 'did-fail-load', url, `code=${code}; description=${description}`);
    if (context.retiring) {
      diagnostic(`Navigation failure ignored for retiring window: windowId=${window.id}; code=${code}; target=${describeUrl(url)}`);
      return;
    }
    if (context.navigationTransaction?.observeFailure({ code, description, url })) {
      diagnostic(`Expected navigation failure deferred pending destination proof: generation=${context.navigationTransaction.expected.generation}; code=${code}; target=${describeUrl(url)}; windowId=${window.id}`);
      return;
    }
    void showFatalError(new Error(`Navigation failed (${code} ${description}): ${describeUrl(url)}`));
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (context.retiring || context.candidate) {
      diagnostic(`Renderer stopped for non-active replacement window: windowId=${window.id}; reason=${details.reason}; exitCode=${details.exitCode}`);
      return;
    }
    void showFatalError(new Error(`The embedded manager renderer stopped unexpectedly (${details.reason}, exit ${details.exitCode}).`));
  });
  window.on('maximize', () => { if (!context.retiring && mainWindow === window) window.webContents.send('uem:window:state', 'maximized'); });
  window.on('unmaximize', () => { if (!context.retiring && mainWindow === window) window.webContents.send('uem:window:state', 'normal'); });
  window.on('close', event => {
    if (allowWindowClose || shutdownStarted || context.allowClose) return;
    event.preventDefault();
    if (appHasUnsavedChanges && context.mode === 'dashboard' && process.env.UEM_TEST_MODE !== '1') window.webContents.send('uem:window:confirm-close');
    else void shutdownAndQuit();
  });
  window.on('closed', () => {
    windowRegistry.delete(window);
    if (mainWindow === window) mainWindow = null;
  });
  window.once('ready-to-show', () => {
    if (!context.showWhenReady || context.candidate || mainWindow !== window || context.retiring) {
      diagnostic(`Manager window ready without foreground presentation: windowId=${window.id}; candidate=${context.candidate}; active=${mainWindow === window}; retiring=${context.retiring}`);
      return;
    }
    if (hiddenTestMode) {
      diagnostic(`Manager window ready in hidden test mode; foreground presentation skipped: windowId=${window.id}`);
      return;
    }
    window.show();
    window.focus();
    diagnostic(`Visible manager window created: windowId=${window.id}; handle=${window.getNativeWindowHandle().toString('hex')}`);
  });
  return window;
}

// The lifecycle harness opts into an isolated multi-process test mode so a running installed build cannot own its lock.
const singleInstance = process.env.UEM_TEST_MODE === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      app.setAppUserModelId('AD3PTInteractive.UEFNEntitlementManager');
      Menu.setApplicationMenu(null);
      configureIpc();
      const initialWindow = createMainWindow({ showWhenReady: true });
      activateWindow(initialWindow);
      updateManager = new UpdateManager(app.getVersion(), app.isPackaged, process.platform, distributionMode, appRoot, process.execPath, state => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('uem:update:state', state);
      }, diagnostic);
      updateManager.initialize();
      diagnostic(`Electron ${process.versions.electron}; Chromium ${process.versions.chrome}; Node ${process.versions.node}; arch=${process.arch}; packaged=${app.isPackaged}; distribution=${distributionMode}; appVersion=${releaseMetadata.version ?? app.getVersion()}; sourceRevision=${releaseMetadata.sourceRevision ?? 'unknown'}`);
      await loadLauncher();
      if (portableUpdateResultPath && fs.existsSync(portableUpdateResultPath)) {
        try {
          const result = JSON.parse(fs.readFileSync(portableUpdateResultPath, 'utf8')) as { success?: boolean; message?: string };
          if (result.success === false) await dialog.showMessageBox(initialWindow, { type: 'error', title: 'Portable update could not be completed', message: 'The previous portable update was rolled back.', detail: `${result.message ?? 'The application was left at its previous version.'}\n\nYou can try the update again or download the verified Portable ZIP manually.` });
          fs.rmSync(portableUpdateResultPath, { force: true });
        } catch (error) { diagnostic(`Portable update result could not be read: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!showcaseMode) void updateManager.check(false);
    } catch (error) {
      await showFatalError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

app.on('window-all-closed', () => {
  diagnostic(`Electron window-all-closed observed: registrySize=${windowRegistry.size}; activeWindow=${mainWindow?.id ?? 'none'}; shutdownStarted=${shutdownStarted}`);
  if (!shutdownStarted && windowRegistry.size === 0) void shutdownAndQuit();
});
process.on('uncaughtException', error => void showFatalError(error));
process.on('unhandledRejection', error => void showFatalError(error instanceof Error ? error : new Error(String(error))));
