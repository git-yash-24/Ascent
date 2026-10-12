/**
 * Chains (spec: Chains).
 *
 * A chain counts consecutive chain units that were held or fulfilled. Skipped units are
 * neutral. One missed unit between two held units is forgiven, at most once in any 7 days;
 * a second miss inside that window breaks the chain. The current unit never breaks a chain.
 * Changing a habit's schedule or type, or archiving it, starts a new chain; old chains stay
 * in history.
 *
 * Units: a day (daily), a scheduled day (chosen weekdays), a week (X a week, Monday to
 * Sunday) or a month (X a month). For week and month units the forgiveness window is 7
 * units rather than 7 days (assumption A-M5-3), otherwise every other week could be missed.
 */
import { addDays, compareDateKeys, daysInMonth, diffDays, weekStart } from '../model/date';
import type { ChainDerived, ChainSpan, DateKey, Habit, HabitVersion } from '../model/types';
import { isHeld } from './state';
import type { HabitDay } from './timeline';
import { sameChainRules } from './versions';

export type UnitStatus = 'held' | 'skipped' | 'missed' | 'current';

export interface ChainUnit {
  start: DateKey;
  end: DateKey;
  status: UnitStatus;
  /** 'day' units use a 7-day forgiveness window; 'period' units use 7 units. */
  kind: 'day' | 'period';
  segment: number;
}

const FORGIVE_DAYS = 7;
const FORGIVE_UNITS = 7;

interface Segment {
  version: HabitVersion;
  days: HabitDay[];
}

function segments(days: HabitDay[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const d of days) {
    const v = d.version;
    if (!v) {
      cur = null; // not yet created, or archived: the chain ends here
      continue;
    }
    if (!cur || !sameChainRules(cur.version, v)) {
      cur = { version: v, days: [] };
      out.push(cur);
    }
    cur.days.push(d);
  }
  return out;
}

function periodBounds(v: HabitVersion, date: DateKey): { start: DateKey; end: DateKey } {
  if (v.schedule.kind === 'perMonth') {
    const start = `${date.slice(0, 7)}-01`;
    const end = addDays(start, daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7))) - 1);
    return { start, end };
  }
  const start = weekStart(date);
  return { start, end: addDays(start, 6) };
}

export function chainUnits(days: HabitDay[], today: DateKey, todayEnded: boolean): ChainUnit[] {
  const units: ChainUnit[] = [];
  const segs = segments(days);
  segs.forEach((seg, si) => {
    const s = seg.version.schedule;
    if (s.kind === 'daily' || s.kind === 'weekdays') {
      for (const d of seg.days) {
        if (!d.counted) continue;
        let status: UnitStatus;
        if (isHeld(d.state)) status = 'held';
        else if (d.state === 'skipped') status = 'skipped';
        else if (d.date === today && !todayEnded) status = 'current';
        else status = 'missed';
        units.push({ start: d.date, end: d.date, status, kind: 'day', segment: si });
      }
      return;
    }
    const first = seg.days[0];
    const last = seg.days[seg.days.length - 1];
    if (!first || !last) return;
    const segStart = first.date;
    // A segment still running at today extends to the end of its period; otherwise it ends
    // on its last day.
    const running = last.date === today;
    const groups = new Map<string, HabitDay[]>();
    for (const d of seg.days) {
      const b = periodBounds(seg.version, d.date);
      const g = groups.get(b.start);
      if (g) g.push(d);
      else groups.set(b.start, [d]);
    }
    for (const [, g] of groups) {
      const gFirst = g[0] as HabitDay;
      const b = periodBounds(seg.version, gFirst.date);
      const start = compareDateKeys(b.start, segStart) < 0 ? segStart : b.start;
      const end = running && compareDateKeys(b.end, today) >= 0 ? b.end : (g[g.length - 1] as HabitDay).date;
      const available = diffDays(start, end) + 1;
      const req = Math.min(s.n, available);
      const held = g.filter((d) => isHeld(d.state)).length;
      const skipped = g.filter((d) => d.state === 'skipped').length;
      const containsToday = compareDateKeys(today, start) >= 0 && compareDateKeys(today, end) <= 0;
      const periodEnded = !containsToday || (todayEnded && end === today);
      let status: UnitStatus;
      if (held >= req) status = 'held';
      else if (!periodEnded) status = 'current';
      else if (held + skipped >= req) status = 'skipped';
      else status = 'missed';
      units.push({ start, end, status, kind: 'period', segment: si });
    }
  });
  return units;
}

/** Walk units, applying the forgiveness rule. */
export function chainsFromUnits(units: ChainUnit[]): ChainDerived {
  const history: ChainSpan[] = [];
  let open: ChainSpan | null = null;
  let pendingMiss: { unit: ChainUnit; index: number } | null = null;
  let lastForgiven: { unit: ChainUnit; index: number } | null = null;
  let segment = -1;

  const close = (): void => {
    if (open) history.push(open);
    open = null;
    pendingMiss = null;
  };

  const withinWindow = (a: { unit: ChainUnit; index: number }, b: { unit: ChainUnit; index: number }): boolean =>
    b.unit.kind === 'day' ? diffDays(a.unit.end, b.unit.end) < FORGIVE_DAYS : b.index - a.index < FORGIVE_UNITS;

  units.forEach((u, index) => {
    if (u.segment !== segment) {
      close();
      segment = u.segment;
    }
    switch (u.status) {
      case 'held':
        if (pendingMiss) {
          lastForgiven = pendingMiss;
          pendingMiss = null;
        }
        if (open) {
          open.length += 1;
          open.to = u.end;
        } else open = { from: u.start, to: u.end, length: 1 };
        break;
      case 'skipped':
      case 'current':
        break;
      case 'missed': {
        if (!open) break;
        const here = { unit: u, index };
        if (pendingMiss || (lastForgiven && withinWindow(lastForgiven, here))) close();
        else pendingMiss = here;
        break;
      }
    }
  });
  const lastUnit = units[units.length - 1];
  const lastSegment = lastUnit?.segment ?? -1;
  const current = open !== null && segment === lastSegment ? (open as ChainSpan).length : 0;
  if (open) history.push(open);
  const best = history.reduce((m, c) => Math.max(m, c.length), 0);
  return { current, best, history };
}

export function habitChain(h: Habit, days: HabitDay[], today: DateKey, todayEnded: boolean): ChainDerived {
  const units = chainUnits(days, today, todayEnded);
  const c = chainsFromUnits(units);
  // An archived habit has no running chain.
  const last = days[days.length - 1];
  if (h.archivedFrom && last && !last.version) return { ...c, current: 0 };
  return c;
}
