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
  /** Unit vector toward the moon (kept simple: across the sky from the sun, always a little up). */
  moon: THREE.Vector3;
}

/** The sun for a local solar hour and day of the year at the preset latitude. */
export function sunAt(hour: number, doy: number, lat = LATITUDE): Sun {
  const rad = Math.PI / 180;
  const decl = 23.44 * rad * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const H = (hour - 12) * 15 * rad;
  const phi = lat * rad;
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(H) * Math.sin(phi);
  const up = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(H) * Math.cos(phi);
  const dir = new THREE.Vector3(east, up, -north).normalize();
  const moon = new THREE.Vector3(-dir.x, Math.max(0.35, Math.abs(dir.y) * 0.8), -dir.z).normalize();
  return { elev: Math.asin(Math.max(-1, Math.min(1, up))) / rad, dir, moon };
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
  { at: -18, zenith: '#060912', mid: '#10162e', horizon: '#232843', fog: '#151a2c', hemiSky: '#3a4380', hemiGround: '#12100d', hemi: 0.95, sun: '#8fa4d8', sunI: 0, stars: 0.95, cloudLit: '#2a3046', cloudShade: '#11141f' },
  { at: -7, zenith: '#0f1736', mid: '#28366a', horizon: '#6a5f8e', fog: '#2c3050', hemiSky: '#4a5590', hemiGround: '#15120f', hemi: 0.95, sun: '#c78ab0', sunI: 0, stars: 0.55, cloudLit: '#6d5f8f', cloudShade: '#262a45' },
  { at: -1, zenith: '#1d2552', mid: '#5a4572', horizon: '#ec8a5c', fog: '#6e5662', hemiSky: '#9a86b0', hemiGround: '#46321f', hemi: 1.5, sun: '#ff9a5c', sunI: 0.95, stars: 0.12, cloudLit: '#ffae7a', cloudShade: '#4d3a52' },
  { at: 7, zenith: '#2a4c84', mid: '#9196b8', horizon: '#f5bf90', fog: '#958890', hemiSky: '#a4a6cc', hemiGround: '#4a3a28', hemi: 1.6, sun: '#ffcf9c', sunI: 1.1, stars: 0, cloudLit: '#ffe2c2', cloudShade: '#7c7590' },
  { at: 25, zenith: '#335b93', mid: '#7fa6cc', horizon: '#cfdce4', fog: '#8d9fb2', hemiSky: '#a9bbd8', hemiGround: '#463b2c', hemi: 1.5, sun: '#fff0d8', sunI: 1.0, stars: 0, cloudLit: '#ffffff', cloudShade: '#a7b3c4' },
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
    sunI: num('sunI') * smooth((elev + 3) / 7),
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

  update(t: number, dt: number, w: Weather): void {
    const target = w === 'clear' ? 0.12 : w === 'calm' ? 0.25 : w === 'snow' ? 0.5 : 0.9;
    this.base += (target - this.base) * (1 - Math.exp(-dt / 8));
    const n = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.53 + 1.3) * 0.3 + Math.sin(t * 1.37 + 2.1) * 0.2;
    this.gust = Math.max(0, n) ** 2;
    this.strength = this.base * (0.7 + this.gust * 0.9);
    // The direction wanders a little.
    const a = 0.25 + Math.sin(t * 0.05) * 0.2;
    this.dir.set(Math.cos(a), Math.sin(a));
  }
}
