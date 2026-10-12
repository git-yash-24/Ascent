/**
 * Validation for every stored document (I9: invalid input never corrupts stored records).
 * Documents are validated after migration, at the boundary between the store and the core.
 */
import { z } from 'zod';
import { isDateKey, weekStart } from './date';
import type { CorrectionsDoc, Entry, HabitsDoc, MonthLog, Profile, SeenDoc } from './types';

export const CURRENT_SCHEMA = {
  profile: 2,
  habits: 1,
  log: 1,
  seen: 1,
  corrections: 1,
} as const;

export type DocKind = keyof typeof CURRENT_SCHEMA;

/** Largest value a numeric or duration habit accepts (one day of minutes is 1440). */
export const MAX_VALUE = 1_000_000;

const dateKey = z.string().refine(isDateKey, { message: 'not a calendar date' });
const id = z.string().min(1).max(64);

const schedule = z.union([
  z.object({ kind: z.literal('daily') }).strict(),
  z
    .object({
      kind: z.literal('weekdays'),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .strict()
    .refine((s) => new Set(s.days).size === s.days.length, { message: 'repeated weekday' }),
  z.object({ kind: z.literal('perWeek'), n: z.number().int().min(1).max(7) }).strict(),
  z.object({ kind: z.literal('perMonth'), n: z.number().int().min(1).max(31) }).strict(),
]);

const habitVersion = z
  .object({
    from: dateKey,
    type: z.enum(['binary', 'numeric', 'duration', 'avoid']),
    unit: z.string().max(24).optional(),
    target: z.number().finite().positive().max(MAX_VALUE),
    minimum: z.number().finite().positive().max(MAX_VALUE),
    schedule,
    label: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    archived: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.minimum <= v.target, { message: 'minimum above target' })
  .refine((v) => (v.type === 'binary' || v.type === 'avoid' ? v.target === 1 && v.minimum === 1 : true), {
    message: 'binary and avoid habits have target and minimum 1',
  });

const habit = z
  .object({
    id,
    name: z.string().min(1).max(80),
    category: z.enum(['prepare', 'test', 'repair', 'effort', 'presence', 'rest', 'record', 'make', 'care']),
    createdOn: dateKey,
    archivedFrom: dateKey.optional(),
    versions: z.array(habitVersion).min(1).max(500),
  })
  .strict()
  .refine((h) => h.versions.every((v, i, a) => i === 0 || (a[i - 1] as { from: string }).from < v.from), {
    message: 'versions must be strictly ordered by from',
  })
  .refine((h) => (h.versions[0] as { from: string }).from === h.createdOn, {
    message: 'first version must start on createdOn',
  });

export const entrySchema = z
  .object({
    v: z.number().finite().min(0).max(MAX_VALUE).optional(),
    skip: z.union([z.literal(true), z.enum(['rest', 'sick', 'travel', 'exam', 'night'])]).optional(),
    at: z.number().int().nonnegative(),
    dev: id,
  })
  .strict()
  .refine((e) => !(e.v !== undefined && e.skip !== undefined), { message: 'value and skip together' });

export const profileSchema = z
  .object({
    schema: z.literal(CURRENT_SCHEMA.profile),
    identity: z.string().max(200),
    startDate: dateKey,
    settings: z
      .object({
        dayBoundary: z.number().int().min(0).max(1439),
        timeZone: z.string().min(1).max(64),
        sound: z.boolean(),
        music: z.boolean(),
        reducedMotion: z.boolean(),
      })
      .strict(),
    weekly: z
      .object({
        steep: z
          .array(dateKey)
          .max(2000)
          .refine((a) => a.every((d) => isDateKey(d) && weekStart(d) === d), { message: 'steep weeks must be Mondays' }),
      })
      .strict(),
  })
  .strict();

export const habitsSchema = z
  .object({ schema: z.literal(CURRENT_SCHEMA.habits), habits: z.array(habit).max(200) })
  .strict()
  .refine((d) => new Set(d.habits.map((h) => h.id)).size === d.habits.length, { message: 'duplicate habit id' });

export const monthLogSchema = z
  .object({
    schema: z.literal(CURRENT_SCHEMA.log),
    days: z.record(dateKey, z.record(id, entrySchema)),
  })
  .strict();

export const seenSchema = z
  .object({
    schema: z.literal(CURRENT_SCHEMA.seen),
    presentedStoryDay: z.number().int().min(0),
    episodes: z.array(z.number().int().min(0)),
    moments: z.array(z.string().max(80)),
    records: z.array(z.string().max(120)),
  })
  .strict();

export const correctionsSchema = z
  .object({
    schema: z.literal(CURRENT_SCHEMA.corrections),
    log: z.array(
      z
        .object({
          date: dateKey,
          habit: id,
          old: entrySchema.nullable(),
          new: entrySchema.nullable(),
          at: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

// Schemas mirror the contracts in types.ts; parse() casts at the boundary because zod's
// optional fields infer as `T | undefined`, which exactOptionalPropertyTypes treats as distinct.
// tests/unit/schemas.test.ts round-trips every contract shape to keep the two in step.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function wrap<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): ParseResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid' };
}

export const parse = {
  profile: (x: unknown): ParseResult<Profile> => wrap(profileSchema as z.ZodType<Profile, z.ZodTypeDef, unknown>, x),
  habits: (x: unknown): ParseResult<HabitsDoc> => wrap(habitsSchema as z.ZodType<HabitsDoc, z.ZodTypeDef, unknown>, x),
  log: (x: unknown): ParseResult<MonthLog> => wrap(monthLogSchema as z.ZodType<MonthLog, z.ZodTypeDef, unknown>, x),
  seen: (x: unknown): ParseResult<SeenDoc> => wrap(seenSchema as z.ZodType<SeenDoc, z.ZodTypeDef, unknown>, x),
  corrections: (x: unknown): ParseResult<CorrectionsDoc> =>
    wrap(correctionsSchema as z.ZodType<CorrectionsDoc, z.ZodTypeDef, unknown>, x),
  entry: (x: unknown): ParseResult<Entry> => wrap(entrySchema as z.ZodType<Entry, z.ZodTypeDef, unknown>, x),
};
