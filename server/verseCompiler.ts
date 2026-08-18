import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';

const execFileAsync = promisify(execFile);

/** The port used by Epic's current Verse VS Code client. Compatibility evidence, not a production default. */
export const HISTORICAL_WORKFLOW_PORT = 1962;
const MAX_PROTOCOL_MESSAGE_BYTES = 10 * 1024 * 1024;
const UEFN_PROCESS_NAME = 'UnrealEditorFortnite-Win64-Shipping.exe';

export type CompilerStatus =
  | 'compiled'
  | 'uefn-not-running'
  | 'project-not-loaded'
  | 'compiler-not-initialized'
  | 'project-mismatch'
  | 'multiple-sessions-ambiguous'
  | 'compile-request-failed';

export interface WorkflowEndpoint { host: string; port: number; }

export interface VerseCompilerSession extends WorkflowEndpoint {
  processId?: number;
  projectFile?: string;
  source: 'override' | 'process-listener' | 'compatibility-port';
  transport: 'tcp-content-length-json';
  discoveredAt: string;
}

export interface VerseCompilerDiagnostic {
  severity?: 'error' | 'warning' | 'info' | 'log';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string | number;
}

export interface WorkflowCompileResult {
  success: boolean;
  connected: boolean;
  status?: CompilerStatus;
  numErrors?: number;
  numWarnings?: number;
  messages?: unknown[];
  diagnostics?: VerseCompilerDiagnostic[];
  session?: VerseCompilerSession;
  error?: string;
}

export interface UefnProcessInfo { processId: number; projectFile?: string; }
export interface LoopbackListener { host: string; port: number; processId: number; }

export interface CompilerDiscoverySystem {
  listUefnProcesses(): Promise<UefnProcessInfo[]>;
  listLoopbackListeners(): Promise<LoopbackListener[]>;
  readActiveProjectFile(): Promise<string | undefined>;
}

export interface CompilerDiscoveryOptions {
  projectFile?: string;
  preferredProcessId?: number;
  environment?: NodeJS.ProcessEnv;
  system?: CompilerDiscoverySystem;
  now?: () => Date;
}

export interface CompilerDiscoveryResult {
  status: Exclude<CompilerStatus, 'compiled' | 'compile-request-failed'>;
  sessions: VerseCompilerSession[];
  activeProjectFile?: string;
  processes: UefnProcessInfo[];
  error?: string;
}

export interface CompileVerseOptions extends CompilerDiscoveryOptions {
  timeoutMs?: number;
  endpoint?: WorkflowEndpoint;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\[|\]/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
}

function parsePort(value: string | undefined, variableName: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${variableName} must be a valid TCP port.`);
  return port;
}

function parseEndpoint(value: string, sourceName: string): WorkflowEndpoint {
  const candidate = value.trim().replace(/^tcp:\/\//i, '');
  let host: string;
  let portText: string;
  if (candidate.startsWith('[')) {
    const close = candidate.indexOf(']');
    if (close < 0 || candidate[close + 1] !== ':') throw new Error(`${sourceName} must use host:port syntax.`);
    host = candidate.slice(1, close);
    portText = candidate.slice(close + 2);
  } else {
    const separator = candidate.lastIndexOf(':');
    if (separator <= 0) throw new Error(`${sourceName} must use host:port syntax.`);
    host = candidate.slice(0, separator);
    portText = candidate.slice(separator + 1);
  }
  if (!isLoopbackHost(host)) throw new Error(`${sourceName} must target local loopback.`);
  return { host, port: parsePort(portText, sourceName) };
}

/** Resolve only an explicit development/test override. Ordinary callers use discovery. */
export function resolveWorkflowEndpoint(environment: NodeJS.ProcessEnv = process.env): WorkflowEndpoint {
  const explicit = environment.UEM_VERSE_COMPILER_ENDPOINT?.trim();
  if (explicit) return parseEndpoint(explicit, 'UEM_VERSE_COMPILER_ENDPOINT');
  const legacyHost = environment.UEM_VERSE_WORKFLOW_HOST;
  const legacyPort = environment.UEM_VERSE_WORKFLOW_PORT;
  if (legacyHost !== undefined || legacyPort !== undefined) {
    const host = (legacyHost ?? '127.0.0.1').trim();
    if (!host) throw new Error('UEM_VERSE_WORKFLOW_HOST must not be empty.');
    if (!isLoopbackHost(host)) throw new Error('UEM_VERSE_WORKFLOW_HOST must target local loopback.');
    return { host, port: parsePort(legacyPort, 'UEM_VERSE_WORKFLOW_PORT') };
  }
  throw new Error('No Verse compiler endpoint override is configured; automatic UEFN discovery is required.');
}

function normalizeProjectPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/');
  return normalized ? normalized.toLowerCase() : undefined;
}

export function projectPathsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeProjectPath(left);
  const normalizedRight = normalizeProjectPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function parseNetstatAddress(value: string): { host: string; port: number } | undefined {
  const candidate = value.trim();
  if (candidate.startsWith('[')) {
    const close = candidate.lastIndexOf(']');
    if (close < 0 || candidate[close + 1] !== ':') return undefined;
    const port = Number(candidate.slice(close + 2));
    return Number.isInteger(port) ? { host: candidate.slice(1, close), port } : undefined;
  }
  const separator = candidate.lastIndexOf(':');
  if (separator < 0) return undefined;
  const port = Number(candidate.slice(separator + 1));
  return Number.isInteger(port) ? { host: candidate.slice(0, separator), port } : undefined;
}

function extractProjectFile(commandLine: string | undefined): string | undefined {
  if (!commandLine) return undefined;
  return commandLine.match(/(?:^|[\s"])([A-Za-z]:[\\/][^\r\n"]+\.uefnproject)(?:["\s]|$)/i)?.[1];
}

async function listUefnProcesses(): Promise<UefnProcessInfo[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter \"Name = '${UEFN_PROCESS_NAME}'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const parsed = JSON.parse(stdout.trim() || '[]') as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      const processId = Number(record.ProcessId);
      return Number.isInteger(processId) && processId > 0 ? [{ processId, projectFile: extractProjectFile(typeof record.CommandLine === 'string' ? record.CommandLine : undefined) }] : [];
    });
  } catch {
    return [];
  }
}

async function listLoopbackListeners(): Promise<LoopbackListener[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return stdout.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!match) return [];
      const address = parseNetstatAddress(match[1]);
      const processId = Number(match[2]);
      if (!address || !isLoopbackHost(address.host) || !Number.isInteger(processId) || processId < 1) return [];
      return [{ ...address, processId }];
    });
  } catch {
    return [];
  }
}

async function readActiveProjectFile(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const logPath = `${localAppData}\\UnrealEditorFortnite\\Saved\\Logs\\UnrealEditorFortnite.log`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = '${logPath.replace(/'/g, "''")}'; if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw }`,
    ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const matches = [...stdout.matchAll(/Successfully opened project ['"]([^'"\r\n]+\.uefnproject)['"]/gi)];
    return matches.at(-1)?.[1];
  } catch {
    return undefined;
  }
}

const defaultDiscoverySystem: CompilerDiscoverySystem = { listUefnProcesses, listLoopbackListeners, readActiveProjectFile };

function sortListeners(listeners: LoopbackListener[]): LoopbackListener[] {
  return [...listeners].sort((left, right) => {
    const leftPriority = left.port === HISTORICAL_WORKFLOW_PORT ? 0 : 1;
    const rightPriority = right.port === HISTORICAL_WORKFLOW_PORT ? 0 : 1;
    return leftPriority - rightPriority || left.port - right.port || left.processId - right.processId;
  });
}

export async function discoverVerseCompiler(options: CompilerDiscoveryOptions = {}): Promise<CompilerDiscoveryResult> {
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  let override: WorkflowEndpoint | undefined;
  try {
    if (environment.UEM_VERSE_COMPILER_ENDPOINT?.trim() || environment.UEM_VERSE_WORKFLOW_HOST !== undefined || environment.UEM_VERSE_WORKFLOW_PORT !== undefined) override = resolveWorkflowEndpoint(environment);
  } catch (error) {
    return { status: 'compiler-not-initialized', sessions: [], processes: [], error: error instanceof Error ? error.message : 'Verse compiler endpoint override is invalid.' };
  }

  if (override) {
    const now = options.now ?? (() => new Date());
    return { status: 'compiler-not-initialized', sessions: [{ ...override, source: 'override', transport: 'tcp-content-length-json', projectFile: options.projectFile, discoveredAt: now().toISOString() }], processes: [] };
  }

  const system = options.system ?? defaultDiscoverySystem;
  const processes = await system.listUefnProcesses();
  const activeProjectFile = await system.readActiveProjectFile();
  const requestedProject = normalizeProjectPath(options.projectFile);
  const processProjectMatches = requestedProject ? processes.filter(item => projectPathsMatch(item.projectFile, requestedProject)) : [];
  if (requestedProject && activeProjectFile && !projectPathsMatch(requestedProject, activeProjectFile) && processProjectMatches.length === 0) return { status: 'project-mismatch', sessions: [], activeProjectFile, processes, error: `UEFN is currently associated with a different project (${activeProjectFile}).` };

  if (processes.length === 0) return { status: 'uefn-not-running', sessions: [], activeProjectFile, processes, error: 'UEFN is not running.' };
  if (requestedProject && !activeProjectFile && !processes.some(item => projectPathsMatch(item.projectFile, requestedProject))) return { status: 'project-not-loaded', sessions: [], activeProjectFile, processes, error: 'UEFN is running but no matching project has been identified.' };

  let selectedProcesses = processes;
  if (processProjectMatches.length > 0) selectedProcesses = processProjectMatches;
  else if (options.preferredProcessId) selectedProcesses = processes.filter(item => item.processId === options.preferredProcessId);
  if (selectedProcesses.length === 0) selectedProcesses = processes;
  if (selectedProcesses.length > 1) return { status: 'multiple-sessions-ambiguous', sessions: [], activeProjectFile, processes, error: 'Multiple UEFN processes are active and no authoritative project-to-process match was available.' };

  const selectedProcess = selectedProcesses[0];
  const listeners = sortListeners((await system.listLoopbackListeners()).filter(listener => listener.processId === selectedProcess.processId));
  const sessions = listeners.map(listener => ({ host: listener.host, port: listener.port, processId: listener.processId, projectFile: selectedProcess.projectFile ?? activeProjectFile, source: 'process-listener' as const, transport: 'tcp-content-length-json' as const, discoveredAt: now().toISOString() }));
  if (sessions.length > 0) return { status: 'compiler-not-initialized', sessions, activeProjectFile, processes };
  return {
    status: 'compiler-not-initialized',
    sessions: [{ host: '127.0.0.1', port: HISTORICAL_WORKFLOW_PORT, processId: selectedProcess.processId, projectFile: selectedProcess.projectFile ?? activeProjectFile, source: 'compatibility-port', transport: 'tcp-content-length-json', discoveredAt: now().toISOString() }],
    activeProjectFile,
    processes,
    error: 'UEFN is running but did not expose a discoverable loopback listener; the historical Workflow Server endpoint will be probed for compatibility.',
  };
}

function findNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'number') return record[key];
  for (const child of Object.values(record)) { const found = findNumber(child, key); if (found !== undefined) return found; }
  return undefined;
}

function findMessages(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.messages)) return record.messages;
  for (const child of Object.values(record)) { const found = findMessages(child); if (found) return found; }
  return undefined;
}

function normalizeDiagnostics(messages: unknown[] | undefined): VerseCompilerDiagnostic[] {
  if (!messages) return [];
  const entries: unknown[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') entries.push(record);
    Object.values(record).forEach(child => { if (child !== record.message) collect(child); });
  };
  messages.forEach(collect);
  return entries.flatMap(message => {
    if (typeof message === 'string') return [{ message }];
    if (!message || typeof message !== 'object') return [];
    const record = message as Record<string, unknown>;
    if (typeof record.message !== 'string') return [];
    const rawSeverity = String(record.severity ?? record.level ?? '').toLowerCase();
    const severity = rawSeverity.includes('error') ? 'error' : rawSeverity.includes('warn') ? 'warning' : rawSeverity.includes('info') ? 'info' : rawSeverity.includes('log') ? 'log' : undefined;
    const result: VerseCompilerDiagnostic = { message: record.message };
    if (severity) result.severity = severity;
    if (typeof record.file === 'string') result.file = record.file;
    else if (typeof record.path === 'string') result.file = record.path;
    if (typeof record.line === 'number') result.line = record.line;
    if (typeof record.column === 'number') result.column = record.column;
    if (typeof record.code === 'string' || typeof record.code === 'number') result.code = record.code;
    return [result];
  });
}

interface TransportResult extends WorkflowCompileResult { protocolFailure?: boolean; }

function requestCompile(session: VerseCompilerSession, timeoutMs: number): Promise<TransportResult> {
  return new Promise(resolve => {
    const client = new net.Socket();
    let buffer = Buffer.alloc(0);
    const notifications: unknown[] = [];
    let connected = false;
    let finished = false;
    const finish = (result: TransportResult) => { if (finished) return; finished = true; clearTimeout(timeout); client.destroy(); resolve({ ...result, session }); };
    const timeout = setTimeout(() => finish({ success: false, connected, status: 'compile-request-failed', error: 'Verse Workflow Server timed out before returning a final compileProject response.' }), timeoutMs);
    client.connect(session.port, session.host, () => {
      connected = true;
      const body = Buffer.from(JSON.stringify({ seq: 1, type: 1, command: 'compileProject', params: {} }), 'utf8');
      client.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
    });
    client.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
        if (!match) return finish({ success: false, connected: true, status: 'compile-request-failed', protocolFailure: true, error: 'Workflow response omitted Content-Length.' });
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PROTOCOL_MESSAGE_BYTES) return finish({ success: false, connected: true, status: 'compile-request-failed', protocolFailure: true, error: 'Workflow response declared an invalid message length.' });
        const messageEnd = headerEnd + 4 + length;
        if (buffer.length < messageEnd) return;
        const body = buffer.subarray(headerEnd + 4, messageEnd).toString('utf8');
        buffer = buffer.subarray(messageEnd);
        let response: Record<string, unknown>;
        try { response = JSON.parse(body) as Record<string, unknown>; } catch { return finish({ success: false, connected: true, status: 'compile-request-failed', protocolFailure: true, error: 'Workflow response contained invalid JSON.' }); }
        if (response.type !== 2 || response.command !== 'compileProject') { notifications.push(response); continue; }
        const numErrors = findNumber(response, 'numErrors');
        const numWarnings = findNumber(response, 'numWarnings');
        const messages = findMessages(response) ?? (notifications.length > 0 ? notifications : undefined);
        if (numErrors === undefined) return finish({ success: false, connected: true, status: 'compile-request-failed', protocolFailure: true, numWarnings, messages, diagnostics: normalizeDiagnostics(messages), error: 'Final compile response did not include numErrors; success cannot be verified.' });
        finish({ success: numErrors === 0, connected: true, status: 'compiled', numErrors, numWarnings, messages, diagnostics: normalizeDiagnostics(messages), error: numErrors > 0 ? `Verse compilation failed with ${numErrors} error(s).` : undefined });
        return;
      }
    });
    client.on('error', error => finish({ success: false, connected, status: 'compile-request-failed', error: `Could not connect to the Verse Workflow Server at ${session.host}:${session.port}: ${error.message}` }));
    client.on('close', () => { if (!finished) finish({ success: false, connected, status: 'compile-request-failed', error: 'Workflow Server closed before returning a final compile result.' }); });
  });
}

export async function compileVerseProject(timeoutOrOptions: number | CompileVerseOptions = {}, legacyEndpoint?: WorkflowEndpoint): Promise<WorkflowCompileResult> {
  const options: CompileVerseOptions = typeof timeoutOrOptions === 'number' ? { timeoutMs: timeoutOrOptions, endpoint: legacyEndpoint } : timeoutOrOptions;
  const timeoutMs = Math.max(250, options.timeoutMs ?? 15000);
  let explicitEndpoint: WorkflowEndpoint | undefined = options.endpoint;
  if (!explicitEndpoint) {
    try {
      if (options.environment?.UEM_VERSE_COMPILER_ENDPOINT?.trim() || options.environment?.UEM_VERSE_WORKFLOW_HOST !== undefined || options.environment?.UEM_VERSE_WORKFLOW_PORT !== undefined) explicitEndpoint = resolveWorkflowEndpoint(options.environment);
    } catch (error) { return { success: false, connected: false, status: 'compile-request-failed', error: error instanceof Error ? error.message : 'Verse compiler endpoint override is invalid.' }; }
  }
  let discovery: CompilerDiscoveryResult;
  if (explicitEndpoint) {
    const now = (options.now ?? (() => new Date()))();
    discovery = { status: 'compiler-not-initialized', sessions: [{ ...explicitEndpoint, projectFile: options.projectFile, source: 'override', transport: 'tcp-content-length-json', discoveredAt: now.toISOString() }], processes: [] };
  } else {
    discovery = await discoverVerseCompiler(options);
    if (discovery.sessions.length === 0) return { success: false, connected: false, status: discovery.status, error: discovery.error ?? `Verse compiler unavailable: ${discovery.status}.` };
  }
  let lastResult: WorkflowCompileResult | undefined;
  for (let attempt = 0; attempt < (explicitEndpoint ? 1 : 2); attempt += 1) {
    for (const session of discovery.sessions.slice(0, 8)) {
      const result = await requestCompile(session, timeoutMs);
      lastResult = result;
      if (result.status !== 'compile-request-failed') return result;
    }
    if (explicitEndpoint) break;
    const refreshed = await discoverVerseCompiler(options);
    if (refreshed.sessions.length === 0) return lastResult ?? { success: false, connected: false, status: refreshed.status, error: refreshed.error };
    discovery = refreshed;
  }
  return lastResult ?? { success: false, connected: false, status: 'compile-request-failed', error: 'No Verse compiler session could be contacted.' };
}
