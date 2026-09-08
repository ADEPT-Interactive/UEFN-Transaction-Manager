import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { summarizeManagedRuntimeSetup } from '../server/transactionReadiness';

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function withGeneratedSource(callback: (filePath: string, hash: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uem-transaction-readiness-'));
  try {
    const source = 'using { /Fortnite.com/Devices }\nmanaged_transactions_device := class(creative_device):\n';
    const filePath = path.join(root, 'managed_transactions.verse');
    fs.writeFileSync(filePath, source);
    callback(filePath, contentHash(source));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('generated current source, managed class, one placed device, and matching compile prove UTM runtime readiness', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: { status: 'placed', devicePlaced: true, deviceCount: 1, devicePath: '/Project/ManagedDevice', reason: 'managed-transactions-device-placed' },
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.generatedSource.present, true);
    assert.equal(setup.generatedSource.classPresent, true);
    assert.equal(setup.generatedSource.current, true);
    assert.equal(setup.managedDevice.status, 'placed');
    assert.equal(setup.compile.status, 'passed');
    assert.equal(setup.utmRuntimeReady, true);
    assert.doesNotMatch(setup.guidance, /in_island_transactions|Transactions editable|TaB|VDevice_InIslandTransactions/i);
  });
});

test('compile evidence becomes stale when generated source is no longer current', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: '0'.repeat(64),
      managedDevice: { status: 'placed', devicePlaced: true, deviceCount: 1, reason: 'managed-transactions-device-placed' },
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.generatedSource.current, false);
    assert.equal(setup.compile.status, 'passed');
    assert.equal(setup.utmRuntimeReady, false);
    assert.match(setup.remediation, /current UTM catalog/i);
  });
});

test('missing managed device remains a generic readiness failure', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: { status: 'missing-device', devicePlaced: false, deviceCount: 0, reason: 'managed-transactions-device-not-placed-in-current-level' },
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.utmRuntimeReady, false);
    assert.equal(setup.managedDevice.status, 'missing-device');
    assert.match(setup.remediation, /No managed transactions device is placed in the active level/i);
    assert.doesNotMatch(setup.remediation, /in_island_transactions|Transactions editable|TaB|VDevice_InIslandTransactions/i);
  });
});
