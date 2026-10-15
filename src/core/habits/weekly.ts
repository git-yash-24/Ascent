/**
 * The weekly climb (docs/decisions/weekly-climb.md).
 *
 * Two tracks: the story advances by days shown up (derive), and Ari's altitude moves once a
 * week by the week's score. The score is each habit's share of its own weekly plan, in its own
 * unit, averaged across habits. Totals count across the week (a big Sunday counts), but each
 * habit is capped at 100% of its plan, so one habit cannot carry another.
 *
 * Bands: 85% or more summit push (climb + reward), 50% climb, 30% hold, below 30% slip.
 * - Comeback: after 2 weeks in a row under 50%, the next climb is 2 stages; at most once in
 *   8 weeks, so it cannot shorten the year.
 * - Steep line (chosen on Monday, unlocked after 4 counted weeks): the climb bar rises to 70%;
 *   reaching it earns a 10% head start on next week's gauge. 50 to 69% on the steep line holds.
 * - Planned rest and sick days come out of the plan. A week with 4 or more rested or excused
 *   days cannot climb (hold at best). A week with no plan at all is a rest week: nothing moves.
 * - Fewer than 3 countable days (7 minus rested and excused days): the week is neutral, shown
 *   as a rest week. It neither moves Ari nor breaks or extends the weekly chain or comeback count.
 * - A rest-heavy week never slips: the worst it can do is hold.
 * - Slips never cross the current chapter's base camp, and never exceed one stage a week.
 */
import { addDays, compareDateKeys, daysInMonth, diffDays, weekStart, weekday } from '../model/date';
import type { Climb, DateKey, DayDerived, Habit, HabitId, Snapshot, Verdict, WeekResult } from '../model/types';
import { isHeld } from './state';
import type { HabitDay } from './timeline';

export const CLIMB = {
  summit: 0.85,
  climb: 0.5,
  hold: 0.3,
  steepBar: 0.7,
  steepHeadstart: 0.1,
  comebackAfterWeeks: 2,
  comebackCooldownWeeks: 8,
  steepUnlockWeeks: 4,
  restHeavyDays: 4,
  /** A week needs this many countable days (not rested or excused) to be judged at all. */
  minCountableDays: 3,
  stagesPerChapter: 4,
} as const;

/** One habit's share of its plan for the week [mon, mon + 6], up to `last`. */
export function habitWeekShare(days: HabitDay[], mon: DateKey, last: DateKey): number | null {
  let planned = 0;
  let achieved = 0;
  let quotaN = 0;
  let quotaAvailable = 0;
  let quotaSkipped = 0;
  let quotaHeld = 0;
  let monthPlanned = 0;
  let monthHeld = 0;
  let lastVersion: HabitDay['version'];
  for (const d of days) {
    if (compareDateKeys(d.date, mon) < 0 || compareDateKeys(d.date, last) > 0) continue;
    const v = d.version;
    lastVersion = v;
    if (!v) continue;
    const s = v.schedule;
    if (s.kind === 'daily' || s.kind === 'weekdays') {
      if (!d.counted || d.state === 'skipped') continue;
      planned += v.target;
      achieved += v.type === 'numeric' || v.type === 'duration' ? d.value ?? 0 : isHeld(d.state) ? 1 : 0;
    } else if (s.kind === 'perWeek') {
      quotaN = s.n;
      quotaAvailable++;
      if (d.state === 'skipped') quotaSkipped++;
      if (isHeld(d.state)) quotaHeld++;
    } else {
      const y = Number(d.date.slice(0, 4));
      const m = Number(d.date.slice(5, 7));
      if (d.state !== 'skipped') monthPlanned += s.n / daysInMonth(y, m);
      if (isHeld(d.state)) monthHeld++;
    }
  }
  // A live week is judged against the whole week's plan: days still to come count in the plan,
  // so crossing 50% midweek really does secure the climb.
  const lv = lastVersion;
  if (lv && (lv.schedule.kind === 'daily' || lv.schedule.kind === 'weekdays')) {
    const sched = lv.schedule;
    for (let d = addDays(last, 1); compareDateKeys(d, addDays(mon, 6)) <= 0; d = addDays(d, 1)) {
      if (sched.kind === 'daily' || sched.days.includes(weekday(d))) planned += lv.target;
    }
  }
  if (quotaAvailable > 0) {
    // In a live week the days still to come are available too: the quota is judged over the
    // whole week, so the live gauge shows the share of the week's count done so far.
    const toCome = diffDays(last, addDays(mon, 6));
    planned += Math.min(quotaN, Math.max(0, quotaAvailable + toCome - quotaSkipped));
    achieved += Math.min(quotaHeld, quotaN);
  }
  if (monthPlanned > 0) {
    planned += monthPlanned;
    achieved += Math.min(monthHeld, monthPlanned);
  }
  if (planned <= 0) return null;
  return Math.min(1, achieved / planned);
}

export function band(score: number, steep: boolean): Exclude<Verdict, 'rest'> {
  if (score >= CLIMB.summit) return 'summit';
  if (steep) {
    if (score >= CLIMB.steepBar) return 'climb';
    if (score >= CLIMB.climb) return 'hold';
  } else if (score >= CLIMB.climb) return 'climb';
  if (score >= CLIMB.hold) return 'hold';
  return 'slip';
}

export interface ClimbInput {
  habits: Habit[];
  timelines: Map<HabitId, HabitDay[]>;
  days: Record<DateKey, DayDerived>;
  today: DateKey;
  todayEnded: boolean;
  steep: DateKey[];
}

export function computeClimb(input: ClimbInput): Climb {
  const { habits, timelines, days, today, todayEnded } = input;
  const steepSet = new Set(input.steep);
  let first: DateKey | null = null;
  for (const h of habits) if (first === null || compareDateKeys(h.createdOn, first) < 0) first = h.createdOn;

  let stage = 0;
  let headstart = 0;
  let missStreak = 0;
  let lastComeback: number | null = null;
  let counted = 0;
  let weeklyChain = 0;
  const weeks: WeekResult[] = [];
  let current: WeekResult | null = null;

  if (first !== null && compareDateKeys(first, today) <= 0) {
    const thisWeek = weekStart(today);
    let index = 0;
    for (let mon = weekStart(first); compareDateKeys(mon, thisWeek) <= 0; mon = addDays(mon, 7), index++) {
      const sun = addDays(mon, 6);
      const ended = compareDateKeys(sun, today) < 0 || (sun === today && todayEnded);
      const last = ended ? sun : today;

      const shares: number[] = [];
      for (const h of habits) {
        if (h.system) continue; // water never moves the climb
        // Timelines are indexed by days since creation: slice just this week (keeps derive linear).
        const tl = timelines.get(h.id) ?? [];
        const from = Math.max(0, diffDays(h.createdOn, mon));
        const share = habitWeekShare(tl.slice(from, from + 7), mon, last);
        if (share !== null) shares.push(share);
      }
      const raw = shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null;

      let restDays = 0;
      for (let d = mon; compareDateKeys(d, last) <= 0; d = addDays(d, 1)) {
        const o = days[d]?.outcome;
        if (o === 'rested' || o === 'excused') restDays++;
      }

      const steep = steepSet.has(mon) && counted >= CLIMB.steepUnlockWeeks;
      const comeback =
        missStreak >= CLIMB.comebackAfterWeeks &&
        (lastComeback === null || index - lastComeback >= CLIMB.comebackCooldownWeeks);
      const score = raw === null ? null : Math.min(1, raw + headstart);

      const neutral = score !== null && 7 - restDays < CLIMB.minCountableDays;
      let verdict: Verdict = score === null || neutral ? 'rest' : band(score, steep);
      if (restDays >= CLIMB.restHeavyDays && verdict !== 'rest') verdict = 'hold';

      const up = verdict === 'summit' || verdict === 'climb';
      const moved = up ? (comeback ? 2 : 1) : verdict === 'slip' ? -1 : 0;
      const floor = Math.floor(stage / CLIMB.stagesPerChapter) * CLIMB.stagesPerChapter;
      const stageAfter = Math.max(floor, stage + moved);
      const headstartOut = steep && up && score !== null && score >= CLIMB.steepBar ? CLIMB.steepHeadstart : 0;

      const result: WeekResult = {
        week: mon,
        raw,
        score,
        headstartIn: headstart,
        steep,
        comeback,
        verdict,
        moved: stageAfter - stage,
        stageAfter,
        headstartOut,
        restDays,
        ...(neutral ? { neutral: true } : {}),
      };

      if (!ended) {
        current = result;
        break;
      }
      weeks.push(result);
      stage = stageAfter;
      headstart = headstartOut;
      if (score !== null && !neutral) {
        counted++;
        if (score < CLIMB.climb) {
          missStreak++;
          weeklyChain = 0;
        } else {
          missStreak = 0;
          weeklyChain++;
        }
        if (comeback && up) {
          lastComeback = index;
          missStreak = 0;
        }
      }
    }
  }

  return {
    stage,
    chapter: Math.floor(stage / CLIMB.stagesPerChapter),
    weeks,
    current,
    steepUnlocked: counted >= CLIMB.steepUnlockWeeks,
    weeklyChain,
  };
}

export type SteepRefusal = 'noProfile' | 'locked' | 'alreadyChosen' | 'weekStarted';

/**
 * Choose the steep line for the current week. Allowed once the line is unlocked and only
 * before anything is logged this week, so it is a promise made at the start, not a bet
 * placed after a strong Monday.
 */
export function chooseSteep(
  s: Snapshot,
  climb: Climb,
  today: DateKey,
): { ok: true; snapshot: Snapshot } | { ok: false; reason: SteepRefusal } {
  if (!s.profile) return { ok: false, reason: 'noProfile' };
  if (!climb.steepUnlocked) return { ok: false, reason: 'locked' };
  const mon = weekStart(today);
  if (s.profile.weekly.steep.includes(mon)) return { ok: false, reason: 'alreadyChosen' };
  for (let d = mon; compareDateKeys(d, today) <= 0; d = addDays(d, 1)) {
    const entries = s.logs[d.slice(0, 7)]?.days[d];
    if (entries && Object.values(entries).some((e) => e.v !== undefined || e.skip !== undefined)) {
      return { ok: false, reason: 'weekStarted' };
    }
  }
  const profile = { ...s.profile, weekly: { ...s.profile.weekly, steep: [...s.profile.weekly.steep, mon] } };
  return { ok: true, snapshot: { ...s, profile } };
}
