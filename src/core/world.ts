/**
 * What the world shows from the record, beyond the checklist (docs: Story Engine and Roadmap,
 * "Attachment" and "Homescapes" tabs). Pure and derived: nothing here is stored.
 *
 *   camp      improvements earned by story days, on a published schedule; they travel with Ari
 *   momentum  0 to 3 after missed days; 3 is the floor, it never gets worse; any effort today ends it
 *   weather   from the last ended week's verdict; sick and rest days are always calm
 */
import { addDays, compareDateKeys, weekStart } from './model/date';
import type { DateKey, Derived } from './model/types';

export interface Improvement {
  id: string;
  name: string;
  /** Story day on which it is made. */
  at: number;
}

/** About one every 10 to 30 story days early on, spacing out as the year goes. */
export const CAMP_SCHEDULE: Improvement[] = [
  { id: 'windbreak', name: 'a windbreak', at: 5 },
  { id: 'stone', name: 'a cooking stone', at: 12 },
  { id: 'lantern', name: 'a lantern on a hook', at: 20 },
  { id: 'woodpile', name: 'a woodpile', at: 30 },
  { id: 'pennants', name: 'a line of pennants with your mark', at: 45 },
  { id: 'bench', name: 'a bench for two', at: 60 },
  { id: 'tarp', name: 'a weathered tarp over the tent', at: 90 },
  { id: 'chime', name: 'a wind chime of old pitons', at: 120 },
];

export interface CampState {
  built: Improvement[];
  next: (Improvement & { inDays: number }) | null;
}

export function campState(storyDay: number): CampState {
  const built = CAMP_SCHEDULE.filter((i) => storyDay >= i.at);
  const upcoming = CAMP_SCHEDULE.find((i) => storyDay < i.at);
  return { built, next: upcoming ? { ...upcoming, inDays: upcoming.at - storyDay } : null };
}

/**
 * Missed days in a row before today, capped at 3. Any logged effort today (or a rest or sick
 * day) brings it back to 0 at once: return never has to be earned.
 */
export function momentumStep(d: Derived, today: DateKey): 0 | 1 | 2 | 3 {
  const states = Object.values(d.days[today]?.states ?? {});
  if (states.some((s) => s === 'fulfilled' || s === 'held' || s === 'attempted' || s === 'skipped')) return 0;
  let n = 0;
  for (let k = 1; k <= 60 && n < 3; k++) {
    const o = d.days[addDays(today, -k)]?.outcome;
    if (o === undefined) break;
    if (o === 'free') continue;
    if (o !== 'missed') break;
    n++;
  }
  return n as 0 | 1 | 2 | 3;
}

export type Weather = 'clear' | 'calm' | 'snow' | 'storm';

/**
 * The week's weather comes from the last ended week, so a Monday morning is never blamed for a
 * week not yet lived. Once this week's climb is secured the sky clears early. Sick and rest days
 * are always calm: weather never implies a crisis caused by illness or chosen rest.
 */
export function weatherOf(d: Derived, today: DateKey): Weather {
  const t = d.days[today]?.outcome;
  if (t === 'excused' || t === 'rested') return 'calm';
  const cur = d.climb.current;
  const mon = weekStart(today);
  const last = [...d.climb.weeks].reverse().find((w) => compareDateKeys(w.week, mon) < 0);
  if (cur && cur.verdict !== 'rest' && (cur.verdict === 'climb' || cur.verdict === 'summit')) return 'clear';
  if (!last) return 'calm';
  switch (last.verdict) {
    case 'summit':
    case 'climb':
      return 'clear';
    case 'hold':
      return 'snow';
    case 'slip':
      return 'storm';
    default:
      return 'calm';
  }
}
