/**
 * The app controller: the store, the clock, derived state and every action a person can take.
 * No DOM here, so it is tested directly; views only read `view()` and call actions.
 */
import { derive } from '../core/derive';
import { startCursor, tick, type DayCursor } from '../core/model/clock';
import { addDays, compareDateKeys, monthOf, weekStart } from '../core/model/date';
import { correctRecord, entryOn, isCleared, isEditable, logEntry } from '../core/model/entries';
import { ACTS_MAX, CURRENT_SCHEMA } from '../core/model/schemas';
import type { DateKey, Derived, Entry, ExpeditionDoc, Habit, HabitId, HabitsDoc, Profile, SkipReason, Snapshot } from '../core/model/types';
import { chooseSteep } from '../core/habits/weekly';
import { archiveHabit, createHabit, deleteHabit, editDefinition, renameHabit, restoreHabit, retagHabit, sameChainRules, versionOn, type Definition } from '../core/habits/versions';
import { suggestTag } from '../core/tags';
import { NOTE_MAX } from '../core/model/schemas';
import { backupDue, exportCsv, exportJson, backupFileName, prepareImport, type PreparedImport } from '../data/backup/backup';
import type { SyncedStore, StoreState } from '../data/store';
import type { KV } from '../data/sync/journal';

/**
 * Which of Ari's chores a habit becomes is the story's choice, made per scene so it stays
 * fresh. The stored category is only a starting hint; the person is never asked.
 */
const STORY_CHOOSES: Habit['category'] = 'effort';

export const WATER_ID = 'water';

function withWater(doc: HabitsDoc, today: DateKey): HabitsDoc {
  if (doc.habits.some((x) => x.system === 'water')) return doc;
  const water: Habit = {
    id: WATER_ID,
    name: 'Water',
    category: 'care',
    createdOn: today,
    system: 'water',
    tag: { family: 'health', group: 'hydration' },
    versions: [{ from: today, type: 'numeric', unit: 'glasses', target: 8, minimum: 6, schedule: { kind: 'daily' } }],
  };
  return { ...doc, habits: [...doc.habits, water] };
}

export interface Clock {
  now(): number;
  zone(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

const CURSOR_KEY = 'ascent:cursor:v1';
const BACKUP_KEY = 'ascent:lastBackup:v1';
const LAUNCHED_KEY = 'ascent:launched:v1';

export interface View {
  store: StoreState;
  snapshot: Snapshot;
  derived: Derived;
  today: DateKey;
  viewDate: DateKey;
  /** A clock jump that must be confirmed before days are finalised. */
  pendingJump: { to: DateKey; ended: DateKey[] } | null;
  backupDue: boolean;
  steepAvailable: boolean;
  firstRun: boolean;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

const REJECTIONS: Record<string, string> = {
  final: 'That day is closed. Use Correct the record in Setup to change it.',
  future: 'That day has not started yet.',
  unknownHabit: 'That habit no longer exists.',
  invalidValue: 'That value cannot be saved. Use a number from 0 up.',
};

export class Controller {
  private cursor: DayCursor;
  private _viewDate: DateKey;
  private pendingJump: View['pendingJump'] = null;
  private memo: { snapshot: Snapshot; today: DateKey; derived: Derived } | null = null;
  private listeners = new Set<(v: View) => void>();
  private firstLaunch: boolean;
  sceneActive = false;

  constructor(
    readonly store: SyncedStore,
    private readonly kv: KV | null,
    readonly dev: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.cursor = this.loadCursor();
    this._viewDate = this.cursor.date;
    this.firstLaunch = this.kvGet(LAUNCHED_KEY) === null;
    this.kvSet(LAUNCHED_KEY, '1');
    store.onChange(() => this.emit());
  }

  get boundary(): number {
    return this.store.current.snapshot.profile?.settings.dayBoundary ?? 240;
  }

  get today(): DateKey {
    return this.cursor.date;
  }

  onChange(fn: (v: View) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  view(): View {
    const st = this.store.current;
    const s = st.snapshot;
    if (!this.memo || this.memo.snapshot !== s || this.memo.today !== this.today) {
      this.memo = { snapshot: s, today: this.today, derived: derive(s, { date: this.today, ended: false }) };
    }
    const derived = this.memo.derived;
    const firstUse = s.habits.habits.reduce<DateKey | null>((m, h) => (m === null || h.createdOn < m ? h.createdOn : m), null);
    const yesterday = derived.days[addDays(this.today, -1)];
    return {
      store: st,
      snapshot: s,
      derived,
      today: this.today,
      viewDate: this._viewDate,
      pendingJump: this.pendingJump,
      backupDue: backupDue({
        lastBackup: this.kvGet(BACKUP_KEY),
        firstUse,
        today: this.today,
        dayClosed: yesterday !== undefined && yesterday.outcome !== 'free',
        firstLaunch: this.firstLaunch,
        sceneActive: this.sceneActive,
      }),
      steepAvailable: s.profile !== null && chooseSteep(s, derived.climb, this.today).ok,
      firstRun: s.profile === null && s.habits.habits.length === 0,
    };
  }

  // Clock -----------------------------------------------------------------------------------

  /** Advance the logical day if the boundary has passed. Called on a timer and on focus. */
  checkDay(): void {
    const t = tick(this.cursor, this.clock.now(), this.clock.zone(), this.boundary);
    if (t.kind === 'same') {
      this.cursor = t.cursor;
      return;
    }
    if (t.kind === 'confirm') {
      this.pendingJump = { to: t.proposed.date, ended: t.ended };
      this.proposed = t.proposed;
      this.emit();
      return;
    }
    const wasToday = this._viewDate === this.cursor.date;
    this.cursor = t.cursor;
    this.saveCursor();
    if (wasToday || !isEditable(this._viewDate, this.today)) this._viewDate = this.today;
    this.emit();
  }

  private proposed: DayCursor | null = null;

  /** The person confirms the clock jump (T18). */
  confirmJump(accept: boolean): void {
    if (accept && this.proposed) {
      this.cursor = this.proposed;
      this._viewDate = this.cursor.date;
      this.saveCursor();
    } else {
      // Keep the current day; the observed time moves on so the question is not asked again
      // until the clock jumps again.
      this.cursor = { ...this.cursor, seen: this.clock.now() };
      this.saveCursor();
    }
    this.pendingJump = null;
    this.proposed = null;
    this.emit();
  }

  setViewDate(d: DateKey): void {
    if (!isEditable(d, this.today)) return;
    this._viewDate = d;
    this.emit();
  }

  // Logging ---------------------------------------------------------------------------------

  private entry(fields: { v?: number; skip?: SkipReason }): Entry {
    return { ...fields, at: this.clock.now(), dev: this.dev };
  }

  /**
   * The entry with this change added to its history of action times (decision G-38): the
   * last ACTS_MAX changes, each with when it was recorded and what it became.
   */
  private withActs(date: DateKey, habit: HabitId, e: Entry): Entry {
    const prev = this.store.current.snapshot.logs[monthOf(date)]?.days[date]?.[habit];
    const act = { at: e.at, ...(e.v !== undefined ? { v: e.v } : {}), ...(e.skip !== undefined ? { skip: e.skip } : {}) };
    return { ...e, acts: [...(prev?.acts ?? []), act].slice(-ACTS_MAX) };
  }

  setValue(habit: HabitId, value: number): ActionResult {
    return this.write(habit, this.entry({ v: value }));
  }

  toggle(habit: HabitId): ActionResult {
    const cur = entryOn(this.store.current.snapshot, this._viewDate, habit);
    return cur?.v !== undefined && cur.v > 0 ? this.clearEntry(habit) : this.setValue(habit, 1);
  }

  /**
   * The game screen's hold: done (the full target) or, when already done, empty again.
   * Anything in between (attempted, held, skipped) becomes done.
   */
  tapDone(habit: HabitId): ActionResult {
    const h = this.store.current.snapshot.habits.habits.find((x) => x.id === habit);
    const ver = h ? versionOn(h, this._viewDate) : undefined;
    if (!ver) return { ok: false, message: 'That habit no longer exists.' };
    const cur = entryOn(this.store.current.snapshot, this._viewDate, habit);
    const done = cur?.v !== undefined && cur.v >= ver.target;
    return done ? this.clearEntry(habit) : this.setValue(habit, ver.target);
  }

  /** Mark the full target done, whatever was there (the options sheet's "Mark done"). */
  complete(habit: HabitId): ActionResult {
    const h = this.store.current.snapshot.habits.habits.find((x) => x.id === habit);
    const ver = h ? versionOn(h, this._viewDate) : undefined;
    if (!ver) return { ok: false, message: 'That habit no longer exists.' };
    return this.setValue(habit, ver.target);
  }

  /** The value a habit had on a day, to put back on Undo (null: nothing logged). */
  entryFields(date: DateKey, habit: HabitId): { v?: number; skip?: SkipReason } | null {
    const e = entryOn(this.store.current.snapshot, date, habit);
    if (!e || (e.v === undefined && e.skip === undefined)) return null;
    return { ...(e.v !== undefined ? { v: e.v } : {}), ...(e.skip !== undefined ? { skip: e.skip } : {}) };
  }

  /** Undo: put back exactly what was there before, on the day it was logged. */
  revert(date: DateKey, habit: HabitId, prev: { v?: number; skip?: SkipReason } | null): ActionResult {
    const e = this.entry(prev ?? {});
    const r = logEntry(this.store.current.snapshot, this.today, date, habit, e);
    if (!r.ok) return { ok: false, message: REJECTIONS[r.reason] ?? 'That could not be undone.' };
    this.store.putEntry(date, habit, this.withActs(date, habit, e));
    return { ok: true };
  }

  skip(habit: HabitId, reason: SkipReason): ActionResult {
    return this.write(habit, this.entry({ skip: reason }));
  }

  clearEntry(habit: HabitId): ActionResult {
    return this.write(habit, this.entry({}));
  }

  private write(habit: HabitId, e: Entry): ActionResult {
    const r = logEntry(this.store.current.snapshot, this.today, this._viewDate, habit, e);
    if (!r.ok) return { ok: false, message: REJECTIONS[r.reason] ?? 'That could not be saved.' };
    this.store.putEntry(this._viewDate, habit, this.withActs(this._viewDate, habit, e));
    return { ok: true };
  }

  correct(date: DateKey, habit: HabitId, fields: { v?: number; skip?: SkipReason } | null): ActionResult {
    const s = this.store.current.snapshot;
    const e = this.entry(fields ?? {});
    const r = correctRecord(s, this.today, date, habit, e);
    if (!r.ok) return { ok: false, message: REJECTIONS[r.reason] ?? 'That could not be saved.' };
    this.store.putEntry(date, habit, this.withActs(date, habit, e));
    this.store.putDoc('corrections', r.snapshot.corrections);
    return { ok: true };
  }

  chooseSteep(): ActionResult {
    const s = this.store.current.snapshot;
    const r = chooseSteep(s, this.view().derived.climb, this.today);
    if (!r.ok) return { ok: false, message: 'The steep line can be chosen only before the week’s first tick.' };
    if (r.snapshot.profile) this.store.putDoc('profile', r.snapshot.profile);
    return { ok: true };
  }

  // Setup -----------------------------------------------------------------------------------

  start(input: { identity: string; habits: Array<{ name: string; definition: Definition; tag?: { family: string; group: string } }> }): ActionResult {
    const profile: Profile = {
      schema: CURRENT_SCHEMA.profile,
      identity: input.identity.trim(),
      startDate: this.today,
      settings: { dayBoundary: this.boundary, timeZone: this.clock.zone(), sound: true, music: true, reducedMotion: false },
      weekly: { steep: [] },
    };
    let doc: HabitsDoc = { schema: CURRENT_SCHEMA.habits, habits: [] };
    try {
      for (const hb of input.habits) doc = createHabit(doc, { id: this.newId(), name: hb.name.trim(), category: STORY_CHOOSES, today: this.today, definition: hb.definition, tag: hb.tag ?? suggestTag(hb.name) });
      doc = withWater(doc, this.today);
      this.store.putDoc('habits', doc);
      this.store.putDoc('profile', profile);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Setup could not be saved.' };
    }
    return { ok: true };
  }

  /** Every player has the water bar; add it to an existing record that predates it. */
  ensureWater(): void {
    const s = this.store.current.snapshot;
    if (!s.profile || s.habits.habits.some((x) => x.system === 'water')) return;
    try {
      this.store.putDoc('habits', withWater(s.habits, this.today));
    } catch {
      // leave the record untouched if it cannot take the habit
    }
  }

  /** One glass more (or fewer). Water is always logged for today. */
  addGlass(delta: 1 | -1): ActionResult {
    const w = this.view().derived.water;
    if (!w) return { ok: false, message: 'The water bar is not set up yet.' };
    const next = Math.max(0, w.today + delta);
    const r = logEntry(this.store.current.snapshot, this.today, this.today, w.habit, this.entry({ v: next }));
    if (!r.ok) return { ok: false, message: REJECTIONS[r.reason] ?? 'That could not be saved.' };
    this.store.putEntry(this.today, w.habit, this.withActs(this.today, w.habit, this.entry({ v: next })));
    return { ok: true };
  }

  setWaterTarget(glasses: number): ActionResult {
    if (!Number.isInteger(glasses) || glasses < 1 || glasses > 30) return { ok: false, message: 'Choose 1 to 30 glasses.' };
    const h = this.store.current.snapshot.habits.habits.find((x) => x.system === 'water');
    if (!h) return { ok: false, message: 'The water bar is not set up yet.' };
    return this.saveHabits((doc) =>
      editDefinition(doc, h.id, this.today, { type: 'numeric', unit: 'glasses', target: glasses, minimum: Math.max(1, Math.round(glasses * 0.75)), schedule: { kind: 'daily' } }),
    );
  }

  addHabit(name: string, definition: Definition, tag?: { family: string; group: string }): ActionResult {
    return this.saveHabits((doc) =>
      createHabit(doc, { id: this.newId(), name: name.trim(), category: STORY_CHOOSES, today: this.today, definition, tag: tag ?? suggestTag(name) }),
    );
  }

  /** Move a habit to another coloured group. Applies everywhere, like the name. */
  retag(id: HabitId, tag: { family: string; group: string }): ActionResult {
    return this.saveHabits((doc) => retagHabit(doc, id, tag));
  }

  /** Attempted: some effort, short of the hold point. Amount habits keep the amount given. */
  attempt(habit: HabitId, amount?: number): ActionResult {
    const h = this.store.current.snapshot.habits.habits.find((x) => x.id === habit);
    const ver = h ? versionOn(h, this._viewDate) : undefined;
    if (!ver) return { ok: false, message: 'That habit no longer exists.' };
    const binary = ver.type === 'binary' || ver.type === 'avoid';
    const v = binary ? 0.5 : amount ?? Math.max(0, Math.min(ver.minimum, ver.target) / 2);
    return this.setValue(habit, v);
  }

  /** One short journal note per day; an empty note removes the day's entry. */
  saveNote(date: DateKey, text: string): ActionResult {
    const clean = text.trim().slice(0, NOTE_MAX);
    const notes = this.store.current.snapshot.notes;
    const entries = { ...notes.entries };
    if (clean) entries[date] = clean;
    else delete entries[date];
    try {
      this.store.putDoc('notes', { ...notes, entries });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'The note could not be saved.' };
    }
    return { ok: true };
  }

  editHabit(id: HabitId, name: string, definition: Definition): ActionResult {
    return this.saveHabits((doc) => {
      let next = renameHabit(doc, id, name.trim());
      const h = next.habits.find((x) => x.id === id);
      const cur = h ? versionOn(h, this.today) : undefined;
      const changed =
        !cur ||
        cur.target !== (definition.type === 'binary' || definition.type === 'avoid' ? 1 : definition.target) ||
        cur.minimum !== (definition.minimum ?? cur.minimum) ||
        (cur.unit ?? '') !== (definition.unit ?? '') ||
        (cur.time ?? '') !== (definition.time ?? '') ||
        !sameChainRules(cur, { ...cur, type: definition.type, schedule: definition.schedule });
      if (changed) next = editDefinition(next, id, this.today, definition);
      return next;
    });
  }

  archive(id: HabitId): ActionResult {
    return this.saveHabits((doc) => archiveHabit(doc, id, this.today));
  }

  restore(id: HabitId): ActionResult {
    return this.saveHabits((doc) => restoreHabit(doc, id, this.today));
  }

  /** Delete after archiving, confirmed by typing the habit's name. */
  remove(id: HabitId, typedName: string): ActionResult {
    const s = this.store.current.snapshot;
    const h = s.habits.habits.find((x) => x.id === id);
    if (!h) return { ok: false, message: 'That habit no longer exists.' };
    if (typedName.trim() !== h.name) return { ok: false, message: `Type “${h.name}” exactly to delete it.` };
    try {
      const next = deleteHabit(s, id);
      // Clear every stored entry for the habit, then drop it from the habit list.
      for (const log of Object.values(s.logs)) {
        for (const [date, entries] of Object.entries(log.days)) {
          // A deleted habit leaves no history of action times either.
          if (entries[id] && !isCleared(entries[id])) this.store.putEntry(date, id, { ...this.entry({}), acts: [] });
        }
      }
      this.store.putDoc('habits', next.habits);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Delete failed.' };
    }
    return { ok: true };
  }

  saveProfile(patch: { identity?: string; dayBoundary?: number; sound?: boolean; music?: boolean; reducedMotion?: boolean }): ActionResult {
    const p = this.store.current.snapshot.profile;
    if (!p) return { ok: false, message: 'Finish the first setup first.' };
    const { identity, ...settings } = patch;
    const next: Profile = { ...p, identity: identity ?? p.identity, settings: { ...p.settings, ...settings } };
    try {
      this.store.putDoc('profile', next);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Settings could not be saved.' };
    }
    return { ok: true };
  }

  private saveHabits(change: (doc: HabitsDoc) => HabitsDoc): ActionResult {
    try {
      this.store.putDoc('habits', change(this.store.current.snapshot.habits));
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'That change could not be saved.' };
    }
    return { ok: true };
  }

  /** Optional personal marks: symbol, accent, expedition name. `null` clears a field. */
  saveExpedition(patch: { name?: string | null; symbol?: ExpeditionDoc['symbol'] | null; accent?: ExpeditionDoc['accent'] | null; introOn?: DateKey | null }): ActionResult {
    const next: ExpeditionDoc = { ...this.store.current.snapshot.expedition };
    for (const [k, v] of Object.entries(patch) as Array<[keyof ExpeditionDoc, unknown]>) {
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) delete next[k];
      else (next as unknown as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v;
    }
    try {
      this.store.putDoc('expedition', next);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'That could not be saved.' };
    }
    return { ok: true };
  }

  /** Record that a moment was shown (a camp improvement revealed, the intro). Idempotent. */
  markSeen(moment: string): void {
    const seen = this.store.current.snapshot.seen;
    if (seen.moments.includes(moment)) return;
    try {
      this.store.putDoc('seen', { ...seen, moments: [...seen.moments, moment].slice(-500) });
    } catch {
      // a moment not recorded only plays again; nothing is lost
    }
  }

  // Backup ----------------------------------------------------------------------------------

  exportFiles(app: string): { json: { filename: string; data: string }; csv: { filename: string; data: string } } {
    const now = this.clock.now();
    const s = this.store.current.snapshot;
    const name = backupFileName(now);
    return { json: { filename: name, data: exportJson(s, app, now) }, csv: { filename: name.replace('.json', '.csv'), data: exportCsv(s) } };
  }

  markBackedUp(): void {
    this.kvSet(BACKUP_KEY, this.today);
    this.emit();
  }

  prepareImport(text: string, app: string): PreparedImport {
    return prepareImport(this.store.current.snapshot, text, app, this.clock.now());
  }

  applyImport(incoming: Snapshot): void {
    this.store.replaceAll(incoming);
  }

  useConflictValue(date: DateKey, habit: HabitId, e: Entry): ActionResult {
    const fields: { v?: number; skip?: SkipReason } = {};
    if (e.v !== undefined) fields.v = e.v;
    if (e.skip !== undefined) fields.skip = e.skip;
    return this.correct(date, habit, fields);
  }

  // Internals -------------------------------------------------------------------------------

  private newId(): string {
    let s = 'h';
    for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    return s;
  }

  private loadCursor(): DayCursor {
    const now = this.clock.now();
    const fresh = startCursor(now, this.clock.zone(), 240);
    const raw = this.kvGet(CURSOR_KEY);
    if (!raw) return fresh;
    try {
      const c = JSON.parse(raw) as DayCursor;
      if (typeof c.date !== 'string' || typeof c.zone !== 'string') return fresh;
      // Never earlier than the stored day (a clock set back, westward travel).
      return compareDateKeys(fresh.date, c.date) < 0 ? { ...c, seen: Math.max(c.seen, now) } : c;
    } catch {
      return fresh;
    }
  }

  private saveCursor(): void {
    this.kvSet(CURSOR_KEY, JSON.stringify(this.cursor));
  }

  private kvGet(k: string): string | null {
    try {
      return this.kv?.get(k) ?? null;
    } catch {
      return null;
    }
  }

  private kvSet(k: string, v: string): void {
    try {
      this.kv?.set(k, v);
    } catch {
      // device storage is optional
    }
  }

  private emit(): void {
    const v = this.view();
    for (const l of this.listeners) l(v);
  }

  /** Days of this week up to today, for the week strip. */
  weekDays(): DateKey[] {
    const mon = weekStart(this.today);
    return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
  }
}
