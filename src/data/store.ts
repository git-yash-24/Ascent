/**
 * The store (spec: Persistence, sync and backup; build plan: Store interface).
 *
 * Every tap is accepted locally first and synced second, and the status always says which of
 * the two has happened. A record is never shown as safe before it is:
 *
 *   synced    stored on the account and read back
 *   saving    sent, waiting for confirmation
 *   local     saved on this device only; will sync when it can   ("saved here")
 *   unsaved   in memory only: no device storage and not yet synced
 *
 * The store never decides what a value means; the core validates every write first.
 */
import { mergeEntry } from '../core/model/entries';
import { monthOf } from '../core/model/date';
import { parse } from '../core/model/schemas';
import { emptySnapshot } from '../core/model/snapshot';
import type { DateKey, Entry, HabitId, Snapshot } from '../core/model/types';
import { PermanentBackendError, type Backend, type DocKindSingle } from './backend';
import { replaceWrites } from './backup/backup';
import { fold, type Conflict, type Problem } from './sync/fold';
import { Journal, type JournalOp, type KV } from './sync/journal';

export type SyncStatus = 'synced' | 'saving' | 'local' | 'unsaved';

export interface StoreState {
  snapshot: Snapshot;
  status: SyncStatus;
  /** True when the account store could not be read at open: showing the last synced copy. */
  offline: boolean;
  /** True when this device cannot keep offline copies (no browser storage). */
  noDeviceStorage: boolean;
  conflicts: Conflict[];
  problems: Problem[];
  /** Ops that failed permanently (rejected by the store); kept here, never silently dropped. */
  rejected: JournalOp[];
}

export interface StoreOptions {
  backend: Backend | null;
  kv: KV | null;
  dev: string;
  now?: () => number;
  /** Timer for retries; tests pass a manual scheduler. */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Read timeout at open, ms. */
  openTimeoutMs?: number;
}

export const CACHE_KEY = 'ascent:cache:v1';
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;

let opSeq = 0;
function opId(dev: string, now: number): string {
  opSeq = (opSeq + 1) % 1e9;
  return `${dev}-${now.toString(36)}-${opSeq.toString(36)}`;
}

export class SyncedStore {
  private readonly backend: Backend | null;
  private readonly kv: KV | null;
  private readonly dev: string;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly openTimeoutMs: number;
  private readonly journal: Journal;

  /** The folded remote state, before pending local changes are laid on top. */
  private remote: Snapshot = emptySnapshot();
  private state: StoreState;
  private listeners = new Set<(s: StoreState) => void>();
  private flushing: Promise<void> | null = null;
  private failures = 0;
  private retryTimer = false;
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(o: StoreOptions) {
    this.backend = o.backend;
    this.kv = o.kv;
    this.dev = o.dev;
    this.now = o.now ?? Date.now;
    this.schedule = o.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.openTimeoutMs = o.openTimeoutMs ?? 10_000;
    this.journal = new Journal(o.kv);
    this.state = {
      snapshot: emptySnapshot(),
      status: 'synced',
      offline: false,
      noDeviceStorage: !this.journal.durable,
      conflicts: [],
      problems: [],
      rejected: [],
    };
  }

  get current(): StoreState {
    return this.state;
  }

  onChange(fn: (s: StoreState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read everything, lay the unconfirmed journal on top, start syncing. */
  async open(): Promise<StoreState> {
    let offline = false;
    if (this.backend) {
      try {
        await this.pull();
      } catch {
        offline = true;
        this.remote = this.readCache() ?? emptySnapshot();
      }
    } else {
      this.remote = this.readCache() ?? emptySnapshot();
    }
    this.state = { ...this.state, offline };
    this.rebuild();
    if (!offline) this.subscribeRemote();
    void this.flush();
    return this.state;
  }

  private subscribeRemote(): void {
    if (!this.backend || this.unsubscribe) return;
    this.unsubscribe = this.backend.subscribe(() => {
      if (this.flushing) return; // our own echo: the flush re-reads when it finishes
      void this.pull()
        .then(() => this.rebuild())
        .catch(() => undefined);
    });
  }

  /** Accept a validated entry: memory and journal now, the account next. */
  putEntry(date: DateKey, habit: HabitId, e: Entry): void {
    this.journal.append({ id: opId(this.dev, this.now()), kind: 'entry', date, habit, e: { ...e, dev: this.dev } });
    this.rebuild();
    void this.flush();
  }

  /** Replace a whole document (validated here too: a bad body never reaches the account). */
  putDoc(doc: DocKindSingle, body: object): void {
    const r = parse[doc](body);
    if (!r.ok) throw new TypeError(`${doc}: ${r.error}`);
    this.journal.append({ id: opId(this.dev, this.now()), kind: 'doc', doc, body: r.value, at: this.now() });
    this.rebuild();
    void this.flush();
  }

  /**
   * Replace everything with an imported snapshot (after the caller has shown the dry run and
   * exported the current data). Goes through the journal like any other write.
   */
  replaceAll(incoming: Snapshot): void {
    const at = this.now();
    for (const w of replaceWrites(this.state.snapshot, incoming, at, this.dev)) {
      this.journal.append({ id: opId(this.dev, at), kind: 'entry', date: w.date, habit: w.habit, e: w.e });
    }
    if (incoming.profile) this.journal.append({ id: opId(this.dev, at), kind: 'doc', doc: 'profile', body: incoming.profile, at });
    for (const doc of ['habits', 'seen', 'corrections'] as const) {
      this.journal.append({ id: opId(this.dev, at), kind: 'doc', doc, body: incoming[doc], at });
    }
    this.rebuild();
    void this.flush();
  }

  /** Send every pending op; confirm each by reading it back. Retries with backoff. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
      this.updateStatus();
    });
    return this.flushing;
  }

  close(): void {
    this.closed = true;
    this.unsubscribe?.();
  }

  private async doFlush(): Promise<void> {
    const backend = this.backend;
    if (!backend) {
      this.updateStatus();
      return;
    }
    if (this.state.offline) {
      // The account store was unreachable at open: reconnect before writing anything, so the
      // remote view is current and conflicts are seen.
      try {
        await this.pull();
        this.rebuild();
        this.subscribeRemote();
      } catch {
        this.failures++;
        this.scheduleRetry();
        return;
      }
    }
    if (this.journal.pending.length === 0) {
      this.updateStatus();
      return;
    }
    this.setStatus('saving');
    try {
      // Ops appended while a flush runs are picked up by the next pass.
      for (let pass = 0; pass < 100 && this.journal.pending.length > 0; pass++) {
        for (const op of [...this.journal.pending]) await this.send(backend, op);
      }
      this.failures = 0;
      // Fold our confirmed writes into the remote view so the snapshot no longer depends on
      // the journal for them.
      await this.pull().catch(() => undefined);
      this.rebuild();
    } catch {
      this.failures++;
      this.scheduleRetry();
    }
  }

  /** Send one op and confirm it by reading it back. Permanent rejections are set aside. */
  private async send(backend: Backend, op: JournalOp): Promise<void> {
    try {
      if (op.kind === 'entry') {
        const month = monthOf(op.date);
        await backend.putEntry(month, this.dev, op.date, op.habit, op.e);
        const back = await backend.getEntry(month, this.dev, op.date, op.habit);
        if (!back || back.at < op.e.at) throw new Error('unavailable: unconfirmed');
      } else {
        await backend.putDoc(op.doc, op.body);
      }
      this.journal.confirm(op);
    } catch (e) {
      if (!(e instanceof PermanentBackendError)) throw e;
      this.journal.confirm(op);
      this.state = { ...this.state, rejected: [...this.state.rejected, op] };
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed) return;
    this.retryTimer = true;
    const ms = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(10, this.failures - 1));
    this.schedule(() => {
      this.retryTimer = false;
      if (!this.closed) void this.flush();
    }, ms);
  }

  /** Re-read the account store into the remote view. */
  private async pull(): Promise<void> {
    if (!this.backend) return;
    const remote = await withTimeout(this.backend.readAll(), this.openTimeoutMs);
    const f = fold(remote, this.now());
    this.remote = f.snapshot;
    this.state = { ...this.state, conflicts: f.conflicts, problems: f.problems, offline: false };
    this.writeCache();
  }

  /** snapshot = remote view + every unconfirmed journal op on top. */
  private rebuild(): void {
    let s = this.remote;
    for (const op of this.journal.pending) {
      if (op.kind === 'entry') s = mergeEntry(s, op.date, op.habit, op.e);
      else s = { ...s, [op.doc]: op.body } as Snapshot;
    }
    this.state = { ...this.state, snapshot: s, noDeviceStorage: !this.journal.durable };
    this.updateStatus(false);
    this.emit();
  }

  private updateStatus(emit = true): void {
    const pending = this.journal.pending.length > 0;
    const durable = this.journal.durable;
    let status: SyncStatus;
    if (!pending) status = this.backend ? 'synced' : durable ? 'local' : 'unsaved';
    else if (this.flushing && this.failures === 0 && !this.state.offline) status = 'saving';
    else status = durable ? 'local' : 'unsaved';
    if (status !== this.state.status) {
      this.state = { ...this.state, status };
      if (emit) this.emit();
    }
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.state.status) return;
    this.state = { ...this.state, status };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  private readCache(): Snapshot | null {
    if (!this.kv) return null;
    try {
      const raw = this.kv.get(CACHE_KEY);
      if (!raw) return null;
      const docs = JSON.parse(raw) as { snapshot?: Snapshot };
      return docs.snapshot ?? null;
    } catch {
      return null;
    }
  }

  private writeCache(): void {
    if (!this.kv) return;
    try {
      this.kv.set(CACHE_KEY, JSON.stringify({ savedAt: this.now(), snapshot: this.remote }));
    } catch {
      // A full device storage only costs the offline copy; the account still has everything.
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('unavailable: timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
