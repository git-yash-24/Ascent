/** Phase 5: when things happened, as honestly as the record can say (core/timeline.ts). */
import { describe, expect, it } from 'vitest';
import { clockOf, glassTimes, hourOf, momentOf } from '../../src/core/timeline';
import type { Entry } from '../../src/core/model/types';

const TZ = 'Asia/Manila';
const at = (iso: string): number => new Date(iso).getTime();

describe('the moment a habit-day settled', () => {
  it('has no time when none was recorded (older entries)', () => {
    const e: Entry = { v: 1, at: at('2026-10-01T09:00:00+08:00'), dev: 'd' };
    expect(momentOf(e, '2026-10-01', TZ, 240)).toEqual({ at: null, started: null, loggedOn: null, elsewhere: false });
  });

  it('is the last recorded change, with the start when it was begun earlier', () => {
    const e: Entry = {
      v: 50,
      at: at('2026-10-14T18:40:00+08:00'),
      dev: 'd',
      acts: [
        { at: at('2026-10-14T10:12:00+08:00'), v: 20 },
        { at: at('2026-10-14T18:40:00+08:00'), v: 50 },
      ],
    };
    const m = momentOf(e, '2026-10-14', TZ, 240);
    expect(clockOf(m.at!, TZ)).toBe('18:40');
    expect(clockOf(m.started!, TZ)).toBe('10:12');
    expect(m.loggedOn).toBeNull();
    expect(hourOf(m.at!, TZ)).toBeCloseTo(18 + 40 / 60, 5);
  });

  it('says when a day was logged later (a backfill), instead of inventing a time', () => {
    const e: Entry = { v: 1, at: at('2026-10-15T08:05:00+08:00'), dev: 'd', acts: [{ at: at('2026-10-15T08:05:00+08:00'), v: 1 }] };
    expect(momentOf(e, '2026-10-14', TZ, 240).loggedOn).toBe('2026-10-15');
  });

  it('counts a late night before the day boundary for the day itself', () => {
    const e: Entry = { v: 1, at: at('2026-10-15T01:30:00+08:00'), dev: 'd', acts: [{ at: at('2026-10-15T01:30:00+08:00'), v: 1 }] };
    expect(momentOf(e, '2026-10-14', TZ, 240).loggedOn).toBeNull();
  });

  it('does not call a record made in a zone ahead "logged later" (speedrun: Tomás in Madrid)', () => {
    // 06:30 in Madrid on 27 Nov is 23:30 on 26 Nov in Mexico City, the record's zone.
    const t = at('2026-11-27T06:30:00+01:00');
    const m = momentOf({ v: 1, at: t, dev: 'd', acts: [{ at: t, v: 1 }] }, '2026-11-27', 'America/Mexico_City', 240);
    expect(m.loggedOn).toBeNull();
    expect(m.elsewhere).toBe(true);
  });
});

describe('the time of each glass', () => {
  it('gives each glass the time it was added, and a removal takes the latest back', () => {
    const t = [at('2026-10-14T07:00:00Z'), at('2026-10-14T09:00:00Z'), at('2026-10-14T11:00:00Z'), at('2026-10-14T12:00:00Z')];
    expect(glassTimes([{ at: t[0]!, v: 1 }, { at: t[1]!, v: 2 }, { at: t[2]!, v: 1 }, { at: t[3]!, v: 2 }], 2)).toEqual([t[0], t[3]]);
  });

  it('leaves glasses from before times were kept untimed', () => {
    const t = at('2026-10-14T09:00:00Z');
    expect(glassTimes([{ at: t, v: 3 }], 3)).toEqual([null, null, t]);
    expect(glassTimes(undefined, 2)).toEqual([null, null]);
  });
});
