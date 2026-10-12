/**
 * Storage encoding for the artifact database.
 *
 * The database's update merges nested objects recursively, so an entry stored as an object
 * would merge an undo ({at, dev}) into the old value and keep it. Entries are therefore stored
 * as arrays, which replace wholesale: [value | null, skip | null, writeTime].
 * The device is implied by the document the entry lives in.
 */
import type { Entry, SkipReason } from '../core/model/types';

export type EncodedEntry = [number | null, SkipReason | null, number];

export function encodeEntry(e: Entry): EncodedEntry {
  return [e.v ?? null, e.skip ?? null, e.at];
}

export function decodeEntry(x: unknown, dev: string): Entry | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const [v, skip, at] = x as unknown[];
  if (typeof at !== 'number') return null;
  const e: Entry = { at, dev };
  if (typeof v === 'number') e.v = v;
  else if (v !== null) return null;
  if (skip === true || typeof skip === 'string') e.skip = skip as SkipReason;
  else if (skip !== null) return null;
  return e;
}

const SINGLE = new Set(['profile', 'habits', 'seen', 'corrections', 'notes']);
const LOG_ID = /^log-(\d{4}-\d{2})~([A-Za-z0-9_-]{1,64})$/;

export function logDocId(month: string, dev: string): string {
  return `log-${month}~${dev}`;
}

export type ParsedDocId =
  | { kind: 'single'; name: 'profile' | 'habits' | 'seen' | 'corrections' | 'notes' }
  | { kind: 'log'; month: string; dev: string }
  | { kind: 'unknown' };

export function parseDocId(id: string): ParsedDocId {
  if (SINGLE.has(id)) return { kind: 'single', name: id as 'profile' };
  const m = LOG_ID.exec(id);
  if (m) return { kind: 'log', month: m[1] as string, dev: m[2] as string };
  return { kind: 'unknown' };
}

/** Device ids are random, permanent per browser, and safe as path segments. */
export function newDeviceId(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return s;
}
