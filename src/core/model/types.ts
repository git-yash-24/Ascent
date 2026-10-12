/**
 * Stored and derived data contracts (build plan: Data contracts; spec: Data model and history).
 *
 * Only five things are stored: profile, habits, monthly logs, seen, corrections.
 * Everything else is derived by pure functions and can be rebuilt at any time.
 */
import type { DateKey } from './date';

export type { DateKey };
export type HabitId = string;

export type Schedule =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: number[] } // 0 = Sunday
  | { kind: 'perWeek'; n: number }
  | { kind: 'perMonth'; n: number };

export type HabitType = 'binary' | 'numeric' | 'duration' | 'avoid';

export type HabitCategory =
  | 'prepare'
  | 'test'
  | 'repair'
  | 'effort'
  | 'presence'
  | 'rest'
  | 'record'
  | 'make'
  | 'care';

export interface HabitVersion {
  /** First date this version applies. */
  from: DateKey;
  type: HabitType;
  unit?: string;
  /** 1 for binary and avoid. */
  target: number;
  /** Equals target for binary and avoid. */
  minimum: number;
  schedule: Schedule;
  /** Difficulty: chooses a scene variant only. */
  label?: 1 | 2 | 3;
  /**
   * True for an archive version: from this date the habit is not scheduled.
   * Archive and restore are versions, so past days stay judged by what was in force (I3).
   */
  archived?: true;
}

export interface Habit {
  id: HabitId;
  name: string;
  category: HabitCategory;
  createdOn: DateKey;
  /** Convenience mirror of the latest archive version's date, if currently archived. */
  archivedFrom?: DateKey;
  /** Sorted by from; never edited once superseded. */
  versions: HabitVersion[];
}

export type SkipReason = true | 'rest' | 'sick' | 'travel' | 'exam' | 'night';

/**
 * One habit's entry for one date. Writes set a value, never add.
 * An entry with neither v nor skip is a cleared entry (undo): it keeps its write time so a
 * later merge from another device cannot resurrect the older value.
 */
export interface Entry {
  v?: number;
  skip?: SkipReason;
  /** Write time, ms. */
  at: number;
  /** Device id. */
  dev: string;
}

export interface MonthLog {
  schema: number;
  days: Record<DateKey, Record<HabitId, Entry>>;
}

export interface Profile {
  schema: number;
  identity: string;
  startDate: DateKey;
  settings: {
    /** Minutes after midnight; default 240 (04:00). */
    dayBoundary: number;
    timeZone: string;
    sound: boolean;
    music: boolean;
    reducedMotion: boolean;
  };
}

export interface HabitsDoc {
  schema: number;
  habits: Habit[];
}

export interface SeenDoc {
  schema: number;
  /** Highest story day ever presented. Never decreases. */
  presentedStoryDay: number;
  episodes: number[];
  moments: string[];
  records: string[];
}

export interface Correction {
  date: DateKey;
  habit: HabitId;
  old: Entry | null;
  new: Entry | null;
  at: number;
}

export interface CorrectionsDoc {
  schema: number;
  log: Correction[];
}

/** Everything stored, as read from the store. Logs are keyed by 'YYYY-MM'. */
export interface Snapshot {
  profile: Profile | null;
  habits: HabitsDoc;
  logs: Record<string, MonthLog>;
  seen: SeenDoc;
  corrections: CorrectionsDoc;
}

export type HabitDayState =
  | 'unscheduled'
  | 'open'
  | 'attempted'
  | 'held'
  | 'fulfilled'
  | 'skipped'
  | 'missed';

export type DayOutcome = 'inProgress' | 'closed' | 'rested' | 'partial' | 'missed' | 'free';

export interface DayDerived {
  outcome: DayOutcome;
  /** f: mean credit of the day's counted habits, 0 to 1. Rested days are 1. */
  progress: number;
  states: Record<HabitId, HabitDayState>;
}

export interface ChainSpan {
  from: DateKey;
  to: DateKey;
  length: number;
}

export interface ChainDerived {
  current: number;
  best: number;
  history: ChainSpan[];
}

export interface RecordMark {
  id: string;
  on: DateKey;
}

export interface Derived {
  days: Record<DateKey, DayDerived>;
  chains: Record<HabitId, ChainDerived>;
  rates: { last7: number | null; last30: number | null };
  storyDayEarned: number;
  condition: {
    warmth: number;
    fatigue: 'fresh' | 'tired' | 'worn';
    resolveTier: 0 | 1 | 2 | 3;
  };
  records: RecordMark[];
  lifetime: { daysShownUp: number; fulfilled: number };
}

/** The current logical day, and whether its boundary has already passed. */
export interface Now {
  date: DateKey;
  ended: boolean;
}
