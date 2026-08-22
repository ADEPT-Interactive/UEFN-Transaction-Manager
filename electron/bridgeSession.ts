import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ProjectCandidate } from './contracts.js';
import { projectIsOpen } from './projectDiscovery.js';
import { sendUefnConnectorCommand } from './nativeWindows.js';

export type DiagnosticWriter = (message: string) => void;

interface ConnectorInstallResult {
  installed: boolean;
  addedThisLaunch: boolean;
}

function installAutomaticConnector(appRoot: string, project: ProjectCandidate): ConnectorInstallResult {
  const source = path.join(appRoot, 'uefn_auto_connector.py');
  if (!fs.existsSync(source)) return { installed: false, addedThisLaunch: false };
  const pythonDirectory = path.join(project.contentDirectory, 'Python');
  fs.mkdirSync(pythonDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(pythonDirectory, 'uefn_auto_connector.py'));

  const beginMarker = '# UEM_AUTO_CONNECTOR_BEGIN';
  const endMarker = '# UEM_AUTO_CONNECTOR_END';
  const initPath = path.join(pythonDirectory, 'init_unreal.py');
  const existing = fs.existsSync(initPath) ? fs.readFileSync(initPath, 'utf8') : '';
  const alreadyInstalled = existing.includes(beginMarker) && existing.includes(endMarker);
  if (!alreadyInstalled) {
    if (fs.existsSync(initPath)) {
      const backupDirectory = path.join(pythonDirectory, '.uem-backups');
      fs.mkdirSync(backupDirectory, { recursive: true });
      fs.copyFileSync(initPath, path.join(backupDirectory, `init_unreal.py.${new Date().toISOString().replace(/[-:.]/g, '')}.bak`), fs.constants.COPYFILE_EXCL);
    }
    const managedBlock = [
      beginMarker,
      'try:',
      '    import uefn_auto_connector as _uem_auto_connector',
      '    _uem_auto_connector.install()',
      'except Exception as _uem_auto_connector_error:',
      '    import unreal as _uem_unreal',
      '    _uem_unreal.log_warning(f"[TransactionManager] Automatic connector startup failed: {_uem_auto_connector_error}")',
      endMarker,
      '',
    ].join(os.EOL);
    const next = `${existing.trimEnd()}${existing.length === 0 ? '' : `${os.EOL}${os.EOL}`}${managedBlock}`;
    const temporary = `${initPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, next, { encoding: 'utf8', flag: 'wx' });
    if (!fs.existsSync(initPath)) fs.renameSync(temporary, initPath);
    else {
      const replaced = `${initPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.replaced`;
      fs.renameSync(initPath, replaced);
      try {
        fs.renameSync(temporary, initPath);
        fs.rmSync(replaced);
      } catch (error) {
        if (!fs.existsSync(initPath) && fs.existsSync(replaced)) fs.renameSync(replaced, initPath);
        fs.rmSync(temporary, { force: true });
        throw error;
      }
    }
  }
  return { installed: true, addedThisLaunch: !alreadyInstalled };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') {
        listener.close();
        reject(new Error('Windows did not reserve a loopback port.'));
        return;
      }
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function request(port: number, pathname: string, token?: string, method = 'GET', body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      timeout: 1500,
      headers: {
        ...(token ? { 'X-UEM-Token': token } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('timeout', () => req.destroy(new Error('Loopback request timed out.')));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.off('exit', exited); resolve(false); }, milliseconds);
    const exited = () => { clearTimeout(timer); resolve(true); };
    child.once('exit', exited);
  });
}

function writeActiveSession(port: number, editorToken: string, project: ProjectCandidate, connectorScript: string): string {
  // Compatibility: this state directory is shared with existing 4.0.1 installs.
  const stateRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UEFN Entitlement Manager');
  fs.mkdirSync(stateRoot, { recursive: true });
  const statePath = path.join(stateRoot, 'active-session.json');
  const temporary = `${statePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const state = {
    schemaVersion: 1,
    desktopProcessId: process.pid,
    port,
    editorToken,
    contentRoot: project.contentDirectory,
    assetMount: `/${project.assetMount}`,
    projectFile: project.projectFile,
    connectorScript,
  };
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.rmSync(statePath, { force: true });
  fs.renameSync(temporary, statePath);
  return statePath;
}

export class BridgeSession {
  readonly appUrl: string;
  readonly processId: number;
  private stopped = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly port: number,
    private readonly sessionToken: string,
    private readonly editorToken: string,
    private readonly statePath: string,
    private readonly logPath: string,
    private readonly writeDiagnostic: DiagnosticWriter,
    appUrl: string,
  ) {
    this.appUrl = appUrl;
    this.processId = child.pid ?? 0;
  }

  static async start(appRoot: string, project: ProjectCandidate, managerWindow: BrowserWindow, writeDiagnostic: DiagnosticWriter, showcaseMode = false): Promise<BridgeSession> {
    const serverPath = path.join(appRoot, 'dist', 'server.cjs');
    if (!fs.existsSync(serverPath)) throw new Error(`The manager bridge build is missing: ${serverPath}`);
    let connector: ConnectorInstallResult = { installed: false, addedThisLaunch: false };
    try {
      connector = installAutomaticConnector(appRoot, project);
    } catch (error) {
      writeDiagnostic(`Automatic UEFN connector installation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    const openProject = projectIsOpen(project.projectFile, writeDiagnostic);
    const port = await reserveLoopbackPort();
    const sessionToken = crypto.randomBytes(48).toString('base64url');
    const editorToken = crypto.randomBytes(48).toString('base64url');
    // Compatibility: keep the established per-user log namespace across the rename.
    const logRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'UEFN Entitlement Manager', 'logs');
    fs.mkdirSync(logRoot, { recursive: true });
    const logPath = path.join(logRoot, `bridge-startup-${port}.log`);
    const logHandle = fs.openSync(logPath, 'a');
    const environment = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      UEM_SESSION_TOKEN: sessionToken,
      UEM_EDITOR_TOKEN: editorToken,
      UEM_CONTENT_ROOT: project.contentDirectory,
      UEM_ASSET_MOUNT: `/${project.assetMount}`,
      UEM_PROJECT_FILE: project.projectFile,
      UEM_PROJECT_PYTHON_ENABLED: project.pythonEnabled ? '1' : '0',
      UEM_AUTO_CONNECTOR_INSTALLED: connector.installed ? '1' : '0',
      UEM_UEFN_PROCESS_ID: String(openProject?.processId ?? 0),
      UEM_BOOTSTRAP_ELIGIBLE: openProject && project.pythonEnabled && connector.installed ? '1' : '0',
      UEM_IDLE_TIMEOUT_MS: '120000',
    };
    const child = spawn(process.execPath, [serverPath], {
      cwd: appRoot,
      env: environment,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', logHandle, logHandle],
    });
    fs.closeSync(logHandle);
    let statePath = '';
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (child.exitCode !== null) break;
        try {
          const response = await request(port, '/api/health');
          if (response.status === 200 && response.text.includes('UEFN Entitlement Manager Bridge')) {
            healthy = true;
            break;
          }
        } catch {
          // The bridge may not have bound the port yet.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!healthy) {
        const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-6000) : 'Bridge log unavailable.';
        throw new Error(`The secure project bridge did not start.\n\n${output}`);
      }
      const fragment = new URLSearchParams({
        token: sessionToken,
        contentDir: project.contentDirectory,
        assetFolder: 'EntitlementIcons',
        verseFile: 'managed_transactions.verse',
        pythonEnabled: String(project.pythonEnabled),
        projectFile: project.projectFile,
        ...(showcaseMode ? { showcase: '1' } : {}),
      });
      const connectorScript = path.join(appRoot, 'entitlement_manager.py');
      statePath = writeActiveSession(port, editorToken, project, connectorScript);
      const session = new BridgeSession(child, port, sessionToken, editorToken, statePath, logPath, writeDiagnostic, `http://127.0.0.1:${port}/#${fragment}`);
      writeDiagnostic(`Bridge started: pid=${child.pid ?? 0}, port=${port}, project=${path.basename(project.projectFile)}`);
      if (openProject && project.pythonEnabled && connector.installed) void session.bootstrapOpenEditor(openProject.windowTitle, managerWindow);
      return session;
    } catch (error) {
      if (statePath) fs.rmSync(statePath, { force: true });
      if (child.exitCode === null) child.kill();
      throw error;
    }
  }

  private async bootstrapOpenEditor(windowTitle: string | undefined, managerWindow: BrowserWindow) {
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const status = await request(this.port, '/api/editor/status', this.sessionToken);
        if (/"editorConnected"\s*:\s*true/i.test(status.text)) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'attempting' }));
      const sent = await sendUefnConnectorCommand(windowTitle, 'import uefn_auto_connector; uefn_auto_connector.install()', managerWindow);
      if (!sent) {
        await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'failed', message: 'The verified UEFN window could not accept the automatic connector command.' }));
        return;
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const status = await request(this.port, '/api/editor/status', this.sessionToken);
        if (/"editorConnected"\s*:\s*true/i.test(status.text)) {
          await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'connected' }));
          return;
        }
      }
      const fallbackSent = await sendUefnConnectorCommand(windowTitle, 'py import uefn_auto_connector; uefn_auto_connector.install()', managerWindow);
      if (!fallbackSent) {
        await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'failed', message: 'The verified UEFN console did not accept either supported connector command form.' }));
        return;
      }
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const status = await request(this.port, '/api/editor/status', this.sessionToken);
        if (/"editorConnected"\s*:\s*true/i.test(status.text)) {
          await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'connected' }));
          return;
        }
      }
      await request(this.port, '/api/editor/bootstrap-status', this.sessionToken, 'POST', JSON.stringify({ state: 'failed', message: 'UEFN did not confirm the connector handshake after the automatic command.' }));
    } catch (error) {
      this.writeDiagnostic(`Automatic UEFN connector bootstrap did not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.child.exitCode === null) {
        try {
          const response = await request(this.port, '/api/session/shutdown', this.sessionToken, 'POST');
          this.writeDiagnostic(`Bridge shutdown response: ${response.status}`);
        } catch (error) {
          this.writeDiagnostic(`Bridge shutdown request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!await waitForExit(this.child, 3000)) {
          this.child.kill();
          await waitForExit(this.child, 1500);
        }
      }
    } finally {
      try {
        if (fs.existsSync(this.statePath)) {
          const current = fs.readFileSync(this.statePath, 'utf8');
          if (current.includes(`"editorToken": "${this.editorToken}"`)) fs.rmSync(this.statePath, { force: true });
        }
      } catch (error) {
        this.writeDiagnostic(`Editor connector session cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.writeDiagnostic(`Bridge shutdown completed: pid=${this.processId}, log=${this.logPath}`);
    }
  }
}
