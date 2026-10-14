/**
 * Setup: habits, settings, correct the record, backup and sync (build plan M8).
 * Rebuilt when opened or after a structural change; forms keep their own state meanwhile.
 */
import { compareDateKeys } from '../../core/model/date';
import { entryOn } from '../../core/model/entries';
import { latestDefinition, versionOn } from '../../core/habits/versions';
import type { DateKey, Habit, SkipReason, Snapshot } from '../../core/model/types';
import type { DryRun } from '../../data/backup/backup';
import type { ActionResult, Controller, View } from '../controller';
import { clear, h } from '../dom';
import { habitSummary, longDate, shortDate, SKIP_REASONS, skipLabel } from '../format';
import { HabitForm } from './habitForm';
import { tagOf } from '../../core/tags';
import { EXPEDITION_NAME_MAX } from '../../core/model/schemas';
import { markPicker } from '../../game/onboard';
import { labUnlocked, openLab } from '../lab';
import { askMotion, LIGHT_STYLES, setWorldPrefs, worldPrefs } from '../worldPrefs';

export interface Saver {
  /** Offer a file to the viewer. Resolves false when declined or unavailable. */
  save(filename: string, data: string): Promise<boolean>;
  available: boolean;
}

const STATUS_WORDS = { synced: 'Synced to your account', saving: 'Saving…', local: 'Saved on this device; syncs when it can', unsaved: 'Not saved yet' } as const;

export class SetupView {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private live: HTMLElement;
  private editing: string | null = null;
  private pendingImport: { incoming: Snapshot; summary: DryRun; safetyExport: string; safetyName: string; saved: boolean } | null = null;

  constructor(
    private readonly app: Controller,
    private readonly saver: Saver,
    private readonly appVersion: string,
  ) {
    this.body = h('div', { class: 'setup-body' });
    this.live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    this.root = h(
      'main',
      { class: 'setup', id: 'setup' },
      h('div', { class: 'setup-head' }, h('h1', { text: 'Setup' }), h('a', { class: 'btn ghost', href: '#home', text: 'Back to today' })),
      this.body,
      this.live,
    );
  }

  private say(r: ActionResult | string, ok = 'Saved.'): void {
    const text = typeof r === 'string' ? r : r.ok ? ok : r.message;
    this.live.textContent = text;
    const toast = this.root.querySelector('.toast');
    if (toast) toast.remove();
    const t = h('p', { class: `toast${typeof r !== 'string' && !r.ok ? ' bad' : ''}`, role: 'status', text });
    this.root.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  /** Report an action, and redraw when it changed the habit list. */
  private act(r: ActionResult, ok: string): void {
    this.say(r, ok);
    if (r.ok) this.render(this.app.view());
  }

  /** One part of Setup at a time (Living World plan F): habits, you and your day, data, about. */
  private part: Part = 'habits';

  render(v: View, section?: string): void {
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    if (section) this.part = PART_OF[section] ?? this.part;
    clear(this.body);
    const tabs = h('div', { class: 'pills setup-parts', role: 'group', 'aria-label': 'Setup sections' });
    for (const [id, label] of PARTS) {
      const b = h('button', { class: 'pill', type: 'button', 'aria-pressed': String(this.part === id) }, label);
      b.addEventListener('click', () => {
        this.part = id;
        this.render(this.app.view());
        (this.body.querySelector('.setup-parts [aria-pressed="true"]') as HTMLElement | null)?.focus();
      });
      tabs.append(b);
    }
    const parts: Record<Part, () => HTMLElement[]> = {
      habits: () => [this.habits(v), this.water(v)],
      you: () => [this.expedition(v), this.settings(v)],
      data: () => [this.correct(v), this.backup(v), this.sync(v)],
      about: () => [this.about()],
    };
    this.body.append(tabs, ...parts[this.part]());
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
    if (focusId) document.getElementById(focusId)?.focus();
  }

  /** The version, and, once asked for, the Environment Lab (a preview tool; it never writes). */
  private about(): HTMLElement {
    const ver = h('button', { class: 'linklike', type: 'button', text: `Ascent ${this.appVersion}` });
    let taps = 0;
    ver.addEventListener('click', () => {
      if (++taps >= 5) {
        labUnlocked(true);
        this.say('Environment Lab unlocked on this device.');
        this.render(this.app.view());
      }
    });
    const lab = labUnlocked()
      ? h('div', { class: 'field' }, h('a', { class: 'btn', href: '#today', onclick: () => openLab() }, 'Open the Environment Lab'), h('p', { class: 'hint', text: 'Previews light, time and weather over the camp. It never changes your record, the story or the climb.' }))
      : null;
    const credits = h(
      'div',
      { class: 'field' },
      h('span', { class: 'label', text: 'Credits' }),
      h('p', { class: 'hint', text: 'Pines and bushes near camp: Quaternius, Ultimate Nature Pack (CC0, public domain).' }),
    );
    return section('setup-about', 'About', null, h('p', {}, ver), h('p', { class: 'hint', text: 'Your record lives on your account and on this device. Backups are in Data.' }), credits, lab);
  }

  // Habits ---------------------------------------------------------------------------------

  private habits(v: View): HTMLElement {
    const list = h('ul', { class: 'setup-list' });
    for (const hb of v.snapshot.habits.habits) {
      if (hb.system) continue; // the water bar has its own section
      const archived = versionOn(hb, v.today)?.archived === true || (hb.archivedFrom !== undefined && compareDateKeys(hb.archivedFrom, v.today) <= 0);
      const li = h('li', { class: `setup-habit${archived ? ' archived' : ''}` });
      const def = latestDefinition(hb);
      li.append(
        h('div', { class: 'sh-text' }, h('span', { class: 'name' }, tagSwatch(hb), hb.name), h('span', { class: 'meta', text: `${habitSummary(def)}${hb.archivedFrom ? ` · archived from ${shortDate(hb.archivedFrom)}` : ''}` })),
      );
      const actions = h('div', { class: 'row-actions' });
      if (this.editing === hb.id) {
        const form = new HabitForm(`Edit ${hb.name}`, { name: hb.name, version: def, ...(hb.tag ? { tag: hb.tag } : {}) });
        const save = h('button', { class: 'btn primary', text: 'Save changes' });
        const cancel = h('button', { class: 'btn ghost', text: 'Cancel' });
        save.addEventListener('click', () => {
          const r = form.read();
          if (!r.ok) {
            this.say(r.message);
            r.field.focus();
            return;
          }
          let res = this.app.editHabit(hb.id, r.draft.name, r.draft.definition);
          if (res.ok && (hb.tag?.family !== r.draft.tag.family || hb.tag?.group !== r.draft.tag.group)) res = this.app.retag(hb.id, r.draft.tag);
          this.say(res, 'Saved. Changes to the target or schedule apply from today; past days keep their rules.');
          if (res.ok) {
            this.editing = null;
            this.render(this.app.view());
          }
        });
        cancel.addEventListener('click', () => {
          this.editing = null;
          this.render(this.app.view());
        });
        li.append(form.el, h('div', { class: 'row-actions' }, save, cancel));
        list.append(li);
        queueMicrotask(() => form.focus());
        continue;
      }
      if (!hb.archivedFrom) {
        actions.append(
          h('button', { class: 'btn', onclick: () => ((this.editing = hb.id), this.render(this.app.view())), 'aria-label': `Edit ${hb.name}` }, 'Edit'),
          h('button', { class: 'btn ghost', onclick: () => this.act(this.app.archive(hb.id), `${hb.name} archived from tomorrow. Its history stays.`), 'aria-label': `Archive ${hb.name}` }, 'Archive'),
        );
      } else {
        actions.append(h('button', { class: 'btn', onclick: () => this.act(this.app.restore(hb.id), `${hb.name} is back from today.`), 'aria-label': `Restore ${hb.name}` }, 'Restore'));
        actions.append(this.deleteControl(hb));
      }
      li.append(actions);
      list.append(li);
    }
    const add = new HabitForm('Add a habit');
    const addBtn = h('button', { class: 'btn primary', text: 'Add habit' });
    addBtn.addEventListener('click', () => {
      const r = add.read();
      if (!r.ok) {
        this.say(r.message);
        r.field.focus();
        return;
      }
      const res = this.app.addHabit(r.draft.name, r.draft.definition, r.draft.tag);
      this.say(res, `${r.draft.name} added. It starts today.`);
      if (res.ok) this.render(this.app.view());
    });
    const addWrap = h('details', { class: 'add' }, h('summary', { text: 'Add a habit' }), add.el, h('div', { class: 'row-actions' }, addBtn));
    return section('setup-habits', 'Habits', 'A new habit starts today. Changing a target or schedule applies from today; past days keep the rules they had.', list, addWrap);
  }

  private deleteControl(hb: Habit): HTMLElement {
    const id = `del-${hb.id}`;
    const input = h('input', { id, type: 'text', autocomplete: 'off', placeholder: hb.name });
    const btn = h('button', { class: 'btn danger', text: 'Delete for good' });
    btn.addEventListener('click', () => {
      const r = this.app.remove(hb.id, input.value);
      this.say(r, `${hb.name} and its history are deleted.`);
      if (r.ok) this.render(this.app.view());
    });
    return h('details', { class: 'danger-zone' }, h('summary', { text: 'Delete' }), h('label', { for: id, text: `Type ${hb.name} to delete it and all its history. This cannot be undone.` }), input, btn);
  }

  // Water ----------------------------------------------------------------------------------

  private water(v: View): HTMLElement {
    const w = v.derived.water;
    if (!w) return section('setup-water', 'Water', 'The water bar appears once setup is finished.');
    const input = h('input', { id: 'water-target', type: 'number', min: '1', max: '30', step: '1', inputmode: 'numeric' });
    input.value = String(w.target);
    const save = h('button', { class: 'btn primary', text: 'Save' });
    save.addEventListener('click', () => this.say(this.app.setWaterTarget(Number(input.value)), 'Water goal saved from today.'));
    return section(
      'setup-water',
      'Water',
      'Every climber carries water. It has its own bar and streak, and keeps Ari strong; it never moves the story day or the climb.',
      h('div', { class: 'field' }, h('label', { for: 'water-target', text: 'Glasses a day (one glass is about 250 ml)' }), input),
      h('p', { class: 'hint', text: 'While Ascent is open, the bar reminds you when two hours pass without a glass. It cannot notify you while closed.' }),
      h('div', { class: 'row-actions' }, save),
    );
  }

  // Your expedition -------------------------------------------------------------------------

  private expedition(v: View): HTMLElement {
    const ex = v.snapshot.expedition;
    if (!v.snapshot.profile) return section('setup-expedition', 'Your expedition', 'Finish the first setup to choose a mark.');
    const pick = markPicker({ ...(ex.symbol ? { symbol: ex.symbol } : {}), ...(ex.accent ? { accent: ex.accent } : {}) });
    const name = h('input', { id: 'set-exp-name', type: 'text', maxlength: String(EXPEDITION_NAME_MAX), placeholder: 'The long winter', autocomplete: 'off' });
    name.value = ex.name ?? '';
    const save = h('button', { class: 'btn primary', text: 'Save mark' });
    save.addEventListener('click', () => {
      const m = pick.value();
      this.say(this.app.saveExpedition({ name: name.value, symbol: m.symbol ?? null, accent: m.accent ?? null }), 'Saved. Ari repaints the flag tonight.');
    });
    const clearMark = h('button', { class: 'btn ghost', text: 'No mark' });
    clearMark.addEventListener('click', () => this.act(this.app.saveExpedition({ symbol: null, accent: null }), 'Mark removed.'));
    const replay = h('a', { class: 'btn ghost', href: '#today', text: 'Watch the opening again' });
    replay.addEventListener('click', () => this.app.saveExpedition({ introOn: null }));
    return section(
      'setup-expedition',
      'Your expedition',
      'Optional. Ari carries your mark on the flag and the pack, and carves it at camp.',
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Mark and colour' }), pick.el),
      h('div', { class: 'field' }, h('label', { for: 'set-exp-name', text: 'Expedition name (optional)' }), name),
      h('div', { class: 'row-actions' }, save, clearMark, replay),
    );
  }

  // Settings -------------------------------------------------------------------------------

  private settings(v: View): HTMLElement {
    const p = v.snapshot.profile;
    if (!p) return section('setup-settings', 'Settings', 'Finish the first setup to change settings.');
    const identity = h('textarea', { id: 'set-identity', rows: '2', maxlength: '200' });
    identity.value = p.identity;
    const boundary = h('input', { id: 'set-boundary', type: 'time', step: '900' });
    const b = p.settings.dayBoundary;
    boundary.value = `${String(Math.floor(b / 60)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}`;
    const check = (id: string, label: string, on: boolean): [HTMLElement, HTMLInputElement] => {
      const box = h('input', { id, type: 'checkbox' });
      box.checked = on;
      return [h('label', { class: 'check', for: id }, box, h('span', { text: label })), box];
    };
    const [soundRow, sound] = check('set-sound', 'Sound', p.settings.sound);
    const [musicRow, music] = check('set-music', 'Music', p.settings.music);
    const [motionRow, motion] = check('set-motion', 'Reduce motion (stills and fades instead of camera moves)', p.settings.reducedMotion);
    const save = h('button', { class: 'btn primary', text: 'Save settings' });
    save.addEventListener('click', () => {
      const [hh, mm] = boundary.value.split(':').map(Number);
      const minutes = (hh ?? 4) * 60 + (mm ?? 0);
      this.say(this.app.saveProfile({ identity: identity.value, dayBoundary: minutes, sound: sound.checked, music: music.checked, reducedMotion: motion.checked }), 'Settings saved.');
    });
    return section(
      'setup-settings',
      'Settings',
      null,
      h('div', { class: 'field' }, h('label', { for: 'set-identity', text: 'Who you are becoming' }), identity),
      h('div', { class: 'field' }, h('label', { for: 'set-boundary', text: 'A day ends at' }), boundary, h('p', { class: 'hint', text: 'Ticks before this time count for the day before. Night shift? Set it later.' })),
      soundRow,
      musicRow,
      motionRow,
      h('p', { class: 'hint', text: `Time zone: ${p.settings.timeZone}. Each day keeps the zone it began in.` }),
      h('div', { class: 'row-actions' }, save),
      this.worldChoices(),
    );
  }

  /** The world's per-device choices: they apply at once and stay on this device only. */
  private worldChoices(): HTMLElement {
    const prefs = worldPrefs();
    const lights = h('div', { class: 'choice-row', role: 'radiogroup', 'aria-label': "Ari's light after dark" });
    for (const [value, label] of LIGHT_STYLES) {
      const r = h('input', { type: 'radio', name: 'set-light', id: `set-light-${value}`, value });
      r.checked = prefs.light === value;
      r.addEventListener('change', () => r.checked && setWorldPrefs({ light: value }));
      lights.append(h('label', { class: 'check', for: `set-light-${value}` }, r, h('span', { text: label })));
    }
    const box = h('input', { id: 'set-shake', type: 'checkbox' });
    box.checked = prefs.shake;
    const note = h('p', { class: 'hint', role: 'status', text: 'Shaking the phone swirls the snow or the petals, gusts the trees and swings her lantern. It never changes anything you logged.' });
    box.addEventListener('change', () => {
      if (!box.checked) return setWorldPrefs({ shake: false });
      void askMotion().then((ok) => {
        box.checked = ok;
        setWorldPrefs({ shake: ok });
        if (!ok) note.textContent = 'This browser did not allow the motion sensors here, so shaking stays off.';
      });
    });
    return h(
      'fieldset',
      { class: 'field world-choices' },
      h('legend', { class: 'label', text: 'The world (this device)' }),
      h('span', { class: 'hint', text: "Ari's light after dark" }),
      lights,
      h('label', { class: 'check', for: 'set-shake' }, box, h('span', { text: 'Shake the phone to stir the world' })),
      note,
      h('a', { class: 'btn', href: '#today', onclick: () => openLab() }, 'Preview time, season and weather'),
      h('p', { class: 'hint', text: 'Sliders for the time of day, the season, the weather and the moon, over the camp. A preview: it never changes your record.' }),
    );
  }

  // Correct the record ---------------------------------------------------------------------

  private correct(v: View): HTMLElement {
    const date = h('input', { id: 'fix-date', type: 'date', max: v.today });
    const habit = h('select', { id: 'fix-habit' }, ...v.snapshot.habits.habits.map((x) => h('option', { value: x.id, text: x.name })));

    const what = h(
      'select',
      { id: 'fix-what' },
      h('option', { value: 'value', text: 'Set a value' }),
      ...SKIP_REASONS.map((r) => h('option', { value: `skip:${String(r.reason)}`, text: r.label })),
      h('option', { value: 'clear', text: 'Nothing logged' }),
    );
    const value = h('input', { id: 'fix-value', type: 'number', min: '0', step: 'any', inputmode: 'decimal' });
    const now = h('p', { class: 'hint', role: 'status' });
    const showCurrent = (): void => {
      if (!date.value || !habit.value) {
        now.textContent = 'Choose a date and a habit.';
        return;
      }
      const e = entryOn(this.app.view().snapshot, date.value as DateKey, habit.value);
      now.textContent = `Now: ${e ? (e.skip !== undefined ? skipLabel(e.skip) : String(e.v)) : 'nothing logged'}.`;
    };
    date.addEventListener('change', showCurrent);
    habit.addEventListener('change', showCurrent);
    what.addEventListener('change', () => (value.disabled = what.value !== 'value'));
    const apply = h('button', { class: 'btn primary', text: 'Correct the record' });
    apply.addEventListener('click', () => {
      if (!date.value) return this.say('Choose a date.');
      let fields: { v?: number; skip?: SkipReason } | null;
      if (what.value === 'value') {
        const n = Number(value.value);
        if (value.value === '' || !Number.isFinite(n) || n < 0) return this.say('Enter a value from 0 up.');
        fields = { v: n };
      } else if (what.value === 'clear') fields = null;
      else {
        const raw = what.value.slice(5);
        fields = { skip: (raw === 'true' ? true : raw) as SkipReason };
      }
      const r = this.app.correct(date.value as DateKey, habit.value, fields);
      this.say(r, `Corrected ${longDate(date.value as DateKey)}. Everything is recalculated; no scene replays.`);
      showCurrent();
    });
    const log = v.snapshot.corrections.log.slice(-8).reverse();
    const names = new Map(v.snapshot.habits.habits.map((x) => [x.id, x.name]));
    return section(
      'setup-correct',
      'Correct the record',
      'For days older than the last four. Every correction is kept in a log.',
      h('div', { class: 'pair' }, h('div', { class: 'field' }, h('label', { for: 'fix-date', text: 'Date' }), date), h('div', { class: 'field' }, h('label', { for: 'fix-habit', text: 'Habit' }), habit)),
      h('div', { class: 'pair' }, h('div', { class: 'field' }, h('label', { for: 'fix-what', text: 'Change to' }), what), h('div', { class: 'field' }, h('label', { for: 'fix-value', text: 'Value' }), value)),
      now,
      h('div', { class: 'row-actions' }, apply),
      log.length
        ? h(
            'ul',
            { class: 'log' },
            ...log.map((c) => h('li', { text: `${shortDate(c.date)} · ${names.get(c.habit) ?? 'deleted habit'}: ${entryText(c.old)} → ${entryText(c.new)}` })),
          )
        : null,
    );
  }

  // Backup ---------------------------------------------------------------------------------

  private backup(_v: View): HTMLElement {
    const files = (): ReturnType<Controller['exportFiles']> => this.app.exportFiles(this.appVersion);
    const json = h('button', { class: 'btn primary', text: 'Save a backup' });
    json.addEventListener('click', async () => {
      const f = files().json;
      const ok = await this.saver.save(f.filename, f.data);
      if (ok) this.app.markBackedUp();
      this.say(ok ? `Saved ${f.filename}.` : 'Not saved.');
    });
    const csv = h('button', { class: 'btn', text: 'Save the log as CSV' });
    csv.addEventListener('click', async () => {
      const f = files().csv;
      this.say((await this.saver.save(f.filename, f.data)) ? `Saved ${f.filename}.` : 'Not saved.');
    });

    const file = h('input', { id: 'import-file', type: 'file', accept: '.json,application/json' });
    const result = h('div', { class: 'import-result' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const r = this.app.prepareImport(await f.text(), this.appVersion);
      if (!r.ok) {
        this.pendingImport = null;
        result.replaceChildren(h('p', { class: 'bad', role: 'alert', text: r.error }));
        return;
      }
      this.pendingImport = { ...r, saved: false };
      this.showImport(result);
    });
    if (this.pendingImport) this.showImport(result);

    return section(
      'setup-backup',
      'Backup',
      'A backup is one file with your whole record. Keep a few, somewhere other than this phone.',
      this.saver.available ? null : h('p', { class: 'hint', text: 'Saving files is not available in this view.' }),
      h('div', { class: 'row-actions' }, json, csv),
      h('div', { class: 'field' }, h('label', { for: 'import-file', text: 'Restore from a backup' }), file),
      result,
    );
  }

  private showImport(el: HTMLElement): void {
    const p = this.pendingImport;
    if (!p) return;
    const s = p.summary;
    const c = s.changes;
    const lines = [
      `${s.habits} habit${s.habits === 1 ? '' : 's'}, ${s.entries} entries over ${s.days} days${s.range ? `, ${shortDate(s.range.from)} to ${shortDate(s.range.to)}` : ''}.`,
      `Compared with now: ${c.entriesAdded} added, ${c.entriesChanged} changed, ${c.entriesRemoved} removed.`,
      c.habitsAdded.length ? `Habits added: ${c.habitsAdded.join(', ')}.` : null,
      c.habitsRemoved.length ? `Habits removed: ${c.habitsRemoved.join(', ')}.` : null,
      c.settingsChanged ? 'Settings will change.' : null,
      s.migrated.length ? 'Older format: it will be updated as it loads.' : null,
    ].filter((x): x is string => x !== null);
    const saveFirst = h('button', { class: 'btn', text: p.saved ? 'Current data saved' : 'Save current data first' });
    saveFirst.disabled = p.saved;
    const confirmId = 'import-confirm';
    const confirm = h('input', { id: confirmId, type: 'checkbox' });
    const replace = h('button', { class: 'btn danger', text: 'Replace with this backup' });
    const refresh = (): void => {
      replace.disabled = !(p.saved || confirm.checked);
    };
    saveFirst.addEventListener('click', async () => {
      p.saved = await this.saver.save(p.safetyName, p.safetyExport);
      saveFirst.textContent = p.saved ? 'Current data saved' : 'Not saved. Try again';
      saveFirst.disabled = p.saved;
      refresh();
    });
    confirm.addEventListener('change', refresh);
    replace.addEventListener('click', () => {
      this.app.applyImport(p.incoming);
      this.pendingImport = null;
      this.say('Restored from the backup.');
      this.render(this.app.view());
    });
    refresh();
    el.replaceChildren(
      h('div', { class: 'dry-run', role: 'region', 'aria-label': 'What this backup would change' }, h('p', { class: 'b-title', text: 'Nothing has changed yet' }), ...lines.map((l) => h('p', { text: l }))),
      h('div', { class: 'row-actions' }, saveFirst),
      h('label', { class: 'check', for: confirmId }, confirm, h('span', { text: 'I have a copy of my current data, or I do not need one' })),
      h('div', { class: 'row-actions' }, replace),
    );
  }

  // Sync -----------------------------------------------------------------------------------

  private sync(v: View): HTMLElement {
    const st = v.store;
    const names = new Map(v.snapshot.habits.habits.map((x) => [x.id, x.name]));
    return section(
      'setup-sync',
      'Sync',
      null,
      h('p', { class: `sync-line s-${st.status}`, text: st.offline ? 'Offline: showing the last synced copy' : STATUS_WORDS[st.status] }),
      h('p', { class: 'hint', text: `This device: ${this.app.dev}` }),
      st.conflicts.length
        ? h(
            'div',
            { class: 'conflicts' },
            h('h3', { text: 'Two devices disagreed' }),
            ...st.conflicts.map((c) =>
              h(
                'div',
                { class: 'conflict' },
                h('p', { text: `${shortDate(c.date)} · ${names.get(c.habit) ?? c.habit}: kept ${entryText(c.kept)}, the other device had ${entryText(c.lost)}.` }),
                h('button', { class: 'btn', onclick: () => this.act(this.app.useConflictValue(c.date, c.habit, c.lost), 'Using the other value.') }, 'Use the other value'),
              ),
            ),
          )
        : null,
      st.problems.length ? h('div', { class: 'problems' }, h('h3', { text: 'Set aside' }), ...st.problems.map((p) => h('p', { text: `${p.doc}: ${p.error}` })), h('p', { class: 'hint', text: 'Restore from a backup to replace these.' })) : null,
      st.rejected.length ? h('div', { class: 'problems' }, h('h3', { text: 'Refused by your account' }), ...st.rejected.map((o) => h('p', { text: o.kind === 'entry' ? `${o.date} ${names.get(o.habit) ?? o.habit}` : o.doc }))) : null,
    );
  }
}

function entryText(e: { v?: number; skip?: SkipReason } | null): string {
  if (!e) return 'nothing';
  if (e.skip !== undefined) return skipLabel(e.skip).toLowerCase();
  return e.v === undefined ? 'nothing' : String(e.v);
}

type Part = 'habits' | 'you' | 'data' | 'about';
const PARTS: Array<[Part, string]> = [
  ['habits', 'Habits'],
  ['you', 'You & day'],
  ['data', 'Data'],
  ['about', 'About'],
];
const PART_OF: Record<string, Part> = {
  'setup-habits': 'habits',
  'setup-water': 'habits',
  'setup-expedition': 'you',
  'setup-settings': 'you',
  'setup-correct': 'data',
  'setup-backup': 'data',
  'setup-sync': 'data',
  'setup-about': 'about',
};

function section(id: string, title: string, intro: string | null, ...children: Array<HTMLElement | null>): HTMLElement {
  return h('section', { class: 'card', id, 'aria-labelledby': `${id}-h` }, h('h2', { id: `${id}-h`, text: title }), intro ? h('p', { class: 'intro', text: intro }) : null, ...children);
}

function tagSwatch(hb: Habit): HTMLElement {
  const d = h('span', { class: 'tag-dot', 'aria-hidden': 'true' });
  d.style.background = tagOf(hb).family.color;
  return d;
}
