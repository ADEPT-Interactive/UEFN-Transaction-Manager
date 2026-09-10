export const ERR_ABORTED_CODE = -3;

export interface ExpectedNavigation {
  generation: number;
  targetUrl: string;
}

function isAbortedText(value: unknown): boolean {
  return typeof value === 'string' && (/ERR_ABORTED/i.test(value) || /\(-3\)/.test(value));
}

export function isNavigationAbortError(error: unknown): boolean {
  if (isAbortedText(error)) return true;
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return code === ERR_ABORTED_CODE || code === 'ERR_ABORTED' || isAbortedText(error.message) || isAbortedText(error.name);
  }
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
    return candidate.code === ERR_ABORTED_CODE || candidate.code === 'ERR_ABORTED' || isAbortedText(candidate.message) || isAbortedText(candidate.name);
  }
  return false;
}

export function isExpectedNavigationAbort(input: {
  expected?: ExpectedNavigation | null;
  code?: number;
  error?: unknown;
  url?: string;
}): boolean {
  if (!input.expected) return false;
  if (input.code !== undefined && input.code !== ERR_ABORTED_CODE) return false;
  if (input.code === undefined && !isNavigationAbortError(input.error)) return false;
  return !input.url || input.url === input.expected.targetUrl;
}

/** Shared in-flight promise used by main-process lifecycle actions. */
export class SerializedAsyncOperation {
  private current: Promise<void> | null = null;

  run(task: () => Promise<void>): Promise<void> {
    if (this.current) return this.current;
    const operation = Promise.resolve().then(task);
    const settled = operation.finally(() => {
      if (this.current === settled) this.current = null;
    });
    this.current = settled;
    return settled;
  }

  get inFlight(): boolean {
    return this.current !== null;
  }
}
