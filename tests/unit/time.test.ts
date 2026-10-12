/** Test matrix: time and history (T01 to T18). Day boundary 04:00 unless stated. */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { startCursor, tick } from '../../src/core/model/clock';
import { addDays, logicalDay } from '../../src/core/model/date';
import { correctRecord, logEntry } from '../../src/core/model/entries';
import { load } from '../../src/core/model/migrations';
import type { Snapshot } from '../../src/core/model/types';
import { Q, R, day, entry, log, logRange, withHabits } from '../fixtures/build';

const MANILA = 'Asia/Manila';
const B = 240;
const at = (iso: string): number => Date.parse(iso);

describe('time and history', () => {
  it('T01: passing midnight with the app open does not roll the day', () => {
    const c = startCursor(at('2026-10-12T23:59:00+08:00'), MANILA, B);
    const t = tick(c, at('2026-10-13T00:01:00+08:00'), MANILA, B);
    expect(c.date).toBe('2026-10-12');
    expect(t.kind).toBe('same');
  });

  it('T02: passing 04:00 ends the previous day', () => {
    const c = startCursor(at('2026-10-13T03:59:00+08:00'), MANILA, B);
    expect(c.date).toBe('2026-10-12');
    const t = tick(c, at('2026-10-13T04:00:00+08:00'), MANILA, B);
    expect(t.kind).toBe('rolled');
    if (t.kind === 'rolled') {
      expect(t.cursor.date).toBe('2026-10-13');
      expect(t.ended).toEqual(['2026-10-12']);
    }
  });

  it('T03: night shift, boundary 08:00: a 06:30 log counts for the previous date', () => {
    expect(logicalDay(new Date('2026-10-13T06:30:00+08:00'), MANILA, 480)).toBe('2026-10-12');
  });

  const D1 = '2026-10-01';
  const today = day(D1, 9); // day 10

  it('T04: logging day 8 from day 10 is accepted and re-derived', () => {
    const s0 = withHabits(R(D1));
    const r = logEntry(s0, today, day(D1, 7), 'R', entry(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(derive(r.snapshot, { date: today, ended: false }).storyDayEarned).toBe(1);
  });

  it('T05: logging day 5 from the checklist on day 10 is refused', () => {
    const s0 = withHabits(R(D1));
    const r = logEntry(s0, today, day(D1, 4), 'R', entry(1));
    expect(r).toEqual({ ok: false, reason: 'final' });
    expect(logEntry(s0, today, day(D1, 10), 'R', entry(1))).toEqual({ ok: false, reason: 'future' });
  });

  it('T06: correct the record on a final day: entry plus correction log; all re-derived', () => {
    const s0 = withHabits(R(D1));
    const r = correctRecord(s0, today, day(D1, 4), 'R', entry(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.corrections.log).toHaveLength(1);
    expect(r.snapshot.corrections.log[0]).toMatchObject({ date: day(D1, 4), habit: 'R', old: null });
    expect(derive(r.snapshot, { date: today, ended: false }).days[day(D1, 4)]?.outcome).toBe('closed');
    // Seen is never touched by a correction (no scene replays).
    expect(r.snapshot.seen).toBe(s0.seen);
  });

  it('T07: a record whose basis is corrected away disappears', () => {
    const mon = '2026-10-05';
    let s = logRange(withHabits(R(mon)), mon, 7, 'R', 1);
    const now = { date: day(mon, 20), ended: false };
    expect(derive(s, now).records.map((r) => r.id)).toContain('first-closed-week');
    const r = correctRecord(s, now.date, day(mon, 3), 'R', entry(null));
    expect(r.ok).toBe(true);
    if (r.ok) s = r.snapshot;
    expect(derive(s, now).records.map((x) => x.id)).not.toContain('first-closed-week');
  });

  it('T08: a correction that unmakes a closed week leaves seen untouched', () => {
    const mon = '2026-10-05';
    let s = logRange(withHabits(R(mon)), mon, 7, 'R', 1);
    s = { ...s, seen: { ...s.seen, moments: ['first-closed-week'] } };
    const r = correctRecord(s, day(mon, 20), day(mon, 2), 'R', entry(null));
    expect(r.ok && r.snapshot.seen.moments).toEqual(['first-closed-week']);
    if (r.ok) expect(derive(r.snapshot, { date: day(mon, 20), ended: false }).days[day(mon, 2)]?.outcome).toBe('missed');
  });

  it('T09: a miss inserted at day 15 of a 30-day chain is recomputed by the forgiveness rule', () => {
    let s = logRange(withHabits(R(D1)), D1, 30, 'R', 1);
    const now = { date: day(D1, 29), ended: true };
    expect(derive(s, now).chains.R?.current).toBe(30);
    const r = correctRecord(s, now.date, day(D1, 14), 'R', entry(null));
    if (r.ok) s = r.snapshot;
    expect(derive(s, now).chains.R?.current).toBe(29);
    const r2 = correctRecord(s, now.date, day(D1, 17), 'R', entry(null));
    if (r2.ok) s = r2.snapshot;
    expect(derive(s, now).chains.R?.history.map((h) => h.length)).toEqual([16, 12]);
  });

  it('T10: travelling from Manila to UTC-5 keeps today; the next day starts at local 04:00', () => {
    const c = startCursor(at('2026-10-12T09:00:00+08:00'), MANILA, B);
    // Fly to New York: 12 hours later it is 09:00 on the 12th in New York (UTC-4 in October).
    const ny = 'America/New_York';
    const t1 = tick(c, at('2026-10-12T21:00:00+08:00'), ny, B);
    if (t1.kind !== 'same') throw new Error('expected the same day');
    // Manila 04:00 on the 13th has passed but it is still the 12th in New York: no roll.
    const t2 = tick(t1.cursor, at('2026-10-13T05:00:00+08:00'), ny, B);
    expect(t2.kind).toBe('same');
    // New York 04:00 on the 13th: the next day begins, exactly one day ended.
    const t3 = tick(c, at('2026-10-13T04:00:00-04:00'), ny, B);
    expect(t3.kind).toBe('rolled');
    if (t3.kind === 'rolled') expect(t3.ended).toEqual(['2026-10-12']);
  });

  it('T11: crossing the date line creates and deletes no day', () => {
    // Westward, Manila to Honolulu: the date goes back locally; the logical day must not.
    const c = startCursor(at('2026-10-12T10:00:00+08:00'), MANILA, B);
    const west = tick(c, at('2026-10-12T20:00:00+08:00'), 'Pacific/Honolulu', B);
    expect(west.kind).toBe('same');
    // Eastward, Honolulu to Kiritimati (UTC+14): local date jumps two; we roll one at a time.
    const h = startCursor(at('2026-10-12T20:00:00-10:00'), 'Pacific/Honolulu', B);
    // Honolulu 05:00 on the 13th is 05:00 on the 14th in Kiritimati: two local dates in 9 hours.
    const east = tick(h, at('2026-10-13T05:00:00-10:00'), 'Pacific/Kiritimati', B);
    expect(east.kind).toBe('rolled');
    if (east.kind === 'rolled') {
      expect(east.ended).toEqual(['2026-10-12']);
      expect(east.cursor.date).toBe('2026-10-13');
    }
  });

  it('T12: 29 February is an ordinary day', () => {
    const d = '2028-02-28';
    const s = logRange(withHabits(R(d)), d, 3, 'R', 1);
    const out = derive(s, { date: '2028-03-01', ended: true });
    expect(out.days['2028-02-29']?.outcome).toBe('closed');
    expect(out.chains.R?.current).toBe(3);
  });

  it('T13: a week spanning 31 December counts Monday to Sunday across years', () => {
    const mon = '2029-12-31';
    let s = withHabits(Q(mon, { kind: 'perWeek', n: 3 }));
    for (const i of [0, 1, 2]) s = log(s, day(mon, i), 'Q', 50);
    const d = derive(s, { date: day(mon, 6), ended: true });
    expect(d.chains.Q?.current).toBe(1);
    expect(d.chains.Q?.history[0]).toEqual({ from: mon, to: '2030-01-06', length: 1 });
  });

  it('T14: never logged: story day 0, no error', () => {
    const d = derive(withHabits(), { date: '2026-10-12', ended: false });
    expect(d.storyDayEarned).toBe(0);
    expect(d.condition.fatigue).toBe('fresh');
  });

  it('T15: 180 days away: missed days, story paused, fatigue reset on return', () => {
    let s = logRange(withHabits(R(D1)), D1, 10, 'R', 1);
    const back = day(D1, 190);
    const d = derive(s, { date: back, ended: false });
    expect(d.storyDayEarned).toBe(10);
    const missed = Object.values(d.days).filter((x) => x.outcome === 'missed').length;
    expect(missed).toBe(180);
    expect(d.condition.fatigue).toBe('fresh');
    s = log(s, back, 'R', 1);
    expect(derive(s, { date: back, ended: false }).storyDayEarned).toBe(11);
  });

  it('T16: 365 days away with old schema documents: migrated, nothing lost', () => {
    const old = { days: { '2026-10-01': { R: { v: 1, at: 1, dev: 'x' } } } }; // schema 0
    const r = load('log', old);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s: Snapshot = { ...withHabits(R(D1)), logs: { '2026-10': r.value } };
    const d = derive(s, { date: addDays(D1, 366), ended: false });
    expect(d.days[D1]?.outcome).toBe('closed');
    expect(d.storyDayEarned).toBe(1);
  });

  it('T17: five years and ten habits derive in under 300 ms', () => {
    const start = '2026-01-01';
    const habits = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? R(start, { kind: 'daily' }, `r${i}`) : { ...Q(start), id: `q${i}` },
    );
    let s = withHabits(...habits);
    const n = 5 * 365;
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < n; i++) {
      for (const h of habits) {
        const x = rnd();
        if (x < 0.15) continue;
        s = log(s, addDays(start, i), h.id, x < 0.2 ? 'skip' : h.id.startsWith('q') ? Math.floor(x * 70) : 1);
      }
    }
    expect(Object.keys(s.logs).length).toBeGreaterThanOrEqual(60);
    const now = { date: addDays(start, n - 1), ended: false };
    derive(s, now); // warm-up
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      derive(s, now);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    // Median on the test machine; the phone budget is checked again with the probe at M9.
    expect(runs[2]).toBeLessThan(300);
  });

  it('T18: a clock set 3 days ahead asks before finalising', () => {
    const c = startCursor(at('2026-10-12T09:00:00+08:00'), MANILA, B);
    const t = tick(c, at('2026-10-15T10:00:00+08:00'), MANILA, B);
    expect(t.kind).toBe('confirm');
    if (t.kind === 'confirm') expect(t.ended).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    // A clock set back never moves the day backwards.
    expect(tick(c, at('2026-10-10T09:00:00+08:00'), MANILA, B).kind).toBe('same');
  });
});

describe('clock after an eastward short day', () => {
  it('catches up one date at a time without skipping', () => {
    const h = startCursor(at('2026-10-12T20:00:00-10:00'), 'Pacific/Honolulu', B);
    const first = tick(h, at('2026-10-13T05:00:00-10:00'), 'Pacific/Kiritimati', B);
    if (first.kind !== 'rolled') throw new Error('expected a roll');
    // Still the 14th locally; too soon to roll again.
    expect(tick(first.cursor, at('2026-10-13T07:00:00-10:00'), 'Pacific/Kiritimati', B).kind).toBe('same');
    const later = tick(first.cursor, at('2026-10-13T18:00:00-10:00'), 'Pacific/Kiritimati', B);
    expect(later.kind).toBe('rolled');
    if (later.kind === 'rolled') expect(later.ended).toEqual(['2026-10-13']);
  });
});

describe('clock without travel', () => {
  it('a 26-hour gap across two boundaries ends both days', () => {
    const c = startCursor(at('2026-10-12T03:00:00+08:00'), MANILA, B); // logical 11th
    const t = tick(c, at('2026-10-13T05:00:00+08:00'), MANILA, B);
    expect(t.kind).toBe('rolled');
    if (t.kind === 'rolled') expect(t.ended).toEqual(['2026-10-11', '2026-10-12']);
  });
});
