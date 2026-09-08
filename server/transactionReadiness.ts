import crypto from 'node:crypto';
import fs from 'node:fs';

export type ManagedDeviceStatus = 'placed' | 'missing-device' | 'ambiguous' | 'not-verifiable' | 'not-checked';

export type ManagedDeviceReport = {
  status: ManagedDeviceStatus;
  devicePlaced: boolean;
  deviceCount?: number;
  devicePath?: string;
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
  managedDevice: ManagedDeviceReport | { status: 'not-reported'; devicePlaced: false; reason: string };
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
    && managedDevice.status === 'placed'
    && compile.status === 'passed';

  let remediation = 'Save the UTM catalog to generate managed_transactions.verse, then compile it in UEFN.';
  if (!generatedSource.present) remediation = 'Save the UTM catalog to generate managed_transactions.verse, then compile it in UEFN.';
  else if (!generatedSource.classPresent) remediation = 'Regenerate the managed transaction source so the generated managed_transactions_device class is present, then compile it in UEFN.';
  else if (!generatedSource.current) remediation = 'Save the current UTM catalog so the generated managed transaction source is current, then compile it in UEFN.';
  else if (!options.managedDevice) remediation = 'Keep the linked UEFN project open until the editor connector reports the managed transactions device state.';
  else if (managedDevice.status === 'missing-device') remediation = 'No managed transactions device is placed in the active level. Place an instance of the generated managed_transactions_device before testing transactions.';
  else if (managedDevice.status === 'ambiguous') remediation = 'Multiple managed transactions device instances were found in the active level. Verify which single instance your project uses.';
  else if (managedDevice.status === 'not-verifiable') remediation = 'UTM cannot verify managed transactions device placement through the available editor API. Keep UEFN open and update the editor connector before treating the runtime as ready.';
  else if (managedDevice.status === 'not-checked') remediation = 'Keep the linked UEFN project open while UTM checks for the managed transactions device.';
  else if (compile.status === 'failed') remediation = 'Resolve the authoritative UEFN Verse compile errors, then compile the current generated file again.';
  else if (compile.status !== 'passed') remediation = 'Run the authoritative UEFN Verse compile for the current generated file.';

  const status = utmRuntimeReady
    ? 'ready'
    : managedDevice.status !== 'not-reported'
      ? managedDevice.status
      : 'not-reported';
  return {
    status,
    utmRuntimeReady,
    generatedSource,
    managedDevice,
    compile,
    remediation,
    guidance: managedDevice.status === 'placed'
      ? 'Managed transactions runtime device detected. Ensure any project purchase callers reference this device where required.'
      : 'UTM validates the managed runtime device only; project-specific purchase caller wiring remains the creator\'s responsibility.',
  };
}
