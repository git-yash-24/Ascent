/**
 * Action times (G-38): each change to a habit-day is recorded with when it was recorded, beside
 * the entry, so a reader that predates them sees the same entries, and a backup carries them.
 */
import { describe, expect, it } from 'vitest';
import { decodeActs, encodeActs } from '../../src/data/codec';
import { fold } from '../../src/data/sync/fold';
import { MemoryBackend } from '../../src/data/adapters/memory';
import { SyncedStore } from '../../src/data/store';
import { MemoryKV } from '../../src/data/sync/journal';
import { Controller } from '../../src/ui/controller';
import { exportJson, parseBackup } from '../../src/data/backup/backup';
import { entryOn } from '../../src/core/model/entries';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function rig(backend = new MemoryBackend(), dev = 'phone') {
  let t = Date.parse('2026-10-13T01:00:00Z');
  const clock = { now: () => (t += 60_000), zone: () => 'Asia/Manila' };
  const store = new SyncedStore({ backend, kv: new MemoryKV(), dev, now: clock.now });
  const app = new Controller(store, new MemoryKV(), dev, clock);
  return { backend, store, app };
}

describe('action times', () => {
  it('encode and decode round trip; bad shapes are refused', () => {
    const a = [{ at: 1, v: 10 }, { at: 2, skip: 'sick' as const }, { at: 3 }];
    expect(decodeActs(encodeActs(a))).toEqual(a);
    expect(decodeActs([[1, null]])).toBeNull();
    expect(decodeActs('x')).toBeNull();
  });

  it('every write appends one, kept through sync, readable by another device, and in backups', async () => {
    const { backend, store, app } = rig();
    await store.open();
    expect(app.start({ identity: '', habits: [{ name: 'Qbank', definition: { type: 'numeric', target: 50, minimum: 25, unit: 'questions', schedule: { kind: 'daily' } } }] }).ok).toBe(true);
    await settle();
    const id = app.view().snapshot.habits.habits.find((h) => !h.system)!.id;
    app.setValue(id, 10);
    app.setValue(id, 30);
    app.complete(id);
    app.addGlass(1);
    app.addGlass(1);
    await settle();
    const today = app.today;
    const e = entryOn(app.view().snapshot, today, id)!;
    expect(e.acts?.map((a) => a.v)).toEqual([10, 30, 50]);
    expect(e.acts?.every((a, i, xs) => i === 0 || a.at > xs[i - 1]!.at)).toBe(true);
    const water = app.view().snapshot.habits.habits.find((h) => h.system === 'water')!.id;
    expect(entryOn(app.view().snapshot, today, water)?.acts?.map((a) => a.v)).toEqual([1, 2]);

    // Another device reads the same history.
    const other = rig(backend, 'laptop');
    await other.store.open();
    expect(entryOn(other.store.current.snapshot, today, id)?.acts?.map((a) => a.v)).toEqual([10, 30, 50]);

    // A backup carries it.
    const parsed = parseBackup(exportJson(app.view().snapshot, '0.1.0', Date.now()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(entryOn(parsed.snapshot, today, id)?.acts?.length).toBe(3);
  });

  it('a reader that ignores `acts` sees exactly the same entries (rollback safety)', () => {
    const days = { '2026-10-13': { Q: [30, null, 5] } };
    const withActs = fold({ single: {}, logs: [{ month: '2026-10', dev: 'phone', body: { schema: 1, days, acts: { '2026-10-13': { Q: [[10, null, 4], [30, null, 5]] } } } }] }, 0);
    const without = fold({ single: {}, logs: [{ month: '2026-10', dev: 'phone', body: { schema: 1, days } }] }, 0);
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'acts' ? undefined : v)));
    expect(withActs.snapshot.logs['2026-10']?.days['2026-10-13']?.Q?.acts?.length).toBe(2);
    expect(strip(withActs.snapshot)).toEqual(strip(without.snapshot));
    expect(withActs.problems).toEqual([]);
  });

  it('unreadable action times are dropped and the entry still counts', () => {
    const body = { schema: 1, days: { '2026-10-13': { Q: [30, null, 5] } }, acts: { '2026-10-13': { Q: 'garbage' } } };
    const out = fold({ single: {}, logs: [{ month: '2026-10', dev: 'phone', body }] }, 0);
    expect(out.snapshot.logs['2026-10']?.days['2026-10-13']?.Q?.v).toBe(30);
    expect(out.snapshot.logs['2026-10']?.days['2026-10-13']?.Q?.acts).toBeUndefined();
  });
});
