import fs from 'node:fs';
import path from 'node:path';

/** Per-launch log files written by this app and earlier releases. Nothing else in the folder is touched. */
const PER_LAUNCH_LOG_PATTERN = /^(?:electron-main|bridge-startup|desktop-shell)-\d+\.log$/i;
const ROTATED_LOG_NAMES = ['bridge.log'];

export interface LogRetentionOptions {
  now?: number;
  maxAgeMs?: number;
  maxRotatedLogBytes?: number;
  keep?: ReadonlySet<string>;
}

export interface LogRetentionResult {
  removed: number;
  rotated: string[];
}

/**
 * Every launch creates new log files, so without pruning the folder grows
 * forever. Remove per-launch logs older than maxAgeMs and rotate shared
 * append-only logs once they exceed maxRotatedLogBytes (one previous copy kept).
 */
export function pruneLogDirectory(logRoot: string, options: LogRetentionOptions = {}): LogRetentionResult {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 14 * 24 * 60 * 60 * 1000;
  const maxRotatedLogBytes = options.maxRotatedLogBytes ?? 5 * 1024 * 1024;
  const keep = new Set([...(options.keep ?? [])].map(file => path.resolve(file).toLowerCase()));
  const result: LogRetentionResult = { removed: 0, rotated: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(logRoot, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(logRoot, entry.name);
    try {
      if (PER_LAUNCH_LOG_PATTERN.test(entry.name)) {
        if (keep.has(path.resolve(filePath).toLowerCase())) continue;
        if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) {
          fs.rmSync(filePath, { force: true });
          result.removed += 1;
        }
      } else if (ROTATED_LOG_NAMES.includes(entry.name.toLowerCase()) && fs.statSync(filePath).size > maxRotatedLogBytes) {
        fs.renameSync(filePath, `${filePath}.1`);
        result.rotated.push(entry.name);
      }
    } catch {
      // A log that is in use or already gone is left for the next launch.
    }
  }
  return result;
}
