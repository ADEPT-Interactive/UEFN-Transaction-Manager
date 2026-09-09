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

const readyDevice = {
  status: 'ready' as const,
  devicePlaced: true,
  callerFound: true,
  transactionsAssigned: true,
  deviceCount: 1,
  devicePath: '/Project/ManagedDevice',
  linkedDevicePath: '/Project/ManagedDevice.managed_transactions_device_0',
  reason: 'managed-device-placed-and-linked',
};

test('generated current source, one placed device, linked Transactions, and matching compile prove operational readiness', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: readyDevice,
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.generatedSource.current, true);
    assert.equal(setup.managedDevice.status, 'ready');
    assert.equal(setup.compile.status, 'passed');
    assert.equal(setup.utmRuntimeReady, true);
    assert.equal(setup.status, 'ready');
  });
});

test('missing device blocks operational readiness with a placement remediation', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: {
        status: 'missing-device', devicePlaced: false, callerFound: false, transactionsAssigned: false,
        deviceCount: 0, reason: 'managed-transactions-device-not-placed-in-current-level',
      },
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.utmRuntimeReady, false);
    assert.equal(setup.status, 'missing-device');
    assert.match(setup.remediation, /Place the generated managed_transactions_device/i);
  });
});

test('missing Transactions wiring blocks operational readiness with a linking remediation', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: {
        status: 'missing-wiring', devicePlaced: true, callerFound: true, transactionsAssigned: false,
        deviceCount: 1, reason: 'in-island-transactions-device-reference-is-not-linked-to-managed-device',
      },
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });

    assert.equal(setup.utmRuntimeReady, false);
    assert.equal(setup.status, 'missing-wiring');
    assert.match(setup.remediation, /Transactions editable/i);
  });
});

test('nested Verse reference paths are represented as a ready device report', () => {
  withGeneratedSource((filePath, hash) => {
    const setup = summarizeManagedRuntimeSetup({
      filePath,
      deviceClassName: 'managed_transactions_device',
      savedFileHash: hash,
      managedDevice: readyDevice,
      compileEvidence: { success: true, contentHash: hash, reportedAt: 1 },
    });
    assert.equal(setup.managedDevice.linkedDevicePath, '/Project/ManagedDevice.managed_transactions_device_0');
    assert.equal(setup.utmRuntimeReady, true);
  });
});
