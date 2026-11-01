/**
 * The 14-week speedrun (M10, run by ten simulated people instead of waited out by one).
 *
 * Each persona drives the real Controller and SyncedStore (one per device, all on one shared
 * account store) through 98 days of simulated time, minute by minute where it matters: the day
 * boundary, late nights, backfills, corrections, two devices with one offline, conflicts, travel,
 * absences, habit edits, export and restore. Every simulated day it runs the M10 record check on
 * every device, checks that devices agree, times the work, and notes anything odd.
 *
 * Output: .sim/<persona>.json and .sim/summary.json, read by the report and by the
 * persona reviewers. Run: npx vitest run --config vitest.sim.config.ts
 */
// @ts-ignore: Node's types are not installed; this file runs under Vitest in Node.
import { mkdirSync, writeFileSync } from 'node:fs';
declare const process: { env: Record<string, string | undefined> };
import { describe, expect, it } from 'vitest';
import { Controller, type Clock, type View } from '../../src/ui/controller';
import { SyncedStore } from '../../src/data/store';
import { MemoryBackend } from '../../src/data/adapters/memory';
import { MemoryKV } from '../../src/data/sync/journal';
import type { Backend } from '../../src/data/backend';
import { addDays, wallClock, weekday, type DateKey } from '../../src/core/model/date';
import { recordOf } from '../../src/data/backup/backup';
import { dayCards } from '../../src/game/montage';
import { weatherOf, momentumStep } from '../../src/core/world';
import { kindFor, seasonOf } from '../../src/game/conditions';
import { mulberry32 } from '../../src/prototype/shared/noise';
import { PERSONAS, type Ev, type Persona } from './personas';

const START: DateKey = '2026-10-15';
const DAYS = Number(process.env.SIM_DAYS ?? 98);
const OUT = '.sim';

function offsetMin(ms: number, zone: string): number {
  const w = wallClock(new Date(ms), zone);
  const asUtc = Date.UTC(+w.date.slice(0, 4), +w.date.slice(5, 7) - 1, +w.date.slice(8, 10)) + w.minutes * 60_000;
  return Math.round((asUtc - ms) / 60_000);
}

/** The instant at `minutes` after local midnight of `date` in `zone`. */
function zonedMs(date: DateKey, minutes: number, zone: string): number {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + minutes * 60_000;
  let ms = guess - offsetMin(guess, zone) * 60_000;
  ms = guess - offsetMin(ms, zone) * 60_000;
  return ms;
}

/** A device's own view of the shared account store, with its own network switch. */
class DeviceLink implements Backend {
  offline = false;
  constructor(private readonly remote: MemoryBackend) {}
  private gate(): void {
    if (this.offline) throw new Error('offline');
  }
  async readAll() {
    this.gate();
    return this.remote.readAll();
  }
  async putEntry(...a: Parameters<Backend['putEntry']>) {
    this.gate();
    return this.remote.putEntry(...a);
  }
  async getEntry(...a: Parameters<Backend['getEntry']>) {
    this.gate();
    return this.remote.getEntry(...a);
  }
  async putDoc(...a: Parameters<Backend['putDoc']>) {
    this.gate();
    return this.remote.putDoc(...a);
  }
  subscribe(fn: () => void) {
    return this.remote.subscribe(() => {
      if (!this.offline) fn();
    });
  }
}

interface Device {
  ctl: Controller;
  store: SyncedStore;
  link: DeviceLink;
  timers: Array<() => void>;
}

export interface Issue {
  day: number;
  date: DateKey;
  kind: string;
  detail: string;
  persona: string;
}

export interface DayLog {
  day: number;
  date: DateKey;
  dow: number;
  events: number;
  rejected: number;
  outcome: string;
  progress: number;
  storyDay: number;
  stage: number;
  verdictSoFar: string | null;
  canon: string;
  kind: string;
  season: string;
  momentum: number;
  water: number;
  waterTarget: number;
  waterStreak: number;
  derivedMs: number;
  actionMs: number;
  trial: { lost: number; changed: number; edits: number; roundTrip: boolean } | null;
  devicesAgree: boolean;
  replay: { cards: number; timed: number; later: number; untimed: number } | null;
  rejections: string[];
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

async function runPersona(p: Persona): Promise<{ days: DayLog[]; issues: Issue[]; final: Record<string, unknown> }> {
  const remote = new MemoryBackend();
  let now = zonedMs(START, 6 * 60, p.zone);
  let zone = p.zone;
  const clock: Clock = { now: () => now, zone: () => zone };
  const issues: Issue[] = [];
  const devices: Device[] = [];
  for (let i = 0; i < p.devices; i++) {
    const link = new DeviceLink(remote);
    const timers: Array<() => void> = [];
    const store = new SyncedStore({ backend: link, kv: new MemoryKV(), dev: `${p.id}-${i}`, now: () => now, schedule: (fn) => timers.push(fn), openTimeoutMs: 1000 });
    await store.open();
    devices.push({ ctl: new Controller(store, new MemoryKV(), `${p.id}-${i}`, clock), store, link, timers });
  }
  const pump = async (): Promise<void> => {
    for (let k = 0; k < 3; k++) {
      for (const d of devices) {
        const fns = d.timers.splice(0);
        for (const f of fns) f();
      }
      await settle();
    }
  };
  const main = devices[0]!;
  const r = main.ctl.start({ identity: `${p.name}, a few small things a day`, habits: p.habits.map((h) => ({ name: h.name, definition: h.def })) });
  if (!r.ok) throw new Error(`${p.id}: start failed: ${r.message}`);
  main.ctl.ensureWater();
  await pump();
  if (main.ctl.view().derived.water) main.ctl.setWaterTarget(p.water);
  await pump();
  for (const d of devices.slice(1)) d.ctl.checkDay();

  const rnd = mulberry32(p.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const days: DayLog[] = [];
  const idOf = (v: View, name: string): string | undefined => v.snapshot.habits.habits.find((h) => h.name === name && !h.system)?.id;
  const prev = new Map<string, { v?: number; skip?: unknown } | null>();
  let lastDay = '';

  for (let d = 0; d < DAYS; d++) {
    const date = addDays(START, d);
    const dow = weekday(date);
    const evs = p.plan(d, rnd, dow).sort((a, b) => a.t - b.t);
    const rejections: string[] = [];
    let actionMs = 0;
    for (const e of evs) {
      const dev = devices[e.dev ?? 0] ?? main;
      const target = zonedMs(date, e.t, zone);
      if (target > now) now = target;
      for (const x of devices) x.ctl.checkDay();
      // A long absence asks the person to confirm the jump; they always say yes.
      for (const x of devices) if (x.ctl.view().pendingJump) x.ctl.confirmJump(true);
      const v = dev.ctl.view();
      const t0 = performance.now();
      const res = act(dev, v, e, idOf, prev, (z) => (zone = z), date);
      actionMs += performance.now() - t0;
      if (res && !res.ok) rejections.push(`${e.kind}${'habit' in e ? ` ${e.habit}` : ''}: ${res.message}`);
      await pump();
    }
    // The end of the simulated day (late evening), then the M10 check on every device.
    now = Math.max(now, zonedMs(date, 23 * 60 + 58, zone));
    for (const x of devices) x.ctl.checkDay();
    for (const x of devices) x.link.offline = false;
    await pump();
    for (const x of devices) await x.store.flush();
    await pump();
    const v = main.ctl.view();
    const today = v.today;
    const t1 = performance.now();
    const fresh = main.ctl.view();
    const derivedMs = performance.now() - t1;
    let trial: DayLog['trial'] = null;
    for (const [i, x] of devices.entries()) {
      const st = x.ctl.trialCheck('sim', true);
      const last = st?.days[st.days.length - 1];
      if (last && i === 0) trial = { lost: last.lost, changed: last.changed, edits: last.edits, roundTrip: last.roundTrip };
      if (last && (last.lost || last.changed)) issues.push({ persona: p.id, day: d, date, kind: last.lost ? 'record-lost' : 'record-changed', detail: JSON.stringify(st?.findings.slice(0, 3)) });
      if (last && !last.roundTrip) issues.push({ persona: p.id, day: d, date, kind: 'roundtrip', detail: `device ${i}: backup did not read back identical` });
    }
    let agree = true;
    if (devices.length > 1) {
      const a = JSON.stringify(recordOf(main.store.current.snapshot));
      for (const x of devices.slice(1)) if (JSON.stringify(recordOf(x.store.current.snapshot)) !== a) agree = false;
      if (!agree) issues.push({ persona: p.id, day: d, date, kind: 'devices-disagree', detail: 'after sync, the devices hold different records' });
    }
    if (today !== date && today !== addDays(date, 1) && lastDay !== '') issues.push({ persona: p.id, day: d, date, kind: 'logical-day', detail: `logical day is ${today} while simulating ${date}` });
    lastDay = today;
    // Look back at the day just finished: its outcome, its replay.
    const dd = fresh.derived.days[date];
    let replay: DayLog['replay'] = null;
    try {
      const cards = dayCards(fresh, date);
      replay = { cards: cards.length, timed: cards.filter((c) => c.time).length, later: cards.filter((c) => c.note?.startsWith('logged later')).length, untimed: cards.filter((c) => c.note?.includes('not recorded')).length };
    } catch (err) {
      issues.push({ persona: p.id, day: d, date, kind: 'replay-crash', detail: String(err) });
    }
    const canon = weatherOf(fresh.derived, date);
    const season = seasonOf(new Date(`${date}T12:00:00`));
    const outcome = dd?.outcome ?? 'none';
    if ((outcome === 'excused' || outcome === 'rested') && canon !== 'calm') issues.push({ persona: p.id, day: d, date, kind: 'weather-blames-rest', detail: `${outcome} day with ${canon} weather` });
    const w = fresh.derived.water;
    days.push({
      day: d,
      date,
      dow,
      events: evs.length,
      rejected: rejections.length,
      outcome,
      progress: Math.round((dd?.progress ?? 0) * 100) / 100,
      storyDay: fresh.derived.storyDayEarned,
      stage: fresh.derived.climb.stage,
      verdictSoFar: fresh.derived.climb.current?.verdict ?? null,
      canon,
      kind: kindFor(canon, season, new Date(`${date}T12:00:00`)),
      season,
      momentum: momentumStep(fresh.derived, today),
      water: w?.today ?? 0,
      waterTarget: w?.target ?? 0,
      waterStreak: w?.streak ?? 0,
      derivedMs: Math.round(derivedMs * 100) / 100,
      actionMs: Math.round(actionMs * 100) / 100,
      trial,
      devicesAgree: agree,
      replay,
      rejections,
    });
    for (const msg of rejections) issues.push({ persona: p.id, day: d, date, kind: 'rejected', detail: msg });
  }
  const v = main.ctl.view();
  // A day's outcome is only final once it has ended: read them all from the end of the run.
  for (const x of days) {
    const dd = v.derived.days[x.date];
    x.outcome = dd?.outcome ?? 'none';
    x.progress = Math.round((dd?.progress ?? 0) * 100) / 100;
  }
  // Every day's replay, read again at the end (after any restores): are the recorded times kept?
  const sweep = { timed: 0, later: 0, untimed: 0, elsewhere: 0 };
  for (const x of days) {
    const cards = dayCards(v, x.date);
    sweep.timed += cards.filter((c) => c.time).length;
    sweep.later += cards.filter((c) => c.note?.startsWith('logged later')).length;
    sweep.untimed += cards.filter((c) => c.note?.includes('not recorded')).length;
    sweep.elsewhere += cards.filter((c) => c.note?.startsWith('recorded in another')).length;
  }
  if (sweep.untimed) issues.push({ persona: p.id, day: DAYS - 1, date: addDays(START, DAYS - 1), kind: 'replay-times-lost', detail: `${sweep.untimed} replay cards without a time at the end of the run` });
  const final = {
    replaySweep: sweep,
    storyDay: v.derived.storyDayEarned,
    stage: v.derived.climb.stage,
    chapter: v.derived.climb.chapter,
    weeks: v.derived.climb.weeks.map((w) => ({ week: w.week, verdict: w.verdict, score: w.score, moved: w.moved })),
    chains: Object.fromEntries(Object.entries(v.derived.chains).map(([id, c]) => [v.snapshot.habits.habits.find((h) => h.id === id)?.name ?? id, { current: c.current, best: c.best }])),
    lifetime: v.derived.lifetime,
    records: v.derived.records.length,
    rates: v.derived.rates,
    entries: Object.keys(recordOf(v.snapshot)).length,
    habits: v.snapshot.habits.habits.map((h) => ({ name: h.name, archived: h.versions[h.versions.length - 1]?.archived ?? false, system: h.system ?? null })),
    boundary: v.snapshot.profile?.settings.dayBoundary,
  };
  return { days, issues, final };
}

type Result = ReturnType<Controller['setValue']> | null;

function act(dev: Device, v: View, e: Ev, idOf: (v: View, n: string) => string | undefined, prev: Map<string, { v?: number; skip?: unknown } | null>, setZone: (z: string) => void, date: DateKey): Result {
  const c = dev.ctl;
  const id = 'habit' in e ? idOf(v, e.habit) : undefined;
  const need = (): string => {
    if (!id) throw new Error(`no habit ${'habit' in e ? e.habit : ''}`);
    return id;
  };
  const remember = (h: string): void => {
    prev.set(h, c.entryFields(c.today, h));
  };
  try {
    switch (e.kind) {
      case 'open':
        return null;
      case 'done':
        remember(need());
        return c.complete(need());
      case 'amount':
        remember(need());
        return c.setValue(need(), e.v);
      case 'attempt':
        return c.attempt(need(), e.v);
      case 'skip':
        return c.skip(need(), e.reason);
      case 'glass':
        return c.addGlass(1);
      case 'unglass':
        return c.addGlass(-1);
      case 'note':
        return c.saveNote(c.today, e.text);
      case 'backfill': {
        const day = addDays(c.today, -(e.daysAgo ?? 1));
        c.setViewDate(day);
        const r = e.v !== undefined ? c.setValue(need(), e.v) : c.complete(need());
        c.setViewDate(c.today);
        return r;
      }
      case 'correct':
        return c.correct(addDays(c.today, -e.daysAgo), need(), e.v === null ? null : { v: e.v });
      case 'edit':
        return c.editHabit(need(), e.habit, e.def);
      case 'archive':
        return c.archive(need());
      case 'restore':
        return c.restore(need());
      case 'add':
        return c.addHabit(e.name, e.def);
      case 'remove':
        return c.remove(need(), e.habit);
      case 'boundary':
        return c.saveProfile({ dayBoundary: e.minutes });
      case 'zone':
        setZone(e.zone);
        return null;
      case 'offline':
        dev.link.offline = e.on;
        return null;
      case 'undo': {
        const h = need();
        return c.revert(c.today, h, (prev.get(h) as { v?: number } | null) ?? null);
      }
      case 'roundtrip': {
        const files = c.exportFiles('sim');
        const p = c.prepareImport(files.json.data, 'sim');
        if (!p.ok) return { ok: false, message: `import failed: ${p.error}` };
        const ch = p.summary.changes;
        if (ch.entriesAdded || ch.entriesChanged || ch.entriesRemoved) return { ok: false, message: `round trip dry run not empty on ${date}: ${JSON.stringify(ch)}` };
        c.applyImport(p.incoming);
        return null;
      }
      case 'replay':
        dayCards(v, addDays(c.today, -e.daysAgo));
        return null;
    }
  } catch (err) {
    return { ok: false, message: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  return null;
}

describe('the 14-week speedrun', () => {
  mkdirSync(OUT, { recursive: true });
  const summary: Record<string, unknown> = {};
  for (const p of PERSONAS) {
    it(`${p.name}: ${DAYS} days`, async () => {
      const t0 = performance.now();
      const res = await runPersona(p);
      const ms = performance.now() - t0;
      writeFileSync(`${OUT}/${p.id}.json`, JSON.stringify({ persona: { id: p.id, name: p.name, age: p.age, role: p.role, zone: p.zone, devices: p.devices, habits: p.habits.map((h) => h.name), water: p.water }, ...res, runMs: Math.round(ms) }, null, 1));
      summary[p.id] = { issues: res.issues.length, kinds: [...new Set(res.issues.map((i) => i.kind))], final: res.final, runMs: Math.round(ms) };
      writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
      expect(res.days.length).toBe(DAYS);
    }, 600_000);
  }
});
