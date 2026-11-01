/**
 * The speedrun bar, shown only in a sandbox with simulated time: the simulated date and time,
 * the speed, pause, and "next morning". It never appears in normal use.
 */
import { appNow, onWarp, setWarp, skipAhead, warpState } from '../core/time/appClock';
import { h } from './dom';

const SPEEDS = [60, 720, 4320];

export function warpBar(): HTMLElement {
  const when = h('span', { class: 'warp-when' });
  const pause = h('button', { class: 'pill', type: 'button' });
  const speed = h('button', { class: 'pill', type: 'button' });
  const next = h('button', { class: 'pill', type: 'button', text: 'Next morning' });
  let last = SPEEDS[1]!;
  const draw = (): void => {
    const w = warpState();
    if (!w) return;
    const d = new Date(appNow());
    when.textContent = `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    pause.textContent = w.speed === 0 ? 'Play' : 'Pause';
    speed.textContent = `×${w.speed || last}`;
  };
  pause.addEventListener('click', () => {
    const w = warpState();
    if (!w) return;
    if (w.speed > 0) last = w.speed;
    setWarp(w.speed > 0 ? 0 : last);
  });
  speed.addEventListener('click', () => {
    const w = warpState();
    last = SPEEDS[(SPEEDS.indexOf(w?.speed || last) + 1) % SPEEDS.length]!;
    setWarp(last);
  });
  // To 06:00 tomorrow, simulated: skips the night when a run wants only the waking day.
  next.addEventListener('click', () => {
    const d = new Date(appNow());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() >= 6 ? 1 : 0), 6, 0).getTime();
    skipAhead(target - appNow());
  });
  onWarp(draw);
  window.setInterval(draw, 250);
  draw();
  return h('div', { class: 'warp-bar glass', role: 'group', 'aria-label': 'Speedrun sandbox' }, h('strong', { text: 'Sandbox' }), when, pause, speed, next);
}
