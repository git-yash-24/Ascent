/**
 * Your mark: one optional choice of symbol and colour, made once at the start (or later in
 * Setup). Ari carries it on the flag and the pack, and carves it at the first camp.
 */
import type { Accent, TrailSymbol } from '../core/model/types';
import { h } from '../ui/dom';
import { ACCENTS, SYMBOLS, symbolPath } from './kit';

const SYMBOL_NAMES: Record<TrailSymbol, string> = { peak: 'Peak', star: 'Star', wave: 'Wave', pine: 'Pine', flame: 'Flame' };
const ACCENT_NAMES: Record<Accent, string> = { ember: 'Ember', moss: 'Moss', glacier: 'Glacier', plum: 'Plum', ochre: 'Ochre', ash: 'Ash' };

export function symbolSvg(s: TrailSymbol): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'sym');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', symbolPath(s));
  const stroked = s === 'wave' || s === 'peak';
  p.setAttribute('fill', stroked ? 'none' : 'currentColor');
  p.setAttribute('stroke', stroked ? 'currentColor' : 'none');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export interface MarkPicker {
  el: HTMLElement;
  value(): { symbol?: TrailSymbol; accent?: Accent };
}

/** Two radio rows: symbol (or none) and accent. `onChange` previews the choice live in the world. */
export function markPicker(initial: { symbol?: TrailSymbol; accent?: Accent }, onChange?: (v: { symbol?: TrailSymbol; accent?: Accent }) => void): MarkPicker {
  let symbol = initial.symbol;
  let accent = initial.accent;
  const name = `mk${Math.random().toString(36).slice(2, 7)}`;
  const syms = h('div', { class: 'mark-row', role: 'radiogroup', 'aria-label': 'Trail symbol' });
  const sw = h('div', { class: 'mark-row', role: 'radiogroup', 'aria-label': 'Colour' });
  const changed = (): void => onChange?.({ ...(symbol ? { symbol } : {}), ...(accent ? { accent } : {}) });
  for (const s of SYMBOLS) {
    const input = h('input', { type: 'radio', name: `${name}-s`, value: s, 'aria-label': SYMBOL_NAMES[s] });
    input.checked = symbol === s;
    input.addEventListener('change', () => {
      symbol = s;
      changed();
    });
    syms.append(h('label', { class: 'mark-opt', title: SYMBOL_NAMES[s] }, input, symbolSvg(s)));
  }
  for (const a of Object.keys(ACCENTS) as Accent[]) {
    const input = h('input', { type: 'radio', name: `${name}-a`, value: a, 'aria-label': ACCENT_NAMES[a] });
    input.checked = (accent ?? 'ash') === a;
    input.addEventListener('change', () => {
      accent = a;
      changed();
    });
    const dot = h('span', { class: 'swatch', 'aria-hidden': 'true' });
    dot.style.background = ACCENTS[a];
    sw.append(h('label', { class: 'mark-opt sw', title: ACCENT_NAMES[a] }, input, dot));
  }
  const el = h('div', { class: 'mark-pick' }, syms, sw);
  return { el, value: () => ({ ...(symbol ? { symbol } : {}), ...(accent ? { accent } : {}) }) };
}
