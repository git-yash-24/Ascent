/** Schemas, migrations and habit lifecycle edges. */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { migrate, load, type MigrationTable } from '../../src/core/model/migrations';
import { parse } from '../../src/core/model/schemas';
import { archiveHabit, deleteHabit, editDefinition, restoreHabit } from '../../src/core/habits/versions';
import { Q, R, day, emptySnapshot, log, logRange, withHabits } from '../fixtures/build';

const D1 = '2026-10-12';

describe('schemas', () => {
  it('accepts every builder document', () => {
    let s = withHabits(Q(D1), R(D1));
    s = log(log(s, D1, 'Q', 30), D1, 'R', 'exam');
    expect(parse.habits(s.habits).ok).toBe(true);
    expect(parse.log(s.logs['2026-10']).ok).toBe(true);
    expect(parse.seen(s.seen).ok).toBe(true);
    expect(parse.corrections(s.corrections).ok).toBe(true);
  });

  it.each([
    ['a negative value', { v: -1, at: 1, dev: 'd' }],
    ['a value with a skip', { v: 1, skip: true, at: 1, dev: 'd' }],
    ['text for a value', { v: '5', at: 1, dev: 'd' }],
    ['a huge value', { v: 1e9, at: 1, dev: 'd' }],
    ['a missing device', { v: 1, at: 1 }],
    ['an unknown field', { v: 1, at: 1, dev: 'd', add: 3 }],
    ['an unknown skip reason', { skip: 'bored', at: 1, dev: 'd' }],
  ])('rejects an entry with %s', (_label, e) => {
    expect(parse.entry(e).ok).toBe(false);
  });

  it('rejects habits that break their own rules', () => {
    const h = Q(D1);
    const bad = [
      { ...h, versions: [{ ...h.versions[0], minimum: 60 }] },
      { ...h, createdOn: day(D1, 1) },
      { ...R(D1), versions: [{ ...R(D1).versions[0], target: 2 }] },
      { ...h, versions: [h.versions[0], h.versions[0]] },
    ];
    for (const b of bad) expect(parse.habits({ schema: 3, habits: [b] }).ok).toBe(false);
    expect(parse.habits({ schema: 3, habits: [h, h] }).ok).toBe(false);
  });

  it('rejects a log keyed by an impossible date', () => {
    expect(parse.log({ schema: 1, days: { '2026-02-30': {} } }).ok).toBe(false);
  });
});

describe('migrations', () => {
  it('migrates schema 0 documents of every kind to the current schema', () => {
    expect(load('profile', { identity: 'I show up', startDate: D1 }).ok).toBe(true);
    expect(load('habits', { habits: [Q(D1)] }).ok).toBe(true);
    expect(load('seen', {}).ok).toBe(true);
    expect(load('corrections', {}).ok).toBe(true);
    expect(load('log', { days: {} }).ok).toBe(true);
  });

  it('profile schema 1 gains an empty weekly climb record in schema 2', () => {
    const v1 = {
      schema: 1,
      identity: 'I show up',
      startDate: D1,
      settings: { dayBoundary: 240, timeZone: 'Asia/Manila', sound: true, music: true, reducedMotion: false },
    };
    const r = load('profile', v1);
    expect(r.ok && r.value.weekly).toEqual({ steep: [] });
    expect(r.ok && r.value.schema).toBe(2);
    expect(load('profile', { ...v1, schema: 2, weekly: { steep: ['2026-10-13'] } }).ok).toBe(false); // a Tuesday
  });

  it('refuses a schema newer than the app', () => {
    const r = load('log', { schema: 99, days: {} });
    expect(r.ok).toBe(false);
  });

  it('runs every step in order and never mutates its input', () => {
    const table: MigrationTable = {
      profile: {},
      habits: {},
      seen: {},
      corrections: {},
      notes: {},
      log: {
        0: (d) => ({ ...d, schema: 1, trail: ['0to1'] }),
        1: (d) => ({ ...d, schema: 2, trail: [...(d.trail as string[]), '1to2'] }),
      },
    };
    const input = { days: {} };
    const out = migrate('log', input, table, 2);
    expect(out.doc.trail).toEqual(['0to1', '1to2']);
    expect(out.from).toBe(0);
    expect(input).toEqual({ days: {} });
  });

  it('fails loudly on a missing step', () => {
    expect(() => migrate('log', { schema: 0 }, { profile: {}, habits: {}, seen: {}, corrections: {}, notes: {}, log: {} }, 1)).toThrow();
  });
});

describe('lifecycle edges', () => {
  it('archive then restore on the same day leaves no gap', () => {
    let s = withHabits(R(D1));
    s = { ...s, habits: archiveHabit(s.habits, 'R', day(D1, 3)) };
    s = { ...s, habits: restoreHabit(s.habits, 'R', day(D1, 3)) };
    expect(s.habits.habits[0]?.versions).toHaveLength(1);
    expect(s.habits.habits[0]?.archivedFrom).toBeUndefined();
    const d = derive(s, { date: day(D1, 6), ended: true });
    expect(d.days[day(D1, 5)]?.outcome).toBe('missed');
  });

  it('two edits on one day keep a single version for that day', () => {
    let s = withHabits(Q(D1));
    const def = { type: 'numeric' as const, target: 60, schedule: { kind: 'daily' as const } };
    s = { ...s, habits: editDefinition(s.habits, 'Q', day(D1, 5), def) };
    s = { ...s, habits: editDefinition(s.habits, 'Q', day(D1, 5), { ...def, target: 70 }) };
    expect(s.habits.habits[0]?.versions.map((v) => v.target)).toEqual([50, 70]);
    expect(parse.habits(s.habits).ok).toBe(true);
  });

  it('delete needs an archive first and removes the history', () => {
    let s = logRange(withHabits(Q(D1), R(D1)), D1, 3, 'R', 1);
    s = log(s, D1, 'Q', 50);
    expect(() => deleteHabit(s, 'R')).toThrow();
    s = { ...s, habits: archiveHabit(s.habits, 'R', day(D1, 3)) };
    s = deleteHabit(s, 'R');
    expect(s.habits.habits.map((h) => h.id)).toEqual(['Q']);
    expect(JSON.stringify(s.logs)).not.toContain('"R"');
    expect(Object.keys(s.logs['2026-10']?.days ?? {})).toEqual([D1]);
  });

  it('an empty snapshot is valid', () => {
    const s = emptySnapshot();
    expect(parse.habits(s.habits).ok && parse.seen(s.seen).ok && parse.corrections(s.corrections).ok).toBe(true);
  });
});

describe('records and condition', () => {
  it('a 7-unit chain leaves a best-chain mark where it stands', () => {
    const s = logRange(withHabits(R(D1)), D1, 9, 'R', 1);
    const d = derive(s, { date: day(D1, 8), ended: false });
    expect(d.records).toContainEqual({ id: 'best-chain:R', on: day(D1, 8) });
  });

  it('a comeback: 7 shown-up days after 7 or more missed', () => {
    let s = logRange(withHabits(R(D1)), D1, 2, 'R', 1);
    s = logRange(s, day(D1, 10), 7, 'R', 1); // days 2-9 missed (8), then 7 back
    const d = derive(s, { date: day(D1, 16), ended: true });
    expect(d.records).toContainEqual({ id: `comeback:${day(D1, 16)}`, on: day(D1, 16) });
    const short = logRange(logRange(withHabits(R(D1)), D1, 2, 'R', 1), day(D1, 7), 7, 'R', 1); // 5 missed
    expect(derive(short, { date: day(D1, 13), ended: true }).records.some((r) => r.id.startsWith('comeback'))).toBe(false);
  });

  it('fatigue follows the 7-day rate on ended days, with at least 3 days', () => {
    const fresh = logRange(withHabits(R(D1)), D1, 7, 'R', 1);
    expect(derive(fresh, { date: day(D1, 7), ended: false }).condition.fatigue).toBe('fresh');
    let tired = withHabits(R(D1));
    for (const i of [0, 2, 4, 5]) tired = log(tired, day(D1, i), 'R', 1); // 4 of 7 = 0.57
    expect(derive(tired, { date: day(D1, 7), ended: false }).rates.last7).toBeCloseTo(4 / 7, 10);
    expect(derive(tired, { date: day(D1, 7), ended: false }).condition.fatigue).toBe('tired');
    let worn = withHabits(R(D1));
    for (const i of [0, 3]) worn = log(worn, day(D1, i), 'R', 1); // 2 of 7, no run of 3 misses
    worn = log(worn, day(D1, 5), 'R', 1);
    expect(derive(worn, { date: day(D1, 7), ended: false }).condition.fatigue).toBe('worn');
    expect(derive(withHabits(R(D1)), { date: day(D1, 1), ended: false }).rates.last7).toBeNull();
  });

  it('resolve tiers at 1, 15, 60 and 180 days shown up; warmth follows today', () => {
    const tierAt = (n: number): number =>
      derive(logRange(withHabits(R(D1)), D1, n, 'R', 1), { date: day(D1, n), ended: false }).condition.resolveTier;
    expect([tierAt(14), tierAt(15), tierAt(60), tierAt(180)]).toEqual([0, 1, 2, 3]);
    const half = log(withHabits(Q(D1)), D1, 'Q', 30);
    expect(derive(half, { date: D1, ended: false }).condition.warmth).toBeCloseTo(0.6, 10);
    const rest = log(withHabits(Q(D1)), D1, 'Q', 'sick');
    expect(derive(rest, { date: D1, ended: false }).condition.warmth).toBe(1);
  });
});
