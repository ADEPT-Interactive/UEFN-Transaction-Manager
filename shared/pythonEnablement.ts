import fs from 'node:fs';
import path from 'node:path';

/**
 * enabled: the project allows Python and no local opt-out was found.
 * project-disabled: Project menu → Project Settings → Beta Access → Python Editor Scripting is off.
 * local-disabled: the project allows Python, but UEFN's per-user preference for this project is explicitly off.
 */
export type PythonEnablementState = 'enabled' | 'project-disabled' | 'local-disabled';

/** UEFN's project flag and its separate per-user Python preference. */
export function projectPythonEnablementState(projectFile: string | undefined, fallback: boolean, localAppData = process.env.LOCALAPPDATA): PythonEnablementState {
  const fallbackState: PythonEnablementState = fallback ? 'enabled' : 'project-disabled';
  if (!projectFile) return fallbackState;
  try {
    const descriptor = JSON.parse(fs.readFileSync(projectFile, 'utf8').replace(/^﻿/, ''));
    const configured = descriptor.dataSets?.experimental?.pythonExperimental?.bEnablePythonForProject
      ?? descriptor.bEnablePythonForProject;
    if (configured !== true) return 'project-disabled';
    const projectId = descriptor.bindings?.projectId;
    if (typeof projectId !== 'string' || !localAppData) return 'enabled';
    const settings = path.join(localAppData, 'UnrealEditorFortnite', 'Saved', 'Config', 'WindowsEditor', 'EditorPerProjectUserSettings.ini');
    let ini: string;
    try { ini = fs.readFileSync(settings, 'utf8'); } catch { return 'enabled'; }
    const key = projectId.replaceAll('-', '').toLowerCase();
    for (const line of ini.split(/\r?\n/)) {
      if (!/^\s*EnablePythonLocallyPerProject\s*=/.test(line)) continue;
      for (const match of line.matchAll(/\(([0-9a-f-]+)\s*,\s*(True|False)\s*\)/gi)) {
        if (match[1].replaceAll('-', '').toLowerCase() === key) return match[2].toLowerCase() === 'true' ? 'enabled' : 'local-disabled';
      }
    }
    // An absent preference is not runtime proof; the authenticated handshake
    // remains required. An explicit local opt-out always blocks attachment.
    return 'enabled';
  } catch { return fallbackState; }
}

export function projectPythonIsEnabled(projectFile: string | undefined, fallback: boolean, localAppData = process.env.LOCALAPPDATA): boolean {
  return projectPythonEnablementState(projectFile, fallback, localAppData) === 'enabled';
}
