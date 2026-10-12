/**
 * The game screen (M9): the world on top, a small sheet under it, five screens side by side.
 *
 *   Base camp | Today | Week | Month | Year
 *
 * Swipe left from Today for base camp; swipe right for the week, the month and the year, each
 * further back on the mountain. Scroll down on any screen for the organised detail.
 * (Xander, 2026-10-13: story about 65% of the screen, the UI under it.)
 */
import type { Controller, View } from '../ui/controller';
import { h } from '../ui/dom';
import { BaseCampSheet } from './basecamp';
import { Stage } from './stage';
import { TodaySheet } from './today';
import { OptionsSheet } from './ui';
import { MonthSheet, WeekSheet, weekCamps, YearSheet } from './views';

export const SCREENS = ['camp', 'today', 'week', 'month', 'year'] as const;
export type Screen = (typeof SCREENS)[number];
const LABEL: Record<Screen, string> = { camp: 'Camp', today: 'Today', week: 'Week', month: 'Month', year: 'Year' };
const NAME: Record<Screen, string> = { camp: 'Base camp', today: 'Today', week: 'This week', month: 'This month', year: 'The year' };

interface Sheet {
  caption: HTMLElement;
  sheet: HTMLElement;
  render(v: View): void;
}

export class GameView {
  readonly root: HTMLElement;
  private readonly pager: HTMLElement;
  private readonly panels: HTMLElement[] = [];
  private readonly navButtons: HTMLButtonElement[] = [];
  private readonly sheets: Record<Screen, Sheet>;
  private readonly announce: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly fallback: HTMLElement;
  private stage: Stage | null = null;
  private index = 1;
  private lastClosed: boolean | null = null;
  private lastToday = '';
  private mounted = false;

  constructor(private readonly app: Controller) {
    this.canvas = h('canvas', { class: 'world', 'aria-hidden': 'true' });
    this.fallback = h('div', { class: 'world-fallback', 'aria-hidden': 'true', hidden: true });
    this.announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const opts = new OptionsSheet();
    const say = (t: string): void => this.say(t);
    const today = new TodaySheet(app, opts, { pulse: (x, y, done) => this.stage?.pulse(x, y, done), say });
    this.sheets = {
      camp: new BaseCampSheet(app, say),
      today,
      week: new WeekSheet(),
      month: new MonthSheet(),
      year: new YearSheet(),
    };
    const nav = h('nav', { class: 'screens', 'aria-label': 'Screens' });
    this.pager = h('div', { class: 'pager' });
    SCREENS.forEach((s, i) => {
      const b = h('button', { class: 'screen-btn', type: 'button', 'aria-controls': `s-${s}` }, LABEL[s]);
      b.addEventListener('click', () => this.go(i, true));
      nav.append(b);
      this.navButtons.push(b);
      const sheet = this.sheets[s];
      const panel = h('section', { class: `panel p-${s}`, id: `s-${s}`, 'aria-label': NAME[s], tabindex: '-1' }, h('div', { class: 'gap' }, sheet.caption), sheet.sheet);
      panel.addEventListener('scroll', () => this.onPanelScroll(i), { passive: true });
      this.panels.push(panel);
      this.pager.append(panel);
    });
    this.pager.addEventListener('scroll', () => this.onPagerScroll(), { passive: true });
    this.root = h('div', { class: 'game' }, this.canvas, this.fallback, nav, this.pager, this.announce, opts.el);
    window.addEventListener('resize', () => this.go(this.index, false));
    window.addEventListener('keydown', (e) => {
      if (!this.root.isConnected || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
      if (e.key === 'PageDown' && e.altKey) this.go(this.index + 1, true);
      if (e.key === 'PageUp' && e.altKey) this.go(this.index - 1, true);
    });
  }

  /** Attach to the page: start the world (once) and land on the requested screen. */
  mount(screen: Screen): void {
    const v = this.app.view();
    if (!this.mounted) {
      this.mounted = true;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || (v.snapshot.profile?.settings.reducedMotion ?? false);
      // ?world=off runs the screens on the painted sky (tests, very slow devices).
      const off = new URLSearchParams(location.search).get('world') === 'off';
      this.stage = off ? null : Stage.create(this.canvas, { reducedMotion: reduced });
      if (!this.stage) {
        this.canvas.hidden = true;
        this.fallback.hidden = false;
      }
    }
    this.index = SCREENS.indexOf(screen);
    requestAnimationFrame(() => this.go(this.index, false));
    this.render(v);
  }

  private dirty = new Set<number>();
  private lastView: View | null = null;

  /** Draw the screen in view and its neighbours now; the rest when they come into view. */
  render(v: View): void {
    this.lastView = v;
    SCREENS.forEach((s, i) => {
      if (Math.abs(i - this.index) <= 1) {
        this.sheets[s].render(v);
        this.dirty.delete(i);
      } else this.dirty.add(i);
    });
    const day = v.derived.days[v.today];
    const closed = day?.outcome === 'closed';
    if (this.stage) {
      // The reward plays only when the day closes now, on this screen, from a tap.
      const live = this.lastClosed === false && closed && this.lastToday === v.today;
      this.stage.setDay({ progress: day?.progress ?? 0, closed, live });
      this.stage.setWeek(weekCamps(v));
      this.stage.setSound(v.snapshot.profile?.settings.sound ?? true);
    }
    if (this.lastClosed === false && closed && this.lastToday === v.today) this.say('Camp is made. Ari takes the route.');
    this.lastClosed = closed;
    this.lastToday = v.today;
  }

  get screen(): Screen {
    return SCREENS[this.index]!;
  }

  go(i: number, smooth: boolean): void {
    const n = Math.max(0, Math.min(SCREENS.length - 1, i));
    const w = this.pager.clientWidth;
    if (w > 0) this.pager.scrollTo({ left: n * w, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    this.settle(n);
    this.stage?.setView(smooth ? this.pager.scrollLeft / Math.max(1, w) : n);
  }

  private settle(n: number): void {
    if (n !== this.index) {
      this.index = n;
      this.stage?.whoosh();
    }
    this.fresh(n);
    this.navButtons.forEach((b, i) => b.setAttribute('aria-current', i === n ? 'page' : 'false'));
    this.panels.forEach((p, i) => p.setAttribute('aria-hidden', i === n ? 'false' : 'true'));
    this.panels.forEach((p, i) => ((p as HTMLElement & { inert: boolean }).inert = i !== n));
    const hash = `#${SCREENS[n]}`;
    if (location.hash !== hash && !location.hash.startsWith('#setup') && location.hash !== '#list') history.replaceState(null, '', hash);
    this.onPanelScroll(n);
  }

  /** Bring the screens around `n` up to date. */
  private fresh(n: number): void {
    for (const i of [n - 1, n, n + 1]) {
      if (this.dirty.has(i) && this.lastView) {
        this.dirty.delete(i);
        this.sheets[SCREENS[i]!].render(this.lastView);
      }
    }
  }

  private settleTimer = 0;
  private onPagerScroll(): void {
    const w = Math.max(1, this.pager.clientWidth);
    const p = this.pager.scrollLeft / w;
    this.stage?.setView(p);
    if (this.dirty.size) this.fresh(Math.round(p));
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      const n = Math.round(this.pager.scrollLeft / Math.max(1, this.pager.clientWidth));
      if (n !== this.index || this.panels[n]?.inert) this.settle(n);
    }, 90);
  }

  private onPanelScroll(i: number): void {
    if (i !== this.index) return;
    const p = this.panels[i]!;
    const gap = (p.firstElementChild as HTMLElement | null)?.offsetHeight ?? 400;
    this.stage?.setDimmed(p.scrollTop > gap * 0.95);
    this.root.style.setProperty('--lift', String(Math.min(1, p.scrollTop / Math.max(1, gap))));
  }

  private pendingSay = '';
  /** Messages raised in the same moment are read together, never one over the other. */
  private say(text: string): void {
    if (this.pendingSay) {
      this.pendingSay += ` ${text}`;
      return;
    }
    this.pendingSay = text;
    this.announce.textContent = '';
    requestAnimationFrame(() => {
      this.announce.textContent = this.pendingSay;
      this.pendingSay = '';
    });
  }
}

export function screenFromHash(hash: string): Screen | null {
  const s = hash.replace('#', '') as Screen;
  return (SCREENS as readonly string[]).includes(s) ? s : null;
}
