/** Small shared pieces for the game screens. */
import type { HabitVersion, SkipReason } from '../core/model/types';
import type { TagFamily } from '../core/tags';
import { h } from '../ui/dom';
import { SKIP_REASONS, unitOf } from '../ui/format';

/** A horizontal bar, 0 to 1, in a family colour (or the ember). */
export function bar(value: number | null, color = 'var(--ember)', label?: string): HTMLElement {
  const fill = h('span', { class: 'g-bar-fill' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
  fill.style.background = color;
  const el = h('span', { class: 'g-bar', role: label ? 'meter' : null, 'aria-label': label ?? null, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((value ?? 0) * 100)) }, fill);
  if (!label) el.setAttribute('aria-hidden', 'true');
  return el;
}

/** The week gauge with its hold, climb and summit marks. */
export function weekGauge(score: number, bar: number, marks: Array<{ at: number; label: string }>, text: string): HTMLElement {
  const fill = h('span', { class: 'g-bar-fill week' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  const track = h('span', { class: 'g-bar tall', role: 'meter', 'aria-label': 'This week', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(score * 100)), 'aria-valuetext': text }, fill);
  for (const m of marks) {
    const t = h('span', { class: `g-mark${m.at === bar ? ' bar' : ''}`, title: `${Math.round(m.at * 100)}% ${m.label}` });
    t.style.left = `${m.at * 100}%`;
    track.append(t);
  }
  return track;
}

export function dot(f: TagFamily): HTMLElement {
  const d = h('span', { class: 'tag-dot', 'aria-hidden': 'true' });
  d.style.background = f.color;
  return d;
}

export function section(title: string, ...body: Array<Node | null>): HTMLElement {
  return h('section', { class: 'g-sec' }, h('h3', { class: 'g-sec-h', text: title }), ...body);
}

export function tiny(label: string, value: string): HTMLElement {
  return h('div', { class: 'g-stat' }, h('span', { class: 'g-stat-v', text: value }), h('span', { class: 'g-stat-l', text: label }));
}

export type OptionChoice = { kind: 'attempt'; amount?: number } | { kind: 'skip'; reason: SkipReason } | { kind: 'clear' } | { kind: 'done' };

/**
 * The hold menu: attempted (with an amount for counted habits), the rest options, clear.
 * One dialog reused for every habit; focus returns to the chip that opened it.
 */
export class OptionsSheet {
  readonly el: HTMLDialogElement;
  private resolve: ((c: OptionChoice | null) => void) | null = null;
  private opener: HTMLElement | null = null;

  constructor() {
    this.el = h('dialog', { class: 'opts', 'aria-labelledby': 'opts-title' });
    this.el.addEventListener('close', () => this.finish(null));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(opts: { name: string; family: TagFamily; ver: HabitVersion; current?: number; opener: HTMLElement }): Promise<OptionChoice | null> {
    this.finish(null);
    this.opener = opts.opener;
    const { ver } = opts;
    const counted = ver.type === 'numeric' || ver.type === 'duration';
    const unit = unitOf(ver);
    const choose = (c: OptionChoice) => () => this.finish(c);
    const title = h('h2', { id: 'opts-title', class: 'opts-title' }, dot(opts.family), opts.name);
    const parts: Node[] = [title];

    if (counted) {
      const input = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', class: 'opts-amount', 'aria-label': `${opts.name}, ${unit || 'amount'}` });
      input.value = opts.current !== undefined && opts.current > 0 ? String(opts.current) : '';
      input.placeholder = String(Math.round(ver.minimum));
      const save = (): void => {
        const n = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(n) || n < 0) {
          input.focus();
          return;
        }
        this.finish({ kind: 'attempt', amount: n });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      });
      parts.push(
        h('p', { class: 'opts-hint', text: `How much? Target ${ver.target}${unit ? ` ${unit}` : ''}, hold point ${ver.minimum}.` }),
        h('div', { class: 'opts-row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save amount')),
      );
    } else {
      parts.push(h('div', { class: 'opts-row' }, h('button', { class: 'btn opt-attempt', type: 'button', onclick: choose({ kind: 'attempt' }) }, 'Attempted')));
    }
    const rests = h('div', { class: 'opts-grid', role: 'group', 'aria-label': 'Rest options' });
    for (const r of SKIP_REASONS) {
      rests.append(h('button', { class: `opt opt-${r.reason === true ? 'skip' : r.reason}`, type: 'button', onclick: choose({ kind: 'skip', reason: r.reason }) }, r.label));
    }
    parts.push(h('p', { class: 'opts-hint', text: 'Or rest it. Rest and sick days keep the streak; nothing moves.' }), rests);
    parts.push(
      h(
        'div',
        { class: 'opts-foot' },
        h('button', { class: 'btn ghost', type: 'button', onclick: choose({ kind: 'clear' }) }, 'Clear'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.el.close() }, 'Cancel'),
      ),
    );
    this.el.style.setProperty('--fam', opts.family.color);
    this.el.replaceChildren(...parts);
    if (!this.el.open) this.el.showModal();
    (this.el.querySelector('input, .opt-attempt') as HTMLElement | null)?.focus();
    return new Promise((r) => (this.resolve = r));
  }

  private finish(c: OptionChoice | null): void {
    const r = this.resolve;
    this.resolve = null;
    if (this.el.open) this.el.close();
    if (r) {
      r(c);
      this.opener?.focus();
    }
  }
}
