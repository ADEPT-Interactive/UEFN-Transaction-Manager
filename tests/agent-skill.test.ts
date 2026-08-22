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
  assert.match(skill, /manual UEFN wiring/);
  assert.doesNotMatch(skill, /Open[A-Z][A-Za-z]+Purchase\(Player/);
  for (const file of ['new-project-workflow.md', 'existing-project-adoption.md', 'transaction-semantics.md', 'dynamic-transactions.md', 'asset-adoption.md', 'verification.md', 'tool-discovery.md']) {
    assert.ok(fs.existsSync(path.join(skillRoot, 'references', file)), file);
  }
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
