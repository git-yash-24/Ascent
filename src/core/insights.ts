/**
 * What the game screens show beyond the checklist: standings per habit, leagues per tag group,
 * trophies and gear, and the advice corner (docs/decisions/game-screen.md).
 *
 * Solo for now: a league measures consistency against the player's own targets, never against
 * other people. Everything here is derived, so nothing new is stored.
 */
import { addDays, compareDateKeys, diffDays, weekStart } from './model/date';
import { entryOn } from './model/entries';
import type { DateKey, Derived, Habit, Snapshot } from './model/types';
import { habitTimeline } from './habits/timeline';
import { CLIMB, habitWeekShare } from './habits/weekly';
import { versionOn } from './habits/versions';
import { tagOf, type TagFamily, type TagGroup } from './tags';

export interface Standing {
  habit: Habit;
  family: TagFamily;
  group: TagGroup;
  /** Share of this week's plan so far (the live week counts days still to come in the plan). */
  thisWeek: number | null;
  /** Shares of the last ended weeks, newest first (null where nothing was planned). */
  past: Array<number | null>;
  /** Mean of the ended weeks; this week's share when no week has ended yet. */
  consistency: number | null;
  chain: number;
  best: number;
}

/** Habits in use today (not water, not archived, already created). */
export function activeHabits(s: Snapshot, today: DateKey): Habit[] {
  return s.habits.habits.filter((h) => {
    if (h.system) return false;
    if (compareDateKeys(h.createdOn, today) > 0) return false;
    const v = versionOn(h, today);
    return v !== undefined && !v.archived;
  });
}

export function standings(s: Snapshot, d: Derived, today: DateKey, weeks = 4): Standing[] {
  const mon = weekStart(today);
  return activeHabits(s, today).map((h) => {
    const tl = habitTimeline(h, (date) => entryOn(s, date, h.id), today, false);
    const past: Array<number | null> = [];
    for (let k = 1; k <= weeks; k++) {
      const m = addDays(mon, -7 * k);
      if (compareDateKeys(addDays(m, 6), h.createdOn) < 0) break;
      past.push(habitWeekShare(tl, m, addDays(m, 6)));
    }
    const thisWeek = habitWeekShare(tl, mon, today);
    const ended = past.filter((x): x is number => x !== null);
    const consistency = ended.length ? ended.reduce((a, b) => a + b, 0) / ended.length : thisWeek;
    const { family, group } = tagOf(h);
    const c = d.chains[h.id];
    return { habit: h, family, group, thisWeek, past, consistency, chain: c?.current ?? 0, best: c?.best ?? 0 };
  });
}

export type Tier = 'foothills' | 'trail' | 'ridge' | 'summit';

export const TIERS: Array<{ id: Tier; name: string; from: number }> = [
  { id: 'summit', name: 'Summit league', from: CLIMB.summit },
  { id: 'ridge', name: 'Ridge league', from: CLIMB.steepBar },
  { id: 'trail', name: 'Trail league', from: CLIMB.climb },
  { id: 'foothills', name: 'Foothills league', from: 0 },
];

export function tierOf(consistency: number | null): Tier {
  const c = consistency ?? 0;
  return (TIERS.find((t) => c >= t.from) ?? TIERS[TIERS.length - 1]!).id;
}

export interface League {
  family: TagFamily;
  group: TagGroup;
  tier: Tier;
  consistency: number | null;
  /** The player's habits in this group, most consistent first. */
  board: Standing[];
  /** Share needed for the next tier up, or null at the top. */
  next: { tier: Tier; at: number } | null;
}

export function leagues(list: Standing[]): League[] {
  const byGroup = new Map<string, Standing[]>();
  for (const st of list) {
    const key = `${st.family.id}/${st.group.id}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), st]);
  }
  const out: League[] = [];
  for (const board of byGroup.values()) {
    board.sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1) || a.habit.name.localeCompare(b.habit.name));
    const vals = board.map((b) => b.consistency).filter((x): x is number => x !== null);
    const consistency = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const tier = tierOf(consistency);
    const idx = TIERS.findIndex((t) => t.id === tier);
    const up = idx > 0 ? TIERS[idx - 1] : undefined;
    const first = board[0] as Standing;
    out.push({ family: first.family, group: first.group, tier, consistency, board, next: up ? { tier: up.id, at: up.from } : null });
  }
  return out.sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
}

export interface Trophy {
  id: string;
  name: string;
  /** What earns it, in a few words. */
  how: string;
  kind: 'trophy' | 'item';
  earned: boolean;
  /** 0 to 1 toward earning it. */
  progress: number;
}

/** Gear Ari carries, earned by days shown up (the resolve tiers plus the year's ends). */
const GEAR: Array<{ id: string; name: string; days: number }> = [
  { id: 'satchel', name: 'Satchel', days: 1 },
  { id: 'scarf', name: 'Wool scarf', days: 15 },
  { id: 'axe', name: 'Ice axe', days: 60 },
  { id: 'lantern', name: 'Storm lantern', days: 180 },
  { id: 'flag', name: 'Summit flag', days: 365 },
];

export function trophies(d: Derived): Trophy[] {
  const shown = d.lifetime.daysShownUp;
  const best = Object.values(d.chains).reduce((m, c) => Math.max(m, c.best), 0);
  const weeks = d.climb.weeks;
  const climbed = weeks.filter((w) => w.verdict === 'climb' || w.verdict === 'summit').length;
  const summits = weeks.filter((w) => w.verdict === 'summit').length;
  const steepWon = weeks.some((w) => w.steep && (w.verdict === 'climb' || w.verdict === 'summit'));
  const comebacks = d.records.filter((r) => r.id.startsWith('comeback')).length;
  const flask = d.water?.streak ?? 0;
  const ratio = (n: number, of: number): number => Math.max(0, Math.min(1, n / of));
  const t = (id: string, name: string, how: string, n: number, of: number): Trophy => ({ id, name, how, kind: 'trophy', earned: n >= of, progress: ratio(n, of) });
  const list: Trophy[] = [
    t('first-camp', 'First camp', 'Show up for a day', d.lifetime.daysShownUp > 0 ? 1 : 0, 1),
    t('first-climb', 'First climb', 'A week at 50% or more', climbed, 1),
    t('seven-fires', 'Seven fires', 'A 7-day streak', best, 7),
    t('thirty-fires', 'Thirty fires', 'A 30-day streak', best, 30),
    t('summit-push', 'Summit push', 'A week at 85% or more', summits, 1),
    t('steep-line', 'Steep line', 'Climb on the steep line', steepWon ? 1 : 0, 1),
    t('comeback', 'Comeback', 'Back for 7 days after a gap', comebacks, 1),
    t('full-flask', 'Full flask', 'Water 7 days in a row', flask, 7),
    t('chapter-two', 'Chapter two', 'Reach the second chapter', d.climb.chapter, 1),
  ];
  for (const g of GEAR) list.push({ id: `gear-${g.id}`, name: g.name, how: `${g.days} ${g.days === 1 ? 'day' : 'days'} shown up`, kind: 'item', earned: shown >= g.days, progress: ratio(shown, g.days) });
  return list;
}

export interface Advice {
  id: string;
  text: string;
  /** Family colour to tint the card with, when the advice is about one habit. */
  family?: TagFamily;
}

/**
 * The advice corner: at most three short, specific lines from the record. Never a lecture; each
 * line names one thing to do or notice.
 */
export function advice(d: Derived, list: Standing[], today: DateKey, steepAvailable: boolean): Advice[] {
  const out: Advice[] = [];
  const cur = d.climb.current;
  const bar = cur?.steep ? CLIMB.steepBar : CLIMB.climb;
  const score = cur?.score ?? null;
  const daysLeft = diffDays(today, addDays(weekStart(today), 6));
  if (score !== null && cur?.verdict !== 'rest' && score < bar) {
    const weakest = [...list].filter((x) => x.thisWeek !== null).sort((a, b) => (a.thisWeek ?? 0) - (b.thisWeek ?? 0))[0];
    const gap = Math.ceil((bar - score) * 100);
    if (weakest && (weakest.thisWeek ?? 0) < bar) {
      out.push({
        id: 'weakest',
        family: weakest.family,
        text: `${weakest.habit.name} is the shortest rope this week. Weekly totals count, so one big session ${daysLeft > 0 ? 'before Sunday ' : 'today '}still closes the ${gap}% gap.`,
      });
    } else out.push({ id: 'gap', text: `${gap}% to the climb this week, with ${daysLeft + 1} ${daysLeft === 0 ? 'day' : 'days'} left.` });
  } else if (score !== null && score >= bar && score < CLIMB.summit && cur?.verdict !== 'rest') {
    out.push({ id: 'summit', text: `The climb is secured. ${Math.ceil((CLIMB.summit - score) * 100)}% more makes it a summit push.` });
  }
  if (steepAvailable) out.push({ id: 'steep', text: 'Strong weeks behind you. Take the steep line before your first tick: 70% this week earns a 10% head start next week.' });
  if (d.condition.fatigue !== 'fresh' && d.rates.last7 !== null) {
    out.push({ id: 'fatigue', text: `The last seven days ran at ${Math.round(d.rates.last7 * 100)}%. Shrink a target for a week rather than skip it; a smaller tick still keeps the streak.` });
  }
  const guard = [...list].filter((x) => x.chain >= 3).sort((a, b) => b.chain - a.chain)[0];
  if (guard) out.push({ id: 'chain', family: guard.family, text: `${guard.habit.name} has a ${guard.chain}-day streak. Protect that one first.` });
  const w = d.water;
  if (w && w.today < w.target && out.length < 3) out.push({ id: 'water', text: `${w.target - w.today} glasses to a full flask. Keep one by the place you work.` });
  if (out.length === 0) out.push({ id: 'steady', text: 'Steady. Tick as you go; the story follows the record.' });
  return out.slice(0, 3);
}
