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
  // Water is a tracker, not a habit of the plan: a glass is not showing up (speedrun finding:
  // two missed days in a row left the fire burning because of a few glasses).
  const water = d.water?.habit;
  const states = Object.entries(d.days[today]?.states ?? {})
    .filter(([id]) => id !== water)
    .map(([, s]) => s);
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

/**
 * Water reminder policy, shared by the flask and Today's bar: once the flask is not full, a
 * glass is due two hours after the last one, or from 9 in the morning if none yet today. The
 * hour is read in the record's time zone (Setup), not whatever the device says. In-app cue only.
 */
export function waterDue(w: { today: number; target: number; lastAt: number | null }, now: number, timeZone?: string): boolean {
  if (w.today >= w.target) return false;
  if (w.lastAt !== null) return now - w.lastAt >= 120 * 60_000;
  return hourIn(now, timeZone) >= 9;
}

export function hourIn(now: number, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, ...(timeZone ? { timeZone } : {}) }).formatToParts(new Date(now));
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(h) ? h % 24 : new Date(now).getHours();
  } catch {
    return new Date(now).getHours();
  }
}
