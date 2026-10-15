/** Phase 3's light pipeline: the sun model, a sky that is continuous in time, and the wind. */
import { describe, expect, it } from 'vitest';
import { coverFor, skyFor, sunAt, Wind } from '../../src/game/sky';

describe('the sun', () => {
  it('rises in the east, stands in the south at noon, sets in the west (world: +x east, +z south)', () => {
    const doy = 286; // mid-October
    const morning = sunAt(7, doy);
    const noon = sunAt(12, doy);
    const evening = sunAt(17, doy);
    expect(morning.dir.x).toBeGreaterThan(0.5);
    expect(evening.dir.x).toBeLessThan(-0.5);
    expect(noon.dir.z).toBeGreaterThan(0.5);
    expect(noon.elev).toBeGreaterThan(40);
    expect(sunAt(0, doy).elev).toBeLessThan(-40);
  });

  it('is higher at midsummer noon than at midwinter noon', () => {
    expect(sunAt(12, 172).elev).toBeGreaterThan(sunAt(12, 355).elev + 40);
  });
});

describe('the sky over a whole day', () => {
  // A real sunset changes fast; what must never happen is a step (a discontinuity would be > 0.1).
  it('changes smoothly: no jump between any two minutes, from 04:00 to 04:00, any cover', () => {
    for (const cover of [0.18, 0.42, 0.95]) {
      let prev = skyFor(sunAt(4, 286).elev, cover);
      for (let m = 1; m <= 24 * 60; m++) {
        const hour = 4 + m / 60;
        const next = skyFor(sunAt(hour % 24, 286).elev, cover);
        const d = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
        expect(d(prev.horizon, next.horizon)).toBeLessThan(0.05);
        expect(d(prev.zenith, next.zenith)).toBeLessThan(0.05);
        expect(Math.abs(prev.sunI - next.sunI)).toBeLessThan(0.05);
        expect(Math.abs(prev.hemi - next.hemi)).toBeLessThan(0.05);
        prev = next;
      }
    }
  });

  it('has no sunlight at night and no moonlight at noon; stars only in the dark', () => {
    expect(skyFor(-30, 0.2).sunI).toBe(0);
    expect(skyFor(50, 0.2).moonI).toBe(0);
    expect(skyFor(50, 0.2).stars).toBe(0);
    expect(skyFor(-30, 0.2).stars).toBeGreaterThan(0.5);
  });

  it('cloud cover follows the weekly weather (the canon), heavier for worse weeks', () => {
    expect(coverFor('clear')).toBeLessThan(coverFor('calm'));
    expect(coverFor('calm')).toBeLessThan(coverFor('snow'));
    expect(coverFor('snow')).toBeLessThan(coverFor('storm'));
  });
});

describe('the wind', () => {
  it('is bounded, settles toward the weather, and never jumps', () => {
    const w = new Wind();
    let last = w.strength;
    for (let i = 0; i < 6000; i++) {
      w.update(i / 60, 1 / 60, i < 3000 ? 'clear' : 'storm');
      expect(Math.abs(w.strength - last)).toBeLessThan(0.05);
      expect(w.strength).toBeGreaterThanOrEqual(0);
      expect(w.strength).toBeLessThan(2);
      last = w.strength;
    }
    expect(w.strength).toBeGreaterThan(0.5);
  });
});
