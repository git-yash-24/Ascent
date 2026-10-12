/**
 * The habit form, shared by first launch and Setup. It follows SMART and asks only what it must:
 *   Specific     what will you do
 *   Measurable   done or not, a number (with its unit), minutes, or something to avoid
 *   Achievable   how many; the hold point is set to half automatically
 *   Time-bound   how often (every day, set days, times a week) and an optional set time
 * Which of Ari's chores it becomes is chosen by the story, never asked.
 */
import type { HabitVersion, Schedule } from '../../core/model/types';
import type { Definition } from '../../core/habits/versions';
import { h } from '../dom';

export interface HabitDraft {
  name: string;
  definition: Definition;
}

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
] as const;

let seq = 0;

type Measure = 'binary' | 'numeric' | 'duration' | 'avoid';
type Often = 'daily' | 'weekdays' | 'perWeek' | 'perMonth';

export class HabitForm {
  readonly el: HTMLFieldSetElement;
  private name: HTMLInputElement;
  private measure: Record<Measure, HTMLInputElement>;
  private often: Partial<Record<Often, HTMLInputElement>>;
  private target: HTMLInputElement;
  private unit: HTMLInputElement;
  private n: HTMLInputElement;
  private time: HTMLInputElement;
  private days: HTMLInputElement[] = [];
  private amountRow: HTMLElement;
  private unitField: HTMLElement;
  private daysRow: HTMLElement;
  private nRow: HTMLElement;
  private holdNote: HTMLElement;
  private targetLabel: HTMLElement;
  /** Kept from an edited habit: the hold point is not asked, but an existing one is kept. */
  private keptMinimum: { target: number; minimum: number } | null = null;

  constructor(legend: string, initial?: { name: string; version: Pick<HabitVersion, 'type' | 'target' | 'minimum' | 'unit' | 'schedule' | 'time'> }) {
    const p = `hf${++seq}`;
    const radios = <K extends string>(name: string, label: string, opts: Array<[K, string]>): [HTMLElement, Record<K, HTMLInputElement>] => {
      const map = {} as Record<K, HTMLInputElement>;
      const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `${p}-${name}-l` });
      for (const [value, text] of opts) {
        const id = `${p}-${name}-${value}`;
        const input = h('input', { type: 'radio', name: `${p}-${name}`, id, value });
        map[value] = input;
        group.append(h('label', { class: 'seg-opt', for: id }, input, h('span', { text })));
      }
      return [h('div', { class: 'field' }, h('span', { class: 'label', id: `${p}-${name}-l`, text: label }), group), map];
    };

    this.name = h('input', { id: `${p}-name`, type: 'text', maxlength: '80', autocomplete: 'off', required: true, placeholder: 'Qbank questions' });
    const [measureField, measure] = radios<Measure>('measure', 'How will you measure it?', [
      ['binary', 'Done or not'],
      ['numeric', 'A number'],
      ['duration', 'Minutes'],
      ['avoid', 'Avoid it'],
    ]);
    this.measure = measure;
    const oftenOpts: Array<[Often, string]> = [
      ['daily', 'Every day'],
      ['weekdays', 'On set days'],
      ['perWeek', 'Times a week'],
    ];
    if (initial?.version.schedule.kind === 'perMonth') oftenOpts.push(['perMonth', 'Times a month']);
    const [oftenField, often] = radios<Often>('often', 'How often?', oftenOpts);
    this.often = often;

    this.target = h('input', { id: `${p}-target`, type: 'number', min: '1', step: 'any', inputmode: 'decimal' });
    this.unit = h('input', { id: `${p}-unit`, type: 'text', maxlength: '24', placeholder: 'questions' });
    this.n = h('input', { id: `${p}-n`, type: 'number', min: '1', max: '7', step: '1', inputmode: 'numeric' });
    this.time = h('input', { id: `${p}-time`, type: 'time' });
    this.holdNote = h('p', { class: 'hint' });
    this.targetLabel = h('label', { for: `${p}-target`, text: 'How many each day?' });

    const dayBoxes = h('div', { class: 'daybox', role: 'group', 'aria-labelledby': `${p}-dayslabel` });
    for (const [d, label] of DAYS) {
      const box = h('input', { type: 'checkbox', id: `${p}-d${d}`, value: String(d) });
      this.days.push(box);
      dayBoxes.append(h('label', { class: 'day', for: `${p}-d${d}` }, box, h('span', { text: label })));
    }

    this.unitField = h('div', { class: 'field' }, h('label', { for: `${p}-unit`, text: 'Of what?' }), this.unit);
    this.amountRow = h('div', { class: 'amount-block' }, h('div', { class: 'pair' }, h('div', { class: 'field' }, this.targetLabel, this.target), this.unitField), this.holdNote);
    this.daysRow = h('div', { class: 'field' }, h('span', { class: 'label', id: `${p}-dayslabel`, text: 'Which days?' }), dayBoxes);
    this.nRow = h('div', { class: 'field' }, h('label', { for: `${p}-n`, text: 'How many times?' }), this.n);

    this.el = h(
      'fieldset',
      { class: 'habit-form' },
      h('legend', { text: legend }),
      h('div', { class: 'field' }, h('label', { for: `${p}-name`, text: 'What will you do?' }), this.name),
      measureField,
      this.amountRow,
      oftenField,
      this.daysRow,
      this.nRow,
      h('div', { class: 'field' }, h('label', { for: `${p}-time`, text: 'At a set time? (optional)' }), this.time),
    );

    for (const r of Object.values<HTMLInputElement>(measure)) r.addEventListener('change', () => this.sync());
    for (const r of Object.values(often)) r?.addEventListener('change', () => this.sync());
    this.target.addEventListener('input', () => this.sync());

    if (initial) {
      const v = initial.version;
      this.name.value = initial.name;
      measure[v.type].checked = true;
      this.target.value = String(v.target);
      this.unit.value = v.unit ?? '';
      if (v.type === 'numeric' || v.type === 'duration') this.keptMinimum = { target: v.target, minimum: v.minimum };
      const s = v.schedule;
      const o = often[s.kind];
      if (o) o.checked = true;
      if (s.kind === 'weekdays') for (const b of this.days) b.checked = s.days.includes(Number(b.value));
      this.n.value = s.kind === 'perWeek' || s.kind === 'perMonth' ? String(s.n) : '3';
      this.time.value = v.time ?? '';
    } else {
      measure.binary.checked = true;
      (often.daily as HTMLInputElement).checked = true;
      this.n.value = '3';
    }
    this.sync();
  }

  private measureValue(): Measure {
    return (Object.entries(this.measure).find(([, r]) => r.checked)?.[0] as Measure | undefined) ?? 'binary';
  }

  private oftenValue(): Often {
    return (Object.entries(this.often).find(([, r]) => r?.checked)?.[0] as Often | undefined) ?? 'daily';
  }

  private minimumFor(target: number): number {
    if (this.keptMinimum && this.keptMinimum.target === target) return this.keptMinimum.minimum;
    return target / 2;
  }

  private sync(): void {
    const m = this.measureValue();
    const amount = m === 'numeric' || m === 'duration';
    this.amountRow.hidden = !amount;
    this.unitField.hidden = m !== 'numeric';
    this.targetLabel.textContent = m === 'duration' ? 'How many minutes each day?' : 'How many each day?';
    const o = this.oftenValue();
    this.daysRow.hidden = o !== 'weekdays';
    this.nRow.hidden = o !== 'perWeek' && o !== 'perMonth';
    this.n.max = o === 'perMonth' ? '31' : '7';
    const t = Number(this.target.value);
    this.holdNote.textContent = t > 0 ? `A day counts as held from ${round(this.minimumFor(t))}, done at ${round(t)}.` : '';
  }

  focus(): void {
    this.name.focus();
  }

  /** The draft, or a message naming the field to fix. */
  read(): { ok: true; draft: HabitDraft } | { ok: false; message: string; field: HTMLElement } {
    const name = this.name.value.trim();
    if (!name) return { ok: false, message: 'Say what you will do.', field: this.name };
    const type = this.measureValue();
    let schedule: Schedule;
    const o = this.oftenValue();
    if (o === 'weekdays') {
      const days = this.days.filter((b) => b.checked).map((b) => Number(b.value));
      if (days.length === 0) return { ok: false, message: 'Choose at least one day.', field: this.days[0] as HTMLElement };
      schedule = { kind: 'weekdays', days };
    } else if (o === 'perWeek' || o === 'perMonth') {
      const n = Number(this.n.value);
      const max = o === 'perWeek' ? 7 : 31;
      if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, message: `Times must be a whole number from 1 to ${max}.`, field: this.n };
      schedule = { kind: o, n };
    } else schedule = { kind: 'daily' };

    const definition: Definition = { type, target: 1, schedule };
    if (type === 'numeric' || type === 'duration') {
      const target = Number(this.target.value);
      if (!(target > 0)) return { ok: false, message: 'Set how many, above 0.', field: this.target };
      if (type === 'numeric' && !this.unit.value.trim()) return { ok: false, message: 'Say what you are counting, like questions or pages.', field: this.unit };
      definition.target = target;
      definition.minimum = this.minimumFor(target);
      if (type === 'numeric') definition.unit = this.unit.value.trim();
    }
    if (this.time.value) definition.time = this.time.value;
    return { ok: true, draft: { name, definition } };
  }
}

function round(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
