import crypto from 'node:crypto';
import fs from 'node:fs';

export type ManagedDeviceStatus = 'ready' | 'missing-device' | 'missing-wiring' | 'ambiguous' | 'not-verifiable' | 'not-checked' | 'not-reported';

export type ManagedDeviceReport = {
  status: ManagedDeviceStatus;
  devicePlaced: boolean;
  callerFound: boolean;
  transactionsAssigned: boolean;
  deviceCount?: number;
  devicePath?: string;
  linkedDevicePath?: string;
  reason: string;
  reportedAt?: number;
};

export type CompileEvidence = {
  success: boolean;
  contentHash: string;
  reportedAt: number;
  error?: string;
};

export type GeneratedSourceStatus = {
  present: boolean;
  classPresent: boolean;
  current: boolean;
  contentHash: string | null;
};

export type ManagedRuntimeSetup = {
  status: string;
  utmRuntimeReady: boolean;
  generatedSource: GeneratedSourceStatus;
  managedDevice: ManagedDeviceReport;
  compile: Record<string, unknown>;
  remediation: string;
  guidance: string;
};

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function generatedTransactionSourceStatus(
  filePath: string,
  deviceClassName: string,
  savedFileHash: string | null,
): GeneratedSourceStatus {
  if (!fs.existsSync(filePath)) return { present: false, classPresent: false, current: false, contentHash: null };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const classPattern = new RegExp(`(?:^|\\r?\\n)\\s*${escapeRegex(deviceClassName)}\\s*:=\\s*class\\(creative_device\\)`);
    const contentHash = sha256(content);
    const classPresent = classPattern.test(content);
    return {
      present: true,
      classPresent,
      current: classPresent && typeof savedFileHash === 'string' && contentHash === savedFileHash,
      contentHash,
    };
  } catch {
    return { present: true, classPresent: false, current: false, contentHash: null };
  }
}

export function summarizeManagedRuntimeSetup(options: {
  filePath: string;
  deviceClassName: string;
  savedFileHash: string | null;
  managedDevice?: ManagedDeviceReport;
  compileEvidence?: CompileEvidence;
}): ManagedRuntimeSetup {
  const generatedSource = generatedTransactionSourceStatus(options.filePath, options.deviceClassName, options.savedFileHash);
  const managedDevice = options.managedDevice ?? {
    status: 'not-reported' as const,
    devicePlaced: false as const,
    callerFound: false as const,
    transactionsAssigned: false as const,
    reason: 'editor-connector-has-not-reported-managed-device-state',
  };
  const compile = options.compileEvidence
    ? {
        status: options.compileEvidence.contentHash === generatedSource.contentHash
          ? (options.compileEvidence.success ? 'passed' : 'failed')
          : 'stale',
        contentHash: options.compileEvidence.contentHash,
        reportedAt: options.compileEvidence.reportedAt,
        ...(options.compileEvidence.error ? { error: options.compileEvidence.error } : {}),
      }
    : { status: 'unknown' };
  const utmRuntimeReady = generatedSource.present
    && generatedSource.classPresent
    && generatedSource.current
    && managedDevice.status === 'ready'
    && compile.status === 'passed';

  let remediation = 'Save the UTM catalog to generate managed_transactions.verse, then compile it in UEFN.';
  if (!generatedSource.present) remediation = 'Save the UTM catalog to generate managed_transactions.verse, then compile it in UEFN.';
  else if (!generatedSource.classPresent) remediation = 'Regenerate the managed transaction source so the generated device class is present, then compile it in UEFN.';
  else if (!generatedSource.current) remediation = 'Save the current UTM catalog so the generated managed transaction source is current, then compile it in UEFN.';
  else if (managedDevice.status === 'not-reported') remediation = 'Keep the linked UEFN project open until the authenticated editor connector reports the managed transactions device and its Transactions wiring.';
  else if (managedDevice.status === 'missing-device') remediation = 'Place the generated managed_transactions_device in the current level, then save the level.';
  else if (managedDevice.status === 'missing-wiring') remediation = 'Assign the placed managed_transactions_device to the in_island_transactions Transactions editable, then save the level.';
  else if (managedDevice.status === 'ambiguous') remediation = 'Keep one generated managed_transactions_device instance in the current level and remove or relink duplicates.';
  else if (managedDevice.status === 'not-verifiable' || managedDevice.status === 'not-checked') remediation = 'UTM cannot yet prove the generated device placement and Transactions wiring through the authenticated editor connector. Resolve that status before treating the runtime as operational.';
  else if (compile.status === 'failed') remediation = 'Resolve the authoritative UEFN Verse compile errors, then compile the current generated file again.';
  else if (compile.status !== 'passed') remediation = 'Run the authoritative UEFN Verse compile for the current generated file.';

  const status = utmRuntimeReady
    ? 'ready'
    : !generatedSource.present
      ? 'not-reported'
      : !generatedSource.classPresent
        ? 'invalid-source'
        : !generatedSource.current
          ? 'stale-source'
          : managedDevice.status !== 'ready'
            ? managedDevice.status
          : compile.status;
  return {
    status,
    utmRuntimeReady,
    generatedSource,
    managedDevice,
    compile,
    remediation,
    guidance: 'UTM validates generated source, authoritative compile evidence, one placed managed device, and its Transactions reference. Project-specific purchase callers and gameplay remain the creator\'s responsibility.',
  };
}
