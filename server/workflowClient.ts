import net from 'net';

export interface WorkflowCompileResult {
  success: boolean;
  connected: boolean;
  numErrors?: number;
  numWarnings?: number;
  messages?: unknown[];
  error?: string;
}

export interface WorkflowEndpoint {
  host: string;
  port: number;
}

export function resolveWorkflowEndpoint(environment: NodeJS.ProcessEnv = process.env): WorkflowEndpoint {
  const host = (environment.UEM_VERSE_WORKFLOW_HOST || '127.0.0.1').trim();
  const port = Number(environment.UEM_VERSE_WORKFLOW_PORT || 1962);
  if (!host) throw new Error('UEM_VERSE_WORKFLOW_HOST must not be empty.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('UEM_VERSE_WORKFLOW_PORT must be a valid TCP port.');
  }
  return { host, port };
}

function findNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'number') return record[key];
  for (const child of Object.values(record)) {
    const found = findNumber(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findMessages(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.messages)) return record.messages;
  for (const child of Object.values(record)) {
    const found = findMessages(child);
    if (found) return found;
  }
  return undefined;
}

export function compileVerseProject(timeoutMs = 15000, endpoint?: WorkflowEndpoint): Promise<WorkflowCompileResult> {
  let workflowEndpoint: WorkflowEndpoint;
  try {
    workflowEndpoint = endpoint ?? resolveWorkflowEndpoint();
  } catch (error) {
    return Promise.resolve({
      success: false,
      connected: false,
      error: error instanceof Error ? error.message : 'Verse Workflow Server endpoint is invalid.',
    });
  }

  return new Promise(resolve => {
    const client = new net.Socket();
    let buffer = Buffer.alloc(0);
    let finished = false;

    const finish = (result: WorkflowCompileResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      client.destroy();
      resolve(result);
    };

    const timeout = setTimeout(() => finish({
      success: false,
      connected: client.readyState === 'open',
      error: 'Verse Workflow Server timed out before returning a final compileProject response.',
    }), timeoutMs);

    client.connect(workflowEndpoint.port, workflowEndpoint.host, () => {
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
        if (!match) return finish({ success: false, connected: true, error: 'Workflow response omitted Content-Length.' });
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > 10 * 1024 * 1024) {
          return finish({ success: false, connected: true, error: 'Workflow response declared an invalid message length.' });
        }
        const messageEnd = headerEnd + 4 + length;
        if (buffer.length < messageEnd) return;
        const body = buffer.subarray(headerEnd + 4, messageEnd).toString('utf8');
        buffer = buffer.subarray(messageEnd);

        let response: Record<string, unknown>;
        try {
          response = JSON.parse(body) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (response.type === 2 && response.command === 'compileProject') {
          const numErrors = findNumber(response, 'numErrors');
          const numWarnings = findNumber(response, 'numWarnings');
          const messages = findMessages(response);
          if (numErrors === undefined) {
            return finish({ success: false, connected: true, numWarnings, messages, error: 'Final compile response did not include numErrors; success cannot be verified.' });
          }
          return finish({ success: numErrors === 0, connected: true, numErrors, numWarnings, messages, error: numErrors > 0 ? `Verse compilation failed with ${numErrors} error(s).` : undefined });
        }
      }
    });

    client.on('error', error => finish({
      success: false,
      connected: false,
      error: `Could not connect to the Verse Workflow Server at ${workflowEndpoint.host}:${workflowEndpoint.port}: ${error.message}`,
    }));
    client.on('close', () => {
      if (!finished) finish({ success: false, connected: true, error: 'Workflow Server closed before returning a final compile result.' });
    });
  });
}
