/** Test builders: small, explicit snapshots for the matrix rows. */
import { addDays } from '../../src/core/model/date';
import { mergeEntry } from '../../src/core/model/entries';
import { CURRENT_SCHEMA } from '../../src/core/model/schemas';
import type { DateKey, Entry, Habit, HabitVersion, Schedule, SkipReason, Snapshot } from '../../src/core/model/types';

export const DEV = 'dev-a';
let clock = 1_700_000_000_000;
export const nextAt = (): number => ++clock;

export function emptySnapshot(): Snapshot {
  return {
    profile: null,
    habits: { schema: CURRENT_SCHEMA.habits, habits: [] },
    logs: {},
    seen: { schema: CURRENT_SCHEMA.seen, presentedStoryDay: 0, episodes: [], moments: [], records: [] },
    corrections: { schema: CURRENT_SCHEMA.corrections, log: [] },
  };
}

export function version(from: DateKey, over: Partial<HabitVersion> = {}): HabitVersion {
  return { from, type: 'binary', target: 1, minimum: 1, schedule: { kind: 'daily' }, ...over };
}

/** Q: numeric, target 50, minimum 25, daily (the matrix's default numeric habit). */
export function Q(createdOn: DateKey, schedule: Schedule = { kind: 'daily' }): Habit {
  return {
    id: 'Q',
    name: 'Qbank',
    category: 'test',
    createdOn,
    versions: [version(createdOn, { type: 'numeric', target: 50, minimum: 25, unit: 'questions', schedule })],
  };
}

/** R: binary, daily (the matrix's default binary habit). */
export function R(createdOn: DateKey, schedule: Schedule = { kind: 'daily' }, id = 'R'): Habit {
  return { id, name: 'Review mistakes', category: 'repair', createdOn, versions: [version(createdOn, { schedule })] };
}

export function withHabits(...habits: Habit[]): Snapshot {
  const s = emptySnapshot();
  return { ...s, habits: { ...s.habits, habits } };
}

export type Value = number | 'skip' | SkipReason | null;

export function entry(value: Value, at = nextAt()): Entry {
  if (value === null) return { at, dev: DEV };
  if (value === 'skip') return { skip: true, at, dev: DEV };
  if (typeof value === 'number') return { v: value, at, dev: DEV };
  return { skip: value, at, dev: DEV };
}

export function log(s: Snapshot, date: DateKey, habit: string, value: Value, at?: number): Snapshot {
  return mergeEntry(s, date, habit, entry(value, at));
}

/** Log a value for a habit on every date in [from, from + n). */
export function logRange(s: Snapshot, from: DateKey, n: number, habit: string, value: Value): Snapshot {
  let out = s;
  for (let i = 0; i < n; i++) out = log(out, addDays(from, i), habit, value);
  return out;
}

export const day = (base: DateKey, n: number): DateKey => addDays(base, n);
