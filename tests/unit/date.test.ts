import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  diffDays,
  isDateKey,
  logicalDay,
  monthOf,
  weekStart,
  weekday,
} from '../../src/core/model/date';

// A date key generator covering 1990 to 2100.
const dateKey = fc
  .date({ min: new Date(Date.UTC(1990, 0, 1)), max: new Date(Date.UTC(2100, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe('date keys', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isDateKey('2026-10-13')).toBe(true);
    expect(isDateKey('2028-02-29')).toBe(true); // leap year (matrix T12)
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey('')).toBe(false);
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-13', 0)).toBe('2026-10-13');
  });

  it('rejects non-integer offsets and bad keys', () => {
    expect(() => addDays('2026-10-13', 0.5)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });

  it('property: addDays and diffDays are inverse', () => {
    fc.assert(
      fc.property(dateKey, fc.integer({ min: -4000, max: 4000 }), (k, n) => {
        expect(diffDays(k, addDays(k, n))).toBe(n);
        expect(addDays(addDays(k, n), -n)).toBe(k);
        expect(isDateKey(addDays(k, n))).toBe(true);
      }),
    );
  });

  it('weeks run Monday to Sunday, across the year boundary (matrix T13)', () => {
    expect(weekday('2026-10-12')).toBe(1); // a Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });

  it('property: weekStart is a Monday within the previous 6 days', () => {
    fc.assert(
      fc.property(dateKey, (k) => {
        const s = weekStart(k);
        expect(weekday(s)).toBe(1);
        const d = diffDays(s, k);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(6);
      }),
    );
  });

  it('names the month document', () => {
    expect(monthOf('2026-10-13')).toBe('2026-10');
  });
});

describe('logical day and the day boundary', () => {
  const manila = 'Asia/Manila'; // UTC+8, no daylight saving

  it('counts an instant before the boundary for the previous date (matrix T02, T03)', () => {
    // 03:59 Manila on 13 Oct = 19:59 UTC on 12 Oct
    expect(logicalDay(new Date('2026-10-12T19:59:00Z'), manila, 240)).toBe('2026-10-12');
    // 04:00 Manila on 13 Oct
    expect(logicalDay(new Date('2026-10-12T20:00:00Z'), manila, 240)).toBe('2026-10-13');
  });

  it('does not roll the day at midnight with a 04:00 boundary (matrix T01)', () => {
    // 00:01 Manila on 13 Oct
    expect(logicalDay(new Date('2026-10-12T16:01:00Z'), manila, 240)).toBe('2026-10-12');
  });

  it('supports a night-shift boundary of 08:00', () => {
    // 06:30 Manila on 13 Oct
    expect(logicalDay(new Date('2026-10-12T22:30:00Z'), manila, 480)).toBe('2026-10-12');
  });

  it('handles daylight saving zones', () => {
    // New York, the night clocks go back (3 Nov 2024). 01:30 local happens twice; both before 04:00.
    expect(logicalDay(new Date('2024-11-03T05:30:00Z'), 'America/New_York', 240)).toBe('2024-11-02');
    expect(logicalDay(new Date('2024-11-03T06:30:00Z'), 'America/New_York', 240)).toBe('2024-11-02');
    expect(logicalDay(new Date('2024-11-03T10:00:00Z'), 'America/New_York', 240)).toBe('2024-11-03');
  });

  it('rejects invalid boundaries', () => {
    expect(() => logicalDay(new Date(), manila, -1)).toThrow(RangeError);
    expect(() => logicalDay(new Date(), manila, 1440)).toThrow(RangeError);
  });
});
