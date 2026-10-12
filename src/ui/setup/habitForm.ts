/** The habit form, shared by first launch and Setup. */
import type { Habit, HabitVersion, Schedule } from '../../core/model/types';
import type { Definition } from '../../core/habits/versions';
import { h } from '../dom';
import { CATEGORIES } from '../format';

export interface HabitDraft {
  name: string;
  category: Habit['category'];
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

export class HabitForm {
  readonly el: HTMLFieldSetElement;
  private name: HTMLInputElement;
  private category: HTMLSelectElement;
  private type: HTMLSelectElement;
  private target: HTMLInputElement;
  private unit: HTMLInputElement;
  private minimum: HTMLInputElement;
  private kind: HTMLSelectElement;
  private n: HTMLInputElement;
  private days: HTMLInputElement[] = [];
  private amountRow: HTMLElement;
  private unitRow: HTMLElement;
  private daysRow: HTMLElement;
  private nRow: HTMLElement;

  constructor(legend: string, initial?: { name: string; category: Habit['category']; version: Pick<HabitVersion, 'type' | 'target' | 'minimum' | 'unit' | 'schedule'> }) {
    const p = `hf${++seq}`;
    const field = (id: string, label: string, control: HTMLElement, hint?: string): HTMLElement =>
      h('div', { class: 'field' }, h('label', { for: `${p}-${id}`, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);

    this.name = h('input', { id: `${p}-name`, type: 'text', maxlength: '80', autocomplete: 'off', required: true });
    this.category = h('select', { id: `${p}-category` }, ...CATEGORIES.map((c) => h('option', { value: c.id, text: c.label })));
    this.type = h(
      'select',
      { id: `${p}-type` },
      h('option', { value: 'binary', text: 'Yes or no' }),
      h('option', { value: 'numeric', text: 'A count (questions, pages, reps)' }),
      h('option', { value: 'duration', text: 'Minutes' }),
      h('option', { value: 'avoid', text: 'Something to avoid' }),
    );
    this.target = h('input', { id: `${p}-target`, type: 'number', min: '1', step: 'any', inputmode: 'decimal' });
    this.unit = h('input', { id: `${p}-unit`, type: 'text', maxlength: '24', placeholder: 'questions' });
    this.minimum = h('input', { id: `${p}-minimum`, type: 'number', min: '1', step: 'any', inputmode: 'decimal' });
    this.kind = h(
      'select',
      { id: `${p}-kind` },
      h('option', { value: 'daily', text: 'Every day' }),
      h('option', { value: 'weekdays', text: 'Chosen days' }),
      h('option', { value: 'perWeek', text: 'A number of times a week' }),
      h('option', { value: 'perMonth', text: 'A number of times a month' }),
    );
    this.n = h('input', { id: `${p}-n`, type: 'number', min: '1', max: '31', step: '1', inputmode: 'numeric' });

    const dayBoxes = h('div', { class: 'daybox', role: 'group', 'aria-labelledby': `${p}-dayslabel` });
    for (const [d, label] of DAYS) {
      const box = h('input', { type: 'checkbox', id: `${p}-d${d}`, value: String(d) });
      this.days.push(box);
      dayBoxes.append(h('label', { class: 'day', for: `${p}-d${d}` }, box, h('span', { text: label })));
    }

    this.amountRow = h('div', { class: 'pair' }, field('target', 'Daily target', this.target), field('minimum', 'Holds at', this.minimum, 'Below this, the day is only started.'));
    this.unitRow = field('unit', 'Unit', this.unit);
    this.daysRow = h('div', { class: 'field' }, h('span', { class: 'label', id: `${p}-dayslabel`, text: 'Days' }), dayBoxes);
    this.nRow = field('n', 'Times', this.n);

    this.el = h(
      'fieldset',
      { class: 'habit-form' },
      h('legend', { text: legend }),
      field('name', 'Name', this.name),
      field('type', 'Kind', this.type),
      this.amountRow,
      this.unitRow,
      field('kind', 'When', this.kind),
      this.daysRow,
      this.nRow,
      field('category', 'Scene', this.category, 'Which of Ari’s chores this habit becomes in the story.'),
    );

    this.type.addEventListener('change', () => this.sync());
    this.kind.addEventListener('change', () => this.sync());
    this.target.addEventListener('change', () => {
      if (!this.minimum.value && this.target.value) this.minimum.value = String(Number(this.target.value) / 2);
    });

    if (initial) {
      this.name.value = initial.name;
      this.category.value = initial.category;
      this.type.value = initial.version.type;
      this.target.value = String(initial.version.target);
      this.minimum.value = String(initial.version.minimum);
      this.unit.value = initial.version.unit ?? '';
      this.setSchedule(initial.version.schedule);
    } else {
      this.kind.value = 'daily';
      this.n.value = '3';
    }
    this.sync();
  }

  private setSchedule(s: Schedule): void {
    this.kind.value = s.kind;
    if (s.kind === 'weekdays') for (const b of this.days) b.checked = s.days.includes(Number(b.value));
    if (s.kind === 'perWeek' || s.kind === 'perMonth') this.n.value = String(s.n);
    else this.n.value = '3';
  }

  private sync(): void {
    const t = this.type.value;
    const amount = t === 'numeric' || t === 'duration';
    this.amountRow.hidden = !amount;
    this.unitRow.hidden = t !== 'numeric';
    this.daysRow.hidden = this.kind.value !== 'weekdays';
    this.nRow.hidden = this.kind.value !== 'perWeek' && this.kind.value !== 'perMonth';
    this.n.max = this.kind.value === 'perWeek' ? '7' : '31';
  }

  focus(): void {
    this.name.focus();
  }

  /** The draft, or a message naming the field to fix. */
  read(): { ok: true; draft: HabitDraft } | { ok: false; message: string; field: HTMLElement } {
    const name = this.name.value.trim();
    if (!name) return { ok: false, message: 'Give the habit a name.', field: this.name };
    const type = this.type.value as Definition['type'];
    let schedule: Schedule;
    switch (this.kind.value) {
      case 'weekdays': {
        const days = this.days.filter((b) => b.checked).map((b) => Number(b.value));
        if (days.length === 0) return { ok: false, message: 'Choose at least one day.', field: this.days[0] as HTMLElement };
        schedule = { kind: 'weekdays', days };
        break;
      }
      case 'perWeek':
      case 'perMonth': {
        const n = Number(this.n.value);
        const max = this.kind.value === 'perWeek' ? 7 : 31;
        if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, message: `Times must be a whole number from 1 to ${max}.`, field: this.n };
        schedule = { kind: this.kind.value, n };
        break;
      }
      default:
        schedule = { kind: 'daily' };
    }
    const definition: Definition = { type, target: 1, schedule };
    if (type === 'numeric' || type === 'duration') {
      const target = Number(this.target.value);
      if (!(target > 0)) return { ok: false, message: 'Set a daily target above 0.', field: this.target };
      const minimum = this.minimum.value ? Number(this.minimum.value) : target / 2;
      if (!(minimum > 0) || minimum > target) return { ok: false, message: 'The hold point must be above 0 and no more than the target.', field: this.minimum };
      definition.target = target;
      definition.minimum = minimum;
      if (type === 'numeric' && this.unit.value.trim()) definition.unit = this.unit.value.trim();
    }
    return { ok: true, draft: { name, category: this.category.value as Habit['category'], definition } };
  }
}
