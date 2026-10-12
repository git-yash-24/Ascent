/**
 * Fold remote documents into one Snapshot (spec: Merge rules).
 *
 * Each document is migrated and validated; anything that fails is set aside as a problem and
 * never reaches the snapshot (I9). Device logs are merged entry by entry with the core rule,
 * so every replica converges. Two devices that wrote different values to the same habit-day
 * within a minute of each other are reported as a conflict, kept for 7 days.
 */
import { mergeIntoLog } from '../../core/model/entries';
import { isDateKey } from '../../core/model/date';
import { load } from '../../core/model/migrations';
import { parse } from '../../core/model/schemas';
import { emptySnapshot } from '../../core/model/snapshot';
import type { DateKey, Entry, HabitId, MonthLog, Snapshot } from '../../core/model/types';
import { decodeEntry } from '../codec';
import type { RemoteDocs } from '../backend';

export const CONFLICT_WINDOW_MS = 60_000;
export const CONFLICT_KEEP_MS = 7 * 86_400_000;

export interface Conflict {
  date: DateKey;
  habit: HabitId;
  kept: Entry;
  lost: Entry;
}

export interface Problem {
  doc: string;
  error: string;
}

export interface Folded {
  snapshot: Snapshot;
  conflicts: Conflict[];
  problems: Problem[];
}

export function fold(remote: RemoteDocs, now: number): Folded {
  const s = emptySnapshot();
  const problems: Problem[] = [];

  const single = remote.single;
  if (single.profile !== undefined) {
    const r = load('profile', single.profile);
    if (r.ok) s.profile = r.value;
    else problems.push({ doc: 'profile', error: r.error });
  }
  if (single.habits !== undefined) {
    const r = load('habits', single.habits);
    if (r.ok) s.habits = r.value;
    else problems.push({ doc: 'habits', error: r.error });
  }
  if (single.seen !== undefined) {
    const r = load('seen', single.seen);
    if (r.ok) s.seen = r.value;
    else problems.push({ doc: 'seen', error: r.error });
  }
  if (single.notes !== undefined) {
    const r = load('notes', single.notes);
    if (r.ok) s.notes = r.value;
    else problems.push({ doc: 'notes', error: r.error });
  }
  if (single.corrections !== undefined) {
    const r = load('corrections', single.corrections);
    if (r.ok) s.corrections = r.value;
    else problems.push({ doc: 'corrections', error: r.error });
  }

  // date|habit -> every device's entry, for conflict detection.
  const all = new Map<string, Entry[]>();
  const logs: Record<string, MonthLog> = {};
  for (const l of remote.logs) {
    const decoded = decodeDeviceLog(l.body, l.dev, (error) => problems.push({ doc: `log-${l.month}~${l.dev}`, error }));
    if (!decoded) continue;
    for (const [date, entries] of Object.entries(decoded)) {
      if (date.slice(0, 7) !== l.month || !isDateKey(date)) {
        problems.push({ doc: `log-${l.month}~${l.dev}`, error: `misplaced date ${date}` });
        continue;
      }
      for (const [habit, e] of Object.entries(entries)) {
        logs[l.month] = mergeIntoLog(logs[l.month], date, habit, e);
        const key = `${date}|${habit}`;
        const list = all.get(key);
        if (list) list.push(e);
        else all.set(key, [e]);
      }
    }
  }
  // Validate each folded month as a whole.
  for (const [m, log] of Object.entries(logs)) {
    const r = load('log', log);
    if (r.ok) s.logs[m] = r.value;
    else problems.push({ doc: `log-${m}`, error: r.error });
  }

  const conflicts: Conflict[] = [];
  for (const [key, entries] of all) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => b.at - a.at || (b.dev > a.dev ? 1 : -1));
    const kept = sorted[0] as Entry;
    for (const other of sorted.slice(1)) {
      if (kept.at - other.at > CONFLICT_WINDOW_MS) continue;
      if (now - kept.at > CONFLICT_KEEP_MS) continue;
      if (other.v === kept.v && other.skip === kept.skip) continue;
      const [date, habit] = key.split('|') as [string, string];
      conflicts.push({ date, habit, kept, lost: other });
    }
  }
  conflicts.sort((a, b) => b.kept.at - a.kept.at);
  return { snapshot: s, conflicts, problems };
}

function decodeDeviceLog(
  body: unknown,
  dev: string,
  report: (error: string) => void,
): Record<DateKey, Record<HabitId, Entry>> | null {
  if (typeof body !== 'object' || body === null) {
    report('unreadable month log');
    return null;
  }
  const days = (body as { days?: unknown }).days;
  if (typeof days !== 'object' || days === null) {
    report('unreadable month log');
    return null;
  }
  const out: Record<DateKey, Record<HabitId, Entry>> = {};
  for (const [date, entries] of Object.entries(days as Record<string, unknown>)) {
    if (typeof entries !== 'object' || entries === null) {
      report(`unreadable day ${date}`);
      continue;
    }
    const day: Record<HabitId, Entry> = {};
    for (const [habit, raw] of Object.entries(entries as Record<string, unknown>)) {
      const e = decodeEntry(raw, dev);
      // Each entry is validated on its own: one bad entry never costs the rest of the month.
      if (!e || !parse.entry(e).ok) {
        report(`invalid entry ${date} ${habit}`);
        continue;
      }
      day[habit] = e;
    }
    out[date] = day;
  }
  return out;
}
