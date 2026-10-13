/** Export, import and the backup prompt: I10, X14. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import {
  backupDue,
  dryRun,
  exportCsv,
  exportJson,
  parseBackup,
  prepareImport,
  recordOf,
} from '../../src/data/backup/backup';
import { MemoryBackend } from '../../src/data/adapters/memory';
import { SyncedStore } from '../../src/data/store';
import { MemoryKV } from '../../src/data/sync/journal';
import { historyArb } from '../fixtures/histories';
import { Q, R, day, log, logRange, withHabits } from '../fixtures/build';
import type { Snapshot } from '../../src/core/model/types';

const D = '2026-10-05';
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('export and import', () => {
  it('I10: export then parse reproduces the identical store', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        const parsed = parseBackup(exportJson(h.snapshot, '0.1.0', 1_800_000_000_000));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.snapshot).toEqual(JSON.parse(JSON.stringify(h.snapshot)));
        expect(parsed.migrated).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('I10b: importing through the store gives every device the identical record and world', async () => {
    let current = logRange(withHabits(Q(D), R(D)), D, 5, 'R', 1);
    current = log(current, day(D, 2), 'Q', 30);
    let backup = logRange(withHabits(Q(D), R(D)), D, 3, 'Q', 50);
    backup = log(backup, day(D, 4), 'R', 'sick');

    const backend = new MemoryBackend();
    const a = new SyncedStore({ backend, kv: new MemoryKV(), dev: 'phone', now: () => 1_800_000_000_000 });
    await a.open();
    a.replaceAll(current);
    await settle();
    expect(recordOf(a.current.snapshot)).toEqual(recordOf(current));

    const prepared = prepareImport(a.current.snapshot, exportJson(backup, '0.1.0', 1), '0.1.0', 1_800_000_000_500);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    a.replaceAll(prepared.incoming);
    await settle();
    expect(a.current.status).toBe('synced');

    const b = new SyncedStore({ backend, kv: new MemoryKV(), dev: 'laptop', now: () => 1_800_000_001_000 });
    await b.open();
    const now = { date: day(D, 6), ended: true };
    for (const s of [a.current.snapshot, b.current.snapshot]) {
      expect(recordOf(s)).toEqual(recordOf(backup));
      expect(s.habits).toEqual(backup.habits);
      expect(derive(s, now).days).toEqual(derive(backup, now).days);
      expect(derive(s, now).climb).toEqual(derive(backup, now).climb);
    }
  });

  it('X14: an older backup is migrated, summarised, and the current data exported first', () => {
    const current = logRange(withHabits(R(D)), D, 4, 'R', 1);
    const old = JSON.stringify({
      format: 'ascent-backup',
      version: 1,
      app: '0.0.9',
      exportedAt: '2026-09-01T00:00:00.000Z',
      docs: {
        profile: { schema: 1, identity: 'I show up', startDate: D, settings: { dayBoundary: 240, timeZone: 'Asia/Manila', sound: true, music: true, reducedMotion: false } },
        habits: { habits: [Q(D), R(D)] },
        seen: {},
        corrections: {},
        logs: { '2026-10': { days: { [D]: { Q: { v: 50, at: 1, dev: 'x' } }, [day(D, 1)]: { R: { v: 1, at: 2, dev: 'x' } } } } },
      },
    });
    const p = prepareImport(current, old, '0.1.0', 1_800_000_000_000);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.summary.migrated).toEqual(expect.arrayContaining(['profile', 'habits', 'seen', 'corrections', 'log-2026-10']));
    expect(p.incoming.profile?.weekly).toEqual({ steep: [] });
    expect(p.summary.changes).toMatchObject({ entriesAdded: 1, entriesRemoved: 3, entriesChanged: 0, habitsAdded: ['Qbank'], habitsRemoved: [], settingsChanged: true });
    expect(p.summary.range).toEqual({ from: D, to: day(D, 1) });
    // The safety export is the current data, intact.
    const back = parseBackup(p.safetyExport);
    expect(back.ok && recordOf(back.snapshot)).toEqual(recordOf(current));
    expect(p.safetyName).toMatch(/^ascent-backup-\d{4}-\d{2}-\d{2}-before-import\.json$/);
  });

  it.each([
    ['not JSON', 'nope', 'not valid JSON'],
    ['another file', '{"hello":1}', 'not an Ascent backup'],
    ['a newer version', '{"format":"ascent-backup","version":9,"docs":{}}', 'newer version'],
    ['a broken habit', '{"format":"ascent-backup","version":1,"docs":{"habits":{"schema":3,"habits":[{"id":"x"}]}}}', 'habits'],
    ['an unknown habit in the log', '{"format":"ascent-backup","version":1,"docs":{"habits":{"schema":3,"habits":[]},"logs":{"2026-10":{"schema":1,"days":{"2026-10-05":{"ghost":{"v":1,"at":1,"dev":"d"}}}}}}}', 'not in the backup'],
    ['a misplaced date', '{"format":"ascent-backup","version":1,"docs":{"logs":{"2026-10":{"schema":1,"days":{"2026-11-05":{}}}}}}', 'another month'],
  ])('rejects %s, whole', (_label, text, message) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('a dry run of the same data changes nothing', () => {
    const s = logRange(withHabits(R(D)), D, 4, 'R', 1);
    expect(dryRun(s, s).changes).toEqual({
      entriesAdded: 0,
      entriesRemoved: 0,
      entriesChanged: 0,
      habitsAdded: [],
      habitsRemoved: [],
      settingsChanged: false,
    });
  });

  it('the CSV lists every logged habit-day, quoted where needed', () => {
    let s: Snapshot = withHabits({ ...Q(D), name: 'Qbank, hard "set"' }, R(D));
    s = log(log(log(s, D, 'Q', 42), D, 'R', 'exam'), day(D, 1), 'R', null);
    expect(exportCsv(s)).toBe('date,habit_id,habit_name,value,skip\n2026-10-05,Q,"Qbank, hard ""set""",42,\n2026-10-05,R,Review mistakes,,exam\n');
  });
});

describe('the weekly backup prompt', () => {
  const base = { lastBackup: null, firstUse: D, today: day(D, 7), dayClosed: true, firstLaunch: false, sceneActive: false };
  it('appears once a week after a day closes', () => {
    expect(backupDue(base)).toBe(true);
    expect(backupDue({ ...base, today: day(D, 6) })).toBe(false);
    expect(backupDue({ ...base, lastBackup: day(D, 3) })).toBe(false);
    expect(backupDue({ ...base, lastBackup: day(D, 0) })).toBe(true);
  });
  it('never before the day closes, during a scene, or on the first launch', () => {
    expect(backupDue({ ...base, dayClosed: false })).toBe(false);
    expect(backupDue({ ...base, sceneActive: true })).toBe(false);
    expect(backupDue({ ...base, firstLaunch: true })).toBe(false);
  });
});
