/**
 * M10, the 14 days of real use: "daily export diffed against the log; zero lost or wrong
 * records; export and restore identical" (build plan, gate 2). Instead of asking for an export
 * file every day, the app keeps yesterday's fingerprint of the whole record on this device and
 * checks today's against it, once a day:
 *
 *   lost     an entry that existed is gone (entries are never deleted; a clear keeps a tombstone)
 *   changed  an entry's value changed without a newer write time (nobody edited it, yet it moved:
 *            a sync or storage fault)
 *   edits    changes with a newer write time are your own edits or corrections: counted, not flagged
 *   round    the record exported to a backup and read back is identical
 *
 * Read-only: it never writes to the record. Kept per device, beside the record, not in it.
 */
import { exportJson, parseBackup, recordOf } from './backup/backup';
import { isCleared } from '../core/model/entries';
import type { DateKey, Snapshot } from '../core/model/types';

export const TRIAL_DAYS = 14;

/** date|habit → "value@writeTime" for every entry, cleared ones included. */
export function fingerprint(s: Snapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const log of Object.values(s.logs)) {
    for (const [date, entries] of Object.entries(log.days)) {
      for (const [habit, e] of Object.entries(entries)) {
        const val = isCleared(e) ? 'cleared' : e.skip !== undefined ? `skip:${String(e.skip)}` : `v:${String(e.v)}`;
        out[`${date}|${habit}`] = `${val}@${e.at}`;
      }
    }
  }
  return out;
}

export interface Finding {
  kind: 'lost' | 'changed';
  date: DateKey;
  habit: string;
  was: string;
  now: string | null;
}

export interface Comparison {
  findings: Finding[];
  edits: number;
  added: number;
}

/** Yesterday's fingerprint against today's. */
export function compare(prev: Record<string, string>, cur: Record<string, string>): Comparison {
  const findings: Finding[] = [];
  let edits = 0;
  for (const [k, was] of Object.entries(prev)) {
    const [date, habit] = k.split('|') as [DateKey, string];
    const now = cur[k];
    if (now === undefined) {
      findings.push({ kind: 'lost', date, habit, was, now: null });
      continue;
    }
    if (now === was) continue;
    const at = (x: string): number => Number(x.slice(x.lastIndexOf('@') + 1));
    if (at(now) > at(was)) edits++;
    else findings.push({ kind: 'changed', date, habit, was, now });
  }
  const added = Object.keys(cur).filter((k) => !(k in prev)).length;
  return { findings, edits, added };
}

/** Export to a backup and read it back: is the record identical? */
export function roundTrip(s: Snapshot, app: string, now: number): boolean {
  const parsed = parseBackup(exportJson(s, app, now));
  if (!parsed.ok) return false;
  const a = recordOf(s);
  const b = recordOf(parsed.snapshot);
  const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y);
  return same(a, b) && same(s.habits, parsed.snapshot.habits) && same(s.profile, parsed.snapshot.profile) && same(s.notes, parsed.snapshot.notes);
}

export interface TrialDay {
  day: DateKey;
  lost: number;
  changed: number;
  edits: number;
  added: number;
  roundTrip: boolean;
}

export interface TrialState {
  start: DateKey;
  last: { day: DateKey; print: Record<string, string> } | null;
  days: TrialDay[];
  /** The latest problems found, kept to show until the next clean check. */
  findings: Finding[];
}

/** One day's check: compares with the last fingerprint and stores today's. Pure. */
export function checkDay(state: TrialState | null, s: Snapshot, today: DateKey, app: string, now: number): TrialState {
  const print = fingerprint(s);
  const st: TrialState = state ?? { start: today, last: null, days: [], findings: [] };
  const cmp = st.last ? compare(st.last.print, print) : { findings: [], edits: 0, added: Object.keys(print).length };
  const day: TrialDay = {
    day: today,
    lost: cmp.findings.filter((f) => f.kind === 'lost').length,
    changed: cmp.findings.filter((f) => f.kind === 'changed').length,
    edits: cmp.edits,
    added: cmp.added,
    roundTrip: roundTrip(s, app, now),
  };
  const days = [...st.days.filter((d) => d.day !== today), day].slice(-60);
  return { start: st.start, last: { day: today, print }, days, findings: cmp.findings.length ? cmp.findings : st.last?.day === today ? st.findings : [] };
}
