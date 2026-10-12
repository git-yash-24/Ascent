/**
 * Calendar dates for Ascent.
 *
 * A DateKey is a local calendar date ('2026-10-13'). Dates are never stored as timestamps,
 * so time zones cannot move them (spec: Data model, Identifiers).
 *
 * All arithmetic is done in UTC on the date's own digits, so it is independent of the
 * machine's time zone and of daylight-saving changes.
 */

export type DateKey = string;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True when s is a real calendar date in YYYY-MM-DD form. */
export function isDateKey(s: string): boolean {
  const m = DATE_KEY.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtcMs(key: DateKey): number {
  const m = DATE_KEY.exec(key);
  if (!m || !isDateKey(key)) throw new RangeError(`Not a date key: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): DateKey {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${mo}-${da}`;
}

/** The date key n days after (or before, for negative n) the given date. */
export function addDays(key: DateKey, n: number): DateKey {
  if (!Number.isInteger(n)) throw new RangeError(`Day offset must be an integer: ${n}`);
  return fromUtcMs(toUtcMs(key) + n * DAY_MS);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** Day of the week, 0 = Sunday ... 6 = Saturday. */
export function weekday(key: DateKey): number {
  return new Date(toUtcMs(key)).getUTCDay();
}

/** The Monday on or before the given date (weeks run Monday to Sunday). */
export function weekStart(key: DateKey): DateKey {
  return addDays(key, -((weekday(key) + 6) % 7));
}

/** 'YYYY-MM' of the date: the month document it is stored in. */
export function monthOf(key: DateKey): string {
  return key.slice(0, 7);
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Local wall-clock fields of an instant in a given IANA time zone.
 * Uses Intl, so it is correct across daylight-saving changes.
 */
export function wallClock(instant: Date, timeZone: string): { date: DateKey; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { date, minutes };
}

/**
 * The logical day an instant belongs to, given a day boundary in minutes after midnight
 * (spec default 04:00 = 240). Before the boundary, the instant counts for the previous date.
 */
export function logicalDay(instant: Date, timeZone: string, boundaryMinutes: number): DateKey {
  if (!Number.isInteger(boundaryMinutes) || boundaryMinutes < 0 || boundaryMinutes >= 24 * 60) {
    throw new RangeError(`Day boundary must be 0 to 1439 minutes: ${boundaryMinutes}`);
  }
  const { date, minutes } = wallClock(instant, timeZone);
  return minutes < boundaryMinutes ? addDays(date, -1) : date;
}
