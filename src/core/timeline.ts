/**
 * When things happened, as far as the record can honestly say (Living World plan, Phase 5).
 *
 * Each habit-day keeps its changes with the time each was recorded (`Entry.acts`, kept from
 * 13 Oct 2026 on). That is a record time: when the person told the app, not proof of when the
 * thing was done. So the replay says "logged later" when the record was made on another day,
 * and "time not recorded" when there is no time at all. Nothing is ever made up.
 */
import { logicalDay, wallClock } from './model/date';
import type { Act, DateKey, Entry } from './model/types';

export interface Moment {
  /** When the habit reached its final state (ms), or null when no time was recorded. */
  at: number | null;
  /** When it was first started, if that was earlier and different (a partial, then done). */
  started: number | null;
  /** The day the record was made, when that is not the day itself (a backfill). */
  loggedOn: DateKey | null;
}

/** The moment a habit-day settled, from its recorded changes. */
export function momentOf(e: Entry | undefined, day: DateKey, timeZone: string, boundary: number): Moment {
  const acts = e?.acts ?? [];
  if (!acts.length) return { at: null, started: null, loggedOn: null };
  const last = acts[acts.length - 1]!;
  const first = acts[0]!;
  const started = acts.length > 1 && first.at < last.at && first.v !== last.v && first.v !== undefined && first.v > 0 ? first.at : null;
  const on = logicalDay(new Date(last.at), timeZone, boundary);
  return { at: last.at, started, loggedOn: on === day ? null : on };
}

/**
 * The time of each glass in a count, oldest first: each glass added takes the time it was added,
 * a removal takes the latest one back. Glasses from before times were kept have none (null).
 */
export function glassTimes(acts: Act[] | undefined, count: number): Array<number | null> {
  const times: Array<number | null> = [];
  (acts ?? []).forEach((a, i) => {
    const n = a.v ?? 0;
    if (i === 0) for (let k = 0; k < n - 1; k++) times.push(null);
    while (times.length > n) times.pop();
    while (times.length < n) times.push(a.at);
  });
  while (times.length < count) times.unshift(null);
  return times.slice(0, count);
}

/** The local hour (fractional) of an instant in the record's time zone. */
export function hourOf(at: number, timeZone: string): number {
  return wallClock(new Date(at), timeZone).minutes / 60;
}

/** "07:42" in the record's time zone. */
export function clockOf(at: number, timeZone: string): string {
  const m = wallClock(new Date(at), timeZone).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
