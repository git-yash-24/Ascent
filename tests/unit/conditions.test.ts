/** Weather × season × time (game/conditions.ts) and the moon (game/sky.ts). */
import { describe, expect, it } from 'vitest';
import { conditionsFor, goldenOf, KINDS, kindFor, outfitFor, SEASONS, seasonOf, shelterFor, todaysConditions } from '../../src/game/conditions';
import { moonAge, sunAt } from '../../src/game/sky';
import type { Weather } from '../../src/core/world';

const CANON: Weather[] = ['clear', 'calm', 'snow', 'storm'];

describe('the weather the world shows', () => {
  it('follows the calendar for the season (northern, at the preset latitude)', () => {
    expect(seasonOf(new Date(2026, 0, 15))).toBe('winter');
    expect(seasonOf(new Date(2026, 3, 15))).toBe('spring');
    expect(seasonOf(new Date(2026, 6, 15))).toBe('summer');
    expect(seasonOf(new Date(2026, 9, 13))).toBe('autumn');
    expect(seasonOf(new Date(2026, 11, 1))).toBe('winter');
  });

  it('makes a slipped week hard in a way that fits the season, and never snow in summer', () => {
    const d = new Date(2026, 9, 13);
    expect(kindFor('storm', 'winter', d)).toBe('blizzard');
    expect(kindFor('storm', 'summer', d)).toBe('thunder');
    expect(kindFor('storm', 'autumn', d)).toBe('gale');
    for (const c of CANON) for (let i = 0; i < 40; i++) expect(['snow', 'blizzard']).not.toContain(kindFor(c, 'summer', new Date(2026, 6, 1 + i)));
  });

  it('keeps a good week fair: no rain, snow or lightning from a clear canon', () => {
    for (const s of SEASONS) {
      for (let i = 0; i < 60; i++) {
        const c = todaysConditions('clear', new Date(2026, 0, 1 + i * 6), s);
        expect(c.rain).toBe(0);
        expect(c.snow).toBe(0);
        expect(c.lightning).toBe(false);
      }
    }
  });

  it('is the same all day and on every device (from the date alone)', () => {
    const a = todaysConditions('calm', new Date(2026, 9, 13, 6, 0));
    const b = todaysConditions('calm', new Date(2026, 9, 13, 23, 30));
    expect(a).toEqual(b);
  });

  it('has sensible numbers for every kind in every season', () => {
    for (const k of KINDS) {
      for (const s of SEASONS) {
        const c = conditionsFor(k, s);
        for (const v of [c.cover, c.storm, c.wind, c.rain, c.snow, c.fog, c.cold, c.heat, c.lying, c.wet]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        // Snow lies only in winter or while it falls.
        if (s !== 'winter' && c.snow === 0) expect(c.lying).toBe(0);
        if (c.rain > 0 || c.snow > 0) expect(c.motes === 'none' || k === 'gale').toBe(true);
      }
    }
  });
});

describe('what Ari wears and rigs', () => {
  it('a rain shell in rain, a parka in the cold, a sun hat only on a hot sunny day', () => {
    expect(outfitFor(conditionsFor('rain', 'autumn'), 20).layer).toBe('shell');
    expect(outfitFor(conditionsFor('clear', 'winter'), 20).layer).toBe('parka');
    expect(outfitFor(conditionsFor('blizzard', 'winter'), 5).bundled).toBe(true);
    const hot = outfitFor(conditionsFor('dry', 'summer'), 40);
    expect(hot.layer).toBe('light');
    expect(hot.sunHat).toBe(true);
    expect(outfitFor(conditionsFor('dry', 'summer'), -10).sunHat).toBe(false);
  });

  it('covers her things when anything falls, and only then', () => {
    expect(shelterFor(conditionsFor('rain', 'spring')).sheet).toBe(true);
    expect(shelterFor(conditionsFor('thunder', 'summer')).fly).toBe(true);
    expect(shelterFor(conditionsFor('snow', 'winter')).sheet).toBe(true);
    expect(shelterFor(conditionsFor('clear', 'summer'))).toEqual({ sheet: false, fly: false, tentShut: false, weighted: false });
  });
});

describe('the golden hour and the moon', () => {
  it('is golden just above the horizon and not at noon or at night', () => {
    expect(goldenOf(4)).toBeCloseTo(1, 5);
    expect(goldenOf(40)).toBe(0);
    expect(goldenOf(-10)).toBe(0);
    expect(goldenOf(1)).toBeGreaterThan(0.3);
  });

  it('has the moon age from the date: new on 6 Jan 2000, full about 14.8 days later', () => {
    expect(moonAge(new Date(Date.UTC(2000, 0, 6, 18, 14)))).toBeCloseTo(0, 3);
    expect(moonAge(new Date(Date.UTC(2000, 0, 21, 12, 0)))).toBeGreaterThan(14);
    expect(moonAge(new Date(Date.UTC(2000, 0, 21, 12, 0)))).toBeLessThan(15.5);
  });

  it('puts a full moon opposite the sun and a new moon beside it', () => {
    const full = sunAt(18, 286, 28, 14.77);
    expect(full.moonLit).toBeCloseTo(1, 2);
    expect(full.dir.dot(full.moon)).toBeLessThan(-0.85);
    const fresh = sunAt(18, 286, 28, 0.2);
    expect(fresh.moonLit).toBeLessThan(0.01);
    expect(fresh.dir.dot(fresh.moon)).toBeGreaterThan(0.9);
    // A full moon rises as the sun sets and is high at midnight.
    expect(sunAt(0, 286, 28, 14.77).moonElev).toBeGreaterThan(40);
  });
});

import { setHemisphereFromZone, seasonOf as seasonOfZ } from '../../src/game/conditions';
describe('hemisphere', () => {
  it('flips the seasons for southern zones', () => {
    setHemisphereFromZone('Australia/Sydney');
    expect(seasonOfZ(new Date(2026, 0, 15))).toBe('summer');
    setHemisphereFromZone('Europe/Madrid');
    expect(seasonOfZ(new Date(2026, 0, 15))).toBe('winter');
  });
});
