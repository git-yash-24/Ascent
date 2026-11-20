/**
 * A day's beat on the trail: what Ari crossed (or why he did not), chosen from the day's outcome
 * and its date, so the same day always tells the same story on every device. Pure.
 *
 * These are trail beats only, wordless in the world (an obstacle, a camp); the line is for the
 * replay caption and for screen readers. Authored story scenes come later (M11 onward).
 */
import type { DateKey, DayOutcome } from '../core/model/types';

export type Obstacle = 'stream' | 'boulders' | 'log' | 'ice' | 'scree';

export interface Beat {
  /** What lies on the trail below that day's camp. */
  obstacle: Obstacle | null;
  /** Marks at the day's camp. */
  camp: 'cairn' | 'tent' | 'storm' | 'drift' | 'none';
  line: string;
}

const CROSSED: Record<Obstacle, { full: string; half: string }> = {
  stream: { full: 'Forded the meltwater stream', half: 'Got halfway across the stream' },
  boulders: { full: 'Climbed through the boulder field', half: 'Picked a way into the boulders' },
  log: { full: 'Crossed the ravine on a fallen pine', half: 'Tested the fallen pine, half across' },
  ice: { full: 'Edged across the ice shelf', half: 'Cut the first steps into the ice' },
  scree: { full: 'Pushed up the loose scree', half: 'Gained some ground on the scree' },
};

const ORDER: Obstacle[] = ['stream', 'boulders', 'log', 'ice', 'scree'];

/** FNV-1a over the date: stable across devices and versions. */
export function dateSeed(d: DateKey): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) {
    h ^= d.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function obstacleFor(d: DateKey): Obstacle {
  return ORDER[dateSeed(d) % ORDER.length]!;
}

export function dayBeat(d: DateKey, outcome: DayOutcome | 'future'): Beat {
  const o = obstacleFor(d);
  switch (outcome) {
    case 'closed':
      return { obstacle: o, camp: 'cairn', line: CROSSED[o].full };
    case 'partial':
      return { obstacle: o, camp: 'cairn', line: CROSSED[o].half };
    case 'rested':
      return { obstacle: null, camp: 'tent', line: 'Rested in the lee of the rocks' };
    case 'excused':
      return { obstacle: null, camp: 'storm', line: 'Sat out the storm, wrapped in wool' };
    case 'missed':
      return { obstacle: null, camp: 'drift', line: 'The snow came down. Ari kept the fire' };
    case 'inProgress':
      return { obstacle: null, camp: 'none', line: 'Today, still being written' };
    case 'free':
      return { obstacle: null, camp: 'none', line: 'A quiet day before the climb' };
    case 'future':
      return { obstacle: null, camp: 'none', line: 'Not yet walked' };
  }
}
