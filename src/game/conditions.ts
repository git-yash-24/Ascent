/**
 * What the weather looks like today, from three things (Xander, 13 Oct: "rainy, dry, cloudy,
 * dull, windy, snowy, the seasons, and how all of that looks with the time of day"):
 *
 *   the canon   the week's weather from the record (core/world.ts): clear, calm, snow, storm.
 *               It decides how hard the day is, never anything else. Rest and sick days are calm.
 *   the season  from the calendar at the world's preset latitude (28° N): what kind of hard.
 *               A slipped week is a blizzard in winter, a thunderstorm in summer, a gale in autumn.
 *   the day     a calm week varies day to day (cloudy, dull, fog...), the same all day long and
 *               the same on every device, from the date alone. Nothing is random at runtime.
 *
 * Time of day is not decided here: the stage mixes these with the sun (golden light through
 * rain, fireflies only on warm nights). Everything is presentation; nothing here is stored.
 * The full matrix and Ari's reactions are in docs/design/weather-and-seasons.md.
 */
import type { Weather } from '../core/world';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Kind = 'clear' | 'dry' | 'cloudy' | 'dull' | 'fog' | 'windy' | 'showers' | 'rain' | 'thunder' | 'gale' | 'snow' | 'blizzard';
export const KINDS: Kind[] = ['clear', 'dry', 'cloudy', 'dull', 'fog', 'windy', 'showers', 'rain', 'thunder', 'gale', 'snow', 'blizzard'];
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface Conditions {
  season: Season;
  kind: Kind;
  /** Cloud cover 0 clear to 1 overcast. */
  cover: number;
  /** How much darker the storm makes the light. */
  storm: number;
  /** The steady wind the gusts ride on, 0 still to 1 a gale. */
  wind: number;
  /** Rainfall and snowfall rates, 0 to 1. */
  rain: number;
  snow: number;
  /** Haze and mist, 0 to 1 (fog is 1). */
  fog: number;
  /** How cold it feels, 0 to 1; and how hot. */
  cold: number;
  heat: number;
  /** Snow lying on the ground and on things, 0 to 1. */
  lying: number;
  /** Wet ground and puddles, 0 to 1. */
  wet: number;
  lightning: boolean;
  /** Small things in the air in fair weather: petals, pollen, leaves (fireflies are by night, in the stage). */
  motes: 'none' | 'petals' | 'pollen' | 'leaves';
}

/** Northern seasons by month at the world's latitude. */
export function seasonOf(d: Date): Season {
  const m = d.getMonth();
  return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
}

/** A number from the date alone, so a day looks the same all day and on every device. */
function dayHash(d: Date): number {
  let h = (d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate()) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = <T>(list: T[], u: number): T => list[Math.min(list.length - 1, Math.floor(u * list.length))]!;

/** Which kind of weather a canon becomes in a season, on a day. */
export function kindFor(canon: Weather, season: Season, day: Date): Kind {
  const u = dayHash(day);
  switch (canon) {
    case 'clear':
      return season === 'summer' ? pick<Kind>(['dry', 'dry', 'clear'], u) : season === 'autumn' ? pick<Kind>(['clear', 'clear', 'windy'], u) : 'clear';
    case 'calm':
      return pick<Kind>(
        season === 'spring' ? ['cloudy', 'showers', 'clear', 'cloudy'] : season === 'summer' ? ['cloudy', 'clear', 'dull', 'dry'] : season === 'autumn' ? ['dull', 'fog', 'windy', 'cloudy'] : ['dull', 'cloudy', 'fog', 'clear'],
        u,
      );
    case 'snow':
      return season === 'winter' ? 'snow' : season === 'autumn' ? pick<Kind>(['rain', 'windy'], u) : season === 'spring' ? pick<Kind>(['showers', 'rain'], u) : 'rain';
    case 'storm':
      return season === 'winter' ? 'blizzard' : season === 'autumn' ? 'gale' : 'thunder';
  }
}

//                     cover storm wind  rain  snow  fog   wet
const BASE: Record<Kind, [number, number, number, number, number, number, number]> = {
  clear: [0.15, 0, 0.12, 0, 0, 0, 0],
  dry: [0.05, 0, 0.18, 0, 0, 0.22, 0],
  cloudy: [0.62, 0, 0.25, 0, 0, 0.1, 0],
  dull: [0.88, 0.12, 0.14, 0, 0, 0.45, 0.2],
  fog: [0.72, 0.05, 0.05, 0, 0, 1, 0.3],
  windy: [0.42, 0, 0.78, 0, 0, 0.05, 0],
  showers: [0.66, 0.08, 0.32, 0.45, 0, 0.15, 0.5],
  rain: [0.92, 0.25, 0.4, 0.85, 0, 0.35, 0.85],
  thunder: [1, 0.55, 0.75, 1, 0, 0.4, 1],
  gale: [0.9, 0.35, 1, 0.6, 0, 0.3, 0.65],
  snow: [0.82, 0.1, 0.3, 0, 0.8, 0.35, 0],
  blizzard: [0.96, 0.4, 0.95, 0, 1, 0.75, 0],
};

const SEASON_COLD: Record<Season, number> = { winter: 0.65, autumn: 0.32, spring: 0.22, summer: 0 };

export function conditionsFor(kind: Kind, season: Season): Conditions {
  const [cover, storm, wind, rain, snow, fog, wet] = BASE[kind];
  const chill = kind === 'blizzard' ? 0.35 : kind === 'snow' ? 0.25 : kind === 'gale' || kind === 'windy' ? 0.15 : kind === 'rain' || kind === 'thunder' || kind === 'fog' ? 0.1 : kind === 'dry' ? -0.2 : 0;
  const cold = Math.max(0, Math.min(1, SEASON_COLD[season] + chill));
  const heat = season === 'summer' ? (kind === 'dry' ? 0.9 : kind === 'clear' ? 0.6 : kind === 'cloudy' || kind === 'dull' ? 0.3 : 0) : season === 'spring' && kind === 'clear' ? 0.2 : 0;
  const lying = snow > 0 ? 1 : season === 'winter' ? 0.75 : 0;
  const fair = rain === 0 && snow === 0;
  const motes: Conditions['motes'] = !fair && kind !== 'gale' ? 'none' : season === 'autumn' ? 'leaves' : season === 'spring' && kind !== 'fog' ? 'petals' : season === 'summer' && kind !== 'fog' ? 'pollen' : 'none';
  return { season, kind, cover, storm, wind, rain, snow, fog, cold, heat, lying, wet, lightning: kind === 'thunder', motes };
}

/** The whole chain: the record's canon and today's date. */
export function todaysConditions(canon: Weather, day: Date, season?: Season): Conditions {
  const s = season ?? seasonOf(day);
  return conditionsFor(kindFor(canon, s, day), s);
}

export interface Outfit {
  /** 'light' summer shirt, 'shell' rain shell, 'parka' winter, 'coat' everything between. */
  layer: 'light' | 'coat' | 'shell' | 'parka';
  /** A wide-brimmed hat over the hood in strong sun. */
  sunHat: boolean;
  /** Thick scarf and mitts in the cold. */
  bundled: boolean;
}

/** What Ari wears for the weather and the light (sunElev in degrees). */
export function outfitFor(c: Conditions, sunElev: number): Outfit {
  const layer: Outfit['layer'] = c.rain > 0.3 ? 'shell' : c.cold >= 0.6 || c.snow > 0 ? 'parka' : c.heat >= 0.6 ? 'light' : 'coat';
  return { layer, sunHat: c.heat >= 0.5 && sunElev > 12 && c.cover < 0.5 && layer === 'light', bundled: c.cold >= 0.45 };
}

/** What the camp needs: a sheet over her things, the rain fly over her seat, the tent closed. */
export function shelterFor(c: Conditions): { sheet: boolean; fly: boolean; tentShut: boolean; weighted: boolean } {
  const falling = c.rain > 0.2 || c.snow > 0.2;
  return { sheet: falling, fly: c.rain > 0.5 || c.snow > 0.9, tentShut: falling || c.wind > 0.7, weighted: c.wind > 0.7 };
}

/** The golden hour, 0 to 1: strongest a few degrees above the horizon, gone by 16° or below -2°. */
export function goldenOf(sunElev: number): number {
  if (sunElev <= -2 || sunElev >= 16) return 0;
  return sunElev < 4 ? (sunElev + 2) / 6 : 1 - (sunElev - 4) / 12;
}

/** A gust you can see coming, for showers: rain comes and goes over minutes. 0 to 1. */
export function showerPulse(t: number): number {
  const s = Math.sin(t * 0.021) * 0.6 + Math.sin(t * 0.053 + 2) * 0.4;
  return Math.max(0, Math.min(1, (s + 0.15) * 1.6));
}
