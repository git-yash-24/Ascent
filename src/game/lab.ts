/**
 * Environment Lab panel (Living World plan F): a 24-hour dial, a weather preview, the frame time
 * and a way back to live. A preview only: it moves the light and the sky, never the record, the
 * story clock, streaks or the weekly climb, and it is gone on reload.
 */
import type { Weather } from '../core/world';
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
  const weather = h('select', { 'aria-label': 'Weather preview' });
  for (const [value, label] of [['', 'Weather: from the record'], ['clear', 'Clear'], ['calm', 'Calm'], ['snow', 'Snow'], ['storm', 'Storm']] as const) {
    const o = h('option', { value, text: label });
    o.selected = (stage.previewing.weather ?? '') === value;
    weather.append(o);
  }
  weather.addEventListener('change', () => stage.previewWeather(weather.value ? (weather.value as Weather) : null));
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
  const tick = window.setInterval(() => (fps.textContent = `${stage.frameMs.toFixed(1)} ms/frame · ${Math.round(1000 / Math.max(1, stage.frameMs))} fps · quality ${['light', 'standard', 'high'][stage.tier]} · sun ${stage.sunElev.toFixed(1)}°`), 500);
  const reset = h('button', { class: 'btn small', type: 'button' }, 'Back to live');
  reset.addEventListener('click', () => {
    stage.previewHour(null);
    stage.previewWeather(null);
    dial.value = String(live);
    weather.value = '';
    show();
  });
  const close = h('button', { class: 'btn small ghost', type: 'button' }, 'Close');
  const panel = h(
    'section',
    { class: 'lab glass', 'aria-label': 'Environment Lab' },
    h('div', { class: 'lab-row' }, h('strong', { text: 'Environment Lab' }), h('span', { class: 'lab-note', text: 'preview only' }), close),
    h('div', { class: 'lab-row' }, dial, time),
    presets,
    h('div', { class: 'lab-row' }, weather, reset),
    fps,
  );
  close.addEventListener('click', () => {
    window.clearInterval(tick);
    stage.previewHour(null);
    stage.previewWeather(null);
    panel.remove();
    onClose();
  });
  return panel;
}
