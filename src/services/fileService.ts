import { ProjectConfig, EntitlementItem, BundleOffer } from '../types/entitlement';

const API_BASE = '/api';

export interface ScanResult {
  success: boolean;
  folderPath?: string;
  verseFiles?: string[];
  subDirs?: string[];
  hasInIslandTransactions?: boolean;
  error?: string;
}

export interface SaveResult {
  success: boolean;
  filePath?: string;
  message?: string;
  error?: string;
}

export interface UploadTextureResult {
  success: boolean;
  filePath?: string;
  verseAssetPath?: string;
  error?: string;
}

export interface CompileResult {
  success: boolean;
  connected?: boolean;
  message?: string;
  rawResponse?: string;
  error?: string;
}

export const FileService = {
  // Check if backend bridge is reachable
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Scan a directory
  async scanProject(folderPath: string): Promise<ScanResult> {
    try {
      const res = await fetch(`${API_BASE}/project/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to connect to backend server' };
    }
  },

  // Load Verse file content
  async loadVerseFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/verse/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to load file from disk' };
    }
  },

  // Save Verse file content
  async saveVerseFile(filePath: string, content: string, createBackup = true): Promise<SaveResult> {
    try {
      const res = await fetch(`${API_BASE}/verse/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, content, createBackup }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to save file to disk' };
    }
  },

  // Upload image to project asset folder
  async uploadTexture(
    contentFolderPath: string,
    assetFolderName: string,
    assetName: string,
    file: File
  ): Promise<UploadTextureResult> {
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('contentFolderPath', contentFolderPath);
      formData.append('assetFolderName', assetFolderName);
      formData.append('assetName', assetName);

      const res = await fetch(`${API_BASE}/texture/upload`, {
        method: 'POST',
        body: formData,
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to upload texture' };
    }
  },

  // Trigger Verse compilation via Verse Workflow Server
  async triggerVerseCompilation(): Promise<CompileResult> {
    try {
      const res = await fetch(`${API_BASE}/verse/compile`, {
        method: 'POST',
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not reach compilation server' };
    }
  },

  // Browser-based direct file download (fallback when offline or standalone web)
  downloadVerseFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // Export project preset to JSON
  exportPresetJson(data: {
    config: ProjectConfig;
    entitlements: EntitlementItem[];
    bundles: BundleOffer[];
  }) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uefn_entitlements_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
};
