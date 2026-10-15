/**
 * Environment Lab (Living World plan F): sliders for the time of day, the season, the weather and
 * the moon, a shake, the frame time and a way back to live (Xander, 14 Oct: "the sliders for all
 * seasons, all weather conditions and all time of day"). A preview only: it moves the light and
 * the sky, never the record, the story clock, streaks or the weekly climb, and it is gone on reload.
 */
import { KINDS, SEASONS, type Kind, type Season } from './conditions';
import { moonAge } from './sky';
import { h } from '../ui/dom';
import type { Stage } from './stage';
import { appDate } from '../core/time/appClock';

const cap = (x: string): string => x[0]!.toUpperCase() + x.slice(1);

export function moonPhase(age: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.floor(((age / 29.53) * 8 + 0.5) % 8)]!;
}

function bandOf(elev: number): string {
  return elev < -10 ? 'night' : elev < -2 ? 'blue hour' : elev < 16 ? 'golden hour' : 'day';
}

function clock(hr: number): string {
  const hh = Math.floor(hr) % 24;
  const mm = Math.floor((hr - Math.floor(hr)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** A labelled slider with tick marks and a live reading. */
function slider(id: string, label: string, min: number, max: number, step: number, ticks: number[]): { row: HTMLElement; input: HTMLInputElement; out: HTMLOutputElement } {
  const input = h('input', { type: 'range', id, min: String(min), max: String(max), step: String(step), list: `${id}-ticks` });
  const list = h('datalist', { id: `${id}-ticks` }, ...ticks.map((t) => h('option', { value: String(t) })));
  const out = h('output', { class: 'lab-val', for: id });
  const row = h('div', { class: 'lab-slider' }, h('label', { for: id, class: 'lab-label' }, h('span', { text: label }), out), input, list);
  return { row, input, out };
}

export function labPanel(stage: Stage, onClose: () => void): HTMLElement {
  const now = appDate();
  const live = now.getHours() + now.getMinutes() / 60;
  const p = stage.previewing;

  const time = slider('lab-time', 'Time of day', 0, 24, 0.05, [0, 3, 6, 9, 12, 15, 18, 21, 24]);
  time.input.value = String(p.hour ?? live);
  const season = slider('lab-season', 'Season', 0, SEASONS.length, 1, [0, 1, 2, 3, 4]);
  season.input.value = String(p.season ? SEASONS.indexOf(p.season) + 1 : 0);
  const weather = slider('lab-weather', 'Weather', 0, KINDS.length, 1, KINDS.map((_, i) => i).concat(KINDS.length));
  weather.input.value = String(p.kind ? KINDS.indexOf(p.kind) + 1 : 0);
  const moon = slider('lab-moon', 'Moon', -1, 29.5, 0.25, [-1, 0, 7.4, 14.8, 22.1, 29.5]);
  moon.input.value = String(p.moon ?? -1);

  const summary = h('span', { class: 'lab-note' });
  const show = (): void => {
    const hr = Number(time.input.value);
    time.out.textContent = `${clock(hr)} · ${bandOf(stage.sunElev)}`;
    const si = Number(season.input.value);
    const c = stage.conditions;
    season.out.textContent = si === 0 ? `Calendar (${c.season})` : cap(SEASONS[si - 1]!);
    const wi = Number(weather.input.value);
    weather.out.textContent = wi === 0 ? `From the record (${c.kind})` : cap(KINDS[wi - 1]!);
    const m = Number(moon.input.value);
    moon.out.textContent = m < 0 ? `Tonight: ${moonPhase(moonAge(appDate()))}` : `${moonPhase(m)} · day ${m.toFixed(1)}`;
    summary.textContent = `${clock(hr)} · ${cap(c.season)} · ${cap(c.kind)}`;
  };
  time.input.addEventListener('input', () => {
    stage.previewHour(Number(time.input.value));
    show();
  });
  season.input.addEventListener('input', () => {
    const i = Number(season.input.value);
    stage.previewSeason(i === 0 ? null : (SEASONS[i - 1] as Season));
    show();
  });
  weather.input.addEventListener('input', () => {
    const i = Number(weather.input.value);
    stage.previewWeather(i === 0 ? null : (KINDS[i - 1] as Kind));
    show();
  });
  moon.input.addEventListener('input', () => {
    const m = Number(moon.input.value);
    stage.previewMoon(m < 0 ? null : m);
    show();
  });

  const presets = h('div', { class: 'lab-presets', role: 'group', 'aria-label': 'Times of day' });
  for (const [label, hr] of [['Dawn', 6], ['Golden', 17.4], ['Dusk', 18.8], ['Blue', 19.6], ['Night', 23], ['Noon', 12.5]] as const) {
    const b = h('button', { class: 'pill', type: 'button' }, label);
    b.addEventListener('click', () => {
      time.input.value = String(hr);
      stage.previewHour(hr);
      show();
    });
    presets.append(b);
  }
  const fps = h('span', { class: 'lab-fps' });
  const tick = window.setInterval(() => {
    show();
    fps.textContent = `${stage.frameMs.toFixed(1)} ms/frame · ${Math.round(1000 / Math.max(1, stage.frameMs))} fps · quality ${['light', 'standard', 'high'][stage.tier]} · sun ${stage.sunElev.toFixed(1)}°`;
  }, 500);
  const shake = h('button', { class: 'btn small', type: 'button' }, 'Shake');
  shake.addEventListener('click', () => stage.shake(1));
  const reset = h('button', { class: 'btn small', type: 'button' }, 'Back to live');
  const clear = (): void => {
    stage.previewHour(null);
    stage.previewWeather(null);
    stage.previewSeason(null);
    stage.previewMoon(null);
  };
  reset.addEventListener('click', () => {
    clear();
    time.input.value = String(appDate().getHours() + appDate().getMinutes() / 60);
    season.input.value = weather.input.value = '0';
    moon.input.value = '-1';
    show();
  });
  const fold = h('button', { class: 'btn small ghost', type: 'button', 'aria-expanded': 'true' }, 'Hide');
  const close = h('button', { class: 'btn small ghost', type: 'button' }, 'Close');
  const body = h('div', { class: 'lab-body' }, time.row, presets, season.row, weather.row, moon.row, h('div', { class: 'lab-row' }, shake, reset), fps);
  const panel = h(
    'section',
    { class: 'lab glass', 'aria-label': 'Environment Lab' },
    h('div', { class: 'lab-row' }, h('strong', { text: 'Environment Lab' }), summary, fold, close),
    body,
  );
  // Fold it down to one line to look at the world; unfold to change things.
  fold.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    fold.textContent = open ? 'Hide' : 'Show';
    fold.setAttribute('aria-expanded', String(open));
  });
  close.addEventListener('click', () => {
    window.clearInterval(tick);
    clear();
    panel.remove();
    onClose();
  });
  show();
  return panel;
}
