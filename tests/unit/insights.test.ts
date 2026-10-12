/** Game screens: standings, leagues (solo, own targets), trophies and advice. */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { advice, leagues, standings, tierOf, trophies } from '../../src/core/insights';
import { Q, R, day, log, logRange, withHabits } from '../fixtures/build';

const MON = '2026-09-07'; // a Monday, five weeks before the "today" below
const TODAY = '2026-10-14'; // a Wednesday

describe('standings and leagues', () => {
  it('consistency is the mean of ended weeks against the habit’s own plan', () => {
    let s = withHabits({ ...R(MON), tag: { family: 'study', group: 'medical-exams' } }, { ...Q(MON), tag: { family: 'study', group: 'medical-exams' } });
    s = logRange(s, MON, 35, 'R', 1); // every day for five weeks
    for (let i = 0; i < 35; i += 7) s = log(s, day(MON, i), 'Q', 175); // one big Monday: half the weekly 350
    const d = derive(s, { date: TODAY, ended: false });
    const list = standings(s, d, TODAY);
    const r = list.find((x) => x.habit.id === 'R')!;
    const q = list.find((x) => x.habit.id === 'Q')!;
    expect(r.past).toEqual([1, 1, 1, 1]);
    expect(r.consistency).toBe(1);
    expect(q.consistency).toBeCloseTo(0.5, 10); // a big day counts toward the week's total
    const [lg] = leagues(list);
    expect(lg?.group.id).toBe('medical-exams');
    expect(lg?.board.map((b) => b.habit.id)).toEqual(['R', 'Q']); // most consistent first
    expect(lg?.consistency).toBeCloseTo(0.75, 10);
    expect(lg?.tier).toBe('ridge');
    expect(lg?.next).toEqual({ tier: 'summit', at: 0.85 });
  });

  it('a habit with no ended week is judged on this week so far; water never joins a league', () => {
    const s = log(withHabits(R('2026-10-12'), { ...R('2026-10-12', { kind: 'daily' }, 'water'), system: 'water' as const }), '2026-10-12', 'R', 1);
    const d = derive(s, { date: TODAY, ended: false });
    const list = standings(s, d, TODAY);
    expect(list.map((x) => x.habit.id)).toEqual(['R']);
    expect(list[0]?.past).toEqual([]);
    expect(list[0]?.consistency).toBe(list[0]?.thisWeek);
  });

  it('tiers sit on the climb bands', () => {
    expect([tierOf(null), tierOf(0.49), tierOf(0.5), tierOf(0.7), tierOf(0.85)]).toEqual(['foothills', 'foothills', 'trail', 'ridge', 'summit']);
  });
});

describe('trophies and advice', () => {
  it('gear follows days shown up; a 7-day streak earns seven fires', () => {
    const s = logRange(withHabits(R(MON)), MON, 16, 'R', 1);
    const t = trophies(derive(s, { date: day(MON, 16), ended: false }));
    const by = (id: string) => t.find((x) => x.id === id)!;
    expect(by('gear-satchel').earned).toBe(true);
    expect(by('gear-scarf').earned).toBe(true); // 15 days
    expect(by('gear-axe').earned).toBe(false);
    expect(by('gear-axe').progress).toBeCloseTo(16 / 60, 10);
    expect(by('seven-fires').earned).toBe(true);
    expect(by('thirty-fires').earned).toBe(false);
  });

  it('advice names the shortest rope when the week is short of the climb, at most three lines', () => {
    let s = withHabits(R('2026-10-12'), Q('2026-10-12'));
    s = log(log(s, '2026-10-12', 'R', 1), '2026-10-13', 'R', 1);
    const d = derive(s, { date: TODAY, ended: false });
    const a = advice(d, standings(s, d, TODAY), TODAY, false);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a[0]?.id).toBe('weakest');
    expect(a[0]?.text).toContain('Qbank');
  });
});
