/**
 * Pure operations on logged entries (spec: Persistence; Merge rules; Time rules).
 *
 * Writes set a value and never add, so a repeated write is harmless (I1).
 * Two writes to the same habit-day: the later write time wins; ties go to the larger device id
 * so every replica settles on the same value regardless of arrival order.
 */
import { addDays, compareDateKeys, monthOf } from './date';
import type { DateKey, Entry, HabitId, MonthLog, Snapshot } from './types';
import { CURRENT_SCHEMA, parse } from './schemas';

/** Today and the 3 previous dates are freely editable; older dates are final. */
export const EDIT_WINDOW_DAYS = 3;

export function isEditable(date: DateKey, today: DateKey): boolean {
  return compareDateKeys(date, today) <= 0 && compareDateKeys(date, addDays(today, -EDIT_WINDOW_DAYS)) >= 0;
}

export function isFinal(date: DateKey, today: DateKey): boolean {
  return compareDateKeys(date, addDays(today, -EDIT_WINDOW_DAYS)) < 0;
}

/** True when b should replace a. */
export function wins(b: Entry, a: Entry | undefined): boolean {
  if (!a) return true;
  if (b.at !== a.at) return b.at > a.at;
  return b.dev > a.dev || (b.dev === a.dev && entryKey(b) > entryKey(a));
}

function entryKey(e: Entry): string {
  return `${e.v ?? ''}|${e.skip ?? ''}`;
}

/** A cleared entry: an undo, kept as a tombstone with its write time. */
export function isCleared(e: Entry | undefined): boolean {
  return !e || (e.v === undefined && e.skip === undefined);
}

/** Merge one habit-day entry into a month log, returning a new log (input untouched). */
export function mergeIntoLog(log: MonthLog | undefined, date: DateKey, habit: HabitId, e: Entry): MonthLog {
  const base: MonthLog = log ?? { schema: CURRENT_SCHEMA.log, days: {} };
  const day = base.days[date];
  const existing = day?.[habit];
  if (!wins(e, existing)) return base;
  return {
    ...base,
    days: { ...base.days, [date]: { ...(day ?? {}), [habit]: { ...e } } },
  };
}

/** Merge one entry into a snapshot (the month document is chosen by date). */
export function mergeEntry(s: Snapshot, date: DateKey, habit: HabitId, e: Entry): Snapshot {
  const m = monthOf(date);
  const next = mergeIntoLog(s.logs[m], date, habit, e);
  if (next === s.logs[m]) return s;
  return { ...s, logs: { ...s.logs, [m]: next } };
}

export function entryOn(s: Snapshot, date: DateKey, habit: HabitId): Entry | undefined {
  const e = s.logs[monthOf(date)]?.days[date]?.[habit];
  return isCleared(e) ? undefined : e;
}

export type LogRejection = 'final' | 'future' | 'unknownHabit' | 'invalidValue';

/**
 * The checklist's write: validated against the edit window (T04, T05).
 * Older dates can change only through correctRecord.
 */
export function logEntry(
  s: Snapshot,
  today: DateKey,
  date: DateKey,
  habit: HabitId,
  input: unknown,
): { ok: true; snapshot: Snapshot } | { ok: false; reason: LogRejection } {
  if (compareDateKeys(date, today) > 0) return { ok: false, reason: 'future' };
  if (!isEditable(date, today)) return { ok: false, reason: 'final' };
  if (!s.habits.habits.some((h) => h.id === habit)) return { ok: false, reason: 'unknownHabit' };
  const e = validEntry(input);
  if (!e) return { ok: false, reason: 'invalidValue' };
  return { ok: true, snapshot: mergeEntry(s, date, habit, e) };
}

/** Correct the record (T06 to T09): any past date, with an entry in the corrections log. */
export function correctRecord(
  s: Snapshot,
  today: DateKey,
  date: DateKey,
  habit: HabitId,
  input: unknown,
): { ok: true; snapshot: Snapshot } | { ok: false; reason: LogRejection } {
  if (compareDateKeys(date, today) > 0) return { ok: false, reason: 'future' };
  if (!s.habits.habits.some((h) => h.id === habit)) return { ok: false, reason: 'unknownHabit' };
  const e = validEntry(input);
  if (!e) return { ok: false, reason: 'invalidValue' };
  const old = entryOn(s, date, habit) ?? null;
  const merged = mergeEntry(s, date, habit, e);
  return {
    ok: true,
    snapshot: {
      ...merged,
      corrections: {
        ...merged.corrections,
        log: [...merged.corrections.log, { date, habit, old, new: isCleared(e) ? null : { ...e }, at: e.at }],
      },
    },
  };
}

/** Untrusted input is validated in full before it can touch a snapshot (I9). */
function validEntry(e: unknown): Entry | null {
  const r = parse.entry(e);
  return r.ok ? r.value : null;
}
