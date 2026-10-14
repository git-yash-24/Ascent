/**
 * A day's replay, as captions: the trail beat, each habit as it went, the flask, the journal
 * line if one was written, and how the day ended. The world cuts in time with these.
 *
 * Honest (Phase 5): habits come in the order they were recorded, each with its recorded time;
 * the sky shows that hour. A record made on a later day says so ("logged later"), and one with no
 * time says "time not recorded"; nothing is placed at a time it did not happen.
 */
import { entryOn } from '../core/model/entries';
import { versionOn } from '../core/habits/versions';
import { tagOf } from '../core/tags';
import type { DateKey, DayOutcome } from '../core/model/types';
import type { View } from '../ui/controller';
import { longDate, shortDate, skipLabel, unitOf } from '../ui/format';
import { dayBeat } from './beats';
import { clockOf, glassTimes, hourOf, momentOf } from '../core/timeline';
import { logicalDay } from '../core/model/date';

export interface Card {
  kicker: string;
  text: string;
  /** Tag family colour for a habit card. */
  color?: string;
  /** Muted: a habit left undone. */
  dim?: boolean;
  quote?: boolean;
  /** The recorded time, "07:42", when there is one for this day. */
  time?: string;
  /** The hour for the sky while this card shows (recorded on the day itself only). */
  hour?: number;
  /** A small honest note: "logged later, Thu 15 Oct", "time not recorded". */
  note?: string;
}

export const CARD_SECONDS = 1.25;
const MAX_CARDS = 9;

const ENDING: Record<DayOutcome, string> = {
  closed: 'Camp made',
  partial: 'Partway up',
  rested: 'A rest day',
  excused: 'Sick, excused. The streak holds',
  missed: 'Ari stayed by the fire',
  free: 'Nothing was due',
  inProgress: 'Still being written',
};

export function dayCards(v: View, date: DateKey): Card[] {
  const out: Card[] = [];
  const isToday = date === v.today;
  const outcome: DayOutcome = isToday ? 'inProgress' : v.derived.days[date]?.outcome ?? 'free';
  const when = longDate(date);
  out.push({ kicker: when, text: dayBeat(date, outcome).line });
  const states = v.derived.days[date]?.states ?? {};
  const tz = v.snapshot.profile?.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const boundary = v.snapshot.profile?.settings.dayBoundary ?? 240;
  const done: Array<Card & { at: number }> = [];
  const undone: Card[] = [];
  for (const h of v.snapshot.habits.habits) {
    if (h.system) continue;
    const ver = versionOn(h, date);
    if (!ver || ver.archived || h.createdOn > date) continue;
    const st = states[h.id];
    if (!st || st === 'unscheduled') continue;
    const e = entryOn(v.snapshot, date, h.id);
    const fam = tagOf(h).family;
    const counted = ver.type === 'numeric' || ver.type === 'duration';
    const unit = unitOf(ver);
    let text: string;
    if (e?.skip !== undefined) text = skipLabel(e.skip);
    else if (st === 'fulfilled') text = counted ? `${fmt(e?.v ?? 0)} ${unit}`.trim() : 'Done';
    else if (st === 'held') text = `${fmt(e?.v ?? 0)} of ${fmt(ver.target)} ${unit}`.trim();
    else if (st === 'attempted') text = counted ? `Started · ${fmt(e?.v ?? 0)} ${unit}`.trim() : 'Attempted';
    else text = isToday ? 'Not yet' : 'Missed';
    const card: Card = { kicker: h.name, text, color: fam.color };
    if (st === 'open' || st === 'missed') {
      card.dim = true;
      undone.push(card);
      continue;
    }
    const m = momentOf(e, date, tz, boundary);
    if (m.at === null) card.note = 'time not recorded';
    else if (m.loggedOn) card.note = `logged later, ${shortDate(m.loggedOn)}`;
    else {
      card.time = m.started ? `${clockOf(m.started, tz)} → ${clockOf(m.at, tz)}` : clockOf(m.at, tz);
      card.hour = hourOf(m.at, tz);
    }
    // Timed ones in the order they happened; untimed ones after them.
    done.push({ ...card, at: m.at === null || m.loggedOn ? Infinity : m.at });
  }
  done.sort((a, b) => a.at - b.at);
  out.push(...done.map(({ at: _at, ...c }) => c), ...undone);
  const w = v.derived.water;
  if (w) {
    const e = entryOn(v.snapshot, date, w.habit);
    const glasses = e?.v ?? 0;
    if (glasses > 0) {
      const times = glassTimes(e?.acts, glasses).filter((t): t is number => t !== null && logicalDay(new Date(t), tz, boundary) === date);
      const card: Card = { kicker: 'The flask', text: `${glasses} ${glasses === 1 ? 'glass' : 'glasses'}`, color: '#9cc3e0' };
      if (times.length) {
        card.time = times.length > 4 ? `${times.slice(0, 3).map((t) => clockOf(t, tz)).join(' · ')} …` : times.map((t) => clockOf(t, tz)).join(' · ');
        card.hour = hourOf(times[times.length - 1]!, tz);
      } else card.note = 'times not recorded';
      out.push(card);
    }
  }
  const note = v.snapshot.notes.entries[date];
  if (note) out.push({ kicker: 'From the journal', text: note.length > 120 ? `${note.slice(0, 117)}…` : note, quote: true });
  out.push({ kicker: 'The day', text: ENDING[outcome] });
  // The opening beat takes the hour of the day's first recorded moment, the ending its last.
  const hours = out.map((c) => c.hour).filter((x): x is number => x !== undefined);
  if (hours.length) {
    out[0]!.hour = Math.max(0, Math.min(...hours) - 0.5);
    out[out.length - 1]!.hour = Math.max(...hours);
  }
  // Keep the replay quick: the beat, the ending, and as many habits as fit between.
  if (out.length > MAX_CARDS) return [...out.slice(0, MAX_CARDS - 1), out[out.length - 1]!];
  return out;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
