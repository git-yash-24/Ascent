/** Words and numbers as people read them. */
import { addDays, diffDays, weekday } from '../core/model/date';
import type { DateKey, Habit, HabitDayState, HabitVersion, Schedule, SkipReason, Verdict } from '../core/model/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(d: DateKey): string {
  return `${WEEKDAYS[weekday(d)]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
}

export function shortDate(d: DateKey): string {
  return `${SHORT[weekday(d)]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3)}`;
}

/** Chip label for a day in the edit window. */
export function dayChip(d: DateKey, today: DateKey): string {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return SHORT[weekday(d)] as string;
}

export function editWindow(today: DateKey): DateKey[] {
  return [0, 1, 2, 3].map((i) => addDays(today, -i));
}

export function scheduleText(s: Schedule): string {
  switch (s.kind) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return [...s.days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => SHORT[d])
        .join(' ');
    case 'perWeek':
      return `${s.n} ${s.n === 1 ? 'time' : 'times'} a week`;
    case 'perMonth':
      return `${s.n} ${s.n === 1 ? 'time' : 'times'} a month`;
  }
}

export function unitOf(v: HabitVersion): string {
  if (v.type === 'duration') return 'min';
  return v.unit ?? '';
}

export function isAmount(v: HabitVersion): boolean {
  return v.type === 'numeric' || v.type === 'duration';
}

export const STATE_WORDS: Record<HabitDayState, string> = {
  unscheduled: 'not due',
  open: 'not done yet',
  attempted: 'started',
  held: 'held',
  fulfilled: 'done',
  skipped: 'skipped',
  missed: 'missed',
};

export const SKIP_REASONS: Array<{ reason: SkipReason; label: string }> = [
  { reason: 'rest', label: 'Rest day' },
  { reason: 'sick', label: 'Sick' },
  { reason: 'exam', label: 'Exam' },
  { reason: 'night', label: 'Night duty' },
  { reason: 'travel', label: 'Travel' },
  { reason: true, label: 'Skip' },
];

export function skipLabel(r: SkipReason): string {
  return SKIP_REASONS.find((x) => x.reason === r)?.label ?? 'Skip';
}

export const VERDICT_WORDS: Record<Verdict, { now: string; done: string }> = {
  summit: { now: 'Summit push', done: 'Summit push' },
  climb: { now: 'Climb secured', done: 'Climbed' },
  hold: { now: 'Holding', done: 'Held by the storm' },
  slip: { now: 'Slipping', done: 'Slipped back' },
  rest: { now: 'Rest week', done: 'Rest week' },
};

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}

export function habitSummary(v: HabitVersion): string {
  const amount = isAmount(v) ? `${v.target} ${unitOf(v)}`.trim() : v.type === 'avoid' ? 'Avoid' : 'Yes or no';
  return `${amount} · ${scheduleText(v.schedule)}`;
}

export const CATEGORIES: Array<{ id: Habit['category']; label: string }> = [
  { id: 'test', label: 'Test (practice questions, drills)' },
  { id: 'repair', label: 'Repair (review mistakes, fix)' },
  { id: 'prepare', label: 'Prepare (plan, pack, set up)' },
  { id: 'effort', label: 'Effort (training, hard work)' },
  { id: 'presence', label: 'Presence (meditate, walk, pray)' },
  { id: 'rest', label: 'Rest (sleep, recover)' },
  { id: 'record', label: 'Record (journal, log)' },
  { id: 'make', label: 'Make (write, build, draw)' },
  { id: 'care', label: 'Care (body, people, home)' },
];
