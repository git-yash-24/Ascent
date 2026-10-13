/**
 * Stored and derived data contracts (build plan: Data contracts; spec: Data model and history).
 *
 * Only six things are stored: profile, habits, monthly logs, seen, corrections, notes (the journal).
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

/** Which of Ari's chores a habit becomes. Chosen by the story, never by the person. */
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
  /** Optional set time, 'HH:MM' local (Time-bound in SMART). Orders the checklist and reminders. */
  time?: string;
}

export interface Habit {
  id: HabitId;
  name: string;
  category: HabitCategory;
  createdOn: DateKey;
  /** Convenience mirror of the latest archive version's date, if currently archived. */
  archivedFrom?: DateKey;
  /** The coloured tag: a broad family and a named group inside it (core/tags.ts). */
  tag?: { family: string; group: string };
  /**
   * A built-in habit every player has. 'water' is tracked on its own bar and streak and feeds
   * Ari's condition, but never counts toward the story day or the weekly climb.
   */
  system?: 'water';
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
  /**
   * Each change to this habit-day, oldest first: when it was recorded and what it became.
   * Recorded from 13 Oct 2026 on; older entries have none. A record time, not proof of when
   * the thing itself was done (a backfill is recorded when it is entered).
   */
  acts?: Act[];
}

export interface Act {
  at: number;
  v?: number;
  skip?: SkipReason;
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
  /** Weekly climb choices (schema 2). */
  weekly: {
    /** Monday of each week the steep line was chosen. */
    steep: DateKey[];
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
  notes: NotesDoc;
  expedition: ExpeditionDoc;
}

/** Trail symbols: one marks Ari's flag and pack and is carved at the first camp. */
export type TrailSymbol = 'peak' | 'star' | 'wave' | 'pine' | 'flame';
/** Accent colours for Ari's scarf and the tent ribbon. */
export type Accent = 'ember' | 'moss' | 'glacier' | 'plum' | 'ochre' | 'ash';

/**
 * The person's expedition: small, optional, personal marks. Ari stays Ari; these make the
 * journey theirs (docs/decisions: model D). Private, like everything else.
 */
export interface ExpeditionDoc {
  schema: number;
  /** An optional name for the journey, shown only to the person. */
  name?: string;
  symbol?: TrailSymbol;
  accent?: Accent;
  /** The day the opening scene was seen or skipped; it plays once. */
  introOn?: DateKey;
}

/** The person's journal: at most one short note per day. Stored as `notes` (the word journal is
 * taken by the sync journal). */
export interface NotesDoc {
  schema: number;
  entries: Record<DateKey, string>;
}

export type HabitDayState =
  | 'unscheduled'
  | 'open'
  | 'attempted'
  | 'held'
  | 'fulfilled'
  | 'skipped'
  | 'missed';

/**
 * excused: every counted habit skipped as sick. Streaks hold, nothing is missed, and the story
 * does not advance (Xander, 2026-10-13: "sick days maintain the streak but no progress made").
 */
export type DayOutcome = 'inProgress' | 'closed' | 'rested' | 'excused' | 'partial' | 'missed' | 'free';

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
  climb: Climb;
  /** The built-in water bar, when the player has it (everyone does after setup). */
  water: Water | null;
}

export interface Water {
  habit: HabitId;
  /** Glasses today. */
  today: number;
  target: number;
  /** Write time of today's last change (ms), for the in-app reminder. */
  lastAt: number | null;
  streak: number;
}

/** Weekly verdicts (docs/decisions/weekly-climb.md). */
export type Verdict = 'summit' | 'climb' | 'hold' | 'slip' | 'rest';

export interface WeekResult {
  /** Monday. */
  week: DateKey;
  /** Mean of each habit's share of its weekly plan, 0 to 1, before any head start. */
  raw: number | null;
  /** raw plus the head start carried in, capped at 1. */
  score: number | null;
  headstartIn: number;
  steep: boolean;
  comeback: boolean;
  verdict: Verdict;
  /** Stages moved this week (negative for a slip). */
  moved: number;
  stageAfter: number;
  /** Head start earned for next week. */
  headstartOut: number;
}

export interface Climb {
  stage: number;
  chapter: number;
  /** Ended weeks, oldest first. */
  weeks: WeekResult[];
  /** The week in progress: live score and the verdict it would get now. */
  current: WeekResult | null;
  /** True once the steep line can be chosen. */
  steepUnlocked: boolean;
  /** Consecutive ended weeks at 50% or more (rest weeks neutral). */
  weeklyChain: number;
}

/** The current logical day, and whether its boundary has already passed. */
export interface Now {
  date: DateKey;
  ended: boolean;
}
