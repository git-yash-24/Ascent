/**
 * A fake of the artifact database (db.d.ts, contract 0.2.46) faithful in the ways that matter
 * to the adapter: update merges nested objects recursively but replaces arrays, update on a
 * missing document rejects invalid_argument, paths need even/odd segment counts, and
 * collection snapshots fire after writes.
 */
import type { CollectionLike, DbLike, DocRefLike, DocSnapshotLike } from '../../src/data/adapters/artifactDb';

type Body = Record<string, unknown>;

function segments(path: string): string[] {
  return path.split('/');
}

function merge(into: Body, patch: Body): Body {
  const out: Body = { ...into };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (isPlain(v) && isPlain(cur)) out[k] = merge(cur, v);
    else out[k] = structuredClone(v);
  }
  return out;
}

function isPlain(x: unknown): x is Body {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export class FakeDb implements DbLike {
  readonly docs = new Map<string, Body>();
  private listeners = new Map<string, Set<(snap: { docs: DocSnapshotLike[] }) => void>>();
  offline = false;
  writes = 0;

  private snap(path: string): DocSnapshotLike {
    const body = this.docs.get(path);
    const id = segments(path).at(-1) as string;
    return { id, exists: body !== undefined, data: () => (body ? structuredClone(body) : undefined) };
  }

  private fail(): void {
    if (this.offline) throw { code: 'unavailable', message: 'offline' };
  }

  private changed(path: string): void {
    const coll = segments(path).slice(0, -1).join('/');
    const ls = this.listeners.get(coll);
    if (!ls) return;
    const docs = this.list(coll);
    for (const l of ls) l({ docs });
  }

  private list(coll: string): DocSnapshotLike[] {
    const n = segments(coll).length + 1;
    return [...this.docs.keys()]
      .filter((p) => p.startsWith(`${coll}/`) && segments(p).length === n)
      .sort()
      .map((p) => this.snap(p));
  }

  doc(path: string): DocRefLike {
    if (segments(path).length % 2 !== 0) throw new TypeError(`document path needs an even number of segments: ${path}`);
    return {
      get: async () => {
        await Promise.resolve();
        this.fail();
        return this.snap(path);
      },
      set: async (data) => {
        await Promise.resolve();
        this.fail();
        if (!isPlain(data)) throw { code: 'invalid_argument', message: 'body must be an object' };
        this.docs.set(path, structuredClone(data));
        this.writes++;
        this.changed(path);
      },
      update: async (data) => {
        await Promise.resolve();
        this.fail();
        const cur = this.docs.get(path);
        if (!cur) throw { code: 'invalid_argument', message: 'document does not exist' };
        this.docs.set(path, merge(cur, data));
        this.writes++;
        this.changed(path);
      },
    };
  }

  collection(path: string): CollectionLike {
    if (segments(path).length % 2 !== 1) throw new TypeError(`collection path needs an odd number of segments: ${path}`);
    return {
      limit: (n: number) => ({
        get: async () => {
          await Promise.resolve();
          this.fail();
          return { docs: this.list(path).slice(0, n) };
        },
      }),
      onSnapshot: (next) => {
        const set = this.listeners.get(path) ?? new Set();
        set.add(next);
        this.listeners.set(path, set);
        queueMicrotask(() => next({ docs: this.list(path) }));
        return () => set.delete(next);
      },
    };
  }
}
