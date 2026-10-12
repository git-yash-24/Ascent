/** Random histories for property and regression tests. */
import fc from 'fast-check';
import { addDays } from '../../src/core/model/date';
import { mergeEntry } from '../../src/core/model/entries';
import type { DateKey, Entry, Habit, Schedule, Snapshot } from '../../src/core/model/types';
import { emptySnapshot, version } from './build';

export const START = '2026-01-05';

export const scheduleArb: fc.Arbitrary<Schedule> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Schedule>({ kind: 'daily' }) },
  fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 6 }).map((days) => ({ kind: 'weekdays' as const, days })),
  fc.integer({ min: 1, max: 5 }).map((n) => ({ kind: 'perWeek' as const, n })),
  fc.integer({ min: 1, max: 12 }).map((n) => ({ kind: 'perMonth' as const, n })),
);

const habitArb = (i: number): fc.Arbitrary<Habit> =>
  fc.record({ numeric: fc.boolean(), schedule: scheduleArb, offset: fc.integer({ min: 0, max: 10 }) }).map(({ numeric, schedule, offset }) => {
    const createdOn = addDays(START, offset);
    return {
      id: `h${i}`,
      name: `habit ${i}`,
      category: 'effort' as const,
      createdOn,
      versions: [numeric ? version(createdOn, { type: 'numeric', target: 50, minimum: 25, schedule }) : version(createdOn, { schedule })],
    };
  });

type Cell = { kind: 'none' } | { kind: 'value'; v: number } | { kind: 'skip' } | { kind: 'clear' };
const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Cell>({ kind: 'none' }) },
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 100 }).map<Cell>((v) => ({ kind: 'value', v })) },
  { weight: 1, arbitrary: fc.constant<Cell>({ kind: 'skip' }) },
  { weight: 1, arbitrary: fc.constant<Cell>({ kind: 'clear' }) },
);

export interface History {
  snapshot: Snapshot;
  writes: Array<{ date: DateKey; habit: string; e: Entry }>;
  today: DateKey;
  ended: boolean;
}

export const historyArb: fc.Arbitrary<History> = fc
  .integer({ min: 1, max: 4 })
  .chain((n) =>
    fc.record({
      habits: fc.tuple(...Array.from({ length: n }, (_, i) => habitArb(i))),
      length: fc.integer({ min: 1, max: 120 }),
      ended: fc.boolean(),
      seed: fc.array(cellArb, { minLength: 4 * 130, maxLength: 4 * 130 }),
    }),
  )
  .map(({ habits, length, ended, seed }) => {
    let s: Snapshot = { ...emptySnapshot(), habits: { schema: 1, habits } };
    const writes: History['writes'] = [];
    let at = 1;
    for (let d = 0; d < length + 10; d++) {
      const date = addDays(START, d);
      habits.forEach((h, hi) => {
        const cell = seed[(d * 4 + hi) % seed.length] as Cell;
        if (cell.kind === 'none' || date < h.createdOn) return;
        const binary = h.versions[0]?.type === 'binary';
        const e: Entry =
          cell.kind === 'skip'
            ? { skip: true, at: at++, dev: 'd' }
            : cell.kind === 'clear'
              ? { at: at++, dev: 'd' }
              : { v: binary ? (cell.v > 30 ? 1 : 0) : cell.v, at: at++, dev: 'd' };
        writes.push({ date, habit: h.id, e });
        s = mergeEntry(s, date, h.id, e);
      });
    }
    return { snapshot: s, writes, today: addDays(START, length + 9), ended };
  });

