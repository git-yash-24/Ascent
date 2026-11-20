/**
 * Which logical day it is (spec: Time rules; T01, T02, T10, T11, T18).
 *
 * - The day rolls only at the day boundary, never at midnight.
 * - A day keeps the time zone in force when it began; the next day begins at the boundary in
 *   the zone in force when it rolls. Travelling never creates or deletes a day.
 * - The logical day never moves backwards (westward travel, a clock set back).
 * - The clock is trusted for the current day only: a jump of more than 36 hours asks for a
 *   one-time confirmation before any day is finalised.
 */
import { addDays, compareDateKeys, diffDays, logicalDay, type DateKey } from './date';

export interface DayCursor {
  /** The current logical day. */
  date: DateKey;
  /** The time zone the current day began in. */
  zone: string;
  /** Instant (ms) at which the current day began, as observed. */
  began: number;
  /** Latest instant observed (ms). */
  seen: number;
  /** True while the logical day trails the local date after an eastward crossing. */
  behind?: true;
}

export const JUMP_CONFIRM_MS = 36 * 3_600_000;
/** While catching up after an eastward crossing, each day lasts at least this long. */
const MIN_DAY_MS = 12 * 3_600_000;

export function startCursor(instant: number, zone: string, boundary: number): DayCursor {
  return { date: logicalDay(new Date(instant), zone, boundary), zone, began: instant, seen: instant };
}

export type Tick =
  | { kind: 'same'; cursor: DayCursor }
  | { kind: 'rolled'; cursor: DayCursor; ended: DateKey[] }
  | { kind: 'confirm'; proposed: DayCursor; ended: DateKey[]; jumpMs: number };

export function tick(c: DayCursor, instant: number, zone: string, boundary: number): Tick {
  const seen = Math.max(c.seen, instant);
  // Has the current day ended, judged in the zone it began in?
  const inOldZone = logicalDay(new Date(instant), c.zone, boundary);
  if (compareDateKeys(inOldZone, c.date) <= 0) return { kind: 'same', cursor: { ...c, seen } };
  // The next day starts at the boundary in the zone in force now.
  const local = logicalDay(new Date(instant), zone, boundary);
  if (compareDateKeys(local, c.date) <= 0) return { kind: 'same', cursor: { ...c, seen } };
  const jumpMs = instant - c.seen;
  let next = local;
  if (jumpMs <= JUMP_CONFIRM_MS) {
    // Catching up after an eastward crossing: let the current day last a while first.
    if (c.behind && instant - c.began < MIN_DAY_MS) return { kind: 'same', cursor: { ...c, seen } };
    // Never skip a date because of a zone change: roll one date at a time.
    if (zone !== c.zone && diffDays(c.date, local) > 1) next = addDays(c.date, 1);
  }
  const ended: DateKey[] = [];
  for (let d = c.date; compareDateKeys(d, next) < 0; d = addDays(d, 1)) ended.push(d);
  const cursor: DayCursor = { date: next, zone, began: instant, seen };
  if (compareDateKeys(next, local) < 0) cursor.behind = true;
  if (jumpMs > JUMP_CONFIRM_MS) return { kind: 'confirm', proposed: cursor, ended, jumpMs };
  return { kind: 'rolled', cursor, ended };
}
