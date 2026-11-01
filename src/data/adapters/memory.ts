/**
 * In-memory backend: the reference implementation of the Backend contract, used by tests and
 * by the app when no synced store is available. Stores the same encoded shapes as the artifact
 * database, with failure injection for sync tests.
 */
import { decodeActs, decodeEntry, encodeActs, encodeEntry, type EncodedActs, type EncodedEntry } from '../codec';
import type { Backend, DeviceLog, DocKindSingle, RemoteDocs } from '../backend';
import type { DateKey, Entry, HabitId } from '../../core/model/types';

interface LogBody {
  schema: number;
  days: Record<DateKey, Record<HabitId, EncodedEntry>>;
  acts?: Record<DateKey, Record<HabitId, EncodedActs>>;
}

export class MemoryBackend implements Backend {
  private single: Partial<Record<DocKindSingle, unknown>> = {};
  private logs = new Map<string, { month: string; dev: string; body: LogBody }>();
  private listeners = new Set<() => void>();

  /** When true, every call rejects as a network failure. */
  offline = false;
  /** When true, writes are applied but the call still rejects (a lost acknowledgement). */
  loseAcks = false;
  /** Calls made, for assertions. */
  calls = { putEntry: 0, putDoc: 0, readAll: 0 };

  private check(): void {
    if (this.offline) throw new Error('unavailable: offline');
  }

  async readAll(): Promise<RemoteDocs> {
    await Promise.resolve();
    this.check();
    this.calls.readAll++;
    const logs: DeviceLog[] = [...this.logs.values()].map((l) => ({ month: l.month, dev: l.dev, body: structuredClone(l.body) }));
    return { single: structuredClone(this.single), logs };
  }

  async putEntry(month: string, dev: string, date: DateKey, habit: HabitId, e: Entry): Promise<void> {
    await Promise.resolve();
    this.check();
    this.calls.putEntry++;
    const key = `${month}~${dev}`;
    const doc = this.logs.get(key) ?? { month, dev, body: { schema: 1, days: {} } };
    const day = doc.body.days[date] ?? {};
    day[habit] = encodeEntry(e);
    doc.body.days[date] = day;
    if (e.acts) {
      doc.body.acts ??= {};
      (doc.body.acts[date] ??= {})[habit] = encodeActs(e.acts);
    }
    this.logs.set(key, doc);
    this.emit();
    if (this.loseAcks) throw new Error('unavailable: acknowledgement lost');
  }

  async getEntry(month: string, dev: string, date: DateKey, habit: HabitId): Promise<Entry | undefined> {
    await Promise.resolve();
    this.check();
    const body = this.logs.get(`${month}~${dev}`)?.body;
    const raw = body?.days[date]?.[habit];
    const e = raw ? decodeEntry(raw, dev) ?? undefined : undefined;
    const acts = decodeActs(body?.acts?.[date]?.[habit]);
    if (e && acts?.length) e.acts = acts;
    return e;
  }

  async putDoc(kind: DocKindSingle, body: object): Promise<void> {
    await Promise.resolve();
    this.check();
    this.calls.putDoc++;
    this.single[kind] = structuredClone(body);
    this.emit();
    if (this.loseAcks) throw new Error('unavailable: acknowledgement lost');
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /** Test helper: write a raw document as if another app version or device had. */
  rawPutSingle(kind: DocKindSingle, body: unknown): void {
    this.single[kind] = body;
    this.emit();
  }

  /** Test helper: how many entries exist for a habit-day across all devices. */
  countEntries(date: DateKey, habit: HabitId): number {
    let n = 0;
    for (const l of this.logs.values()) if (l.body.days[date]?.[habit]) n++;
    return n;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
