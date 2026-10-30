export type PythonState = 'enabled' | 'project-disabled' | 'local-disabled';

/** The one place UEFN exposes the project switch: Project menu → Project Settings → Beta Access. */
export const PYTHON_SETUP_STEPS = 'In UEFN, open the Project menu (palm tree icon) → Project Settings, then under Beta Access turn on Python Editor Scripting.';

export function pythonSetupMessage(pythonState?: PythonState): string {
  if (pythonState === 'local-disabled') {
    return 'Python Editor Scripting is on for this project, but UEFN has Python turned off for your user on this PC. Turn on Tools → Enable Python in UEFN; UTM connects automatically.';
  }
  return `${PYTHON_SETUP_STEPS} UTM connects automatically; no restart is needed.`;
}
