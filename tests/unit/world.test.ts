/** The world's readings of the record: camp improvements, momentum, weather. */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/derive';
import { campState, hourIn, momentumStep, waterDue, weatherOf } from '../../src/core/world';
import { R, day, log, logRange, withHabits } from '../fixtures/build';

const MON = '2026-09-07';

describe('camp improvements', () => {
  it('follow story days on a published schedule, with an honest next goal', () => {
    expect(campState(0).built).toEqual([]);
    expect(campState(0).next).toMatchObject({ id: 'windbreak', inDays: 5 });
    expect(campState(5).built.map((i) => i.id)).toEqual(['windbreak']);
    expect(campState(13).next).toMatchObject({ id: 'lantern', inDays: 7 });
    expect(campState(500).next).toBeNull();
  });
});

describe('momentum', () => {
  it('drops one step per missed day, stops at 3, and any effort today restores it', () => {
    let s = logRange(withHabits(R(MON)), MON, 3, 'R', 1); // Mon to Wed done
    const at = (n: number, snap = s) => momentumStep(derive(snap, { date: day(MON, n), ended: false }), day(MON, n));
    expect(at(3)).toBe(0);
    expect(at(4)).toBe(1); // Thursday missed
    expect(at(6)).toBe(3);
    expect(at(10)).toBe(3); // the floor
    s = log(s, day(MON, 10), 'R', 1);
    expect(at(10, s)).toBe(0); // first tap back
  });

  it('rest and sick days are not misses', () => {
    let s = logRange(withHabits(R(MON)), MON, 2, 'R', 1);
    s = log(log(s, day(MON, 2), 'R', 'rest'), day(MON, 3), 'R', 'sick');
    expect(momentumStep(derive(s, { date: day(MON, 4), ended: false }), day(MON, 4))).toBe(0);
  });
});

describe('weather', () => {
  it('comes from the last ended week; sick and rest days are calm; a secured week clears', () => {
    const climbed = logRange(withHabits(R(MON)), MON, 7, 'R', 1);
    expect(weatherOf(derive(climbed, { date: day(MON, 8), ended: false }), day(MON, 8))).toBe('clear');
    const slipped = log(withHabits(R(MON)), MON, 'R', 1); // one day of seven
    expect(weatherOf(derive(slipped, { date: day(MON, 8), ended: false }), day(MON, 8))).toBe('storm');
    const sick = log(slipped, day(MON, 8), 'R', 'sick');
    expect(weatherOf(derive(sick, { date: day(MON, 8), ended: false }), day(MON, 8))).toBe('calm');
    expect(weatherOf(derive(withHabits(R(MON)), { date: MON, ended: false }), MON)).toBe('calm');
  });
});

describe('water reminder', () => {
  const at = (iso: string) => Date.parse(iso);
  it('is due two hours after the last glass, never when full', () => {
    expect(waterDue({ today: 2, target: 8, lastAt: at('2026-10-13T01:00:00Z') }, at('2026-10-13T02:59:00Z'), 'Asia/Manila')).toBe(false);
    expect(waterDue({ today: 2, target: 8, lastAt: at('2026-10-13T01:00:00Z') }, at('2026-10-13T03:00:00Z'), 'Asia/Manila')).toBe(true);
    expect(waterDue({ today: 8, target: 8, lastAt: at('2026-10-13T01:00:00Z') }, at('2026-10-13T09:00:00Z'), 'Asia/Manila')).toBe(false);
  });
  it('with no glass yet, from 9 in the morning in the record’s zone, not the device’s', () => {
    // 00:30 UTC is 08:30 in Manila: not yet. 01:00 UTC is 09:00 there.
    expect(waterDue({ today: 0, target: 8, lastAt: null }, at('2026-10-13T00:30:00Z'), 'Asia/Manila')).toBe(false);
    expect(waterDue({ today: 0, target: 8, lastAt: null }, at('2026-10-13T01:00:00Z'), 'Asia/Manila')).toBe(true);
    expect(hourIn(at('2026-10-13T01:00:00Z'), 'America/New_York')).toBe(21);
  });
});
