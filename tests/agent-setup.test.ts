import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentSkillTargetPath, inspectAgentSkill, installAgentSkill } from '../server/agentSetup';

const skillRoot = path.resolve(import.meta.dirname, '..', 'skills', 'uefn-transaction-manager');

test('guided Agent Skill installation is scoped, repeatable, and reports stale state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'utm-agent-home-'));
  try {
    const target = agentSkillTargetPath('codex', home);
    const first = installAgentSkill(skillRoot, 'codex', home);
    assert.equal(first.success, true);
    assert.equal(first.changed, true);
    assert.equal(first.upToDate, true);
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, 'references', 'existing-project-adoption.md')));
    assert.match(fs.readFileSync(path.join(target, '.utm-install.json'), 'utf8'), /uefn-transaction-manager/);

    const second = installAgentSkill(skillRoot, 'codex', home);
    assert.equal(second.success, true);
    assert.equal(second.changed, false);

    fs.appendFileSync(path.join(target, 'SKILL.md'), '\nlocal test drift\n');
    const updateAvailable = inspectAgentSkill(skillRoot, 'codex', home);
    assert.equal(updateAvailable.installed, true);
    assert.equal(updateAvailable.managed, true);
    assert.equal(updateAvailable.upToDate, false);

    fs.rmSync(path.join(target, 'SKILL.md'));
    const missingSkillFile = inspectAgentSkill(skillRoot, 'codex', home);
    assert.equal(missingSkillFile.installed, false);
    assert.equal(missingSkillFile.managed, true);
    assert.equal(missingSkillFile.upToDate, false);

    fs.rmSync(target, { recursive: true, force: true });
    const disappearedPath = inspectAgentSkill(skillRoot, 'codex', home);
    assert.equal(disappearedPath.installed, false);
    assert.equal(disappearedPath.managed, false);
    assert.equal(disappearedPath.upToDate, false);

    const unavailableSource = inspectAgentSkill(path.join(home, 'missing-skill-source'), 'codex', home);
    assert.equal(unavailableSource.installed, false);
    assert.equal(unavailableSource.upToDate, false);
    assert.match(unavailableSource.error ?? '', /packaged UTM Agent Skill is unavailable/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guided Agent Skill installation never overwrites an unrelated skill folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'utm-agent-conflict-'));
  try {
    const target = agentSkillTargetPath('cursor', home);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'unrelated skill');
    assert.throws(() => installAgentSkill(skillRoot, 'cursor', home), /does not own/);
    assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'unrelated skill');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
