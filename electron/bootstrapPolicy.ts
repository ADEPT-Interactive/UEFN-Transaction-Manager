import path from 'node:path';

export type BootstrapProjectIdentity = { projectFile: string; processId: number };

export type BootstrapDecision =
  | { kind: 'connected' | 'waiting'; reason: string; identity?: string; identityChanged?: boolean; identityCleared?: boolean }
  | { kind: 'attempt'; reason: string; identity: string; attemptNumber: number; maxAttempts: number; nextRetryAt: number; identityChanged?: boolean; identityCleared?: boolean }
  | { kind: 'exhausted'; reason: string; identity: string; attemptNumber: number; maxAttempts: number; identityChanged?: boolean; identityCleared?: boolean };

export class BootstrapPolicy {
  readonly maxAttempts = 3;
  private readonly retryDelays = [0, 2_000, 5_000];
  private readonly projectGracePeriodMs = 4_000;
  private identity: string | undefined;
  private attemptNumber = 0;
  private nextRetryAt = 0;
  private graceUntil = 0;

  observe(input: { now: number; project?: BootstrapProjectIdentity; connectorAlive: boolean; editorConnected: boolean }): BootstrapDecision {
    if (input.editorConnected) return { kind: 'connected', reason: 'editor-connected', ...(this.identity ? { identity: this.identity } : {}) };

    if (!input.project) {
      const identityCleared = Boolean(this.identity);
      this.identity = undefined;
      this.attemptNumber = 0;
      this.nextRetryAt = 0;
      this.graceUntil = 0;
      return { kind: 'waiting', reason: 'linked-project-not-open', ...(identityCleared ? { identityCleared: true } : {}) };
    }

    const nextIdentity = `${path.resolve(input.project.projectFile).toLowerCase()}#${input.project.processId}`;
    const identityChanged = this.identity !== nextIdentity;
    if (identityChanged) {
      this.identity = nextIdentity;
      this.attemptNumber = 0;
      this.nextRetryAt = 0;
      this.graceUntil = input.now + this.projectGracePeriodMs;
    }

    if (input.connectorAlive) return { kind: 'waiting', reason: 'connector-heartbeat-alive-awaiting-readiness', identity: nextIdentity, ...(identityChanged ? { identityChanged: true } : {}) };
    if (input.now < this.graceUntil) return { kind: 'waiting', reason: 'project-startup-grace', identity: nextIdentity, ...(identityChanged ? { identityChanged: true } : {}) };
    if (input.now < this.nextRetryAt) return { kind: 'waiting', reason: 'bootstrap-backoff', identity: nextIdentity };
    if (this.attemptNumber >= this.maxAttempts) return { kind: 'exhausted', reason: 'bounded-bootstrap-attempts-exhausted', identity: nextIdentity, attemptNumber: this.attemptNumber, maxAttempts: this.maxAttempts };

    this.attemptNumber += 1;
    const delay = this.retryDelays[this.attemptNumber] ?? this.retryDelays.at(-1)!;
    this.nextRetryAt = input.now + delay;
    return { kind: 'attempt', reason: 'connector-heartbeat-stale', identity: nextIdentity, attemptNumber: this.attemptNumber, maxAttempts: this.maxAttempts, nextRetryAt: this.nextRetryAt, ...(identityChanged ? { identityChanged: true } : {}) };
  }
}
