/**
 * Test matrix: habits and scheduling (H01 to H24).
 * Q: numeric, target 50, minimum 25. R: binary. Day 1 is Monday 2026-10-12.
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { addDays, weekday } from '../../src/core/model/date';
import { entryOn, mergeEntry } from '../../src/core/model/entries';
import { archiveHabit, createHabit, editDefinition, restoreHabit } from '../../src/core/habits/versions';
import { DEV, Q, R, day, emptySnapshot, entry, log, logRange, withHabits } from '../fixtures/build';
import type { Snapshot } from '../../src/core/model/types';

const D1 = '2026-10-12'; // Monday
const open = (date: string) => ({ date, ended: false });

describe('habits and scheduling', () => {
  it('H01: no habits: every day free, story day 0', () => {
    const d = derive(emptySnapshot(), open(D1));
    expect(d.storyDayEarned).toBe(0);
    expect(Object.values(d.days).some((x) => x.outcome === 'missed')).toBe(false);
  });

  it('H02: one binary habit logged: day closed, story day 1', () => {
    const s = log(withHabits(R(D1)), D1, 'R', 1);
    const d = derive(s, open(D1));
    expect(d.days[D1]?.outcome).toBe('closed');
    expect(d.storyDayEarned).toBe(1);
  });

  it('H03: Q and R both logged in full: closed', () => {
    let s = withHabits(Q(D1), R(D1));
    s = log(log(s, D1, 'Q', 50), D1, 'R', 1);
    const d = derive(s, open(D1));
    expect(d.days[D1]?.outcome).toBe('closed');
    expect(d.days[D1]?.progress).toBe(1);
  });

  it('H04: 20 habits, one logged: partial, story advances, walk 5%', () => {
    const habits = Array.from({ length: 20 }, (_, i) => R(D1, { kind: 'daily' }, `h${i}`));
    const s = log(withHabits(...habits), D1, 'h0', 1);
    const d = derive(s, open(D1));
    expect(d.days[D1]?.outcome).toBe('partial');
    expect(d.storyDayEarned).toBe(1);
    expect(d.days[D1]?.progress).toBeCloseTo(0.05, 10);
  });

  it('H05: Q set to 0 stays open, not attempted', () => {
    const s = log(withHabits(Q(D1)), D1, 'Q', 0);
    const d = derive(s, open(D1));
    expect(d.days[D1]?.states.Q).toBe('open');
    expect(d.days[D1]?.progress).toBe(0);
  });

  it.each([
    [30, 'held', 0.6],
    [49, 'held', 0.98],
    [50, 'fulfilled', 1],
    [100, 'fulfilled', 1],
    [25, 'held', 0.5],
    [1, 'attempted', 0.02],
  ] as const)('H06 to H09: Q set to %d is %s with credit %d', (v, state, credit) => {
    const s = log(withHabits(Q(D1)), D1, 'Q', v);
    const d = derive(s, open(D1));
    expect(d.days[D1]?.states.Q).toBe(state);
    expect(d.days[D1]?.progress).toBeCloseTo(credit, 10);
    expect(d.days[D1]?.progress).toBeLessThanOrEqual(1);
  });

  it('H09: a value over target is stored as entered', () => {
    const s = log(withHabits(Q(D1)), D1, 'Q', 100);
    expect(entryOn(s, D1, 'Q')?.v).toBe(100);
  });

  it('H10: undo removes the entry; R open; no stale chain', () => {
    let s = log(withHabits(R(D1)), D1, 'R', 1);
    expect(derive(s, open(D1)).chains.R?.current).toBe(1);
    s = log(s, D1, 'R', null);
    const d = derive(s, open(D1));
    expect(entryOn(s, D1, 'R')).toBeUndefined();
    expect(d.days[D1]?.states.R).toBe('open');
    expect(d.chains.R?.current).toBe(0);
    expect(d.storyDayEarned).toBe(0);
  });

  it('H11: 25 toggles keep only the final value', () => {
    let s = withHabits(R(D1));
    for (let i = 0; i < 25; i++) s = log(s, D1, 'R', i % 2 === 0 ? 1 : null);
    expect(Object.keys(s.logs['2026-10']?.days[D1] ?? {})).toEqual(['R']);
    expect(entryOn(s, D1, 'R')?.v).toBe(1);
    expect(derive(s, open(D1)).days[D1]?.states.R).toBe('fulfilled');
  });

  it('H12: a weekday habit on a non-chosen day is unscheduled and the day free', () => {
    const tue = day(D1, 1);
    const s = withHabits(R(D1, { kind: 'weekdays', days: [1, 3, 5] }));
    const d = derive(s, { date: tue, ended: true });
    expect(weekday(tue)).toBe(2);
    expect(d.days[tue]?.states.R).toBe('unscheduled');
    expect(d.days[tue]?.outcome).toBe('free');
  });

  it('H13: nothing logged by the boundary: missed, story paused', () => {
    const s = withHabits(Q(D1), R(D1));
    const d = derive(s, { date: D1, ended: true });
    expect(d.days[D1]?.outcome).toBe('missed');
    expect(d.storyDayEarned).toBe(0);
  });

  it('H14: a skip needs no reason', () => {
    const s = log(withHabits(R(D1)), D1, 'R', 'skip');
    expect(entryOn(s, D1, 'R')?.skip).toBe(true);
    expect(derive(s, open(D1)).days[D1]?.states.R).toBe('skipped');
  });

  it('H15: daily changed to 3 a week on day 40: earlier days keep the daily rule; a new chain', () => {
    const day40 = day(D1, 39);
    let s = logRange(withHabits(R(D1)), D1, 39, 'R', 1);
    const before = derive(s, { date: addDays(day40, -1), ended: true });
    s = { ...s, habits: editDefinition(s.habits, 'R', day40, { type: 'binary', target: 1, schedule: { kind: 'perWeek', n: 3 } }) };
    s = log(s, day40, 'R', 1);
    const after = derive(s, open(day40));
    for (let i = 0; i < 39; i++) {
      const d = day(D1, i);
      expect(after.days[d]).toEqual(before.days[d]);
    }
    expect(after.chains.R?.history[0]?.length).toBe(39);
    // The new weekly unit runs Friday to Sunday and needs 3; one so far, so it is still current.
    expect(after.chains.R?.current).toBe(0);
    expect(after.chains.R?.history).toHaveLength(1);
  });

  it('H16: target raised mid-chain: the chain continues; the new target applies from today', () => {
    let s = logRange(withHabits(Q(D1)), D1, 20, 'Q', 50);
    const d21 = day(D1, 20);
    s = { ...s, habits: editDefinition(s.habits, 'Q', d21, { type: 'numeric', target: 80, minimum: 40, schedule: { kind: 'daily' } }) };
    s = log(s, d21, 'Q', 50);
    const d = derive(s, open(d21));
    expect(d.chains.R).toBeUndefined();
    expect(d.chains.Q?.current).toBe(21);
    expect(d.days[d21]?.states.Q).toBe('held');
    expect(d.days[day(D1, 19)]?.states.Q).toBe('fulfilled');
  });

  it('H17: archived on day 15: from day 16 free for R; earlier days kept', () => {
    const d15 = day(D1, 14);
    let s = logRange(withHabits(R(D1)), D1, 15, 'R', 1);
    s = { ...s, habits: archiveHabit(s.habits, 'R', d15) };
    expect(s.habits.habits[0]?.archivedFrom).toBe(day(D1, 15));
    const d = derive(s, { date: day(D1, 30), ended: true });
    for (let i = 15; i <= 30; i++) {
      expect(d.days[day(D1, i)]?.states.R).toBe('unscheduled');
      expect(d.days[day(D1, i)]?.outcome).toBe('free');
    }
    expect(d.days[d15]?.states.R).toBe('fulfilled');
    expect(d.storyDayEarned).toBe(15);
  });

  it('H18: a habit created on Wednesday is not scheduled Monday or Tuesday', () => {
    const wed = day(D1, 2);
    const s = { ...emptySnapshot(), habits: createHabit(emptySnapshot().habits, { id: 'R', name: 'R', category: 'repair', today: wed, definition: { type: 'binary', target: 1, schedule: { kind: 'daily' } } }) };
    const d = derive(s, open(wed));
    expect(d.days[D1]).toBeUndefined();
    expect(d.days[day(D1, 1)]).toBeUndefined();
    expect(d.days[wed]?.states.R).toBe('open');
  });

  it('H19: restored after 120 archived days: archived days stay free; returns today', () => {
    let s = logRange(withHabits(R(D1)), D1, 5, 'R', 1);
    s = { ...s, habits: archiveHabit(s.habits, 'R', day(D1, 4)) };
    const back = day(D1, 125);
    s = { ...s, habits: restoreHabit(s.habits, 'R', back) };
    expect(s.habits.habits[0]?.archivedFrom).toBeUndefined();
    const d = derive(s, open(back));
    for (let i = 5; i < 125; i++) expect(d.days[day(D1, i)]?.outcome).toBe('free');
    expect(d.days[back]?.states.R).toBe('open');
    expect(d.storyDayEarned).toBe(5);
  });

  it('H20: both skipped: rested, story advances, chains hold', () => {
    let s = withHabits(Q(D1), R(D1));
    s = logRange(logRange(s, D1, 3, 'Q', 50), D1, 3, 'R', 1);
    const d4 = day(D1, 3);
    s = log(log(s, d4, 'Q', 'rest'), d4, 'R', 'skip');
    s = log(log(s, day(D1, 4), 'Q', 50), day(D1, 4), 'R', 1);
    const d = derive(s, { date: day(D1, 4), ended: true });
    expect(d.days[d4]?.outcome).toBe('rested');
    expect(d.storyDayEarned).toBe(5);
    expect(d.chains.Q?.current).toBe(4);
    expect(d.chains.R?.current).toBe(4);
  });

  it('H21: no habits scheduled today: free; story unchanged', () => {
    const s = log(withHabits(R(D1, { kind: 'weekdays', days: [1] })), D1, 'R', 1);
    const tue = day(D1, 1);
    const d = derive(s, { date: tue, ended: true });
    expect(d.days[tue]?.outcome).toBe('free');
    expect(d.storyDayEarned).toBe(1);
  });

  it('H22: one miss after a 10-day chain is forgiven: chain 11', () => {
    let s = logRange(withHabits(R(D1)), D1, 10, 'R', 1);
    s = log(s, day(D1, 11), 'R', 1);
    const d = derive(s, { date: day(D1, 11), ended: true });
    expect(d.days[day(D1, 10)]?.outcome).toBe('missed');
    expect(d.chains.R?.current).toBe(11);
    expect(d.chains.R?.history).toHaveLength(1);
  });

  it('H23: a second miss within 7 days breaks the chain', () => {
    let s = logRange(withHabits(R(D1)), D1, 10, 'R', 1); // days 1-10
    s = logRange(s, day(D1, 11), 3, 'R', 1); // miss day 11, held 12-14
    // miss day 15 (4 days after the first miss), held 16
    s = log(s, day(D1, 15), 'R', 1);
    const d = derive(s, { date: day(D1, 15), ended: true });
    expect(d.chains.R?.history.map((h) => h.length)).toEqual([13, 1]);
    expect(d.chains.R?.current).toBe(1);
  });

  it('H23b: a second miss 7 or more days later is forgiven again', () => {
    let s = logRange(withHabits(R(D1)), D1, 10, 'R', 1); // 1-10, miss 11
    s = logRange(s, day(D1, 11), 7, 'R', 1); // 12-18, miss 19 (8 days later)
    s = log(s, day(D1, 19), 'R', 1);
    const d = derive(s, { date: day(D1, 19), ended: true });
    expect(d.chains.R?.current).toBe(18);
  });

  it('H24: 3 times a week, 2 held by Sunday: week not held; weekly chain breaks', () => {
    // Week 1 held (3), week 2 only 2, week 3 only 1: two missed weeks in a row break the chain.
    let s = withHabits(Q(D1, { kind: 'perWeek', n: 3 }));
    for (const i of [0, 2, 4]) s = log(s, day(D1, i), 'Q', 50);
    for (const i of [7, 9]) s = log(s, day(D1, i), 'Q', 50);
    const sun2 = day(D1, 13);
    const d = derive(s, { date: sun2, ended: true });
    expect(d.chains.Q?.current).toBe(1); // week 2's miss is pending, not yet broken
    for (const i of [14]) s = log(s, day(D1, i), 'Q', 50);
    const d3 = derive(s, { date: day(D1, 20), ended: true });
    expect(d3.chains.Q?.current).toBe(0);
    expect(d3.chains.Q?.history.map((h) => h.length)).toEqual([1]);
    // Unlogged quota days are not misses.
    expect(d.days[day(D1, 1)]?.outcome).toBe('free');
    expect(d.days[day(D1, 1)]?.states.Q).toBe('open');
    // Once the week's count is met, the rest of the week is unscheduled.
    expect(d.days[day(D1, 5)]?.states.Q).toBe('unscheduled');
  });
});

describe('merge rules', () => {
  it('the later write wins regardless of arrival order', () => {
    const base = withHabits(R(D1));
    const a = { v: 1, at: 100, dev: 'a' };
    const b = { at: 200, dev: 'b' };
    const s1 = mergeEntry(mergeEntry(base, D1, 'R', a), D1, 'R', b);
    const s2 = mergeEntry(mergeEntry(base, D1, 'R', b), D1, 'R', a);
    expect(s1.logs).toEqual(s2.logs);
    expect(entryOn(s1, D1, 'R')).toBeUndefined();
  });

  it('two devices on different habits the same day never overwrite each other', () => {
    let s: Snapshot = withHabits(Q(D1), R(D1));
    s = mergeEntry(s, D1, 'Q', { v: 50, at: 10, dev: 'phone' });
    s = mergeEntry(s, D1, 'R', { v: 1, at: 11, dev: 'laptop' });
    expect(entryOn(s, D1, 'Q')?.v).toBe(50);
    expect(entryOn(s, D1, 'R')?.v).toBe(1);
  });

  it('builders produce valid entries', () => {
    expect(entry(1).dev).toBe(DEV);
  });
});
