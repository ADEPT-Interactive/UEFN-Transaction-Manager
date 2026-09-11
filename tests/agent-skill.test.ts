import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const skillRoot = path.join(root, 'skills', 'uefn-transaction-manager');
const read = (relative: string) => fs.readFileSync(path.join(skillRoot, relative), 'utf8');

test('Agent Skill is discoverable, reference-driven, and does not hardcode generated symbols', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /^name: uefn-transaction-manager/m);
  assert.match(skill, /get_project_context/);
  assert.match(skill, /expectedRevision/);
  assert.match(skill, /describe_integration_contract/);
  assert.match(skill, /apply_catalog_patch/);
  assert.match(skill, /loopback/);
  assert.match(skill, /Do not .*browser/);
  assert.match(skill, /Existing-project migration/);
  assert.match(skill, /CATALOG_REVISION_CONFLICT/);
  assert.match(skill, /manual UEFN wiring/);
  assert.match(skill, /capability availability is not project readiness/i);
  assert.match(skill, /project browser/i);
  assert.match(skill, /DISCOVER -> PREFLIGHT -> USER BLOCKER\/APPROVAL IF NEEDED -> ACTIVITY TRANSITION -> MUTATE -> VERIFY -> COMPLETE/);
  assert.match(skill, /preflight_operation/);
  assert.match(skill, /preflightToken/);
  assert.match(skill, /catalog-only-migration/);
  assert.match(skill, /never (silently )?(downgrade|allowed to fall back)/i);
  assert.match(skill, /heartbeat/i);
  assert.match(skill, /exactly once/i);
  assert.doesNotMatch(skill, /Open[A-Z][A-Za-z]+Purchase\(Player/);
  for (const file of ['new-project-workflow.md', 'existing-project-adoption.md', 'transaction-semantics.md', 'dynamic-transactions.md', 'asset-adoption.md', 'verification.md', 'tool-discovery.md', 'agent-setup.md']) {
    assert.ok(fs.existsSync(path.join(skillRoot, 'references', file)), file);
  }
});

test('agent setup UI exposes migration discovery, distinct readiness states, and a safe advanced label', () => {
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const panelSource = fs.readFileSync(path.join(root, 'src', 'components', 'AgentIntegrationPanel.tsx'), 'utf8');
  const headerSource = fs.readFileSync(path.join(root, 'src', 'components', 'Header.tsx'), 'utf8');
  const serverSource = fs.readFileSync(path.join(root, 'server', 'index.ts'), 'utf8');
  assert.match(appSource, /transactions in this project/);
  assert.match(appSource, /openAgentIntegration\('migrate'\)/);
  assert.match(headerSource, /agentIntegrationStatus/);
  assert.match(headerSource, /Agent is inspecting UTM/);
  assert.match(headerSource, /Agent is modifying your UTM catalog/);
  assert.match(headerSource, /data-agent-activity/);
  assert.match(headerSource, /Agent/);
  assert.match(panelSource, /Set up your coding agent/);
  assert.match(panelSource, /Connection readiness/);
  assert.match(panelSource, /Ready in this session/);
  assert.match(panelSource, /UTM MCP endpoint/);
  assert.match(panelSource, /local port only/);
  assert.match(panelSource, /Open skill location/);
  assert.match(panelSource, /data-app-chrome-aware/);
  assert.match(panelSource, /max-h-full/);
  assert.match(panelSource, /heartbeat required/);
  assert.match(panelSource, /style=\{\{ top:/);
  assert.match(panelSource, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(panelSource, /action=\{hasVerifiedSkillLocation/);
  assert.doesNotMatch(panelSource, /Installed skill location/);
  assert.match(serverSource, /loopback-url/);
  assert.match(serverSource, /clientConnection/);
  assert.match(serverSource, /agent-integration\/setup/);
});

test('release packaging includes the skill without changing public README scope', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/build-release.ps1'), 'utf8');
  const verify = fs.readFileSync(path.join(root, 'scripts/verify-release.ps1'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(build, /resources\\agent-skills\\uefn-transaction-manager/);
  assert.match(verify, /resources\\agent-skills\\uefn-transaction-manager\\SKILL.md/);
  assert.match(readme, /Version 4\.3\.0/);
  assert.match(readme, /utm-mcp|Agent Integration/);
});
