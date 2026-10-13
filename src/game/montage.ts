/**
 * A day's replay, as captions: the trail beat, each habit as it went, the flask, the journal
 * line if one was written, and how the day ended. The world cuts in time with these.
 */
import { entryOn } from '../core/model/entries';
import { versionOn } from '../core/habits/versions';
import { tagOf } from '../core/tags';
import type { DateKey, DayOutcome } from '../core/model/types';
import type { View } from '../ui/controller';
import { longDate, skipLabel, unitOf } from '../ui/format';
import { dayBeat } from './beats';

export interface Card {
  kicker: string;
  text: string;
  /** Tag family colour for a habit card. */
  color?: string;
  /** Muted: a habit left undone. */
  dim?: boolean;
  quote?: boolean;
}

export const CARD_SECONDS = 1.25;
const MAX_CARDS = 9;

const ENDING: Record<DayOutcome, string> = {
  closed: 'Camp made',
  partial: 'Partway up',
  rested: 'A rest day',
  excused: 'Sick, excused. The streak holds',
  missed: 'He stayed by the fire',
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
  const done: Card[] = [];
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
    } else done.push(card);
  }
  out.push(...done, ...undone);
  const w = v.derived.water;
  if (w) {
    const glasses = entryOn(v.snapshot, date, w.habit)?.v ?? 0;
    if (glasses > 0) out.push({ kicker: 'The flask', text: `${glasses} ${glasses === 1 ? 'glass' : 'glasses'}`, color: '#9cc3e0' });
  }
  const note = v.snapshot.notes.entries[date];
  if (note) out.push({ kicker: 'From the journal', text: note.length > 120 ? `${note.slice(0, 117)}…` : note, quote: true });
  out.push({ kicker: 'The day', text: ENDING[outcome] });
  // Keep the replay quick: the beat, the ending, and as many habits as fit between.
  if (out.length > MAX_CARDS) return [...out.slice(0, MAX_CARDS - 1), out[out.length - 1]!];
  return out;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
