import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import type { UpdateCandidate, UpdateState } from '../src/services/update.js';
import { plainReleaseNotes, shouldOfferUpdate } from '../src/services/update.js';

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

export class UpdateManager {
  private readonly currentVersion: string;
  private readonly enabled: boolean;
  private readonly writeDiagnostic: DiagnosticWriter;
  private readonly listen: StateListener;
  private state: UpdateState;
  private checkPromise: Promise<UpdateState> | null = null;
  private candidate: UpdateCandidate | null = null;
  private dismissedVersion: string | null = null;

  public constructor(currentVersion: string, isPackaged: boolean, platform: NodeJS.Platform, listen: StateListener, writeDiagnostic: DiagnosticWriter) {
    this.currentVersion = currentVersion;
    this.enabled = platform === 'win32' && (isPackaged || process.env.UEM_UPDATE_TEST_CONFIG === '1');
    this.listen = listen;
    this.writeDiagnostic = writeDiagnostic;
    this.state = { status: 'idle', currentVersion };
  }

  public initialize() {
    if (!this.enabled) return;
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
      const state = { status: manual ? 'error' : 'idle', currentVersion: this.currentVersion, message: manual ? 'Updates are available from an installed UEM build.' : undefined } satisfies UpdateState;
      if (manual) this.publish(state);
      return state;
    }
    if (this.checkPromise) return this.checkPromise;
    this.publish({ status: 'checking', currentVersion: this.currentVersion }, manual);
    this.checkPromise = autoUpdater.checkForUpdates().then(result => {
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
      return this.setAvailable(result.updateInfo, manual);
    }).catch(error => {
      this.writeDiagnostic(`Update check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (!manual) {
        this.publish({ status: 'idle', currentVersion: this.currentVersion });
        return this.getState();
      }
      const state = { status: 'error', currentVersion: this.currentVersion, message: 'Could not check for updates. UEM will continue working normally.' } satisfies UpdateState;
      this.publish(state);
      return state;
    }).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  public async download(): Promise<UpdateActionResult> {
    if (!this.enabled || !this.candidate || this.state.status !== 'available') return { success: false, error: 'No downloadable update is available.' };
    this.publish({ ...this.state, status: 'downloading', progress: 0, message: 'Downloading the update…' });
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      this.writeDiagnostic(`Update download failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      this.publish({ status: 'error', currentVersion: this.currentVersion, availableVersion: this.candidate.version, message: 'The update download was interrupted. Try again when your connection is stable.' });
      return { success: false, error: 'The update download was interrupted.' };
    }
  }

  public dismiss() {
    if (this.state.availableVersion) this.dismissedVersion = this.state.availableVersion;
    this.publish({ ...this.state, dismissed: true });
  }

  public async install(discardChanges: boolean, hasUnsavedChanges: boolean, stopOwnedProcesses: () => Promise<void>): Promise<UpdateActionResult> {
    if (this.state.status !== 'downloaded') return { success: false, error: 'Download the update before restarting UEM.' };
    if (!discardChanges && hasUnsavedChanges) return { success: false, error: 'Save or discard unsaved changes before installing the update.' };
    try {
      await stopOwnedProcesses();
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      this.writeDiagnostic(`Update installation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return { success: false, error: 'UEM could not restart into the downloaded update.' };
    }
  }

  private setAvailable(info: UpdateInfo, notify = true): UpdateState {
    const candidate = candidateFromInfo(info);
    this.candidate = candidate;
    const dismissed = this.dismissedVersion === candidate.version;
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
    this.state = { ...state };
    if (notify) this.listen(this.getState());
  }
}
