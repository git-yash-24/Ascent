/**
 * Schema migrations (spec: Schema versions and migration).
 *
 * The app reads any older schema, migrates in memory, then validates. The migrated form is
 * written only on the next change to that document. Migrations are pure functions from
 * schema n to n + 1, tested against stored samples of every earlier schema.
 */
import { CURRENT_SCHEMA, parse, type DocKind, type ParseResult } from './schemas';
import type { CorrectionsDoc, HabitsDoc, MonthLog, Profile, SeenDoc } from './types';

export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** steps[kind][n] migrates a document from schema n to n + 1. */
export type MigrationTable = Record<DocKind, Record<number, Migration>>;

/**
 * Schema 0 is the shape a document has before it carried a schema number (or a hand-written
 * import): fields are filled with defaults. Later schema bumps add entries here.
 */
export const MIGRATIONS: MigrationTable = {
  profile: {
    0: (d) => ({
      ...d,
      schema: 1,
      identity: typeof d.identity === 'string' ? d.identity : '',
      settings: {
        dayBoundary: 240,
        timeZone: 'UTC',
        sound: true,
        music: true,
        reducedMotion: false,
        ...(isObject(d.settings) ? d.settings : {}),
      },
    }),
    // Schema 2 adds the weekly climb choices.
    1: (d) => ({ ...d, schema: 2, weekly: { steep: [] } }),
  },
  habits: { 0: (d) => ({ ...d, schema: 1, habits: Array.isArray(d.habits) ? d.habits : [] }) },
  log: { 0: (d) => ({ ...d, schema: 1, days: isObject(d.days) ? d.days : {} }) },
  seen: {
    0: (d) => ({
      schema: 1,
      presentedStoryDay: typeof d.presentedStoryDay === 'number' ? d.presentedStoryDay : 0,
      episodes: Array.isArray(d.episodes) ? d.episodes : [],
      moments: Array.isArray(d.moments) ? d.moments : [],
      records: Array.isArray(d.records) ? d.records : [],
    }),
  },
  corrections: { 0: (d) => ({ ...d, schema: 1, log: Array.isArray(d.log) ? d.log : [] }) },
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export interface MigrateResult {
  doc: Record<string, unknown>;
  from: number;
  to: number;
}

/**
 * Run every step from the document's schema up to the current one.
 * Throws on a schema newer than this build understands (never guess at the future).
 */
export function migrate(
  kind: DocKind,
  input: unknown,
  table: MigrationTable = MIGRATIONS,
  target: number = CURRENT_SCHEMA[kind],
): MigrateResult {
  if (!isObject(input)) throw new TypeError(`${kind}: not an object`);
  const raw = input.schema;
  const from = raw === undefined ? 0 : raw;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
    throw new TypeError(`${kind}: bad schema number`);
  }
  if (from > target) throw new RangeError(`${kind}: schema ${from} is newer than this app (${target})`);
  let doc: Record<string, unknown> = structuredClone(input);
  for (let n = from; n < target; n++) {
    const step = table[kind][n];
    if (!step) throw new RangeError(`${kind}: no migration from schema ${n}`);
    doc = step(doc);
    if (doc.schema !== n + 1) throw new Error(`${kind}: migration ${n} did not set schema ${n + 1}`);
  }
  return { doc, from, to: target };
}

/** Migrate then validate. Anything that fails is rejected, never partially accepted. */
export function load<K extends DocKind>(kind: K, input: unknown): ParseResult<LoadedDoc[K]> {
  let migrated: MigrateResult;
  try {
    migrated = migrate(kind, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parse[kind](migrated.doc) as ParseResult<LoadedDoc[K]>;
}

export interface LoadedDoc {
  profile: Profile;
  habits: HabitsDoc;
  log: MonthLog;
  seen: SeenDoc;
  corrections: CorrectionsDoc;
}
