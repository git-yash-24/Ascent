/** M10's daily record check (data/trial.ts): lost or silently changed entries are found; edits are not problems. */
import { describe, expect, it } from 'vitest';
import { checkDay, compare, fingerprint, roundTrip } from '../../src/data/trial';
import { emptySnapshot } from '../../src/core/model/snapshot';
import type { Snapshot } from '../../src/core/model/types';
import fc from 'fast-check';
import { historyArb } from '../fixtures/histories';

function snap(entries: Record<string, { v?: number; at: number }>): Snapshot {
  const s = emptySnapshot();
  const days: Record<string, Record<string, { v?: number; at: number; dev: string }>> = {};
  for (const [k, e] of Object.entries(entries)) {
    const [date, habit] = k.split('|') as [string, string];
    (days[date] ??= {})[habit] = { ...e, dev: 'd' };
  }
  return { ...s, logs: { '2026-10': { schema: 1, days } } } as Snapshot;
}

describe('the 14-day check', () => {
  it('finds nothing when only new entries and your own edits happened', () => {
    const a = fingerprint(snap({ '2026-10-13|q': { v: 1, at: 100 } }));
    const b = fingerprint(snap({ '2026-10-13|q': { v: 2, at: 200 }, '2026-10-14|q': { v: 1, at: 300 } }));
    expect(compare(a, b)).toEqual({ findings: [], edits: 1, added: 1 });
  });

  it('flags an entry that vanished, and one that changed without a newer write', () => {
    const a = fingerprint(snap({ '2026-10-12|q': { v: 1, at: 100 }, '2026-10-13|q': { v: 1, at: 150 } }));
    const b = fingerprint(snap({ '2026-10-13|q': { v: 3, at: 150 } }));
    const kinds = compare(a, b).findings.map((f) => `${f.kind}:${f.date}`).sort();
    expect(kinds).toEqual(['changed:2026-10-13', 'lost:2026-10-12']);
  });

  it('keeps a running tally day by day', () => {
    const s1 = snap({ '2026-10-13|q': { v: 1, at: 100 } });
    const day1 = checkDay(null, s1, '2026-10-13', 'test', 1);
    expect(day1.start).toBe('2026-10-13');
    const day2 = checkDay(day1, snap({}), '2026-10-14', 'test', 2);
    expect(day2.days.map((d) => d.lost)).toEqual([0, 1]);
    expect(day2.findings[0]?.kind).toBe('lost');
  });

  it('reads a backup back identical, for any history', () => {
    fc.assert(fc.property(historyArb, (h) => roundTrip(h.snapshot, 'test', 1_800_000_000_000)), { numRuns: 60 });
  });
});
