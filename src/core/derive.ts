/**
 * derive: stored documents in, everything derived out. Pure and deterministic (I2).
 *
 * Order (spec: Derived values): habit-day states, day outcomes, earned story day, chains,
 * rates, lifetime counts, records, then the climber's condition.
 */
import { addDays, compareDateKeys, diffDays, weekStart } from './model/date';
import { entryOn } from './model/entries';
import type {
  DateKey,
  DayDerived,
  DayOutcome,
  Derived,
  HabitDayState,
  HabitId,
  Now,
  RecordMark,
  SkipReason,
  Snapshot,
} from './model/types';
import { computeClimb } from './habits/weekly';
import { habitChain } from './habits/chains';
import { isHeld } from './habits/state';
import { habitTimeline, type HabitDay } from './habits/timeline';

export const SHOWN_UP: ReadonlySet<DayOutcome> = new Set(['closed', 'rested', 'partial']);

/** Resolve tiers by lifetime days shown up (spec: World mapping, Resolve). */
const RESOLVE_TIERS: Array<[number, 0 | 1 | 2 | 3]> = [
  [180, 3],
  [60, 2],
  [15, 1],
];

export function outcomeOf(counted: Array<{ state: HabitDayState; skip?: SkipReason }>, isEnded: boolean): DayOutcome {
  if (counted.length === 0) return 'free';
  const all = (p: (s: HabitDayState) => boolean): boolean => counted.every((c) => p(c.state));
  const any = (p: (s: HabitDayState) => boolean): boolean => counted.some((c) => p(c.state));
  if (all((s) => s === 'skipped')) return counted.some((c) => c.skip === 'sick') ? 'excused' : 'rested';
  if (all((s) => s === 'fulfilled' || s === 'skipped') && any((s) => s === 'fulfilled')) return 'closed';
  if (any(isHeld)) return 'partial';
  return isEnded ? 'missed' : 'inProgress';
}

export function progressOf(counted: Array<{ state: HabitDayState; credit: number }>): number {
  if (counted.length === 0) return 0;
  const active = counted.filter((c) => c.state !== 'skipped');
  if (active.length === 0) return 1;
  return active.reduce((sum, c) => sum + c.credit, 0) / active.length;
}

export function derive(s: Snapshot, now: Now): Derived {
  const today = now.date;
  const habits = s.habits.habits;

  // 1. Habit-day states.
  const timelines = new Map<HabitId, HabitDay[]>();
  let first: DateKey | null = null;
  for (const h of habits) {
    const tl = habitTimeline(h, (d) => entryOn(s, d, h.id), today, now.ended);
    timelines.set(h.id, tl);
    if (tl.length > 0 && (first === null || compareDateKeys(h.createdOn, first) < 0)) first = h.createdOn;
  }

  // 2. Day outcomes.
  const days: Record<DateKey, DayDerived> = {};
  const order: DateKey[] = [];
  let fulfilled = 0;
  if (first !== null) {
    const span = diffDays(first, today) + 1;
    for (let i = 0; i < span; i++) {
      const date = addDays(first, i);
      order.push(date);
      days[date] = { outcome: 'free', progress: 0, states: {} };
    }
    for (const h of habits) {
      const tl = timelines.get(h.id) ?? [];
      const offset = diffDays(first, h.createdOn);
      tl.forEach((hd, i) => {
        const date = order[offset + i] as DateKey;
        (days[date] as DayDerived).states[h.id] = hd.state;
        if (hd.state === 'fulfilled') fulfilled++;
      });
    }
    for (let i = 0; i < order.length; i++) {
      const date = order[i] as DateKey;
      const counted: HabitDay[] = [];
      for (const h of habits) {
        const tl = timelines.get(h.id);
        if (!tl) continue;
        const hd = tl[diffDays(h.createdOn, date)];
        if (hd && hd.counted) counted.push(hd);
      }
      const isEnded = date !== today || now.ended;
      const d = days[date] as DayDerived;
      d.outcome = outcomeOf(counted, isEnded);
      d.progress = progressOf(counted);
    }
  }

  // 3. Earned story day: ended or current days that were closed, rested or partial.
  let daysShownUp = 0;
  for (const date of order) if (SHOWN_UP.has((days[date] as DayDerived).outcome)) daysShownUp++;

  // 4. Chains.
  const chains: Derived['chains'] = {};
  for (const h of habits) chains[h.id] = habitChain(h, timelines.get(h.id) ?? [], today, now.ended);

  // 5. Rates over ended days.
  const ended = order.filter((d) => d !== today || now.ended);
  const rates = { last7: rateOver(days, ended, today, 7), last30: rateOver(days, ended, today, 30) };

  // 6. Records.
  const records = deriveRecords(days, ended, chains, habits.map((h) => h.id));

  // 7. Condition.
  const todayDay = days[today];
  const warmth = todayDay ? (todayDay.outcome === 'rested' || todayDay.outcome === 'excused' ? 1 : todayDay.progress) : 0;
  const fatigueRate = rateOver(days, sinceLastAbsence(days, ended), today, 7);
  const fatigue: Derived['condition']['fatigue'] =
    fatigueRate === null || fatigueRate >= 0.75 ? 'fresh' : fatigueRate >= 0.5 ? 'tired' : 'worn';
  let resolveTier: 0 | 1 | 2 | 3 = 0;
  for (const [min, tier] of RESOLVE_TIERS) {
    if (daysShownUp >= min) {
      resolveTier = tier;
      break;
    }
  }

  return {
    days,
    chains,
    rates,
    storyDayEarned: daysShownUp,
    condition: { warmth, fatigue, resolveTier },
    records,
    lifetime: { daysShownUp, fulfilled },
    climb: computeClimb({
      habits,
      timelines,
      days,
      today,
      todayEnded: now.ended,
      steep: s.profile?.weekly.steep ?? [],
    }),
  };
}

/**
 * Mean progress over ended, non-free days in the window ending yesterday (or today, once
 * ended). Rested days count 1, missed 0. Null below 3 counted days (spec: minimum 3 days).
 */
function rateOver(days: Record<DateKey, DayDerived>, ended: DateKey[], today: DateKey, window: number): number | null {
  // The window is the last `window` calendar days that have ended.
  const lastEnded = ended[ended.length - 1] === today ? today : addDays(today, -1);
  const from = addDays(lastEnded, -(window - 1));
  let n = 0;
  let sum = 0;
  for (let i = ended.length - 1; i >= 0; i--) {
    const date = ended[i] as DateKey;
    if (compareDateKeys(date, from) < 0) break;
    const d = days[date] as DayDerived;
    if (d.outcome === 'free' || d.outcome === 'inProgress' || d.outcome === 'excused') continue;
    n++;
    sum += d.outcome === 'rested' ? 1 : d.outcome === 'missed' ? 0 : d.progress;
  }
  return n >= 3 ? sum / n : null;
}

/** Ended days after the latest run of 3 or more consecutive missed days (fatigue reset). */
function sinceLastAbsence(days: Record<DateKey, DayDerived>, ended: DateKey[]): DateKey[] {
  let run = 0;
  let cut = 0;
  ended.forEach((date, i) => {
    const o = (days[date] as DayDerived).outcome;
    if (o === 'free' || o === 'excused') return;
    if (o === 'missed') {
      run++;
      if (run >= 3) cut = i + 1;
    } else run = 0;
  });
  return ended.slice(cut);
}

function deriveRecords(
  days: Record<DateKey, DayDerived>,
  ended: DateKey[],
  chains: Derived['chains'],
  habitIds: HabitId[],
): RecordMark[] {
  const out: RecordMark[] = [];

  // First closed week: an ended Monday-to-Sunday week, every non-free day closed or rested,
  // at least one closed, and at least 3 non-free days (assumption A-M5-5).
  const endedSet = new Set(ended);
  const firstDay = ended[0];
  if (firstDay) {
    for (let mon = weekStart(firstDay); ; mon = addDays(mon, 7)) {
      const sun = addDays(mon, 6);
      if (!endedSet.has(sun)) break;
      if (compareDateKeys(mon, firstDay) < 0) continue;
      let nonFree = 0;
      let closed = 0;
      let ok = true;
      for (let i = 0; i < 7; i++) {
        const o = (days[addDays(mon, i)] as DayDerived).outcome;
        if (o === 'free' || o === 'excused') continue;
        nonFree++;
        if (o === 'closed') closed++;
        else if (o !== 'rested') ok = false;
      }
      if (ok && closed > 0 && nonFree >= 3) {
        out.push({ id: 'first-closed-week', on: sun });
        break;
      }
    }
  }

  // Longest chain per habit, once it reaches 7 units: the mark sits where that chain stands.
  for (const id of habitIds) {
    const c = chains[id];
    if (!c || c.best < 7) continue;
    const span = c.history.find((h) => h.length === c.best);
    if (span) out.push({ id: `best-chain:${id}`, on: span.to });
  }

  // Comebacks: 7 shown-up days after 7 or more consecutive missed days (free days ignored).
  let missRun = 0;
  let armed = false;
  let back = 0;
  for (const date of ended) {
    const o = (days[date] as DayDerived).outcome;
    if (o === 'free' || o === 'excused') continue;
    if (o === 'missed') {
      missRun++;
      if (missRun >= 7) {
        armed = true;
        back = 0;
      }
      continue;
    }
    missRun = 0;
    if (armed && SHOWN_UP.has(o)) {
      back++;
      if (back === 7) {
        out.push({ id: `comeback:${date}`, on: date });
        armed = false;
      }
    }
  }

  return out.sort((a, b) => compareDateKeys(a.on, b.on) || (a.id < b.id ? -1 : 1));
}
