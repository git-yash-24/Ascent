/**
 * Environment Lab panel (Living World plan F): a 24-hour dial, a weather preview, the frame time
 * and a way back to live. A preview only: it moves the light and the sky, never the record, the
 * story clock, streaks or the weekly climb, and it is gone on reload.
 */
import { KINDS, SEASONS, type Kind, type Season } from './conditions';
import { h } from '../ui/dom';
import type { Stage } from './stage';

export function labPanel(stage: Stage, onClose: () => void): HTMLElement {
  const now = new Date();
  const live = now.getHours() + now.getMinutes() / 60;
  const dial = h('input', { type: 'range', min: '0', max: '24', step: '0.05', 'aria-label': 'Hour of day' });
  dial.value = String(stage.previewing.hour ?? live);
  const time = h('output', { class: 'lab-time' });
  const show = (): void => {
    const hr = Number(dial.value);
    const hh = Math.floor(hr) % 24;
    const mm = Math.floor((hr - Math.floor(hr)) * 60);
    time.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  dial.addEventListener('input', () => {
    stage.previewHour(Number(dial.value));
    show();
  });
  show();
  const cap = (x: string): string => x[0]!.toUpperCase() + x.slice(1);
  const select = <T extends string>(label: string, first: string, values: readonly T[], cur: T | null, on: (v: T | null) => void): HTMLSelectElement => {
    const el = h('select', { 'aria-label': label });
    for (const value of ['', ...values]) {
      const o = h('option', { value, text: value ? cap(value) : first });
      o.selected = (cur ?? '') === value;
      el.append(o);
    }
    el.addEventListener('change', () => on(el.value ? (el.value as T) : null));
    return el;
  };
  const weather = select<Kind>('Weather preview', 'Weather: from the record', KINDS, stage.previewing.kind, (k) => stage.previewWeather(k));
  const season = select<Season>('Season preview', 'Season: from the calendar', SEASONS, stage.previewing.season, (x) => stage.previewSeason(x));
  const shake = h('button', { class: 'pill', type: 'button' }, 'Shake');
  shake.addEventListener('click', () => stage.shake(1));
  const presets = h('div', { class: 'lab-presets', role: 'group', 'aria-label': 'Presets' });
  for (const [label, hr] of [['Dawn', 6], ['Golden', 17.4], ['Dusk', 18.8], ['Blue', 19.6], ['Night', 23], ['Noon', 12.5]] as const) {
    const b = h('button', { class: 'pill', type: 'button' }, label);
    b.addEventListener('click', () => {
      dial.value = String(hr);
      stage.previewHour(hr);
      show();
    });
    presets.append(b);
  }
  const fps = h('span', { class: 'lab-fps' });
  const tick = window.setInterval(() => {
    const c = stage.conditions;
    fps.textContent = `${stage.frameMs.toFixed(1)} ms/frame · ${Math.round(1000 / Math.max(1, stage.frameMs))} fps · quality ${['light', 'standard', 'high'][stage.tier]} · sun ${stage.sunElev.toFixed(1)}° · ${c.season} ${c.kind}`;
  }, 500);
  const reset = h('button', { class: 'btn small', type: 'button' }, 'Back to live');
  reset.addEventListener('click', () => {
    stage.previewHour(null);
    stage.previewWeather(null);
    stage.previewSeason(null);
    dial.value = String(live);
    weather.value = '';
    season.value = '';
    show();
  });
  const close = h('button', { class: 'btn small ghost', type: 'button' }, 'Close');
  const panel = h(
    'section',
    { class: 'lab glass', 'aria-label': 'Environment Lab' },
    h('div', { class: 'lab-row' }, h('strong', { text: 'Environment Lab' }), h('span', { class: 'lab-note', text: 'preview only' }), close),
    h('div', { class: 'lab-row' }, dial, time),
    presets,
    h('div', { class: 'lab-row' }, weather, season),
    h('div', { class: 'lab-row' }, shake, reset),
    fps,
  );
  close.addEventListener('click', () => {
    window.clearInterval(tick);
    stage.previewHour(null);
    stage.previewWeather(null);
    stage.previewSeason(null);
    panel.remove();
    onClose();
  });
  return panel;
}
