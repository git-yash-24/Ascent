/**
 * Habit-day state and credit (spec: Credit and value thresholds).
 *
 * Credit c = min(1, v / target). A value at or above the minimum is held; at or above the
 * target is fulfilled; above zero but below the minimum is attempted; zero is open.
 */
import type { Entry, HabitDayState, HabitVersion } from '../model/types';

export function credit(v: HabitVersion, e: Entry | undefined): number {
  if (!e || e.v === undefined) return 0;
  if (v.target <= 0) return 0;
  return Math.min(1, e.v / v.target);
}

/** The state an entry gives on its own, before the day ends. */
export function stateOfEntry(v: HabitVersion, e: Entry | undefined): Exclude<HabitDayState, 'unscheduled' | 'missed'> {
  if (!e) return 'open';
  if (e.skip !== undefined) return 'skipped';
  if (e.v === undefined || e.v <= 0) return 'open';
  if (e.v >= v.target) return 'fulfilled';
  if (e.v >= v.minimum) return 'held';
  return 'attempted';
}

export function isHeld(s: HabitDayState): boolean {
  return s === 'held' || s === 'fulfilled';
}
