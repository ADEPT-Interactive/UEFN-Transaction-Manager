import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeSession } from './bridgeSession.js';
import type { LauncherState, ProjectCandidate, WindowAction } from './contracts.js';
import { discoverProjects, readProject } from './projectDiscovery.js';
import { isAllowedNavigation as navigationIsAllowed, isHttpExternal } from './security.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'uem-launcher', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const appRoot = app.getAppPath();
const preloadPath = path.join(appRoot, 'dist-electron', 'preload.cjs');
const iconPath = path.join(appRoot, 'electron', 'assets', 'uem-icon.ico');
const launcherAssets = new Map([
  ['/index.html', { path: path.join(appRoot, 'electron', 'launcher.html'), type: 'text/html; charset=utf-8' }],
  ['/launcher.js', { path: path.join(appRoot, 'electron', 'launcher.js'), type: 'text/javascript; charset=utf-8' }],
  ['/uem-icon.svg', { path: path.join(appRoot, 'electron', 'assets', 'uem-icon.svg'), type: 'image/svg+xml' }],
  ['/adept-insignia.png', { path: path.join(appRoot, 'electron', 'assets', 'adept-insignia.png'), type: 'image/png' }],
]);
const launcherUrl = 'uem-launcher://app/index.html';
const logRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UEFN Entitlement Manager', 'logs');
fs.mkdirSync(logRoot, { recursive: true });
const diagnosticPath = path.join(logRoot, `electron-main-${process.pid}.log`);

let mainWindow: BrowserWindow | null = null;
let bridgeSession: BridgeSession | null = null;
let mode: 'launcher' | 'dashboard' = 'launcher';
let allowedDashboardOrigin: string | null = null;
let projects = new Map<string, ProjectCandidate>();
let selectedProjectId: string | null = null;
let launcherBusy = false;
let appHasUnsavedChanges = false;
let allowWindowClose = false;
let shutdownStarted = false;
let testSwitchCompleted = false;

const projectArgumentIndex = process.argv.findIndex(argument => argument.toLowerCase() === '--project');
const preferredProjectFile = projectArgumentIndex >= 0 ? process.argv[projectArgumentIndex + 1] : undefined;

function diagnostic(message: string) {
  fs.appendFileSync(diagnosticPath, `${new Date().toISOString()}\n${message}\n`);
}

function describeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid URL';
  }
}

function isAllowedNavigation(rawUrl: string): boolean {
  return navigationIsAllowed(mode, rawUrl, launcherUrl, allowedDashboardOrigin);
}

function assertTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || !isAllowedNavigation(event.senderFrame.url)) {
    throw new Error('Rejected desktop IPC from an untrusted renderer.');
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
    status: status ?? (projects.size === 0 ? 'No UEFN projects were found. Browse to a .uefnproject file.' : `Found ${projects.size} available UEFN project${projects.size === 1 ? '' : 's'}.`),
    busy: launcherBusy,
  };
}

function sendLauncherState(status?: string) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('uem:launcher:state', launcherState(status));
}

async function loadProjectCandidates() {
  const discovered = discoverProjects(diagnostic);
  projects = new Map(discovered.map(project => [project.id, project]));
  if (preferredProjectFile) {
    const supplied = readProject(preferredProjectFile, 'command-line', false, undefined, diagnostic);
    if (supplied) projects.set(supplied.id, supplied);
  }
  if (!selectedProjectId || !projects.has(selectedProjectId)) selectedProjectId = projects.values().next().value?.id ?? null;
  sendLauncherState();
}

async function validateVisibleRenderer(expectedMode: 'launcher' | 'dashboard') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const result = await mainWindow.webContents.executeJavaScript(`(() => ({ text: document.body?.innerText?.trim().length || 0, root: Boolean(${expectedMode === 'launcher' ? "document.querySelector('[data-uem-launcher-ready]')" : "document.getElementById('root')?.firstElementChild"}) }))()`);
    if (!result.root || result.text < 20) throw new Error(`The ${expectedMode} renderer is blank or missing its expected root.`);
    diagnostic(`${expectedMode === 'launcher' ? 'Project launcher' : 'Dashboard'} renderer ready: bodyText=${result.text}`);
  } catch (error) {
    await showFatalError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function loadLauncher(status?: string) {
  if (!mainWindow) return;
  mode = 'launcher';
  allowedDashboardOrigin = null;
  appHasUnsavedChanges = false;
  launcherBusy = false;
  mainWindow.setMinimumSize(820, 620);
  mainWindow.setSize(960, 720);
  mainWindow.center();
  await mainWindow.loadURL(launcherUrl);
  diagnostic('Project launcher navigation completed: success=True');
  await loadProjectCandidates();
  if (status) sendLauncherState(status);
  await validateVisibleRenderer('launcher');
  if (process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_CONFIRM === '1' && selectedProjectId) {
    setTimeout(() => { if (selectedProjectId) void confirmProject(selectedProjectId); }, 150);
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
  launcherBusy = true;
  sendLauncherState('Starting the authenticated project bridge…');
  try {
    if (!mainWindow) throw new Error('The manager window is unavailable.');
    bridgeSession = await BridgeSession.start(appRoot, verified, mainWindow, diagnostic);
    mode = 'dashboard';
    allowedDashboardOrigin = new URL(bridgeSession.appUrl).origin;
    mainWindow.setMinimumSize(960, 640);
    mainWindow.setSize(1400, 900);
    mainWindow.center();
    await mainWindow.loadURL(bridgeSession.appUrl);
    diagnostic('Dashboard navigation completed: success=True');
    await validateVisibleRenderer('dashboard');
    if (process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_SWITCH === '1' && !testSwitchCompleted) {
      testSwitchCompleted = true;
      setTimeout(() => void switchProject(), 500);
    }
    return { success: true };
  } catch (error) {
    diagnostic(`Project startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    if (bridgeSession) await bridgeSession.stop();
    bridgeSession = null;
    mode = 'launcher';
    allowedDashboardOrigin = null;
    launcherBusy = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, { type: 'error', title: 'UEFN Entitlement Manager', message: 'The selected project could not be opened.', detail: `${error instanceof Error ? error.message : String(error)}\n\nDiagnostic log: ${diagnosticPath}` });
      sendLauncherState('Project startup failed. Select the project and try again.');
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function switchProject() {
  const previous = projects.get(selectedProjectId ?? '')?.projectFile;
  if (bridgeSession) await bridgeSession.stop();
  bridgeSession = null;
  selectedProjectId = null;
  await loadLauncher('Previous project closed cleanly. Select the next project.');
  if (process.env.UEM_TEST_MODE === '1' && process.env.UEM_TEST_AUTO_CONFIRM === '1' && previous) {
    const previousProject = [...projects.values()].find(project => project.projectFile.toLowerCase() === previous.toLowerCase());
    if (previousProject) {
      selectedProjectId = previousProject.id;
      diagnostic('Project switch completed');
      setTimeout(() => void confirmProject(previousProject.id), 150);
    }
  } else diagnostic('Project switch completed');
}

async function shutdownAndQuit() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  allowWindowClose = true;
  if (bridgeSession) await bridgeSession.stop();
  bridgeSession = null;
  diagnostic('Electron shutdown completed');
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

async function showFatalError(error: Error) {
  diagnostic(`Fatal error dialog: ${error.stack ?? error.message}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: 'UEFN Entitlement Manager', message: 'The standalone manager could not start.', detail: `${error.message}\n\nDiagnostic log: ${diagnosticPath}` });
  }
  await shutdownAndQuit();
}

function configureIpc() {
  ipcMain.handle('uem:launcher:get-state', event => { assertTrustedSender(event); return launcherState(); });
  ipcMain.handle('uem:launcher:browse', async event => {
    assertTrustedSender(event);
    if (!mainWindow || mode !== 'launcher') return launcherState();
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select a UEFN project', properties: ['openFile'], filters: [{ name: 'UEFN Project', extensions: ['uefnproject'] }] });
    if (!result.canceled && result.filePaths.length === 1) {
      const project = readProject(result.filePaths[0], 'browse', false, undefined, diagnostic);
      if (project) {
        projects.set(project.id, project);
        selectedProjectId = project.id;
      } else await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'UEFN Entitlement Manager', message: 'That file is not a usable UEFN project.', detail: 'Select a .uefnproject descriptor whose project Content directory is accessible.' });
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
    if (mode !== 'launcher' || typeof projectId !== 'string') return { success: false, error: 'The project launcher is unavailable.' };
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
  ipcMain.on('uem:window:dirty', (event, dirty: unknown) => { assertTrustedSender(event); appHasUnsavedChanges = dirty === true; });
  ipcMain.on('uem:window:action', (event, action: unknown) => {
    assertTrustedSender(event);
    if (!mainWindow || typeof action !== 'string') return;
    switch (action as WindowAction) {
      case 'request-state': mainWindow.webContents.send('uem:window:state', mainWindow.isMaximized() ? 'maximized' : 'normal'); break;
      case 'drag': break; // Native dragging is provided by -webkit-app-region.
      case 'minimize': mainWindow.minimize(); break;
      case 'toggle-maximize': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
      case 'switch-project': void switchProject(); break;
      case 'close': appHasUnsavedChanges = false; void shutdownAndQuit(); break;
      default: diagnostic(`Unknown window action rejected: ${String(action)}`);
    }
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 820,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#080c14',
    icon: iconPath,
    title: 'UEFN Entitlement Manager',
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
  window.removeMenu();
  window.webContents.session.protocol.handle('uem-launcher', request => {
    const target = new URL(request.url);
    if (target.host !== 'app') return new Response('Not found', { status: 404 });
    const asset = launcherAssets.get(target.pathname);
    if (!asset || !fs.existsSync(asset.path)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(asset.path).toString());
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"] } });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpExternal(url)) void shell.openExternal(url, { activate: true });
    else diagnostic(`New-window request rejected: ${describeUrl(url)}`);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (isHttpExternal(url)) void shell.openExternal(url, { activate: true });
    else diagnostic(`Navigation rejected: ${describeUrl(url)}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) void showFatalError(new Error(`Navigation failed (${code} ${description}): ${describeUrl(url)}`));
  });
  window.webContents.on('render-process-gone', (_event, details) => void showFatalError(new Error(`The embedded manager renderer stopped unexpectedly (${details.reason}, exit ${details.exitCode}).`)));
  window.on('maximize', () => window.webContents.send('uem:window:state', 'maximized'));
  window.on('unmaximize', () => window.webContents.send('uem:window:state', 'normal'));
  window.on('close', event => {
    if (allowWindowClose) return;
    event.preventDefault();
    if (appHasUnsavedChanges && mode === 'dashboard' && process.env.UEM_TEST_MODE !== '1') window.webContents.send('uem:window:confirm-close');
    else void shutdownAndQuit();
  });
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
    diagnostic(`Visible manager window created: handle=${window.getNativeWindowHandle().toString('hex')}`);
  });
  return window;
}

const singleInstance = app.requestSingleInstanceLock();
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
      mainWindow = createMainWindow();
      diagnostic(`Electron ${process.versions.electron}; Chromium ${process.versions.chrome}; Node ${process.versions.node}; arch=${process.arch}; packaged=${app.isPackaged}`);
      await loadLauncher();
    } catch (error) {
      await showFatalError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

app.on('window-all-closed', () => { if (!shutdownStarted) void shutdownAndQuit(); });
process.on('uncaughtException', error => void showFatalError(error));
process.on('unhandledRejection', error => void showFatalError(error instanceof Error ? error : new Error(String(error))));
