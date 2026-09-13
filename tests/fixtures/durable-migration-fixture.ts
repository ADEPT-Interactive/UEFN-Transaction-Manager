export const DURABLE_STEMS = ['AccessPass', 'PowerPass'] as const;
export type DurableStem = typeof DURABLE_STEMS[number];

export interface SyntheticPlayer {
  id: string;
}

export interface DurableMirrorFlags {
  OwnsAccessPass: boolean;
  OwnsPowerPass: boolean;
}

export interface DurableDelta {
  player: SyntheticPlayer;
  quantity: number;
}

interface AsyncQueue<T> {
  next(): Promise<T>;
  push(value: T): void;
}

function createQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: Array<(value: T) => void> = [];
  return {
    next: () => {
      const value = values.shift();
      if (value !== undefined) return Promise.resolve(value);
      return new Promise(resolve => waiters.push(resolve));
    },
    push: value => {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else values.push(value);
    },
  };
}

type DurableOwnership = Record<DurableStem, boolean>;

function emptyOwnership(): DurableOwnership {
  return { AccessPass: false, PowerPass: false };
}

function flagFor(stem: DurableStem): keyof DurableMirrorFlags {
  return stem === 'AccessPass' ? 'OwnsAccessPass' : 'OwnsPowerPass';
}

/**
 * Sanitized stand-in for the generated device's public ownership/reconciliation
 * surface. It intentionally exposes one independent Granted and Removed stream
 * per durable stem so a fixture cannot accidentally conflate products.
 */
export class SyntheticDurableEntitlements {
  private readonly ownership = new Map<string, DurableOwnership>();
  private readonly granted = new Map<DurableStem, AsyncQueue<DurableDelta>>();
  private readonly removed = new Map<DurableStem, AsyncQueue<DurableDelta>>();
  reconciliationCalls = 0;
  grantedAwaitCalls: Record<DurableStem, number> = { AccessPass: 0, PowerPass: 0 };
  removedAwaitCalls: Record<DurableStem, number> = { AccessPass: 0, PowerPass: 0 };

  constructor(initial: Partial<Record<DurableStem, boolean>> = {}) {
    for (const stem of DURABLE_STEMS) {
      this.granted.set(stem, createQueue<DurableDelta>());
      this.removed.set(stem, createQueue<DurableDelta>());
    }
    this.defaultOwnership = { ...emptyOwnership(), ...initial };
  }

  private readonly defaultOwnership: DurableOwnership;

  private stateFor(player: SyntheticPlayer): DurableOwnership {
    const existing = this.ownership.get(player.id);
    if (existing) return existing;
    const created = { ...this.defaultOwnership };
    this.ownership.set(player.id, created);
    return created;
  }

  async reconcilePlayerEntitlements(player: SyntheticPlayer): Promise<DurableOwnership> {
    this.reconciliationCalls += 1;
    return { ...this.stateFor(player) };
  }

  async awaitGrantedEvent(stem: DurableStem): Promise<DurableDelta> {
    this.grantedAwaitCalls[stem] += 1;
    return this.granted.get(stem)!.next();
  }

  async awaitRemovedEvent(stem: DurableStem): Promise<DurableDelta> {
    this.removedAwaitCalls[stem] += 1;
    return this.removed.get(stem)!.next();
  }

  grant(player: SyntheticPlayer, stem: DurableStem, quantity = 1): void {
    this.stateFor(player)[stem] = true;
    this.granted.get(stem)!.push({ player, quantity });
  }

  remove(player: SyntheticPlayer, stem: DurableStem, quantity = 1): void {
    this.stateFor(player)[stem] = false;
    this.removed.get(stem)!.push({ player, quantity });
  }
}

/**
 * The failure class from the owner playtest: initialization copies ownership,
 * but no listener keeps the project-owned flag current afterward.
 */
export class ReconcileOnlyDurableMirror {
  readonly flags: DurableMirrorFlags = { OwnsAccessPass: false, OwnsPowerPass: false };
  playerAddedCalls = 0;

  constructor(private readonly source: SyntheticDurableEntitlements) {}

  async onPlayerAdded(player: SyntheticPlayer): Promise<void> {
    this.playerAddedCalls += 1;
    const ownership = await this.source.reconcilePlayerEntitlements(player);
    this.flags.OwnsAccessPass = ownership.AccessPass;
    this.flags.OwnsPowerPass = ownership.PowerPass;
  }
}

/**
 * A good migration adapter: reconciliation initializes both flags, then one
 * persistent event loop per generated durable stem keeps them current.
 */
export class PersistentDurableMirror {
  readonly flags: DurableMirrorFlags = { OwnsAccessPass: false, OwnsPowerPass: false };
  playerAddedCalls = 0;
  listenerStarts: Record<DurableStem, number> = { AccessPass: 0, PowerPass: 0 };

  constructor(private readonly source: SyntheticDurableEntitlements) {}

  async onPlayerAdded(player: SyntheticPlayer): Promise<void> {
    this.playerAddedCalls += 1;
    const ownership = await this.source.reconcilePlayerEntitlements(player);
    this.flags.OwnsAccessPass = ownership.AccessPass;
    this.flags.OwnsPowerPass = ownership.PowerPass;
    for (const stem of DURABLE_STEMS) this.startPersistentListeners(stem, player);
  }

  private startPersistentListeners(stem: DurableStem, player: SyntheticPlayer): void {
    this.listenerStarts[stem] += 1;
    void this.watchGranted(stem, player);
    void this.watchRemoved(stem, player);
  }

  private async watchGranted(stem: DurableStem, player: SyntheticPlayer): Promise<void> {
    while (true) {
      const delta = await this.source.awaitGrantedEvent(stem);
      if (delta.player.id === player.id && delta.quantity > 0) this.flags[flagFor(stem)] = true;
    }
  }

  private async watchRemoved(stem: DurableStem, player: SyntheticPlayer): Promise<void> {
    while (true) {
      const delta = await this.source.awaitRemovedEvent(stem);
      if (delta.player.id === player.id && delta.quantity > 0) this.flags[flagFor(stem)] = false;
    }
  }
}

export const durableMigrationFixture = {
  entitlements: [
    { stem: 'AccessPass', generatedGrantedEvent: 'AwaitAccessPassGrantedEvent', mirror: 'OwnsAccessPass' },
    { stem: 'PowerPass', generatedGrantedEvent: 'AwaitPowerPassGrantedEvent', mirror: 'OwnsPowerPass' },
  ],
  badMigration: {
    initialState: 'OnPlayerAdded -> reconcile current ownership -> mirror HasPass()',
    liveChange: 'none; ownership is observed only after reconnect',
  },
  goodMigration: {
    initialState: 'OnPlayerAdded -> reconcile current ownership -> mirror HasPass()',
    liveChange: 'persistent Await<Stem>GrantedEvent loop -> update the matching mirror immediately',
  },
} as const;

export async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 0));
  if (!predicate()) throw new Error('Timed out waiting for the synthetic durable propagation fixture.');
}
