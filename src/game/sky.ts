/**
 * The light pipeline's pure parts (Living World plan, Phase 3): where the sun is for a local
 * time, what the sky and light look like for that sun under a given cloud cover, and the wind.
 *
 * World axes: +x east, +y up, +z south (the camera looks north, at the mountain). The latitude is
 * an art-directed preset, not the viewer's location: nothing here reads a position.
 */
import * as THREE from 'three';
import type { Weather } from '../core/world';

export const LATITUDE = 28;

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86_400_000);
}

export interface Sun {
  /** Degrees above the horizon (negative below). */
  elev: number;
  /** Unit vector toward the sun. */
  dir: THREE.Vector3;
  /** Unit vector toward the moon, where it really is for its age: it rises about 50 minutes later each day. */
  moon: THREE.Vector3;
  /** The moon's elevation in degrees, and how much of its disc is lit (0 new to 1 full). */
  moonElev: number;
  moonLit: number;
}

const SYNODIC = 29.530589;
/** A new moon (6 Jan 2000, 18:14 UTC): the reference for the moon's age. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** The moon's age in days, 0 to 29.5 (0 new, about 14.8 full). Real, from the date. */
export function moonAge(d: Date): number {
  const days = (d.getTime() - NEW_MOON) / 86_400_000;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

function skyDir(H: number, decl: number, phi: number): THREE.Vector3 {
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(H) * Math.sin(phi);
  const up = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(H) * Math.cos(phi);
  return new THREE.Vector3(east, up, -north).normalize();
}

/**
 * The sun (and the moon, for its age in days) for a local solar hour and day of the year at the
 * preset latitude. The moon trails the sun eastward by its elongation along the ecliptic, so a
 * full moon rises at sunset and a crescent sets soon after the sun.
 */
export function sunAt(hour: number, doy: number, lat = LATITUDE, age = SYNODIC / 2): Sun {
  const rad = Math.PI / 180;
  const lon = ((2 * Math.PI) / 365) * (doy - 81);
  const tilt = 23.44 * rad;
  const decl = Math.asin(Math.sin(tilt) * Math.sin(lon));
  const H = (hour - 12) * 15 * rad;
  const phi = lat * rad;
  const dir = skyDir(H, decl, phi);
  const elong = (age / SYNODIC) * Math.PI * 2;
  const moon = skyDir(H - elong, Math.asin(Math.sin(tilt) * Math.sin(lon + elong)), phi);
  const deg = (y: number): number => Math.asin(Math.max(-1, Math.min(1, y))) / rad;
  return { elev: deg(dir.y), dir, moon, moonElev: deg(moon.y), moonLit: (1 - Math.cos(elong)) / 2 };
}

export interface SkyLook {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  /** Colour and strength of the sunlight (0 once the sun is down). */
  sun: THREE.Color;
  sunI: number;
  /** Moonlight strength (0 by day). */
  moonI: number;
  stars: number;
  /** Lit and shadow sides of the clouds. */
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
}

const C = (h: string): THREE.Color => new THREE.Color(h);
interface Stop {
  at: number;
  zenith: string;
  mid: string;
  horizon: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunI: number;
  stars: number;
  cloudLit: string;
  cloudShade: string;
}
// By sun elevation: night, blue hour, the golden horizon, low sun, full day.
const STOPS: Stop[] = [
  // Night (art direction): deep teal-blue, never black; the ground keeps a moss-dark green so
  // shapes still read by moon and starlight, and warm lights (fire, lamp, candle) sing against it.
  { at: -18, zenith: '#08122c', mid: '#13284c', horizon: '#24456a', fog: '#16263c', hemiSky: '#4a68a4', hemiGround: '#18221e', hemi: 1.1, sun: '#8fa4d8', sunI: 0, stars: 0.95, cloudLit: '#2e4060', cloudShade: '#121c30' },
  { at: -7, zenith: '#10204a', mid: '#2c4478', horizon: '#7a6a9c', fog: '#2e3a5a', hemiSky: '#5a6aa8', hemiGround: '#1c1e1c', hemi: 1.05, sun: '#c78ab0', sunI: 0, stars: 0.55, cloudLit: '#7a6a9a', cloudShade: '#2a3050' },
  { at: -1, zenith: '#22305e', mid: '#7a5a82', horizon: '#ff9a5a', fog: '#8a6a68', hemiSky: '#b094b0', hemiGround: '#523a26', hemi: 1.5, sun: '#ff9a50', sunI: 1.0, stars: 0.12, cloudLit: '#ffb070', cloudShade: '#6a4a68' },
  // The golden hour: low, saturated, honey-coloured light that throws long shadows.
  { at: 5, zenith: '#4f76a8', mid: '#ecc896', horizon: '#ffc670', fog: '#dcb07a', hemiSky: '#ecc494', hemiGround: '#6e5030', hemi: 1.7, sun: '#ffb44a', sunI: 1.32, stars: 0, cloudLit: '#ffdc9c', cloudShade: '#a88894' },
  { at: 13, zenith: '#3a68a6', mid: '#98b8d4', horizon: '#f0dcbc', fog: '#a8b0b4', hemiSky: '#b4c2d6', hemiGround: '#544430', hemi: 1.55, sun: '#ffe6b8', sunI: 1.15, stars: 0, cloudLit: '#fff6e6', cloudShade: '#9ea4c0' },
  // Full day: a painted, slightly turquoise blue over a warm cream horizon.
  { at: 25, zenith: '#3a6fa8', mid: '#86b6d6', horizon: '#e4e6d6', fog: '#a4b8c4', hemiSky: '#b4c8dc', hemiGround: '#544a34', hemi: 1.5, sun: '#fff2dc', sunI: 1.0, stars: 0, cloudLit: '#fffaf0', cloudShade: '#a6aec8' },
];

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** The sky and light for a sun elevation and a cloud cover (0 clear to 1 overcast). Continuous in both. */
export function skyFor(elev: number, cover: number, storm = 0): SkyLook {
  let i = 0;
  while (i < STOPS.length - 2 && elev >= STOPS[i + 1]!.at) i++;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const u = smooth((elev - a.at) / (b.at - a.at));
  const col = (k: 'zenith' | 'mid' | 'horizon' | 'fog' | 'hemiSky' | 'hemiGround' | 'sun' | 'cloudLit' | 'cloudShade'): THREE.Color => C(a[k]).lerp(C(b[k]), u);
  const num = (k: 'hemi' | 'sunI' | 'stars'): number => a[k] + (b[k] - a[k]) * u;
  const look: SkyLook = {
    zenith: col('zenith'),
    mid: col('mid'),
    horizon: col('horizon'),
    fog: col('fog'),
    hemiSky: col('hemiSky'),
    hemiGround: col('hemiGround'),
    hemi: num('hemi'),
    sun: col('sun'),
    sunI: num('sunI') * smooth((elev + 3) / 11),
    moonI: 0.42 * (1 - smooth((elev + 10) / 6)),
    stars: num('stars'),
    cloudLit: col('cloudLit'),
    cloudShade: col('cloudShade'),
  };
  // Cloud cover greys the sky, softens the sun and lifts the shadows; a storm darkens it all.
  const grey = (c: THREE.Color, k: number): void => {
    const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
    c.lerp(new THREE.Color(l, l, l * 1.04), k);
  };
  const g = cover * 0.65;
  for (const c of [look.zenith, look.mid, look.horizon, look.fog, look.hemiSky]) grey(c, g);
  look.sunI *= 1 - cover * 0.6;
  look.hemi *= 1 + cover * 0.12;
  look.stars *= 1 - cover * 0.85;
  if (storm > 0) {
    const dark = 1 - storm * 0.35;
    for (const c of [look.zenith, look.mid, look.horizon, look.fog, look.cloudLit, look.cloudShade]) c.multiplyScalar(dark);
    look.sunI *= 1 - storm * 0.5;
  }
  return look;
}

/** How much cloud each kind of week brings (Phase 3: weather stays the weekly canon). */
export function coverFor(w: Weather): number {
  return w === 'clear' ? 0.18 : w === 'calm' ? 0.42 : w === 'snow' ? 0.78 : 0.95;
}

/**
 * One wind for everything: snow, the flag, the trees, the flames and the sound. A steady part
 * from the weather and gusts that ease in and out (deterministic, no sudden jumps).
 */
export class Wind {
  strength = 0.2;
  gust = 0;
  private base = 0.2;
  readonly dir = new THREE.Vector2(1, 0.25).normalize();

  /** A sudden gust on top (a shake of the phone), 0 to 1, dying away over a few seconds. */
  kick = 0;

  /** `w`: the canon weather, or a steady wind 0 to 1 (game/conditions.ts). */
  update(t: number, dt: number, w: Weather | number): void {
    const target = typeof w === 'number' ? w : w === 'clear' ? 0.12 : w === 'calm' ? 0.25 : w === 'snow' ? 0.5 : 0.9;
    this.base += (target - this.base) * (1 - Math.exp(-dt / 8));
    const n = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.53 + 1.3) * 0.3 + Math.sin(t * 1.37 + 2.1) * 0.2;
    this.gust = Math.max(0, n) ** 2;
    this.kick *= Math.exp(-dt / 1.6);
    this.strength = this.base * (0.7 + this.gust * 0.9) + this.kick;
    // The direction wanders a little.
    const a = 0.25 + Math.sin(t * 0.05) * 0.2;
    this.dir.set(Math.cos(a), Math.sin(a));
  }
}
