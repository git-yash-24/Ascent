/**
 * Invariants checked on random histories (build plan: Invariants I1, I2, I3, I6, I9, I11).
 * The rest (I4, I5, I7, I8, I10) arrive with the modules they constrain.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { derive, SHOWN_UP } from '../../src/core/derive';
import { addDays, monthOf } from '../../src/core/model/date';
import { entryOn, logEntry, mergeEntry } from '../../src/core/model/entries';
import { parse } from '../../src/core/model/schemas';
import type { Habit, Snapshot } from '../../src/core/model/types';
import { editDefinition } from '../../src/core/habits/versions';
import { version } from '../fixtures/build';
import { historyArb, scheduleArb, type History } from '../fixtures/histories';

const RUNS = Number(import.meta.env.VITE_PROPERTY_RUNS ?? 300);

const now = (h: History) => ({ date: h.today, ended: h.ended });

describe('invariants', () => {
  it('I1: logging the same value twice never changes anything derived', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        let twice = h.snapshot;
        for (const w of h.writes) twice = mergeEntry(twice, w.date, w.habit, w.e);
        expect(twice.logs).toEqual(h.snapshot.logs);
        expect(derive(twice, now(h))).toEqual(derive(h.snapshot, now(h)));
      }),
      { numRuns: RUNS },
    );
  });

  it('I1b: merge order does not matter (replicas converge)', () => {
    fc.assert(
      fc.property(historyArb, fc.integer(), (h, seed) => {
        const shuffled = [...h.writes].sort((a, b) => ((a.e.at * 2654435761) ^ seed) - ((b.e.at * 2654435761) ^ seed));
        let s: Snapshot = { ...h.snapshot, logs: {} };
        for (const w of shuffled) s = mergeEntry(s, w.date, w.habit, w.e);
        expect(s.logs).toEqual(h.snapshot.logs);
      }),
      { numRuns: RUNS },
    );
  });

  it('I2: every derived value is reproducible from stored documents alone', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        const stored = JSON.parse(JSON.stringify(h.snapshot)) as Snapshot;
        expect(JSON.stringify(derive(stored, now(h)))).toBe(JSON.stringify(derive(h.snapshot, now(h))));
      }),
      { numRuns: RUNS },
    );
  });

  it('I3: past days are judged by the version in force that day', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 1, max: 100 }), scheduleArb, (h, at, schedule) => {
        const habit = h.snapshot.habits.habits[0] as Habit;
        const change = addDays(habit.createdOn, at);
        if (change > h.today) return;
        const before = derive(h.snapshot, now(h));
        const edited: Snapshot = {
          ...h.snapshot,
          habits: editDefinition(h.snapshot.habits, habit.id, change, { type: 'numeric', target: 10, minimum: 5, schedule }),
        };
        const after = derive(edited, now(h));
        for (const [date, d] of Object.entries(before.days)) {
          if (date >= change) continue;
          // Quota schedules are judged per period, so the change week's days before the change
          // keep their states too: they belong to the old version's period.
          expect(after.days[date]).toEqual(d);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('I6: skipped and missed are never confused', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        const d = derive(h.snapshot, now(h));
        for (const [date, day] of Object.entries(d.days)) {
          for (const [id, state] of Object.entries(day.states)) {
            const e = entryOn(h.snapshot, date, id);
            if (state === 'skipped') expect(e?.skip).toBeDefined();
            if (state === 'missed') expect(e?.skip).toBeUndefined();
            if (e?.skip !== undefined && state !== 'unscheduled') expect(state).toBe('skipped');
          }
          if (day.outcome === 'rested') expect(Object.values(day.states)).toContain('skipped');
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('I9: invalid input never corrupts stored records', () => {
    const garbage = fc.oneof(
      fc.anything(),
      fc.record({ v: fc.oneof(fc.double(), fc.string(), fc.constant(-1), fc.constant(1e12)), at: fc.anything(), dev: fc.anything() }, { requiredKeys: [] }),
      fc.record({ v: fc.integer({ min: 0, max: 10 }), skip: fc.constant(true), at: fc.nat(), dev: fc.constant('d') }),
    );
    fc.assert(
      fc.property(historyArb, garbage, (h, g) => {
        const parsed = parse.entry(g);
        if (!parsed.ok) {
          const before = JSON.stringify(h.snapshot);
          const r = logEntry(h.snapshot, h.today, h.today, 'h0', g);
          expect(r).toEqual({ ok: false, reason: 'invalidValue' });
          expect(JSON.stringify(h.snapshot)).toBe(before);
        } else {
          expect(parsed.value.at).toBeGreaterThanOrEqual(0);
        }
        for (const log of Object.values(h.snapshot.logs)) expect(parse.log(log).ok).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('I11: adding habits never changes the story pace', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 1, max: 20 }), (h, extra) => {
        const base = derive(h.snapshot, now(h));
        const first = h.snapshot.habits.habits.reduce((m, x) => (x.createdOn < m ? x.createdOn : m), h.today);
        const added: Habit[] = Array.from({ length: extra }, (_, i) => ({
          id: `t${i}`,
          name: `trivial ${i}`,
          category: 'care' as const,
          createdOn: first,
          versions: [version(first)],
        }));
        let s: Snapshot = { ...h.snapshot, habits: { ...h.snapshot.habits, habits: [...h.snapshot.habits.habits, ...added] } };
        // The trivial habits are done exactly on the days you already showed up or rested.
        let at = 10_000_000;
        for (const [date, day] of Object.entries(base.days)) {
          const value = day.outcome === 'rested' ? { skip: true as const } : SHOWN_UP.has(day.outcome) ? { v: 1 } : null;
          if (!value) continue;
          for (const t of added) s = mergeEntry(s, date, t.id, { ...value, at: at++, dev: 'd' });
        }
        const after = derive(s, now(h));
        expect(after.storyDayEarned).toBe(base.storyDayEarned);
        expect(after.storyDayEarned).toBeLessThanOrEqual(Object.keys(after.days).length);
      }),
      { numRuns: RUNS },
    );
  });

  it('story day never exceeds the number of days', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        const d = derive(h.snapshot, now(h));
        expect(d.storyDayEarned).toBe(Object.values(d.days).filter((x) => SHOWN_UP.has(x.outcome)).length);
        for (const day of Object.values(d.days)) {
          expect(day.progress).toBeGreaterThanOrEqual(0);
          expect(day.progress).toBeLessThanOrEqual(1);
        }
        for (const c of Object.values(d.chains)) expect(c.current).toBeLessThanOrEqual(c.best);
        expect(Object.keys(h.snapshot.logs).every((m) => /^\d{4}-\d{2}$/.test(m))).toBe(true);
        expect(monthOf(h.today)).toBe(h.today.slice(0, 7));
      }),
      { numRuns: RUNS },
    );
  });
});
