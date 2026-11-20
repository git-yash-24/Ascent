/**
 * The local journal (spec: Write path, step 2).
 *
 * Every change is appended here in the same frame as the tap, before any network call. Writes
 * set values, so the journal keeps only the latest change per habit-day and per document;
 * replaying an entry twice writes the same value twice, which is harmless.
 *
 * Browser storage can be missing or throw (private windows, blocked storage, previews), so
 * every access is guarded and the journal falls back to memory, which the status reports.
 */
import type { DateKey, Entry, HabitId } from '../../core/model/types';
import type { DocKindSingle } from '../backend';

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** localStorage, or null when it cannot be used at all. */
export function browserKV(): KV | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__ascent_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => ls.setItem(k, v),
      remove: (k) => ls.removeItem(k),
    };
  } catch {
    return null;
  }
}

export class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  /** When true, writes throw (storage full or revoked). */
  failing = false;
  get(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  set(k: string, v: string): void {
    if (this.failing) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  remove(k: string): void {
    this.data.delete(k);
  }
}

export type JournalOp =
  | { id: string; kind: 'entry'; date: DateKey; habit: HabitId; e: Entry }
  | { id: string; kind: 'doc'; doc: DocKindSingle; body: object; at: number };

export const JOURNAL_KEY = 'ascent:journal:v1';

export class Journal {
  private ops: JournalOp[] = [];
  /** True while the journal is persisted in browser storage. */
  durable: boolean;

  constructor(private readonly kv: KV | null) {
    this.durable = kv !== null;
    if (kv) {
      try {
        const raw = kv.get(JOURNAL_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) this.ops = parsed.filter(isOp);
      } catch {
        this.ops = [];
      }
    }
  }

  get pending(): readonly JournalOp[] {
    return this.ops;
  }

  append(op: JournalOp): void {
    this.ops = this.ops.filter((o) => !sameTarget(o, op));
    this.ops.push(op);
    this.persist();
  }

  /** Remove an op once the store has confirmed it, unless a newer op replaced it meanwhile. */
  confirm(op: JournalOp): void {
    const before = this.ops.length;
    this.ops = this.ops.filter((o) => o.id !== op.id);
    if (this.ops.length !== before) this.persist();
  }

  private persist(): void {
    if (!this.kv) return;
    try {
      this.kv.set(JOURNAL_KEY, JSON.stringify(this.ops));
      this.durable = true;
    } catch {
      this.durable = false;
    }
  }
}

function sameTarget(a: JournalOp, b: JournalOp): boolean {
  if (a.kind === 'entry' && b.kind === 'entry') return a.date === b.date && a.habit === b.habit;
  if (a.kind === 'doc' && b.kind === 'doc') return a.doc === b.doc;
  return false;
}

function isOp(x: unknown): x is JournalOp {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string') return false;
  if (o.kind === 'entry') return typeof o.date === 'string' && typeof o.habit === 'string' && typeof o.e === 'object' && o.e !== null;
  if (o.kind === 'doc') return typeof o.doc === 'string' && typeof o.body === 'object' && o.body !== null;
  return false;
}
