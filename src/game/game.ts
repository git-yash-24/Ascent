/**
 * The game screen: the world fills the screen; a minimal glass checklist floats over its lower
 * part; five screens slide sideways over it.
 *
 *   Base camp | Today | Week | Month | Year
 *
 * Swipe right from Today for base camp (Ari opens his journal); swipe left for the week (close
 * on this week's trail; tap a day to replay it), the month and the year (the whole route, one
 * beacon). Scroll down on any screen for the organised detail. The flask floats on every
 * screen: tap it and Ari drinks, wherever he is.
 * (Xander, 2026-10-13.)
 */
import type { Accent, DateKey, Entry, TrailSymbol } from '../core/model/types';
import { campState, momentumStep, waterDue, weatherOf } from '../core/world';
import { ACCENTS } from './kit';
import { markPicker } from './onboard';
import { labPanel } from './lab';
import { onMotionChange, reducedMotion, scrollBehavior, setMotionSetting } from '../ui/motion';
import { listenShake, onWorldPrefs, worldPrefs } from '../ui/worldPrefs';
import type { Controller, View } from '../ui/controller';
import { h } from '../ui/dom';
import { BaseCampSheet } from './basecamp';
import { holdable } from './hold';
import { CARD_SECONDS, dayCards, type Card } from './montage';
import { glassTimes } from '../core/timeline';
import { Stage, type TrailDay } from './stage';
import { TodaySheet } from './today';
import { OptionsSheet } from './ui';
import { MonthSheet, WeekSheet, weekDays, YearSheet } from './views';
import { appNow, warpState } from '../core/time/appClock';

export const SCREENS = ['camp', 'today', 'week', 'month', 'year'] as const;
export type Screen = (typeof SCREENS)[number];
const LABEL: Record<Screen, string> = { camp: 'Camp', today: 'Today', week: 'Week', month: 'Month', year: 'Year' };
const NAME: Record<Screen, string> = { camp: 'Base camp', today: 'Today', week: 'This week', month: 'This month', year: 'The year' };

export interface Sheet {
  caption: HTMLElement;
  /** What shows over the world. */
  compact: HTMLElement;
  /** What scrolling down reveals. */
  detail: HTMLElement;
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
  private readonly labels: HTMLElement;
  private readonly flask: HTMLButtonElement;
  private readonly flaskMenu: HTMLDialogElement;
  private readonly reel: HTMLElement;
  private dayLabels = new Map<DateKey, HTMLButtonElement>();
  private here: HTMLElement;
  private stage: Stage | null = null;
  private index = 1;
  private lastClosed: boolean | null = null;
  private lastToday = '';
  private lastGlasses: number | null = null;
  private mounted = false;
  private playing: { timer: number; date: DateKey } | null = null;
  private idleTimer = 0;
  private onboarding: HTMLElement | null = null;
  private readonly nav: HTMLElement;
  private modalOpener: HTMLElement | null = null;
  private campReady = false;

  constructor(private readonly app: Controller) {
    this.canvas = h('canvas', { class: 'world', 'aria-hidden': 'true' });
    this.fallback = h('div', { class: 'world-fallback', 'aria-hidden': 'true', hidden: true });
    this.announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const opts = new OptionsSheet();
    const say = (t: string): void => this.say(t);
    const play = (d: DateKey): void => this.playDay(d);
    this.sheets = {
      camp: new BaseCampSheet(app, say, () => this.stage?.scribble()),
      today: new TodaySheet(app, opts, { pulse: (x, y, done) => this.stage?.pulse(x, y, done), say }),
      week: new WeekSheet(play),
      month: new MonthSheet(),
      year: new YearSheet(),
    };
    const nav = h('nav', { class: 'screens glass', 'aria-label': 'Screens' });
    this.nav = nav;
    this.pager = h('div', { class: 'pager' });
    SCREENS.forEach((s, i) => {
      const b = h('button', { class: 'screen-btn', type: 'button', 'aria-controls': `s-${s}` }, LABEL[s]);
      b.addEventListener('click', () => this.go(i, true));
      nav.append(b);
      this.navButtons.push(b);
      const sheet = this.sheets[s];
      const gap = h('div', { class: 'gap' }, sheet.caption);
      const back = h('span', { text: 'Back to scene' });
      this.pokeable(gap);
      const panel = h(
        'section',
        { class: `panel p-${s}`, id: `s-${s}`, 'aria-label': NAME[s], tabindex: '-1' },
        h('div', { class: 'fold' }, gap, h('div', { class: 'compact' }, sheet.compact)),
        h(
          'div',
          { class: 'below' },
          h(
            'div',
            { class: 'below-bar' },
            h('span', { class: 'below-t', text: NAME[s] }),
            h('button', { class: 'below-up', type: 'button', onclick: () => panel.scrollTo({ top: 0, behavior: scrollBehavior() }) }, chevron(), back),
          ),
          sheet.detail,
        ),
      );
      new ResizeObserver(() => {
        panel.style.setProperty('--compact', `${sheet.compact.offsetHeight}px`);
        if (i === this.index) this.frameAround();
      }).observe(sheet.compact);
      panel.addEventListener('scroll', () => this.onPanelScroll(i), { passive: true });
      this.panels.push(panel);
      this.pager.append(panel);
    });
    this.pager.addEventListener('scroll', () => this.onPagerScroll(), { passive: true });

    // Labels on the world: the week's camps, and "you are here" on the year's route.
    this.labels = h('div', { class: 'labels', 'aria-hidden': 'false' });
    this.here = h('div', { class: 'here', 'aria-hidden': 'true' }, h('span', { class: 'here-dot' }), h('span', { class: 'here-t', text: 'You are here' }));
    this.labels.append(this.here);

    // The flask, on every screen.
    this.flask = h('button', { class: 'flask-btn', type: 'button', 'aria-haspopup': 'dialog' }, h('span', { class: 'flask-ring', 'aria-hidden': 'true' }), h('span', { class: 'flask-core', 'aria-hidden': 'true' }, h('span', { class: 'flask-fill' }), flaskIcon()), h('span', { class: 'flask-n', 'aria-hidden': 'true' }));
    holdable(this.flask, { tap: () => this.glass(1), hold: () => this.openFlaskMenu() });
    this.flaskMenu = h('dialog', { class: 'opts flask-menu', 'aria-label': 'Water' });
    this.flaskMenu.addEventListener('click', (e) => {
      if (e.target === this.flaskMenu) this.flaskMenu.close();
    });

    // The replay: letterbox and one caption at a time.
    this.reel = h('div', { class: 'reel', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Replay of the day' });
    // Only the backdrop and the letterbox close it; the caption and anything on it do not.
    this.reel.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.reel || t.classList.contains('bars')) this.stopDay();
    });
    this.reel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.stopDay();
    });

    const shade = h('div', { class: 'shade', 'aria-hidden': 'true' });
    this.root = h('div', { class: 'game' }, this.canvas, this.fallback, shade, this.labels, nav, this.pager, this.flask, this.reel, this.announce, opts.el, this.flaskMenu);
    // The HUD steps out of the picture after a few seconds without input, like a game's HUD
    // between actions. The first touch only brings it back: hidden controls take no touches,
    // so that touch lands on the world and can never press a button it could not see.
    const wake = (): void => {
      document.body.classList.remove('hud-idle');
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.rest(), 4500);
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin']) window.addEventListener(ev, wake, { passive: true, capture: true });
    // Water due-ness (and her tiredness) moves with the clock, not only with the record.
    window.setInterval(() => this.lastView && this.root.isConnected && this.renderFlask(this.lastView), warpState() ? 2000 : 60_000);
        // The Environment Lab (Setup → About, once unlocked).
    window.addEventListener('ascent:lab', () => this.showLab());
    wake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        window.setTimeout(() => this.maybeGreet(), 900);
        this.scheduleReveal(1500);
      } else this.interruptReveal();
    });
    window.addEventListener('resize', () => this.go(this.index, false));
    window.addEventListener('keydown', (e) => {
      if (!this.root.isConnected || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector('dialog[open]') || this.playing || this.onboarding) return;
      if (e.key === 'PageDown' && e.altKey) this.go(this.index + 1, true);
      if (e.key === 'PageUp' && e.altKey) this.go(this.index - 1, true);
    });
  }

  /** Attach to the page: start the world (once) and land on the requested screen. */
  mount(screen: Screen): void {
    const v = this.app.view();
    if (!this.mounted) {
      this.mounted = true;
      setMotionSetting(v.snapshot.profile?.settings.reducedMotion ?? false);
      const reduced = reducedMotion();
      // ?world=off runs the screens on the painted sky (tests, very slow devices).
      const off = new URLSearchParams(location.search).get('world') === 'off';
      this.stage = off ? null : Stage.create(this.canvas, { reducedMotion: reduced });
      if (!this.stage) {
        this.canvas.hidden = true;
        this.fallback.hidden = false;
        // Pins and "you are here" need the world to stand on.
        this.labels.hidden = true;
      } else {
        this.stage.onFrame = () => this.placeLabels();
        onMotionChange((r) => this.stage?.setReduced(r));
        // Shake to stir the world: only when switched on in Setup (per device).
        let stop: (() => void) | null = null;
        const shake = (on: boolean): void => {
          stop?.();
          stop = on ? listenShake((k) => this.stage?.shake(k)) : null;
        };
        shake(worldPrefs().shake);
        onWorldPrefs((p) => shake(p.shake));
      }
    }
    this.index = SCREENS.indexOf(screen);
    requestAnimationFrame(() => this.go(this.index, false));
    this.render(v);
    window.setTimeout(() => this.maybeGreet(), 1400);
  }

  // Arrival, onboarding, the camp ------------------------------------------------------------

  /** She looks up when you arrive: the first open of a day, or after 4 hours away. Never on tab switches. */
  private maybeGreet(): void {
    if (!this.root.isConnected || this.onboarding || !this.stage) return;
    const v = this.app.view();
    if (v.firstRun) return;
    const KEY = 'ascent:greeted:v1';
    let last: { day: string; at: number } | null = null;
    try {
      last = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { day: string; at: number } | null;
    } catch {
      last = null;
    }
    const now = appNow();
    if (last && last.day === v.today && now - last.at < 4 * 3600_000) return;
    // A real absence (most of a day, or missed days): the cup comes back to your place.
    // (A first visit on this device has nothing to come back from.)
    const away = last !== null && (now - last.at > 18 * 3600_000 || momentumStep(v.derived, v.today) > 0);
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: v.today, at: now }));
    } catch {
      // without storage she greets at most once per load
    }
    this.stage.greet(away);
  }

  /**
   * The opening scene, then a card over the camp: the welcome form for a first launch, or
   * just your mark for someone who started before the opening existed.
   */
  startOnboarding(card: HTMLElement | null): void {
    if (this.onboarding) return;
    const v = this.app.view();
    const title = h('div', { class: 'ob-title', 'aria-hidden': 'true' }, h('span', { text: 'Ascent' }), h('small', { text: 'a year on the mountain' }));
    const skip = h('button', { class: 'ob-skip', type: 'button' }, 'Skip');
    const wrap = h('div', { class: 'ob-card glass', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': card ? 'Begin' : 'Your mark' });
    if (card) wrap.append(card);
    else {
      const ex = v.snapshot.expedition;
      const pick = markPicker({ ...(ex.symbol ? { symbol: ex.symbol } : {}), ...(ex.accent ? { accent: ex.accent } : {}) }, (m) => this.preview(m));
      const done = h('button', { class: 'btn primary big', type: 'button' }, 'Done');
      done.addEventListener('click', () => this.app.saveExpedition({ ...pick.value(), introOn: this.app.today }));
      const later = h('button', { class: 'btn ghost', type: 'button' }, 'Not now');
      later.addEventListener('click', () => this.app.saveExpedition({ introOn: this.app.today }));
      wrap.append(
        h('h1', { class: 'ob-h', text: 'Your mark' }),
        h('p', { class: 'intro', text: 'Ari carries it on the flag and the pack, and carves it at the first camp. You can change it any time in Setup.' }),
        pick.el,
        h('div', { class: 'row-actions' }, done, later),
      );
    }
    const layer = h('div', { class: 'onboard' }, title, skip, wrap);
    this.onboarding = layer;
    this.root.append(layer);
    this.root.classList.add('onboarding');
    this.setModal(true);
    this.interruptReveal();
    document.body.classList.remove('hud-idle');
    const show = (): void => {
      title.classList.add('gone');
      skip.hidden = true;
      wrap.hidden = false;
      (wrap.querySelector('input, textarea, button') as HTMLElement | null)?.focus();
    };
    skip.addEventListener('click', () => (this.stage?.introPlaying ? this.stage.skipIntro() : show()));
    if (this.stage) this.stage.playIntro(show);
    else show();
    skip.focus();
  }

  private endOnboarding(): void {
    this.onboarding?.remove();
    this.onboarding = null;
    this.root.classList.remove('onboarding');
    this.stage?.skipIntro();
    this.setModal(false);
    // Land on the checklist, ready to log.
    (this.panels[this.index]?.querySelector('.gchip, button, a') as HTMLElement | null)?.focus({ preventScroll: true });
    this.scheduleReveal(1200);
  }

  /**
   * A full-screen moment (the opening, a replay) is a real modal: everything behind it is inert,
   * so focus and touches cannot reach it; focus goes back where it was when it ends.
   */
  private setModal(on: boolean): void {
    const behind: Array<Element | null> = [this.pager, this.nav, this.flask, this.labels, document.querySelector('header.top')];
    if (on && !this.modalOpener) this.modalOpener = document.activeElement as HTMLElement | null;
    for (const el of behind) if (el) (el as HTMLElement & { inert: boolean }).inert = on;
    if (!on) {
      this.panels.forEach((p, i) => ((p as HTMLElement & { inert: boolean }).inert = i !== this.index));
      this.syncLifted();
      this.modalOpener = null;
    }
  }

  /** Show a mark on the camp while it is being chosen. */
  preview(m: { symbol?: TrailSymbol; accent?: Accent }): void {
    this.stage?.setExpedition(m.symbol, ACCENTS[m.accent ?? 'ash']);
  }

  /**
   * The travelling home: improvements earned by story days. Earned is the record; shown is
   * separate. A new one waits until you are on Camp or Today with nothing else on screen, plays,
   * and only then counts as seen. Leaving mid-reveal keeps it waiting. Several at once play
   * the newest and name them all.
   */
  private renderCamp(v: View): void {
    if (!this.stage) return;
    const camp = campState(v.derived.storyDayEarned);
    const ids = camp.built.map((i) => i.id);
    this.stage.setCamp(ids);
    const fresh = ids.filter((id) => !v.snapshot.seen.moments.includes(`camp:${id}`));
    this.pendingReveal = fresh.length ? { ids: fresh, names: fresh.map((id) => camp.built.find((i) => i.id === id)?.name ?? id) } : null;
    this.scheduleReveal(this.campReady ? 400 : 2200);
    this.campReady = true;
  }

  private pendingReveal: { ids: string[]; names: string[] } | null = null;
  private revealTimer = 0;
  private revealing = false;

  private canReveal(): boolean {
    return this.index <= 1 && !this.onboarding && !this.playing && document.visibilityState === 'visible' && this.root.dataset.lifted !== 'true' && !document.querySelector('dialog[open]') && this.root.isConnected;
  }

  private scheduleReveal(ms: number): void {
    if (!this.pendingReveal || this.revealing) return;
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      const p = this.pendingReveal;
      if (!p || this.revealing || !this.stage) return;
      // Checked when it would play, not when it was earned.
      if (!this.canReveal()) return;
      this.revealing = true;
      const newest = p.ids.at(-1)!;
      this.say(p.names.length > 1 ? `New at camp: ${p.names.join(', ')}.` : `New at camp: ${p.names[0]}.`);
      this.stage.reveal(newest, (shown) => {
        this.revealing = false;
        if (shown) {
          for (const id of p.ids) this.app.markSeen(`camp:${id}`);
          if (this.pendingReveal === p) this.pendingReveal = null;
        }
      });
    }, ms);
  }

  /** You moved on: a reveal mid-play is cut short and stays waiting. */
  private interruptReveal(): void {
    window.clearTimeout(this.revealTimer);
    if (this.revealing) this.stage?.cancelReveal();
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
    const days = weekDays(v);
    if (this.stage) {
      // The reward plays only when the day closes now, from a tap.
      const live = this.lastClosed === false && closed && this.lastToday === v.today;
      this.stage.setDay({ progress: day?.progress ?? 0, closed, live });
      this.stage.setWeek(days);
      this.stage.setStage(v.derived.climb.stage);
      this.stage.setSound(v.snapshot.profile?.settings.sound ?? true);
      setMotionSetting(v.snapshot.profile?.settings.reducedMotion ?? false);
      this.stage.setWeather(weatherOf(v.derived, v.today));
      this.stage.setMomentum(momentumStep(v.derived, v.today));
      const ex = v.snapshot.expedition;
      if (!this.onboarding) this.stage.setExpedition(ex.symbol, ACCENTS[ex.accent ?? 'ash']);
    }
    if (!v.firstRun) {
      if (this.onboarding && v.snapshot.expedition.introOn) this.endOnboarding();
      else if (!this.onboarding && !v.snapshot.expedition.introOn && v.snapshot.profile && this.mounted) this.startOnboarding(null);
      if (!this.onboarding) this.renderCamp(v);
    }
    this.syncDayLabels(days);
    if (this.lastClosed === false && closed && this.lastToday === v.today) this.say('Camp is made. Ari takes the route.');
    this.lastClosed = closed;
    this.lastToday = v.today;
    this.renderFlask(v);
  }

  private lab: HTMLElement | null = null;

  private showLab(): void {
    if (!this.stage || this.lab) return;
    this.lab = labPanel(this.stage, () => (this.lab = null));
    this.root.append(this.lab);
    (this.lab.querySelector('input') as HTMLElement | null)?.focus();
  }

  /**
   * Hide the HUD, unless something needs it: a sheet or dialog, typing, keyboard focus moving
   * through the controls, the opening, a replay, the detail being up.
   */
  private rest(): void {
    if (!this.root.isConnected || this.onboarding || this.playing || this.lab || this.root.dataset.lifted === 'true') return;
    if (document.querySelector('dialog[open]')) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && (a.matches('input, textarea, select, [contenteditable]') || a.matches(':focus-visible'))) {
      this.idleTimer = window.setTimeout(() => this.rest(), 4500);
      return;
    }
    document.body.classList.add('hud-idle');
  }

  // Framing ---------------------------------------------------------------------------------

  /** Tell the camera how much of the screen the interface covers on Camp and Today. */
  private frameAround(): void {
    if (!this.stage) return;
    if (this.index > 1) {
      this.stage.resetOcclusion();
      return;
    }
    const p = this.panels[this.index];
    const compact = p?.querySelector('.compact') as HTMLElement | null;
    const cap = p?.querySelector('.caption') as HTMLElement | null;
    const bottom = compact?.offsetHeight ?? 84;
    const top = cap ? cap.getBoundingClientRect().bottom : 130;
    this.stage.setOcclusion(bottom, top > 0 ? top : 130);
  }

  get screen(): Screen {
    return SCREENS[this.index]!;
  }

  go(i: number, smooth: boolean): void {
    const n = Math.max(0, Math.min(SCREENS.length - 1, i));
    const w = this.pager.clientWidth;
    if (w > 0) this.pager.scrollTo({ left: n * w, behavior: smooth ? scrollBehavior() : 'auto' });
    this.settle(n);
    this.stage?.setView(smooth ? this.pager.scrollLeft / Math.max(1, w) : n);
  }

  // Water --------------------------------------------------------------------------------------

  private glass(delta: 1 | -1): void {
    const r = this.app.addGlass(delta);
    const w = this.app.view().derived.water;
    this.say(r.ok ? (delta > 0 ? `Ari drinks. ${w?.today ?? 0} of ${w?.target ?? 0} glasses.` : `One glass removed. ${w?.today ?? 0} of ${w?.target ?? 0}.`) : r.message);
  }

  private renderFlask(v: View): void {
    const w = v.derived.water;
    this.flask.hidden = !w;
    if (!w) return;
    // Every new glass, from here, Today's bar or another device: Ari drinks.
    if (this.lastGlasses !== null && w.today > this.lastGlasses) {
      this.stage?.drink();
      this.flask.classList.remove('gulp');
      void this.flask.offsetWidth;
      this.flask.classList.add('gulp');
    }
    this.lastGlasses = w.today;
    const due = waterDue(w, appNow(), this.app.view().snapshot.profile?.settings.timeZone);
    this.flask.dataset.due = String(due);
    this.flask.style.setProperty('--level', String(Math.min(1, w.today / Math.max(1, w.target))));
    // The tin shows what is left to drink today; the corner ring shows what you have had.
    this.stage?.setFlaskLevel(1 - w.today / Math.max(1, w.target));
    this.stage?.setWater({ today: w.today, target: w.target, due, sinceMin: w.lastAt === null ? null : (appNow() - w.lastAt) / 60_000 });
    (this.flask.querySelector('.flask-n') as HTMLElement).textContent = `${w.today}/${w.target}`;
    const ring = this.flask.querySelector('.flask-ring') as HTMLElement;
    if (ring.dataset.k !== `${w.today}/${w.target}`) {
      ring.dataset.k = `${w.today}/${w.target}`;
      ring.replaceChildren(ringSvg(w.today, w.target));
    }
    this.flask.setAttribute('aria-label', `Drink a glass of water. ${w.today} of ${w.target} today.${due ? ' Time for water.' : ''} Hold for more.`);
  }

  /**
   * The flask close-up: Ari holds it up; the sheet shows the count, the fill, and the time of each
   * glass the record has (times are kept from 13 Oct on; earlier glasses are counted without one).
   * Remove a glass here, with Undo. Tap the flask (in the world or the corner) to add one.
   */
  private openFlaskMenu(): void {
    const v = this.app.view();
    const w = v.derived.water;
    if (!w) return;
    const id = v.snapshot.habits.habits.find((x) => x.system === 'water')?.id;
    const status = h('p', { class: 'opts-hint', role: 'status' });
    const body = h('div', { class: 'flask-sheet' });
    const draw = (): void => {
      const now = this.app.view();
      const ww = now.derived.water;
      if (!ww || !id) return;
      const e = entryOfToday(now, id);
      // Each glass added takes that action's time; a removal takes the latest one back.
      const times = glassTimes(e?.acts, ww.today);
      const shown = times.slice(0, ww.today).filter((t): t is number => t !== null);
      const untimed = Math.max(0, ww.today - shown.length);
      const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
      const cells = h('span', { class: 'flask-cells', 'aria-hidden': 'true' });
      for (let i = 0; i < ww.target; i++) cells.append(h('span', { class: i < ww.today ? 'fc on' : 'fc' }));
      const less = h('button', { class: 'btn', type: 'button' }, 'Remove a glass');
      less.disabled = ww.today === 0;
      less.addEventListener('click', () => {
        const prev = this.app.entryFields(this.app.today, id);
        const r = this.app.addGlass(-1);
        if (!r.ok) {
          status.replaceChildren(r.message);
          return;
        }
        const undo = h('button', { class: 'btn small ghost', type: 'button' }, 'Undo');
        undo.addEventListener('click', () => {
          const u = this.app.revert(this.app.today, id, prev);
          status.replaceChildren(u.ok ? 'Glass put back.' : u.message);
          draw();
        });
        status.replaceChildren('One glass removed. ', undo);
        draw();
      });
      const more = h('button', { class: 'btn', type: 'button' }, 'Add a glass');
      more.addEventListener('click', () => {
        this.glass(1);
        status.replaceChildren(`${this.app.view().derived.water?.today ?? 0} of ${ww.target} glasses.`);
        draw();
      });
      const list = shown.length
        ? h('p', { class: 'flask-times' }, h('span', { class: 'label', text: 'Glasses at ' }), shown.map((t) => fmt.format(t)).join(' · '), untimed ? ` · ${untimed} earlier, time not recorded` : '')
        : ww.today
          ? h('p', { class: 'flask-times', text: `${ww.today} today; times are recorded from now on.` })
          : h('p', { class: 'flask-times', text: 'No glasses yet today.' });
      const focusWas = (document.activeElement as HTMLElement | null)?.textContent;
      body.replaceChildren(
        h('p', { class: 'flask-big' }, h('strong', { text: String(ww.today) }), ` of ${ww.target} glasses`),
        cells,
        list,
        h('p', { class: 'opts-hint', text: `${ww.streak > 1 ? `Full ${ww.streak} days in a row. ` : ''}The goal is in Setup. Water keeps Ari strong; it never moves the story.` }),
        h('div', { class: 'opts-row' }, less, more),
      );
      if (focusWas === 'Remove a glass') (ww.today ? less : more).focus();
      if (focusWas === 'Add a glass') more.focus();
    };
    const close = h('button', { class: 'btn ghost', type: 'button', onclick: () => this.flaskMenu.close() }, 'Close');
    this.flaskMenu.replaceChildren(h('h2', { class: 'opts-title', text: 'Water today' }), body, status, h('div', { class: 'opts-foot' }, h('span'), close));
    draw();
    this.stage?.inspectFlask(true);
    this.flaskMenu.showModal();
    (this.flaskMenu.querySelector('.opts-row .btn:not([disabled])') as HTMLElement | null)?.focus();
    this.flaskMenu.addEventListener(
      'close',
      () => {
        this.stage?.inspectFlask(false);
        this.flask.focus();
      },
      { once: true },
    );
  }

  // The world's labels and touches ------------------------------------------------------------

  /**
   * Touches on the world itself. A tap on the flask adds a glass; holding it opens the close-up;
   * a tap elsewhere is a poke (Ari looks up, the fire sparks). Moving is a swipe, never a tap.
   */
  private pokeable(el: HTMLElement): void {
    let down: { x: number; y: number; t: number; prop: 'flask' | null } | null = null;
    let timer = 0;
    el.addEventListener('pointerdown', (e) => {
      const prop = this.stage?.pick(e.clientX, e.clientY) ?? null;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), prop };
      window.clearTimeout(timer);
      if (prop === 'flask') {
        timer = window.setTimeout(() => {
          if (!down) return;
          down = null;
          navigator.vibrate?.(12);
          this.openFlaskMenu();
        }, 600);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) {
        down = null;
        window.clearTimeout(timer);
      }
    });
    el.addEventListener('pointerup', (e) => {
      window.clearTimeout(timer);
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 500) {
        if (down.prop === 'flask') this.glass(1);
        else this.stage?.poke(e.clientX, e.clientY);
      }
      down = null;
    });
    el.addEventListener('pointercancel', () => {
      window.clearTimeout(timer);
      down = null;
    });
  }

  private syncDayLabels(days: TrailDay[]): void {
    const want = new Set(days.map((d) => d.date));
    for (const [d, el] of this.dayLabels) {
      if (!want.has(d)) {
        el.remove();
        this.dayLabels.delete(d);
      }
    }
    for (const d of days) {
      let b = this.dayLabels.get(d.date);
      if (!b) {
        b = h('button', { class: 'day-pin', type: 'button' });
        b.addEventListener('click', () => this.playDay(d.date));
        this.dayLabels.set(d.date, b);
        this.labels.append(b);
      }
      b.className = `day-pin o-${d.isToday ? 'today' : d.outcome}`;
      b.textContent = d.label.slice(0, 1);
      const future = d.outcome === 'future';
      b.disabled = future;
      b.setAttribute('aria-label', `${d.label}${d.isToday ? ', today' : ''}: ${future ? 'still ahead' : 'replay the day'}`);
    }
  }

  /** Each drawn frame: pin the week's days to their camps and the beacon to the route. */
  private placeLabels(): void {
    const s = this.stage;
    if (!s) return;
    const view = s.viewPos;
    const lift = Number(this.root.style.getPropertyValue('--lift') || 0);
    const weekV = this.playing ? 0 : Math.max(0, 1 - Math.abs(view - 2) * 2.2) * (1 - lift * 1.5);
    for (const a of s.anchors) {
      const el = this.dayLabels.get(a.date);
      if (!el) continue;
      const p = s.project(a.pos.clone().setY(a.pos.y + (a.isToday ? 2.4 : 1.6)));
      // Not under the header and tabs.
      const show = weekV > 0.05 && p.visible && p.y > 130;
      el.style.opacity = String(show ? weekV : 0);
      el.style.pointerEvents = show && weekV > 0.6 ? 'auto' : 'none';
      el.tabIndex = show && weekV > 0.6 ? 0 : -1;
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const yearV = this.playing ? 0 : Math.max(0, view - 3) * (1 - lift * 1.5);
    const b = s.project(s.beacon);
    this.here.style.opacity = String(yearV > 0.05 && b.visible ? yearV : 0);
    this.here.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -100%)`;
  }

  // The replay ----------------------------------------------------------------------------------

  playDay(date: DateKey): void {
    const v = this.app.view();
    if (date > v.today) return;
    this.stopDay(false);
    const cards = dayCards(v, date);
    const anchor = this.stage?.anchors.find((a) => a.date === date);
    if (anchor) this.stage?.playMontage(anchor, cards.length, CARD_SECONDS);
    // The world shows that day: its season and weather, and each card's recorded hour.
    this.stage?.replayDay(date, weatherOf(v.derived, date));
    const bar = h('div', { class: 'reel-progress' });
    const card = h('div', { class: 'reel-card glass', 'aria-live': 'polite' });
    const skip = h('button', { class: 'reel-skip', type: 'button', text: 'Close' });
    skip.addEventListener('click', () => this.stopDay());
    this.reel.replaceChildren(h('div', { class: 'bars top' }), h('div', { class: 'bars bottom' }), card, bar, skip);
    for (let i = 0; i < cards.length; i++) bar.append(h('span', {}));
    this.reel.hidden = false;
    this.root.classList.add('replaying');
    this.interruptReveal();
    this.setModal(true);
    skip.focus();
    let k = 0;
    const show = (c: Card): void => {
      const kick = h('span', { class: 'reel-k', text: c.kicker });
      if (c.time) kick.append(h('span', { class: 'reel-time', text: ` · ${c.time}` }));
      card.replaceChildren(kick, h('span', { class: `reel-t${c.quote ? ' quote' : ''}`, text: c.quote ? `“${c.text}”` : c.text }));
      if (c.note) card.append(h('span', { class: 'reel-note', text: c.note }));
      if (c.hour !== undefined) this.stage?.replayHour(c.hour);
      card.style.setProperty('--fam', c.color ?? 'rgba(255,255,255,.5)');
      card.classList.toggle('dim', c.dim === true);
      card.classList.remove('in');
      void card.offsetWidth;
      card.classList.add('in');
      [...bar.children].forEach((s, i) => s.classList.toggle('on', i <= k));
    };
    show(cards[0]!);
    const step = (): void => {
      k++;
      if (k >= cards.length) {
        this.stopDay();
        return;
      }
      show(cards[k]!);
      this.playing = { timer: window.setTimeout(step, CARD_SECONDS * 1000), date };
    };
    this.playing = { timer: window.setTimeout(step, CARD_SECONDS * 1000), date };
  }

  private stopDay(refocus = true): void {
    if (!this.playing) return;
    const date = this.playing.date;
    window.clearTimeout(this.playing.timer);
    this.playing = null;
    this.stage?.endMontage();
    this.stage?.replayDay(null);
    this.reel.hidden = true;
    this.root.classList.remove('replaying');
    this.setModal(false);
    this.scheduleReveal(900);
    if (refocus) (this.dayLabels.get(date) && this.index === 2 ? this.dayLabels.get(date) : (this.panels[this.index]?.querySelector(`[data-date="${date}"]`) as HTMLElement | null))?.focus();
  }

  // Paging ----------------------------------------------------------------------------------------

  private settle(n: number): void {
    if (n !== this.index) {
      this.index = n;
      this.stage?.whoosh();
      if (n > 1) this.interruptReveal();
      else this.scheduleReveal(900);
    }
    this.fresh(n);
    this.navButtons.forEach((b, i) => b.setAttribute('aria-current', i === n ? 'page' : 'false'));
    // With large text the tabs scroll: keep the current one in view.
    if (this.nav.scrollWidth > this.nav.clientWidth) this.navButtons[n]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.panels.forEach((p, i) => p.setAttribute('aria-hidden', i === n ? 'false' : 'true'));
    this.panels.forEach((p, i) => ((p as HTMLElement & { inert: boolean }).inert = i !== n));
    this.root.dataset.screen = SCREENS[n];
    this.frameAround();
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
    const fold = (p.firstElementChild as HTMLElement | null)?.offsetHeight ?? 600;
    // Three separate things: how far the detail covers the world (the shade follows it), whether
    // the detail has reached the top (then its own bar takes over from the tabs), and whether
    // the world is fully hidden (then it can stop drawing).
    const cover = Math.min(1, p.scrollTop / Math.max(1, fold));
    this.stage?.setDimmed(cover >= 1);
    this.root.style.setProperty('--lift', String(cover));
    const lifted = p.scrollTop > fold - 96;
    if ((this.root.dataset.lifted === 'true') !== lifted) {
      this.root.dataset.lifted = String(lifted);
      this.syncLifted();
      if (lifted) this.interruptReveal();
      else this.scheduleReveal(900);
    }
  }

  /** While the detail is up, the tabs, flask and gear are out of reach: hidden and inert alike. */
  private syncLifted(): void {
    const lifted = this.root.dataset.lifted === 'true';
    const hud: Array<Element | null> = [this.nav, this.flask, document.querySelector('header.top .nav')];
    if (lifted && hud.some((el) => el?.contains(document.activeElement))) {
      (this.panels[this.index]?.querySelector('.below-up') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    if (this.onboarding || this.playing) return;
    for (const el of hud) if (el) (el as HTMLElement & { inert: boolean }).inert = lifted;
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

/** A tin flask outline. */
function flaskIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'flask-icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M10 2.5h4v2.2l1.6 1.9c.6.7.9 1.5.9 2.4V19a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 7.5 19V9c0-.9.3-1.7.9-2.4L10 4.7z');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function chevron(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M6 15l6-6 6 6');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** The water ring: one segment per glass of the goal (a continuous arc past 12). */
function ringSvg(n: number, of: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  const r = 26;
  const C = 2 * Math.PI * r;
  const segs = Math.max(1, Math.min(of, 12));
  const gap = of <= 12 ? 3.2 : 0;
  const seg = C / segs - gap;
  const mk = (cls: string, dash: string, off: number): void => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '30');
    c.setAttribute('cy', '30');
    c.setAttribute('r', String(r));
    c.setAttribute('class', cls);
    c.setAttribute('stroke-dasharray', dash);
    c.setAttribute('stroke-dashoffset', String(off));
    svg.append(c);
  };
  if (of <= 12) {
    mk('ring-bg', `${seg} ${gap}`, 0);
    const filled = Math.min(n, of);
    if (filled > 0) mk('ring-on', `${Array.from({ length: filled }, () => `${seg} ${gap}`).join(' ')} 0 ${C}`, 0);
  } else {
    mk('ring-bg', `${C} 0`, 0);
    mk('ring-on', `${(Math.min(n, of) / of) * C} ${C}`, 0);
  }
  return svg;
}

function entryOfToday(v: View, habit: string): Entry | undefined {
  return v.snapshot.logs[v.today.slice(0, 7)]?.days[v.today]?.[habit];
}
