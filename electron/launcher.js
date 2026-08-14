const state = { projects: [], selectedId: null, status: 'Finding active and recent UEFN projects…', busy: false };
const byId = id => document.getElementById(id);

function render() {
  byId('status').textContent = state.status;
  const query = byId('search').value.trim().toLowerCase();
  const list = byId('projects');
  list.replaceChildren();
  const matches = state.projects.filter(project => !query || project.name.toLowerCase().includes(query) || project.projectFile.toLowerCase().includes(query));
  for (const project of matches) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `project${project.id === state.selectedId ? ' selected' : ''}`;
    item.setAttribute('aria-pressed', String(project.id === state.selectedId));
    item.disabled = state.busy;
    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = project.name;
    const projectPath = document.createElement('div');
    projectPath.className = 'project-path';
    projectPath.textContent = project.projectFile;
    const metadata = document.createElement('div');
    metadata.className = 'project-meta';
    metadata.textContent = `${project.sourceLabel} · ${project.pythonEnabled ? 'Python enabled' : 'Native imports need Python'}`;
    item.append(name, projectPath, metadata);
    item.addEventListener('click', async () => applyState(await window.uemDesktop.launcher.select(project.id)));
    list.append(item);
  }
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = query ? 'No projects match your search.' : 'No projects are available yet.';
    list.append(empty);
  }
  const selected = state.projects.find(project => project.id === state.selectedId);
  byId('continue').disabled = !selected || state.busy;
  byId('browse').disabled = state.busy;
  byId('selected-name').textContent = selected ? (selected.isActive ? `${selected.name} — active in UEFN` : selected.name) : 'Select a project to continue';
  byId('selected-path').textContent = selected?.projectFile ?? 'Choose an active, recent, discovered, or browsed UEFN project.';
  byId('python').textContent = selected ? (selected.pythonEnabled ? 'Python Editor Scripting is enabled. UEM will install and attach native texture importing automatically.' : 'Python Editor Scripting is disabled. UEM can still manage Verse; enable it for native texture importing.') : '';
  byId('continue').textContent = state.busy ? 'Opening project…' : 'Open project in UEM';
}

function applyState(next) {
  if (!next || !Array.isArray(next.projects)) return;
  Object.assign(state, next);
  render();
}

byId('search').addEventListener('input', render);
byId('browse').addEventListener('click', async () => applyState(await window.uemDesktop.launcher.browse()));
byId('continue').addEventListener('click', async () => {
  if (!state.selectedId || state.busy) return;
  const result = await window.uemDesktop.launcher.confirm(state.selectedId);
  if (!result.success) applyState(await window.uemDesktop.launcher.getState());
});
byId('adept').addEventListener('click', event => { event.preventDefault(); void window.uemDesktop.openExternal(event.currentTarget.href); });
byId('minimize').addEventListener('click', () => window.uemDesktop.window.action('minimize'));
byId('maximize').addEventListener('click', () => window.uemDesktop.window.action('toggle-maximize'));
byId('close').addEventListener('click', () => window.uemDesktop.window.action('close'));
window.uemDesktop.window.onState(windowState => { byId('maximize').textContent = windowState === 'maximized' ? '❐' : '□'; });
window.uemDesktop.launcher.onState(applyState);
window.uemDesktop.window.action('request-state');
void window.uemDesktop.launcher.getState().then(applyState);
