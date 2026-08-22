import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { UpdateCandidate, UpdateState } from '../src/services/update.js';
import { plainReleaseNotes, shouldOfferUpdate } from '../src/services/update.js';
import type { DistributionMode } from './distributionMode.js';
import { createPortableUpdatePlan, extractPortableArchive, parsePortableUpdateManifest, portableUpdateUrl, verifyPortableDownload, writePortableUpdatePlan, type PortableUpdateManifest, type VerifiedPortableUpdate } from './portableUpdate.js';

export interface UpdateActionResult {
  success: boolean;
  error?: string;
}

type StateListener = (state: UpdateState) => void;
type DiagnosticWriter = (message: string) => void;

function candidateFromInfo(info: UpdateInfo): UpdateCandidate {
  return {
    version: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseNotes: info.releaseNotes as UpdateCandidate['releaseNotes'],
  };
}

const defaultFeedRoot = 'https://updates.adeptinteractive.net/uem/stable/';

export class UpdateManager {
  private readonly currentVersion: string;
  private readonly enabled: boolean;
  private readonly distributionMode: DistributionMode;
  private readonly applicationRoot: string;
  private readonly executablePath: string;
  private readonly writeDiagnostic: DiagnosticWriter;
  private readonly listen: StateListener;
  private state: UpdateState;
  private checkPromise: Promise<UpdateState> | null = null;
  private candidate: UpdateCandidate | null = null;
  private dismissedVersion: string | null = null;
  private portableManifest: PortableUpdateManifest | null = null;
  private portableReady: (VerifiedPortableUpdate & { updateRoot: string }) | null = null;

  public constructor(
    currentVersion: string,
    isPackaged: boolean,
    platform: NodeJS.Platform,
    distributionMode: DistributionMode,
    applicationRoot: string,
    executablePath: string,
    listen: StateListener,
    writeDiagnostic: DiagnosticWriter,
  ) {
    this.currentVersion = currentVersion;
    this.enabled = platform === 'win32' && (isPackaged || process.env.UEM_UPDATE_TEST_CONFIG === '1');
    this.distributionMode = distributionMode;
    this.applicationRoot = applicationRoot;
    this.executablePath = executablePath;
    this.listen = listen;
    this.writeDiagnostic = writeDiagnostic;
    this.state = { status: 'idle', currentVersion, distributionMode };
  }

  public isPortable(): boolean {
    return this.distributionMode === 'portable';
  }

  public initialize() {
    if (!this.enabled || this.isPortable()) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: message => this.writeDiagnostic(`Updater: ${String(message)}`),
      warn: message => this.writeDiagnostic(`Updater warning: ${String(message)}`),
      error: message => this.writeDiagnostic(`Updater error: ${String(message)}`),
      debug: message => this.writeDiagnostic(`Updater debug: ${String(message)}`),
    };
    if (process.env.UEM_UPDATE_TEST_CONFIG === '1') autoUpdater.forceDevUpdateConfig = !process.env.UEM_UPDATE_TEST_PRODUCTION;
    autoUpdater.on('checking-for-update', () => this.publish({ status: 'checking', currentVersion: this.currentVersion }));
    autoUpdater.on('update-available', info => { this.candidate = candidateFromInfo(info); });
    autoUpdater.on('update-not-available', info => {
      this.candidate = candidateFromInfo(info);
      this.dismissedVersion = null;
      this.publish({ status: 'up-to-date', currentVersion: this.currentVersion, message: `You are using the latest version, ${this.currentVersion}.` }, false);
    });
    autoUpdater.on('download-progress', progress => this.setDownloading(progress));
    autoUpdater.on('update-downloaded', event => {
      const candidate = candidateFromInfo(event);
      this.candidate = candidate;
      this.publish({
        status: 'downloaded',
        currentVersion: this.currentVersion,
        availableVersion: candidate.version,
        releaseName: candidate.releaseName ?? candidate.version,
        releaseNotes: plainReleaseNotes(candidate.releaseNotes),
        progress: 100,
      });
    });
    autoUpdater.on('error', error => {
      this.writeDiagnostic(`Updater error event: ${error.stack ?? error.message}`);
    });
  }

  public getState(): UpdateState {
    return { ...this.state };
  }

  public async check(manual: boolean): Promise<UpdateState> {
    if (!this.enabled) {
      const state = { status: manual ? 'error' : 'idle', currentVersion: this.currentVersion, distributionMode: this.distributionMode, message: manual ? 'Updates are available from an installed Transaction Manager build.' : undefined } satisfies UpdateState;
      if (manual) this.publish(state);
      return state;
    }
    if (this.checkPromise) return this.checkPromise;
    this.publish({ status: 'checking', currentVersion: this.currentVersion }, manual);
    this.checkPromise = this.isPortable() ? this.checkPortable(manual) : this.checkInstalled(manual);
    return this.checkPromise.finally(() => { this.checkPromise = null; });
  }

  private async checkInstalled(manual: boolean): Promise<UpdateState> {
    return autoUpdater.checkForUpdates().then(result => {
      if (!result) return this.getState();
      const candidate = candidateFromInfo(result.updateInfo);
      this.candidate = candidate;
      if (!shouldOfferUpdate(this.currentVersion, candidate)) {
        const state = (manual
          ? { status: 'up-to-date', currentVersion: this.currentVersion, message: `You are using the latest version, ${this.currentVersion}.` }
          : { status: 'idle', currentVersion: this.currentVersion }) satisfies UpdateState;
        this.publish(state);
        return state;
      }
      return this.setAvailable(result.updateInfo, manual, manual);
    }).catch(error => this.handleCheckError(error, manual));
  }

  private async checkPortable(manual: boolean): Promise<UpdateState> {
    const manifestUrl = process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL ?? `${process.env.UEM_UPDATE_TEST_URL ?? defaultFeedRoot}portable-latest.json`;
    try {
      const response = await fetch(manifestUrl, { redirect: 'error' });
      if (!response.ok) throw new Error(`Portable update metadata returned HTTP ${response.status}.`);
      const manifest = parsePortableUpdateManifest(await response.json());
      this.portableManifest = manifest;
      this.candidate = { version: manifest.version, releaseName: manifest.version, releaseNotes: manifest.notes };
      if (shouldOfferUpdate(this.currentVersion, this.candidate)) return this.setAvailableFromCandidate(this.candidate, manual, manual);
      const state = (manual
        ? { status: 'up-to-date', currentVersion: this.currentVersion, message: `You are using the latest version, ${this.currentVersion}.` }
        : { status: 'idle', currentVersion: this.currentVersion }) satisfies UpdateState;
      this.publish(state);
      return state;
    } catch (error) {
      return this.handleCheckError(error, manual, 'Could not check for portable updates. Transaction Manager will continue working normally.');
    }
  }

  private handleCheckError(error: unknown, manual: boolean, message = 'Could not check for updates. Transaction Manager will continue working normally.'): UpdateState {
    this.writeDiagnostic(`Update check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    if (!manual) {
      this.publish({ status: 'idle', currentVersion: this.currentVersion });
      return this.getState();
    }
    const state = { status: 'error', currentVersion: this.currentVersion, message } satisfies UpdateState;
    this.publish(state);
    return state;
  }

  public async download(): Promise<UpdateActionResult> {
    if (!this.enabled || !this.candidate || this.state.status !== 'available') return { success: false, error: 'No downloadable update is available.' };
    this.publish({ ...this.state, status: 'downloading', progress: 0, message: 'Downloading the update…' });
    if (this.isPortable()) return this.downloadPortable();
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      this.writeDiagnostic(`Update download failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      this.publish({ status: 'error', currentVersion: this.currentVersion, availableVersion: this.candidate.version, message: 'The update download was interrupted. Try again when your connection is stable.' });
      return { success: false, error: 'The update download was interrupted.' };
    }
  }

  private async downloadPortable(): Promise<UpdateActionResult> {
    const manifest = this.portableManifest;
    if (!manifest) return { success: false, error: 'Portable update metadata is no longer available. Check for updates again.' };
    const updateRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'uem-portable-update-'));
    const archivePath = path.join(updateRoot, path.basename(manifest.filename));
    try {
      const feedRoot = process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL ? new URL('.', process.env.UEM_PORTABLE_UPDATE_MANIFEST_URL).toString() : (process.env.UEM_UPDATE_TEST_URL ?? defaultFeedRoot);
      const response = await fetch(portableUpdateUrl(feedRoot, manifest));
      if (!response.ok) throw new Error(`Portable update archive returned HTTP ${response.status}.`);
      const total = Number(response.headers.get('content-length')) || manifest.size || 0;
      const handle = await fsp.open(archivePath, 'w');
      let downloaded = 0;
      try {
        if (!response.body) throw new Error('Portable update response did not include a body.');
        const reader = response.body.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          await handle.write(next.value);
          downloaded += next.value.byteLength;
          this.publish({ ...this.state, status: 'downloading', progress: total ? Math.min(99, Math.round(downloaded / total * 100)) : 0, message: 'Downloading the portable update…' });
        }
      } finally { await handle.close(); }
      const verified = await verifyPortableDownload({ archivePath, manifest, extractTo: path.join(updateRoot, 'stage'), inspect: extractPortableArchive });
      this.portableReady = { ...verified, updateRoot };
      this.publish({ status: 'downloaded', currentVersion: this.currentVersion, availableVersion: manifest.version, releaseName: manifest.version, releaseNotes: manifest.notes, progress: 100, message: 'Portable update ready. Restart to update in place.' });
      this.writeDiagnostic(`Verified portable update ${manifest.version}: ${archivePath}; bytes=${downloaded}`);
      return { success: true };
    } catch (error) {
      await fsp.rm(updateRoot, { recursive: true, force: true }).catch(() => undefined);
      this.writeDiagnostic(`Portable update download failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      this.publish({ status: 'error', currentVersion: this.currentVersion, availableVersion: manifest.version, message: 'The portable update could not be verified. Your current copy was left untouched.' });
      return { success: false, error: 'The portable update could not be verified.' };
    }
  }

  public dismiss() {
    if (this.state.availableVersion) this.dismissedVersion = this.state.availableVersion;
    this.publish({ ...this.state, dismissed: true });
  }

  public async install(discardChanges: boolean, hasUnsavedChanges: boolean, stopOwnedProcesses: () => Promise<void>): Promise<UpdateActionResult> {
    if (this.state.status !== 'downloaded') return { success: false, error: 'Download the update before restarting Transaction Manager.' };
    if (!discardChanges && hasUnsavedChanges) return { success: false, error: 'Save or discard unsaved changes before installing the update.' };
    try {
      await stopOwnedProcesses();
      if (this.isPortable()) return this.startPortableReplacement();
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      this.writeDiagnostic(`Update installation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return { success: false, error: this.isPortable() ? 'Transaction Manager could not restart into the portable update.' : 'Transaction Manager could not restart into the downloaded update.' };
    }
  }

  private async startPortableReplacement(): Promise<UpdateActionResult> {
    const ready = this.portableReady;
    if (!ready) return { success: false, error: 'The portable update is not staged. Download it again before restarting.' };
    const plan = createPortableUpdatePlan({
      currentRoot: path.dirname(this.executablePath),
      stagedRoot: ready.inspection.root,
      processId: process.pid,
      relaunchPath: this.executablePath,
      cleanupRoot: ready.updateRoot,
    });
    const planPath = path.join(ready.updateRoot, 'plan.json');
    await writePortableUpdatePlan(planPath, plan);
    const helperPath = path.join(this.applicationRoot, 'electron', 'portable-update-helper.ps1');
    if (!fs.existsSync(helperPath)) throw new Error(`Portable update helper is missing: ${helperPath}`);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, '-PlanPath', planPath], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    this.writeDiagnostic(`Portable update replacement started: helper=${helperPath}; plan=${planPath}; root=${path.dirname(this.executablePath)}`);
    return { success: true };
  }

  private setAvailable(info: UpdateInfo, notify = true, manual = false): UpdateState {
    const candidate = candidateFromInfo(info);
    this.candidate = candidate;
    return this.setAvailableFromCandidate(candidate, notify, manual);
  }

  private setAvailableFromCandidate(candidate: UpdateCandidate, notify = true, manual = false): UpdateState {
    const dismissed = !manual && this.dismissedVersion === candidate.version;
    const state = {
      status: 'available',
      currentVersion: this.currentVersion,
      availableVersion: candidate.version,
      releaseName: candidate.releaseName ?? candidate.version,
      releaseNotes: plainReleaseNotes(candidate.releaseNotes),
      dismissed,
    } satisfies UpdateState;
    this.publish(state, notify);
    return state;
  }

  private setDownloading(progress: ProgressInfo) {
    if (!this.candidate) return;
    this.publish({
      status: 'downloading',
      currentVersion: this.currentVersion,
      availableVersion: this.candidate.version,
      releaseName: this.candidate.releaseName ?? this.candidate.version,
      releaseNotes: plainReleaseNotes(this.candidate.releaseNotes),
      progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: `Downloading the update… ${Math.round(progress.percent)}%`,
    });
  }

  private publish(state: UpdateState, notify = true) {
    this.state = { ...state, distributionMode: this.distributionMode };
    if (notify) this.listen(this.getState());
  }
}
