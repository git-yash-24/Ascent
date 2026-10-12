/**
 * Habit versions and lifecycle (spec: Habit lifecycle; Habit versions).
 *
 * To judge a date, use the latest version whose from is on or before it (I3).
 * Archive and restore are versions too, so the past is never rewritten.
 */
import { addDays, compareDateKeys } from '../model/date';
import type { DateKey, Habit, HabitCategory, HabitId, HabitVersion, HabitsDoc, Schedule, Snapshot } from '../model/types';

export function versionOn(h: Habit, date: DateKey): HabitVersion | undefined {
  let found: HabitVersion | undefined;
  for (const v of h.versions) {
    if (compareDateKeys(v.from, date) <= 0) found = v;
    else break;
  }
  return found;
}

/** The version that defines the habit's rules (the latest one that is not an archive). */
export function definitionOn(h: Habit, date: DateKey): HabitVersion | undefined {
  const v = versionOn(h, date);
  return v && !v.archived ? v : undefined;
}

export function latestDefinition(h: Habit): HabitVersion {
  for (let i = h.versions.length - 1; i >= 0; i--) {
    const v = h.versions[i] as HabitVersion;
    if (!v.archived) return v;
  }
  throw new Error(`habit ${h.id} has no definition`);
}

export function sameChainRules(a: HabitVersion, b: HabitVersion): boolean {
  return a.type === b.type && sameSchedule(a.schedule, b.schedule);
}

export function sameSchedule(a: Schedule, b: Schedule): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'daily':
      return true;
    case 'weekdays': {
      const bd = (b as typeof a).days;
      const x = [...a.days].sort();
      const y = [...bd].sort();
      return x.length === y.length && x.every((d, i) => d === y[i]);
    }
    case 'perWeek':
    case 'perMonth':
      return a.n === (b as typeof a).n;
  }
}

export interface Definition {
  type: HabitVersion['type'];
  unit?: string;
  target: number;
  minimum?: number;
  schedule: Schedule;
  label?: 1 | 2 | 3;
  /** Optional set time, 'HH:MM'. */
  time?: string;
}

function toVersion(from: DateKey, d: Definition): HabitVersion {
  const binary = d.type === 'binary' || d.type === 'avoid';
  const target = binary ? 1 : d.target;
  const minimum = binary ? 1 : d.minimum ?? target / 2;
  const v: HabitVersion = { from, type: d.type, target, minimum, schedule: d.schedule };
  if (d.unit !== undefined) v.unit = d.unit;
  if (d.label !== undefined) v.label = d.label;
  if (d.time) v.time = d.time;
  return v;
}

function replaceHabit(doc: HabitsDoc, h: Habit): HabitsDoc {
  return { ...doc, habits: doc.habits.map((x) => (x.id === h.id ? h : x)) };
}

function find(doc: HabitsDoc, id: HabitId): Habit {
  const h = doc.habits.find((x) => x.id === id);
  if (!h) throw new Error(`unknown habit ${id}`);
  return h;
}

/** Push a version effective on `from`, replacing any version already starting that day or later. */
function pushVersion(h: Habit, v: HabitVersion): Habit {
  const kept = h.versions.filter((x) => compareDateKeys(x.from, v.from) < 0);
  return { ...h, versions: [...kept, v] };
}

/** Create: takes effect today; past days are never scheduled retroactively (H18). */
export function createHabit(
  doc: HabitsDoc,
  input: { id: HabitId; name: string; category: HabitCategory; today: DateKey; definition: Definition },
): HabitsDoc {
  if (doc.habits.some((h) => h.id === input.id)) throw new Error(`habit ${input.id} exists`);
  const h: Habit = {
    id: input.id,
    name: input.name,
    category: input.category,
    createdOn: input.today,
    versions: [toVersion(input.today, input.definition)],
  };
  return { ...doc, habits: [...doc.habits, h] };
}

/** Name and scene category apply everywhere, including history. */
export function renameHabit(doc: HabitsDoc, id: HabitId, name: string, category?: HabitCategory): HabitsDoc {
  const h = find(doc, id);
  return replaceHabit(doc, { ...h, name, category: category ?? h.category });
}

/** Type, target, minimum or schedule: a new version effective today (H15, H16). */
export function editDefinition(doc: HabitsDoc, id: HabitId, today: DateKey, d: Definition): HabitsDoc {
  const h = find(doc, id);
  const current = versionOn(h, today);
  if (current?.archived) throw new Error(`habit ${id} is archived`);
  return replaceHabit(doc, pushVersion(h, toVersion(today, d)));
}

/** Archive: effective tomorrow (H17). */
export function archiveHabit(doc: HabitsDoc, id: HabitId, today: DateKey): HabitsDoc {
  const h = find(doc, id);
  const from = addDays(today, 1);
  const def = latestDefinition(h);
  const next = pushVersion(h, { ...def, from, archived: true });
  return replaceHabit(doc, { ...next, archivedFrom: from });
}

/** Restore: a new version effective today; archived days stay free (H19). */
export function restoreHabit(doc: HabitsDoc, id: HabitId, today: DateKey): HabitsDoc {
  const h = find(doc, id);
  const def = latestDefinition(h);
  const restored: HabitVersion = { ...def, from: today };
  delete restored.archived;
  // Archived and restored before the archive took effect: simply drop the archive.
  const pending = h.versions.filter((v) => v.archived && compareDateKeys(v.from, today) > 0);
  let next: Habit;
  if (pending.length > 0 && !versionOn(h, today)?.archived) {
    next = { ...h, versions: h.versions.filter((v) => !pending.includes(v)) };
  } else {
    next = pushVersion(h, restored);
  }
  const { archivedFrom: _drop, ...rest } = next;
  return replaceHabit(doc, rest);
}

/** Delete: only after archiving. Removes the habit and its history from every month log. */
export function deleteHabit(s: Snapshot, id: HabitId): Snapshot {
  const h = find(s.habits, id);
  if (!h.archivedFrom) throw new Error('archive a habit before deleting it');
  const logs: Snapshot['logs'] = {};
  for (const [m, log] of Object.entries(s.logs)) {
    const days: typeof log.days = {};
    for (const [date, entries] of Object.entries(log.days)) {
      const { [id]: _gone, ...others } = entries;
      if (Object.keys(others).length > 0) days[date] = others;
    }
    logs[m] = { ...log, days };
  }
  return { ...s, habits: { ...s.habits, habits: s.habits.habits.filter((x) => x.id !== id) }, logs };
}
