import { BundleOffer, EntitlementItem, ProjectConfig } from '../types/entitlement';
import { cleanManagedData } from './projectSchema';
import { PLACEHOLDER_ICON_ASSET_NAME, PLACEHOLDER_ICON_DATA_URL } from '../constants/placeholderIcon';
import versionInfo from '../../version.json';

const API_BASE = '/api';
const TOKEN_KEY = 'uem_bridge_token';
const ROOT_KEY = 'uem_content_root';

function hashProjectPath(contentFolderPath: string): string {
  const normalized = contentFolderPath.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface LaunchContext {
  contentFolderPath: string;
  assetFolderName?: string;
  targetVerseFileName?: string;
  projectFile?: string;
  showcaseMode?: boolean;
}

export interface SaveResult {
  success: boolean;
  status?: number;
  filePath?: string;
  backupPath?: string;
  contentHash?: string;
  currentHash?: string | null;
  message?: string;
  error?: string;
}

export interface UploadTextureResult {
  success: boolean;
  jobId?: string;
  status?: 'queued' | 'processing' | 'completed' | 'failed';
  assetFolderName?: string;
  assetName?: string;
  filePath?: string;
  verseAssetPath?: string;
  destinationPath?: string;
  assetObjectPath?: string;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CompileResult {
  success: boolean;
  connected?: boolean;
  numErrors?: number;
  numWarnings?: number;
  messages?: unknown[];
  fileName?: string;
  contentHash?: string;
  assetMount?: string;
  error?: string;
}

export interface ProjectIconPreview {
  assetFolderName: string;
  assetName: string;
  verseAssetPath: string;
  assetObjectPath?: string;
}

export interface ProjectScanResult {
  success: boolean;
  folderPath?: string;
  verseFiles?: string[];
  subDirs?: string[];
  iconPreviews?: ProjectIconPreview[];
  error?: string;
}

export interface EditorStatus {
  success: boolean;
  uefnRunning: boolean;
  editorConnected: boolean;
  projectActive: boolean;
  differentProjectOpen: boolean;
  openProjectFile?: string;
  pythonEnabled: boolean;
  autoConnectorInstalled: boolean;
  nativeTextureImportAvailable: boolean;
  bootstrapState: 'not-needed' | 'waiting' | 'attempting' | 'connected' | 'failed';
  bootstrapMessage?: string;
  error?: string;
}

function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, encoded] = dataUrl.split(',', 2);
  const mimeType = header.match(/^data:([^;]+);base64$/)?.[1] ?? 'image/png';
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new File([bytes], fileName, { type: mimeType });
}

const placeholderReady = new Map<string, Promise<boolean>>();

async function apiFetch<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${route}`, {
    ...init,
    headers: {
      ...(!(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      'X-UEM-Token': getToken(),
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({ success: false, error: `Bridge returned HTTP ${response.status}.` }));
  return data as T;
}

export const FileService = {
  getStorageNamespace(contentFolderPath: string): string {
    return `uefn_entitlement_project_${hashProjectPath(contentFolderPath || 'unlaunched')}`;
  },

  consumeLaunchContext(): LaunchContext {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('token');
    const contentFolderPath = hash.get('contentDir');
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    if (contentFolderPath) sessionStorage.setItem(ROOT_KEY, contentFolderPath);
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return {
      contentFolderPath: contentFolderPath ?? sessionStorage.getItem(ROOT_KEY) ?? '',
      assetFolderName: hash.get('assetFolder') ?? undefined,
      targetVerseFileName: hash.get('verseFile') ?? undefined,
      projectFile: hash.get('projectFile') ?? undefined,
      showcaseMode: hash.get('showcase') === '1',
    };
  },

  async checkHealth(): Promise<boolean> {
    try {
      const health = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const identity = await health.json();
      if (!health.ok || identity?.server !== 'UEFN Entitlement Manager Bridge' || identity?.version !== versionInfo.version || identity?.textureImport !== 'uefn-editor-bridge') return false;
      const heartbeat = await apiFetch<{ success: boolean }>('/session/heartbeat', { method: 'POST', body: '{}' });
      return heartbeat.success === true;
    } catch {
      return false;
    }
  },

  async heartbeat(): Promise<void> {
    await apiFetch('/session/heartbeat', { method: 'POST', body: '{}' });
  },

  async getEditorStatus(): Promise<EditorStatus> {
    try {
      return await apiFetch<EditorStatus>('/editor/status', { method: 'GET' });
    } catch (error) {
      return {
        success: false,
        uefnRunning: false,
        editorConnected: false,
        projectActive: false,
        differentProjectOpen: false,
        pythonEnabled: false,
        autoConnectorInstalled: false,
        nativeTextureImportAvailable: false,
        bootstrapState: 'not-needed',
        error: error instanceof Error ? error.message : 'UEFN editor status is unavailable.',
      };
    }
  },

  startSessionLease(): () => void {
    const controller = new AbortController();
    void fetch(`${API_BASE}/session/lease`, {
      method: 'GET',
      headers: { 'X-UEM-Token': getToken(), Accept: 'text/plain' },
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      try {
        while (!(await reader.read()).done) {
          // The open response is the browser's process lease. The bridge closes
          // itself when this connection disappears with the app window.
        }
      } finally {
        reader.releaseLock();
      }
    }).catch(() => {
      // Health polling reports the visible failure; lease teardown is expected
      // when the browser window is closed or the bridge shuts down.
    });
    return () => controller.abort();
  },

  async scanProject(assetFolderName = 'EntitlementIcons'): Promise<ProjectScanResult> {
    try {
      return await apiFetch<ProjectScanResult>('/project/scan', { method: 'POST', body: JSON.stringify({ assetFolderName }) });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to scan Content directory.' };
    }
  },

  async loadVerseFile(fileName: string): Promise<{ success: boolean; content?: string; contentHash?: string; filePath?: string; error?: string; status?: number }> {
    try {
      const response = await fetch(`${API_BASE}/verse/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-UEM-Token': getToken() },
        body: JSON.stringify({ fileName }),
      });
      const data = await response.json().catch(() => ({ success: false, error: `Bridge returned HTTP ${response.status}.` }));
      return { ...(data as { success: boolean; content?: string; contentHash?: string; filePath?: string; error?: string }), status: response.status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load Verse file.' };
    }
  },

  async saveVerseFile(fileName: string, content: string, createBackup = true, expectedHash: string | null = null): Promise<SaveResult> {
    try {
      const response = await fetch(`${API_BASE}/verse/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-UEM-Token': getToken() },
        body: JSON.stringify({ fileName, content, createBackup, expectedHash }),
      });
      const data = await response.json().catch(() => ({ success: false, error: `Bridge returned HTTP ${response.status}.` }));
      return { ...(data as SaveResult), status: response.status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save Verse file.' };
    }
  },

  async importTexture(assetFolderName: string, assetName: string, file: File): Promise<UploadTextureResult> {
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('assetFolderName', assetFolderName);
      formData.append('assetName', assetName);
      return await apiFetch('/texture/import', { method: 'POST', body: formData });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to queue PNG texture import.' };
    }
  },

  async adoptTexture(assetFolderName: string, assetName: string, sourceAssetPath: string): Promise<UploadTextureResult> {
    try {
      return await apiFetch('/texture/adopt', { method: 'POST', body: JSON.stringify({ assetFolderName, assetName, sourceAssetPath }) });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to queue existing Texture2D adoption.' };
    }
  },

  async getTextureImport(jobId: string): Promise<UploadTextureResult> {
    try {
      return await apiFetch(`/texture/import/${encodeURIComponent(jobId)}`, { method: 'GET' });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to read texture import status.' };
    }
  },

  async retryTextureImport(jobId: string): Promise<UploadTextureResult> {
    try {
      return await apiFetch(`/texture/import/${encodeURIComponent(jobId)}/retry`, { method: 'POST', body: '{}' });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to retry texture import.' };
    }
  },

  async loadProjectIconPreview(preview: ProjectIconPreview): Promise<string | null> {
    try {
      const response = await fetch(`${API_BASE}/project/icon-preview/${encodeURIComponent(preview.assetFolderName)}/${encodeURIComponent(preview.assetName)}`, {
        headers: { 'X-UEM-Token': getToken() },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Project icon preview could not be read.'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  },

  async ensurePlaceholderTexture(assetFolderName: string, allowImport = true): Promise<boolean> {
    const key = assetFolderName.trim();
    const existing = placeholderReady.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const scan = await FileService.scanProject(key);
      if (scan.success && scan.iconPreviews?.some(preview => preview.assetName === PLACEHOLDER_ICON_ASSET_NAME)) return true;
      if (!allowImport) return false;
      let job = await FileService.importTexture(key, PLACEHOLDER_ICON_ASSET_NAME, dataUrlToFile(PLACEHOLDER_ICON_DATA_URL, `${PLACEHOLDER_ICON_ASSET_NAME}.png`));
      if (!job.success || !job.jobId) return false;
      const jobId = job.jobId;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (job.status === 'completed') return true;
        if (job.status === 'failed') return false;
        await wait(500);
        job = await FileService.getTextureImport(jobId);
        if (!job.success && job.status !== 'failed') return false;
      }
      return job.status === 'completed';
    })();
    placeholderReady.set(key, promise);
    const ready = await promise;
    if (!ready) placeholderReady.delete(key);
    return ready;
  },

  async triggerVerseCompilation(fileName: string, expectedHash: string): Promise<CompileResult> {
    try {
      return await apiFetch('/verse/compile', { method: 'POST', body: JSON.stringify({ fileName, expectedHash }) });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not reach compilation service.' };
    }
  },

  downloadVerseFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  exportPresetJson(data: { config: ProjectConfig; entitlements: EntitlementItem[]; bundles: BundleOffer[]; storefrontMembership?: import('../types/entitlement').StorefrontMembership; retiredVerseKeys?: string[] }) {
    const clean = cleanManagedData(data.entitlements, data.bundles, data.storefrontMembership ?? { allOffers: [], focused: [] }, data.retiredVerseKeys ?? []);
    const portableConfig = { ...data.config, contentFolderPath: '' };
    const blob = new Blob([JSON.stringify({ ...clean, config: portableConfig }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uefn_entitlements_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
