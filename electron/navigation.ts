export const ERR_ABORTED_CODE = -3;

export interface ExpectedNavigation {
  generation: number;
  targetUrl: string;
}

export interface NavigationFailure {
  code?: number;
  description?: string;
  error?: unknown;
  url?: string;
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

export function isExpectedNavigationTarget(input: {
  expected?: ExpectedNavigation | null;
  url?: string;
}): boolean {
  return Boolean(input.expected && input.url === input.expected.targetUrl);
}

function failureMessage(failure: NavigationFailure): string {
  if (failure.error instanceof Error) return failure.error.message;
  if (failure.error !== undefined) return String(failure.error);
  return `navigation failed${failure.code === undefined ? '' : ` (${failure.code}${failure.description ? ` ${failure.description}` : ''})`}`;
}

/**
 * Owns one controlled navigation from request through renderer validation.
 * A matching browser failure is deferred, never accepted as success. The
 * caller must validate the destination before completing the transaction.
 */
export class NavigationTransaction {
  private destinationValidated = false;
  private deferredFailure: NavigationFailure | null = null;

  constructor(readonly expected: ExpectedNavigation) {}

  matches(url?: string): boolean {
    return isExpectedNavigationTarget({ expected: this.expected, url });
  }

  observeFailure(failure: NavigationFailure): boolean {
    if (!this.matches(failure.url)) return false;
    this.deferredFailure = failure;
    return true;
  }

  markDestinationValidated(url: string): boolean {
    if (!this.matches(url)) return false;
    this.destinationValidated = true;
    return true;
  }

  get isValidated(): boolean {
    return this.destinationValidated;
  }

  get lastFailure(): NavigationFailure | null {
    return this.deferredFailure;
  }

  failureAfterUnverifiedDestination(): Error {
    const failure = this.deferredFailure;
    const detail = failure ? failureMessage(failure) : 'the launcher renderer did not become usable';
    return new Error(`Expected navigation did not produce a usable launcher (generation=${this.expected.generation}, target=${this.expected.targetUrl}): ${detail}`);
  }
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
