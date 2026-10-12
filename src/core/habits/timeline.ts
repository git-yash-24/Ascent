/**
 * One habit's day-by-day states (spec: Schedules; The habit-day state machine).
 *
 * Daily and chosen-weekday habits are scheduled by rule. Quota habits (X a week, X a month)
 * are scheduled every day until the count is met for that period. A quota day left unlogged
 * is not a miss: the quota is judged per week or month, in the chain. So quota habits take
 * part in a day's outcome only on days they were logged as held, fulfilled or skipped.
 * (Assumption A-M5-1; recorded in docs/decisions/m5-engine.md.)
 */
import { addDays, compareDateKeys, weekday, weekStart } from '../model/date';
import type { DateKey, Entry, Habit, HabitDayState, HabitVersion } from '../model/types';
import { credit, isHeld, stateOfEntry } from './state';
import { versionOn } from './versions';

export interface HabitDay {
  date: DateKey;
  state: HabitDayState;
  credit: number;
  /** Takes part in the day's outcome and progress. */
  counted: boolean;
  /** The version in force (undefined when not yet created or archived). */
  version: HabitVersion | undefined;
}

export type EntryLookup = (date: DateKey) => Entry | undefined;

export function periodKey(v: HabitVersion, date: DateKey): string {
  const p = v.schedule.kind === 'perMonth' ? date.slice(0, 7) : weekStart(date);
  return `${p}|${v.from}`;
}

export function habitTimeline(h: Habit, entry: EntryLookup, today: DateKey, todayEnded: boolean): HabitDay[] {
  const out: HabitDay[] = [];
  if (compareDateKeys(h.createdOn, today) > 0) return out;
  const heldInPeriod = new Map<string, number>();
  for (let d = h.createdOn; compareDateKeys(d, today) <= 0; d = addDays(d, 1)) {
    const v = versionOn(h, d);
    const ended = compareDateKeys(d, today) < 0 || todayEnded;
    if (!v || v.archived) {
      out.push({ date: d, state: 'unscheduled', credit: 0, counted: false, version: undefined });
      continue;
    }
    const e = entry(d);
    const s = v.schedule;
    if (s.kind === 'daily' || s.kind === 'weekdays') {
      if (s.kind === 'weekdays' && !s.days.includes(weekday(d))) {
        out.push({ date: d, state: 'unscheduled', credit: 0, counted: false, version: v });
        continue;
      }
      let state: HabitDayState = stateOfEntry(v, e);
      if (state === 'open' && ended) state = 'missed';
      out.push({ date: d, state, credit: credit(v, e), counted: true, version: v });
      continue;
    }
    // Quota schedules.
    const key = periodKey(v, d);
    const before = heldInPeriod.get(key) ?? 0;
    const raw = stateOfEntry(v, e);
    if (isHeld(raw)) heldInPeriod.set(key, before + 1);
    let state: HabitDayState;
    if (raw !== 'open' && raw !== 'attempted') state = raw;
    else if (raw === 'attempted') state = 'attempted';
    else state = before >= s.n ? 'unscheduled' : 'open';
    const counted = isHeld(raw) || raw === 'skipped';
    out.push({ date: d, state, credit: credit(v, e), counted, version: v });
  }
  return out;
}
