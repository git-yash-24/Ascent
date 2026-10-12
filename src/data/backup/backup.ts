/**
 * Export, import and the weekly backup prompt (spec: Backup, export and import).
 *
 * Export writes one JSON file: every stored document plus the app version and schema numbers,
 * and a CSV of the daily log alongside for spreadsheets. Import validates the whole file,
 * migrates old schemas, and produces a dry-run summary before anything is replaced; the
 * current data is exported first. Nothing is ever partly imported.
 */
import { compareDateKeys, diffDays, isDateKey } from '../../core/model/date';
import { isCleared } from '../../core/model/entries';
import { load } from '../../core/model/migrations';
import { CURRENT_SCHEMA } from '../../core/model/schemas';
import { emptySnapshot } from '../../core/model/snapshot';
import type { DateKey, Entry, HabitId, Snapshot } from '../../core/model/types';

export const BACKUP_FORMAT = 'ascent-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  schemas: Record<string, number>;
  docs: {
    profile: unknown;
    habits: unknown;
    seen: unknown;
    corrections: unknown;
    notes?: unknown;
    logs: Record<string, unknown>;
  };
}

export function exportBackup(s: Snapshot, app: string, now: number): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app,
    exportedAt: new Date(now).toISOString(),
    schemas: { ...CURRENT_SCHEMA },
    docs: {
      profile: s.profile,
      habits: s.habits,
      seen: s.seen,
      corrections: s.corrections,
      notes: s.notes,
      logs: s.logs,
    },
  };
}

export function backupFileName(now: number): string {
  return `ascent-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export function exportJson(s: Snapshot, app: string, now: number): string {
  return JSON.stringify(exportBackup(s, app, now), null, 1);
}

/** One row per logged habit-day: date, habit, name, value, skip. */
export function exportCsv(s: Snapshot): string {
  const names = new Map(s.habits.habits.map((h) => [h.id, h.name]));
  const rows = ['date,habit_id,habit_name,value,skip'];
  for (const m of Object.keys(s.logs).sort()) {
    const days = s.logs[m]?.days ?? {};
    for (const date of Object.keys(days).sort()) {
      const entries = days[date] ?? {};
      for (const habit of Object.keys(entries).sort()) {
        const e = entries[habit] as Entry;
        if (isCleared(e)) continue;
        rows.push([date, habit, names.get(habit) ?? '', e.v ?? '', e.skip === true ? 'yes' : e.skip ?? ''].map(csvCell).join(','));
      }
    }
  }
  return `${rows.join('\n')}\n`;
}

function csvCell(x: string | number): string {
  const s = String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type ParsedBackup =
  | { ok: true; snapshot: Snapshot; app: string; exportedAt: string; migrated: string[] }
  | { ok: false; error: string };

/** Validate and migrate a whole backup. Any invalid document rejects the whole file. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, error: 'This file is not an Ascent backup.' };
  }
  const file = raw as Partial<BackupFile>;
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup comes from a newer version of Ascent. Update the app first.' };
  }
  const docs = file.docs;
  if (typeof docs !== 'object' || docs === null) return { ok: false, error: 'The backup has no documents.' };

  const s = emptySnapshot();
  const migrated: string[] = [];
  const schemaOf = (x: unknown): number => (typeof x === 'object' && x !== null && typeof (x as { schema?: unknown }).schema === 'number' ? (x as { schema: number }).schema : 0);

  if (docs.profile !== null && docs.profile !== undefined) {
    const r = load('profile', docs.profile);
    if (!r.ok) return { ok: false, error: `Settings: ${r.error}` };
    if (schemaOf(docs.profile) !== r.value.schema) migrated.push('profile');
    s.profile = r.value;
  }
  for (const kind of ['habits', 'seen', 'corrections', 'notes'] as const) {
    if (docs[kind] === undefined) continue;
    const r = load(kind, docs[kind]);
    if (!r.ok) return { ok: false, error: `${kind}: ${r.error}` };
    if (schemaOf(docs[kind]) !== r.value.schema) migrated.push(kind);
    (s as unknown as Record<string, unknown>)[kind] = r.value;
  }
  const logs = docs.logs ?? {};
  if (typeof logs !== 'object' || logs === null) return { ok: false, error: 'The daily log is unreadable.' };
  for (const [m, body] of Object.entries(logs)) {
    if (!/^\d{4}-\d{2}$/.test(m)) return { ok: false, error: `Unknown month ${m}.` };
    const r = load('log', body);
    if (!r.ok) return { ok: false, error: `Log ${m}: ${r.error}` };
    if (Object.keys(r.value.days).some((d) => d.slice(0, 7) !== m)) return { ok: false, error: `Log ${m} holds dates from another month.` };
    if (schemaOf(body) !== r.value.schema) migrated.push(`log-${m}`);
    s.logs[m] = r.value;
  }
  // Every logged habit must exist.
  const ids = new Set(s.habits.habits.map((h) => h.id));
  for (const log of Object.values(s.logs)) {
    for (const entries of Object.values(log.days)) {
      for (const id of Object.keys(entries)) if (!ids.has(id)) return { ok: false, error: `The log names a habit that is not in the backup (${id}).` };
    }
  }
  return { ok: true, snapshot: s, app: String(file.app ?? ''), exportedAt: String(file.exportedAt ?? ''), migrated };
}

/** The record as a person sees it: values and skips per habit-day, without write times. */
export function recordOf(s: Snapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const log of Object.values(s.logs)) {
    for (const [date, entries] of Object.entries(log.days)) {
      for (const [habit, e] of Object.entries(entries)) {
        if (isCleared(e)) continue;
        out[`${date}|${habit}`] = e.skip !== undefined ? `skip:${String(e.skip)}` : `v:${String(e.v)}`;
      }
    }
  }
  return out;
}

export interface DryRun {
  habits: number;
  days: number;
  range: { from: DateKey; to: DateKey } | null;
  entries: number;
  changes: {
    entriesAdded: number;
    entriesRemoved: number;
    entriesChanged: number;
    habitsAdded: string[];
    habitsRemoved: string[];
    settingsChanged: boolean;
  };
  migrated: string[];
}

export function dryRun(current: Snapshot, incoming: Snapshot, migrated: string[] = []): DryRun {
  const a = recordOf(current);
  const b = recordOf(incoming);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [k, v] of Object.entries(b)) {
    if (!(k in a)) added++;
    else if (a[k] !== v) changed++;
  }
  for (const k of Object.keys(a)) if (!(k in b)) removed++;

  const dates = new Set(Object.keys(b).map((k) => k.slice(0, 10)));
  const sorted = [...dates].sort(compareDateKeys);
  const curIds = new Set(current.habits.habits.map((h) => h.id));
  const newIds = new Set(incoming.habits.habits.map((h) => h.id));
  return {
    habits: incoming.habits.habits.length,
    days: dates.size,
    range: sorted.length ? { from: sorted[0] as DateKey, to: sorted[sorted.length - 1] as DateKey } : null,
    entries: Object.keys(b).length,
    changes: {
      entriesAdded: added,
      entriesRemoved: removed,
      entriesChanged: changed,
      habitsAdded: incoming.habits.habits.filter((h) => !curIds.has(h.id)).map((h) => h.name),
      habitsRemoved: current.habits.habits.filter((h) => !newIds.has(h.id)).map((h) => h.name),
      settingsChanged: JSON.stringify(current.profile) !== JSON.stringify(incoming.profile),
    },
    migrated,
  };
}

export interface ReplaceWrite {
  date: DateKey;
  habit: HabitId;
  e: Entry;
}

/**
 * The entry writes that make the store hold exactly `incoming`: every incoming entry rewritten
 * at `now` (so it wins over anything already stored), and every current entry the backup does
 * not have cleared at `now`.
 */
export function replaceWrites(current: Snapshot, incoming: Snapshot, now: number, dev: string): ReplaceWrite[] {
  const writes: ReplaceWrite[] = [];
  const b = new Set<string>();
  for (const log of Object.values(incoming.logs)) {
    for (const [date, entries] of Object.entries(log.days)) {
      for (const [habit, e] of Object.entries(entries)) {
        if (isCleared(e)) continue;
        b.add(`${date}|${habit}`);
        const w: Entry = { at: now, dev };
        if (e.v !== undefined) w.v = e.v;
        if (e.skip !== undefined) w.skip = e.skip;
        writes.push({ date, habit, e: w });
      }
    }
  }
  for (const log of Object.values(current.logs)) {
    for (const [date, entries] of Object.entries(log.days)) {
      for (const [habit, e] of Object.entries(entries)) {
        if (isCleared(e) || b.has(`${date}|${habit}`)) continue;
        writes.push({ date, habit, e: { at: now, dev } });
      }
    }
  }
  return writes;
}

/**
 * The weekly backup prompt: once a week, after a day closes; never on the very first launch,
 * never during a scene.
 */
export function backupDue(o: {
  lastBackup: DateKey | null;
  firstUse: DateKey | null;
  today: DateKey;
  dayClosed: boolean;
  firstLaunch: boolean;
  sceneActive: boolean;
}): boolean {
  if (!o.dayClosed || o.sceneActive || o.firstLaunch || !o.firstUse) return false;
  if (!isDateKey(o.today) || !isDateKey(o.firstUse)) return false;
  return diffDays(o.lastBackup ?? o.firstUse, o.today) >= 7;
}

export type PreparedImport =
  | { ok: true; incoming: Snapshot; summary: DryRun; safetyExport: string; safetyName: string }
  | { ok: false; error: string };

/** Step 1 of an import: validate, migrate, summarise, and export the current data first. */
export function prepareImport(current: Snapshot, text: string, app: string, now: number): PreparedImport {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    incoming: parsed.snapshot,
    summary: dryRun(current, parsed.snapshot, parsed.migrated),
    safetyExport: exportJson(current, app, now),
    safetyName: backupFileName(now).replace('.json', '-before-import.json'),
  };
}
