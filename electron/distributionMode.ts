import fs from 'node:fs';
import path from 'node:path';

export type DistributionMode = 'installed' | 'portable';

export interface PortableMarker {
  distribution: 'portable';
  version: string;
  schemaVersion: 1;
  managedFiles: string[];
}

export function portableMarkerPath(executablePath: string): string {
  return path.join(path.dirname(path.resolve(executablePath)), 'portable.json');
}

export function readPortableMarker(executablePath: string): PortableMarker | null {
  const markerPath = portableMarkerPath(executablePath);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Partial<PortableMarker>;
    if (value.distribution !== 'portable' || typeof value.version !== 'string' || value.schemaVersion !== 1 || !Array.isArray(value.managedFiles) || value.managedFiles.some(file => typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) return null;
    return { distribution: 'portable', version: value.version, schemaVersion: 1, managedFiles: [...value.managedFiles] };
  } catch {
    return null;
  }
}

export function detectDistributionMode(executablePath = process.execPath): DistributionMode {
  return readPortableMarker(executablePath) ? 'portable' : 'installed';
}
