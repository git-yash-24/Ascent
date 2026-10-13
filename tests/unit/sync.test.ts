/** Store and sync: X01 to X04, status, conflicts, invalid documents, offline open. */
import { describe, expect, it } from 'vitest';
import { entryOn } from '../../src/core/model/entries';
import { MemoryBackend } from '../../src/data/adapters/memory';
import { ArtifactDbBackend } from '../../src/data/adapters/artifactDb';
import { CACHE_KEY, SyncedStore, type StoreOptions } from '../../src/data/store';
import { MemoryKV } from '../../src/data/sync/journal';
import { FakeDb } from '../fixtures/fakeDb';
import { Q, R } from '../fixtures/build';

const D = '2026-10-12';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await tick();
}

function scheduler() {
  const timers: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      timers.push(fn);
    },
    async run() {
      const fns = timers.splice(0);
      for (const f of fns) f();
      await settle();
    },
    get count() {
      return timers.length;
    },
  };
}

let clock = 1_800_000_000_000;
const now = () => clock;

function store(o: Partial<StoreOptions> & { backend: StoreOptions['backend'] }, sched = scheduler()) {
  return new SyncedStore({ kv: new MemoryKV(), dev: 'devA', now, schedule: sched.schedule, openTimeoutMs: 1000, ...o });
}

async function withHabitsDoc(s: SyncedStore): Promise<void> {
  s.putDoc('habits', { schema: 3, habits: [Q(D), R(D)] });
  await settle();
}

describe('write path', () => {
  it('a tap is visible at once, journaled, then synced and confirmed', async () => {
    const backend = new MemoryBackend();
    const s = store({ backend });
    await s.open();
    await withHabitsDoc(s);
    const statuses: string[] = [];
    s.onChange((st) => statuses.push(st.status));
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    expect(entryOn(s.current.snapshot, D, 'R')?.v).toBe(1); // same tick
    await settle();
    expect(s.current.status).toBe('synced');
    expect(statuses).toContain('saving');
    expect(backend.countEntries(D, 'R')).toBe(1);
  });

  it('X01: a reload mid-save replays the journal; the entry is stored once', async () => {
    const backend = new MemoryBackend();
    const kv = new MemoryKV();
    const s1 = store({ backend, kv });
    await s1.open();
    await withHabitsDoc(s1);
    backend.offline = true; // the save never completes before the "reload"
    s1.putEntry(D, 'Q', { v: 30, at: ++clock, dev: 'devA' });
    await settle();
    s1.close();
    backend.offline = false;
    const s2 = store({ backend, kv });
    await s2.open();
    expect(entryOn(s2.current.snapshot, D, 'Q')?.v).toBe(30);
    await settle();
    expect(s2.current.status).toBe('synced');
    expect(backend.countEntries(D, 'Q')).toBe(1);
  });

  it('X01b: a lost acknowledgement is retried harmlessly (set, not add)', async () => {
    const backend = new MemoryBackend();
    const sched = scheduler();
    const s = store({ backend }, sched);
    await s.open();
    await withHabitsDoc(s);
    backend.loseAcks = true;
    s.putEntry(D, 'Q', { v: 30, at: ++clock, dev: 'devA' });
    await settle();
    expect(s.current.status).toBe('local');
    backend.loseAcks = false;
    await sched.run();
    expect(s.current.status).toBe('synced');
    expect(backend.countEntries(D, 'Q')).toBe(1);
    expect(entryOn(s.current.snapshot, D, 'Q')?.v).toBe(30);
  });

  it('X02: network drops: "saved here", then syncs on reconnect', async () => {
    const backend = new MemoryBackend();
    const sched = scheduler();
    const s = store({ backend }, sched);
    await s.open();
    await withHabitsDoc(s);
    backend.offline = true;
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    expect(s.current.status).toBe('local');
    expect(sched.count).toBe(1);
    backend.offline = false;
    await sched.run();
    expect(s.current.status).toBe('synced');
  });

  it('X03: two devices on the same habit-day within 1 s: later write wins, conflict listed', async () => {
    const backend = new MemoryBackend();
    const a = store({ backend, dev: 'devA' });
    const b = store({ backend, dev: 'devB' });
    await a.open();
    await withHabitsDoc(a);
    await b.open();
    const t = ++clock;
    a.putEntry(D, 'Q', { v: 50, at: t, dev: 'devA' });
    b.putEntry(D, 'Q', { v: 20, at: t + 400, dev: 'devB' });
    await settle();
    // Both converge on the later write, whatever order the writes arrived in.
    await a.flush();
    await b.flush();
    const sa = new SyncedStore({ backend, kv: new MemoryKV(), dev: 'devC', now });
    await sa.open();
    expect(entryOn(sa.current.snapshot, D, 'Q')?.v).toBe(20);
    expect(sa.current.conflicts).toHaveLength(1);
    expect(sa.current.conflicts[0]).toMatchObject({ date: D, habit: 'Q', kept: { v: 20 }, lost: { v: 50 } });
  });

  it('X04: an hour of failing sync keeps every entry and catches up', async () => {
    const backend = new MemoryBackend();
    const sched = scheduler();
    const s = store({ backend }, sched);
    await s.open();
    await withHabitsDoc(s);
    backend.offline = true;
    const days = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];
    for (const d of days) {
      s.putEntry(d, 'R', { v: 1, at: ++clock, dev: 'devA' });
      s.putEntry(d, 'Q', { v: 40, at: ++clock, dev: 'devA' });
      await settle();
      await sched.run(); // retries keep failing
    }
    expect(s.current.status).toBe('local');
    backend.offline = false;
    await sched.run();
    expect(s.current.status).toBe('synced');
    for (const d of days) {
      expect(backend.countEntries(d, 'R')).toBe(1);
      expect(backend.countEntries(d, 'Q')).toBe(1);
    }
  });

  it('with no device storage the status says not saved until the account confirms', async () => {
    const backend = new MemoryBackend();
    const s = new SyncedStore({ backend, kv: null, dev: 'devA', now, schedule: scheduler().schedule });
    await s.open();
    expect(s.current.noDeviceStorage).toBe(true);
    await withHabitsDoc(s);
    backend.offline = true;
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    expect(s.current.status).toBe('unsaved');
  });

  it('storage that fills up mid-session downgrades to "not saved" instead of lying', async () => {
    const backend = new MemoryBackend();
    const kv = new MemoryKV();
    const s = store({ backend, kv });
    await s.open();
    await withHabitsDoc(s);
    kv.failing = true;
    backend.offline = true;
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    expect(s.current.status).toBe('unsaved');
  });
});

describe('open', () => {
  it('a copy cached by an older version opens with the newer documents empty', async () => {
    const kv = new MemoryKV();
    const old = { schema: 1, entries: {} };
    kv.set(CACHE_KEY, JSON.stringify({ savedAt: 1, snapshot: { profile: null, habits: { schema: 3, habits: [Q(D), R(D)] }, months: {}, seen: { schema: 1, presentedStoryDay: 0, episodes: [], moments: [], records: [] }, corrections: { schema: 1, items: [] }, notes: old } }));
    const backend = new MemoryBackend();
    backend.offline = true;
    const seen: unknown[] = [];
    const s = store({ backend, kv });
    s.onChange((st) => seen.push(st.snapshot.expedition));
    await s.open();
    expect(s.current.snapshot.expedition).toEqual({ schema: 1 });
    expect(seen.every((e) => e !== undefined)).toBe(true);
    expect(s.current.snapshot.habits.habits).toHaveLength(2);
  });

  it('store unavailable at open: last synced copy, logging still allowed, then reconnects', async () => {
    const backend = new MemoryBackend();
    const kv = new MemoryKV();
    const sched = scheduler();
    const s1 = store({ backend, kv }, sched);
    await s1.open();
    await withHabitsDoc(s1);
    s1.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    s1.close();

    backend.offline = true;
    const s2 = store({ backend, kv }, sched);
    await s2.open();
    expect(s2.current.offline).toBe(true);
    expect(entryOn(s2.current.snapshot, D, 'R')?.v).toBe(1); // from the cache
    s2.putEntry(D, 'Q', { v: 25, at: ++clock, dev: 'devA' });
    await settle();
    expect(s2.current.status).toBe('local');
    backend.offline = false;
    await sched.run();
    expect(s2.current.offline).toBe(false);
    expect(s2.current.status).toBe('synced');
    expect(backend.countEntries(D, 'Q')).toBe(1);
  });

  it('a corrupt document is rejected and listed, never shown as data', async () => {
    const backend = new MemoryBackend();
    backend.rawPutSingle('habits', { schema: 3, habits: [{ id: 'x' }] });
    backend.rawPutSingle('seen', { schema: 1, presentedStoryDay: 4, episodes: [1, 2, 3, 4], moments: [], records: [] });
    const s = store({ backend });
    await s.open();
    expect(s.current.problems.map((p) => p.doc)).toEqual(['habits']);
    expect(s.current.snapshot.habits.habits).toEqual([]);
    expect(s.current.snapshot.seen.presentedStoryDay).toBe(4);
  });

  it('an invalid document write is refused before it reaches the journal', async () => {
    const s = store({ backend: new MemoryBackend() });
    await s.open();
    expect(() => s.putDoc('habits', { schema: 3, habits: [{ id: 'x' }] })).toThrow();
  });

  it('works on the artifact database adapter end to end', async () => {
    const db = new FakeDb();
    const backend = new ArtifactDbBackend(db, 'u1');
    const s = store({ backend });
    await s.open();
    await withHabitsDoc(s);
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    s.putEntry(D, 'R', { at: ++clock, dev: 'devA' }); // undo
    await settle();
    expect(s.current.status).toBe('synced');
    const fresh = store({ backend, dev: 'devB' });
    await fresh.open();
    expect(entryOn(fresh.current.snapshot, D, 'R')).toBeUndefined();
    expect(fresh.current.snapshot.habits.habits.map((h) => h.id)).toEqual(['Q', 'R']);
    expect([...db.docs.keys()].sort()).toEqual(['data/users/u1/habits', 'data/users/u1/log-2026-10~devA']);
  });

  it('live updates from another device arrive through the subscription', async () => {
    const backend = new MemoryBackend();
    const a = store({ backend, dev: 'devA' });
    const b = store({ backend, dev: 'devB' });
    await a.open();
    await withHabitsDoc(a);
    await b.open();
    a.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    expect(entryOn(b.current.snapshot, D, 'R')?.v).toBe(1);
  });
});

describe('no flicker', () => {
  it('a confirmed entry never disappears from the snapshot before the background refresh', async () => {
    const backend = new MemoryBackend();
    const s = store({ backend });
    await s.open();
    await withHabitsDoc(s);
    const seen: Array<number | undefined> = [];
    s.onChange((st) => seen.push(entryOn(st.snapshot, D, 'R')?.v));
    s.putEntry(D, 'R', { v: 1, at: ++clock, dev: 'devA' });
    await settle();
    expect(seen.every((v) => v === 1)).toBe(true);
    expect(s.current.status).toBe('synced');
  });
});
