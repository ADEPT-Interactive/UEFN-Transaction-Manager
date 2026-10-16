import fs from 'node:fs';
import path from 'node:path';

/** UEFN's project flag and its separate per-user Tools > Enable Python switch. */
export function projectPythonIsEnabled(projectFile: string | undefined, fallback: boolean, localAppData = process.env.LOCALAPPDATA): boolean {
  if (!projectFile) return fallback;
  try {
    const descriptor = JSON.parse(fs.readFileSync(projectFile, 'utf8').replace(/^\uFEFF/, ''));
    const configured = descriptor.dataSets?.experimental?.pythonExperimental?.bEnablePythonForProject
      ?? descriptor.bEnablePythonForProject;
    if (configured !== true) return false;
    const projectId = descriptor.bindings?.projectId;
    if (typeof projectId !== 'string' || !localAppData) return true;
    const settings = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Config', 'WindowsEditor', 'EditorPerProjectUserSettings.ini');
    let ini: string;
    try { ini = fs.readFileSync(settings, 'utf8'); } catch { return true; }
    const key = projectId.replaceAll('-', '').toLowerCase();
    for (const line of ini.split(/\r?\n/)) {
      if (!/^\s*EnablePythonLocallyPerProject\s*=/.test(line)) continue;
      for (const match of line.matchAll(/\(([0-9a-f-]+)\s*,\s*(True|False)\s*\)/gi)) {
        if (match[1].replaceAll('-', '').toLowerCase() === key) return match[2].toLowerCase() === 'true';
      }
    }
    // An absent preference is not runtime proof; the authenticated handshake
    // remains required. An explicit local opt-out always blocks attachment.
    return true;
  } catch { return fallback; }
}
