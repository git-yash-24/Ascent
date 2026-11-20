/**
 * Backend over the artifact database (`claude.use("db")`, runtime contract 0.2.46).
 *
 * Everything lives in the viewer's private subtree, data/users/<id>/, one document per path:
 *   profile, habits, seen, corrections          whole documents, replaced on write
 *   log-YYYY-MM~<device>                        that device's entries for the month
 * Entries are encoded as arrays (see codec.ts) because update merges objects recursively.
 */
import { decodeActs, decodeEntry, encodeActs, encodeEntry, logDocId, parseDocId } from '../codec';
import { PermanentBackendError, type Backend, type DeviceLog, type DocKindSingle, type RemoteDocs } from '../backend';
import type { DateKey, Entry, HabitId } from '../../core/model/types';

/** The subset of the db namespace this adapter uses (see db.d.ts). */
export interface DbLike {
  doc(path: string): DocRefLike;
  collection(path: string): CollectionLike;
}
export interface DocSnapshotLike {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface DocRefLike {
  get(): Promise<DocSnapshotLike>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
}
export interface CollectionLike {
  limit(n: number): { get(): Promise<{ docs: DocSnapshotLike[] }> };
  onSnapshot(next: (snap: { docs: DocSnapshotLike[] }) => void, error?: (e: { code: string; message: string }) => void): () => void;
}

const PERMANENT = new Set(['invalid_argument', 'quota_exceeded', 'transform_error', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed']);

function codeOf(e: unknown): string {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
    ? (e as { code: string }).code
    : 'unavailable';
}

function rethrow(e: unknown): never {
  const code = codeOf(e);
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (PERMANENT.has(code)) throw new PermanentBackendError(message, code);
  throw new Error(`${code}: ${message}`);
}

export class ArtifactDbBackend implements Backend {
  private readonly base: string;

  constructor(
    private readonly db: DbLike,
    userId: string,
  ) {
    this.base = `data/users/${userId}`;
  }

  async readAll(): Promise<RemoteDocs> {
    let docs: DocSnapshotLike[];
    try {
      docs = (await this.db.collection(this.base).limit(1000).get()).docs;
    } catch (e) {
      rethrow(e);
    }
    const out: RemoteDocs = { single: {}, logs: [] };
    for (const d of docs) {
      if (!d.exists) continue;
      const id = parseDocId(d.id);
      if (id.kind === 'single') out.single[id.name] = d.data();
      else if (id.kind === 'log') out.logs.push({ month: id.month, dev: id.dev, body: d.data() } satisfies DeviceLog);
    }
    return out;
  }

  async putEntry(month: string, dev: string, date: DateKey, habit: HabitId, e: Entry): Promise<void> {
    const ref = this.db.doc(`${this.base}/${logDocId(month, dev)}`);
    const patch: Record<string, unknown> = { days: { [date]: { [habit]: encodeEntry(e) } } };
    if (e.acts) patch.acts = { [date]: { [habit]: encodeActs(e.acts) } };
    try {
      await ref.update(patch);
      return;
    } catch (err) {
      if (codeOf(err) !== 'invalid_argument') rethrow(err);
    }
    // update rejects invalid_argument when the document does not exist yet. Only this device
    // writes this document, so creating it here cannot overwrite another device's entries.
    // Re-check first: another tab of this device may have just created it.
    try {
      const snap = await ref.get();
      if (snap.exists) await ref.update(patch);
      else await ref.set({ schema: 1, ...patch });
    } catch (err) {
      rethrow(err);
    }
  }

  async getEntry(month: string, dev: string, date: DateKey, habit: HabitId): Promise<Entry | undefined> {
    try {
      const snap = await this.db.doc(`${this.base}/${logDocId(month, dev)}`).get();
      const data = snap.exists ? snap.data() : undefined;
      const raw = (data?.days as Record<string, Record<string, unknown>> | undefined)?.[date]?.[habit];
      const e = raw === undefined ? undefined : decodeEntry(raw, dev) ?? undefined;
      const acts = decodeActs((data?.acts as Record<string, Record<string, unknown>> | undefined)?.[date]?.[habit]);
      if (e && acts?.length) e.acts = acts;
      return e;
    } catch (e) {
      rethrow(e);
    }
  }

  async putDoc(kind: DocKindSingle, body: object): Promise<void> {
    try {
      await this.db.doc(`${this.base}/${kind}`).set(body as Record<string, unknown>);
    } catch (e) {
      rethrow(e);
    }
  }

  subscribe(onChange: () => void): () => void {
    let first = true;
    return this.db.collection(this.base).onSnapshot(
      () => {
        // The first delivery is the current state, which the store has just read.
        if (first) {
          first = false;
          return;
        }
        onChange();
      },
      () => {
        // A terminal subscription error: the store keeps working from its own writes and
        // re-reads on the next open.
      },
    );
  }
}
