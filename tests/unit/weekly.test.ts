/** The weekly climb (docs/decisions/weekly-climb.md). Q: 50 a day. R: daily, binary. */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { addDays } from '../../src/core/model/date';
import type { Profile, Snapshot } from '../../src/core/model/types';
import { chooseSteep } from '../../src/core/habits/weekly';
import { Q, R, day, log, logRange, withHabits } from '../fixtures/build';

const MON = '2026-10-12';
const wk = (n: number): string => addDays(MON, 7 * n);
const endOf = (n: number) => ({ date: addDays(wk(n), 6), ended: true });

/** Fill week n so that Q totals q and R is done on r days. */
function week(s: Snapshot, n: number, q: number, r: number): Snapshot {
  let out = s;
  if (q > 0) out = log(out, addDays(wk(n), 6), 'Q', q); // all on Sunday: totals count
  out = logRange(out, wk(n), r, 'R', 1);
  return out;
}

function withSteep(s: Snapshot, weeks: string[]): Snapshot {
  const profile: Profile = {
    schema: 2,
    identity: '',
    startDate: MON,
    settings: { dayBoundary: 240, timeZone: 'Asia/Manila', sound: true, music: true, reducedMotion: false },
    weekly: { steep: weeks },
  };
  return { ...s, profile };
}

const base = (): Snapshot => withHabits(Q(MON), R(MON));

describe('weekly score', () => {
  it('a big Sunday counts: 350 on one day is a full week of Qbank', () => {
    const s = week(base(), 0, 350, 7);
    const w = derive(s, endOf(0)).climb.weeks[0];
    expect(w?.raw).toBe(1);
    expect(w?.verdict).toBe('summit');
    expect(w?.moved).toBe(1);
  });

  it('each habit is capped at its own plan: 700 questions cannot cover a missed habit', () => {
    const s = week(base(), 0, 700, 0);
    const w = derive(s, endOf(0)).climb.weeks[0];
    expect(w?.raw).toBeCloseTo(0.5, 10);
  });

  it('bands: 85 summit, 50 climb, 30 hold, under 30 slip', () => {
    const verdict = (q: number, r: number) => derive(week(base(), 0, q, r), endOf(0)).climb.weeks[0]?.verdict;
    expect(verdict(200, 4)).toBe('climb'); // (0.571 + 0.571) / 2
    expect(verdict(140, 2)).toBe('hold'); // (0.4 + 0.286) / 2 = 0.343
    expect(verdict(35, 1)).toBe('slip'); // (0.1 + 0.143) / 2
    expect(verdict(300, 6)).toBe('summit'); // (0.857 + 0.857) / 2
  });

  it('the live gauge is a share of the whole week, and nothing moves until Sunday ends', () => {
    let s = log(log(base(), MON, 'Q', 50), MON, 'R', 1);
    const d = derive(s, { date: MON, ended: false });
    expect(d.climb.current?.raw).toBeCloseTo(1 / 7, 10);
    expect(d.climb.stage).toBe(0);
    s = week(s, 0, 300, 7);
    const live = derive(s, { date: addDays(MON, 6), ended: false });
    expect(live.climb.current?.verdict).toBe('summit');
    expect(live.climb.weeks).toHaveLength(0);
    expect(derive(s, endOf(0)).climb.stage).toBe(1);
  });
});

describe('stages', () => {
  it('a slip never crosses the chapter base camp', () => {
    let s = base();
    for (let n = 0; n < 4; n++) s = week(s, n, 350, 7); // four climbs: stage 4, chapter 1
    s = week(s, 4, 0, 0); // slip
    const d = derive(s, endOf(4));
    expect(d.climb.weeks.map((w) => w.stageAfter)).toEqual([1, 2, 3, 4, 4]);
    expect(d.climb.chapter).toBe(1);
    const zero = derive(week(base(), 0, 0, 0), endOf(0));
    expect(zero.climb.stage).toBe(0);
  });

  it('comeback: after 2 weeks under 50%, the next climb is 2 stages, at most once in 8 weeks', () => {
    let s = base();
    s = week(s, 0, 350, 7); // climb to 1
    s = week(s, 1, 350, 7); // 2
    s = week(s, 2, 140, 2); // hold
    s = week(s, 3, 0, 0); // slip to 1? floor is 0, so 1
    s = week(s, 4, 200, 4); // comeback climb: +2
    s = week(s, 5, 140, 2); // hold
    s = week(s, 6, 140, 2); // hold
    s = week(s, 7, 200, 4); // within 8 weeks of the last comeback: +1 only
    const d = derive(s, endOf(7));
    expect(d.climb.weeks.map((w) => w.moved)).toEqual([1, 1, 0, -1, 2, 0, 0, 1]);
    expect(d.climb.weeks[4]?.comeback).toBe(true);
    expect(d.climb.weeks[7]?.comeback).toBe(false);
  });

  it('the comeback returns after the 8-week cooldown', () => {
    let s = base();
    s = week(s, 0, 0, 0);
    s = week(s, 1, 0, 0);
    s = week(s, 2, 350, 7); // comeback +2 (index 2)
    for (let n = 3; n < 8; n++) s = week(s, n, 350, 7);
    s = week(s, 8, 0, 0);
    s = week(s, 9, 0, 0);
    s = week(s, 10, 350, 7); // index 10: 8 weeks later, offered again
    const d = derive(s, endOf(10));
    expect(d.climb.weeks[2]?.moved).toBe(2);
    expect(d.climb.weeks[10]?.comeback).toBe(true);
  });
});

describe('steep line', () => {
  it('is locked for the first 4 counted weeks', () => {
    let s = withSteep(base(), [wk(0)]);
    s = week(s, 0, 280, 6);
    const d = derive(s, endOf(0));
    expect(d.climb.weeks[0]?.steep).toBe(false);
    expect(d.climb.steepUnlocked).toBe(false);
  });

  it('70% climbs one stage and earns a 10% head start; 50 to 69% holds', () => {
    let s = base();
    for (let n = 0; n < 4; n++) s = week(s, n, 350, 7);
    s = withSteep(s, [wk(4), wk(5), wk(6)]);
    s = week(s, 4, 280, 5); // (0.8 + 0.714) / 2 = 0.757: climb + head start
    s = week(s, 5, 140, 3); // raw 0.414 + 0.1 = 0.514, steep: hold
    s = week(s, 6, 70, 1); // raw 0.171, steep: slip
    const d = derive(s, endOf(6));
    const [w4, w5, w6] = d.climb.weeks.slice(4);
    expect(w4).toMatchObject({ steep: true, verdict: 'climb', moved: 1, headstartOut: 0.1 });
    expect(w5?.headstartIn).toBe(0.1);
    expect(w5?.score).toBeCloseTo(0.514, 3);
    expect(w5).toMatchObject({ verdict: 'hold', moved: 0, headstartOut: 0 });
    expect(w6?.verdict).toBe('slip');
    expect(d.climb.steepUnlocked).toBe(true);
  });

  it('the head start helps a normal week too', () => {
    let s = base();
    for (let n = 0; n < 4; n++) s = week(s, n, 350, 7);
    s = withSteep(s, [wk(4)]);
    s = week(s, 4, 350, 7); // summit on the steep line: head start
    s = week(s, 5, 140, 3); // raw 0.414 + 0.1 = 0.514: climb
    const d = derive(s, endOf(5));
    expect(d.climb.weeks[5]?.verdict).toBe('climb');
  });
});

describe('rest and sick days', () => {
  it('a sick day keeps the streak, advances no story, and leaves the week plan', () => {
    let s = logRange(withHabits(R(MON)), MON, 3, 'R', 1);
    s = log(s, day(MON, 3), 'R', 'sick');
    s = logRange(s, day(MON, 4), 3, 'R', 1);
    const d = derive(s, endOf(0));
    expect(d.days[day(MON, 3)]?.outcome).toBe('excused');
    expect(d.storyDayEarned).toBe(6);
    expect(d.chains.R?.current).toBe(6);
    expect(d.climb.weeks[0]?.raw).toBe(1);
  });

  it('a week with 4 or more rest or sick days can hold but not climb', () => {
    let s = withHabits(R(MON));
    for (let i = 0; i < 4; i++) s = log(s, day(MON, i), 'R', i % 2 ? 'sick' : 'rest');
    s = logRange(s, day(MON, 4), 3, 'R', 1);
    const w = derive(s, endOf(0)).climb.weeks[0];
    expect(w?.raw).toBe(1);
    expect(w?.verdict).toBe('hold');
  });

  it('a week with nothing planned is a rest week: nothing moves and the weekly chain holds', () => {
    let s = week(withHabits(R(MON)), 0, 0, 7);
    for (let i = 0; i < 7; i++) s = log(s, day(MON, 7 + i), 'R', 'sick');
    s = week(s, 2, 0, 7);
    const d = derive(s, endOf(2));
    expect(d.climb.weeks.map((w) => w.verdict)).toEqual(['summit', 'rest', 'summit']);
    expect(d.climb.weeklyChain).toBe(2);
  });
});

describe('choosing the steep line', () => {
  const unlocked = (): Snapshot => {
    let s = withSteep(base(), []);
    for (let n = 0; n < 4; n++) s = week(s, n, 350, 7);
    return s;
  };

  it('is allowed on a fresh week once unlocked, and only once', () => {
    const s = unlocked();
    const today = wk(4);
    const d = derive(s, { date: today, ended: false });
    const r = chooseSteep(s, d.climb, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.profile?.weekly.steep).toEqual([wk(4)]);
    expect(chooseSteep(r.snapshot, d.climb, today)).toEqual({ ok: false, reason: 'alreadyChosen' });
  });

  it('is refused after the week has started, or while locked', () => {
    const s = log(unlocked(), wk(4), 'R', 1);
    const today = day(wk(4), 1);
    expect(chooseSteep(s, derive(s, { date: today, ended: false }).climb, today)).toEqual({ ok: false, reason: 'weekStarted' });
    const fresh = withSteep(base(), []);
    expect(chooseSteep(fresh, derive(fresh, { date: MON, ended: false }).climb, MON)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('the built-in water habit', () => {
  const water = (d: string) => ({
    id: 'water',
    name: 'Water',
    category: 'care' as const,
    createdOn: d,
    system: 'water' as const,
    versions: [{ from: d, type: 'numeric' as const, unit: 'glasses', target: 8, minimum: 6, schedule: { kind: 'daily' as const } }],
  });

  it('has its own bar and streak but never moves the story day or the climb', () => {
    let s = withHabits(R(MON), water(MON));
    s = logRange(s, MON, 7, 'water', 8);
    const only = derive(s, endOf(0));
    expect(only.storyDayEarned).toBe(0);
    expect(only.climb.weeks[0]?.raw).toBe(0);
    expect(only.water).toMatchObject({ habit: 'water', today: 8, target: 8, streak: 7 });
    expect(only.lifetime.fulfilled).toBe(0);
    // With the real habit done, water changes nothing in the climb.
    s = week(s, 0, 0, 7);
    const both = derive(s, endOf(0));
    const without = derive(week(withHabits(R(MON)), 0, 0, 7), endOf(0));
    expect(both.climb).toEqual(without.climb);
    expect(both.storyDayEarned).toBe(without.storyDayEarned);
  });
});
