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
import type { Accent, DateKey, TrailSymbol } from '../core/model/types';
import { campState, momentumStep, weatherOf } from '../core/world';
import { ACCENTS } from './kit';
import { markPicker } from './onboard';
import type { Controller, View } from '../ui/controller';
import { h } from '../ui/dom';
import { BaseCampSheet } from './basecamp';
import { holdable } from './hold';
import { CARD_SECONDS, dayCards, type Card } from './montage';
import { Stage, type TrailDay } from './stage';
import { TodaySheet } from './today';
import { OptionsSheet } from './ui';
import { MonthSheet, WeekSheet, weekDays, YearSheet } from './views';

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
  private revealed = new Set<string>();
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
    this.pager = h('div', { class: 'pager' });
    SCREENS.forEach((s, i) => {
      const b = h('button', { class: 'screen-btn', type: 'button', 'aria-controls': `s-${s}` }, LABEL[s]);
      b.addEventListener('click', () => this.go(i, true));
      nav.append(b);
      this.navButtons.push(b);
      const sheet = this.sheets[s];
      const gap = h('div', { class: 'gap' }, sheet.caption);
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
            h('button', { class: 'below-up', type: 'button', 'aria-label': `Back to the ${LABEL[s].toLowerCase()} view`, onclick: () => panel.scrollTo({ top: 0, behavior: 'smooth' }) }, chevron()),
          ),
          sheet.detail,
        ),
      );
      new ResizeObserver(() => panel.style.setProperty('--compact', `${sheet.compact.offsetHeight}px`)).observe(sheet.compact);
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
    this.reel.addEventListener('click', () => this.stopDay());
    this.reel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.stopDay();
    });

    const shade = h('div', { class: 'shade', 'aria-hidden': 'true' });
    this.root = h('div', { class: 'game' }, this.canvas, this.fallback, shade, this.labels, nav, this.pager, this.flask, this.reel, this.announce, opts.el, this.flaskMenu);
    // The HUD fades when you are not touching anything, and returns on any touch or key.
    const wake = (): void => {
      document.body.classList.remove('hud-idle');
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        if (this.root.isConnected && !this.onboarding && !document.querySelector('dialog[open]')) document.body.classList.add('hud-idle');
      }, 4500);
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
    wake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') window.setTimeout(() => this.maybeGreet(), 900);
    });
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
      } else this.stage.onFrame = () => this.placeLabels();
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
    const now = Date.now();
    if (last && last.day === v.today && now - last.at < 4 * 3600_000) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: v.today, at: now }));
    } catch {
      // without storage she greets at most once per load
    }
    this.stage.greet();
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
  }

  /** Show a mark on the camp while it is being chosen. */
  preview(m: { symbol?: TrailSymbol; accent?: Accent }): void {
    this.stage?.setExpedition(m.symbol, ACCENTS[m.accent ?? 'ash']);
  }

  /** The travelling home: improvements earned by story days; a new one is shown being found. */
  private renderCamp(v: View): void {
    if (!this.stage) return;
    const camp = campState(v.derived.storyDayEarned);
    const ids = camp.built.map((i) => i.id);
    this.stage.setCamp(ids);
    const fresh = ids.filter((id) => !v.snapshot.seen.moments.includes(`camp:${id}`) && !this.revealed.has(id));
    if (fresh.length === 0) {
      this.campReady = true;
      return;
    }
    // Reveal only the newest, and only on the Today or Camp screens once the world is up.
    const id = fresh.at(-1)!;
    if (this.index <= 1 && !this.onboarding && !this.playing) {
      for (const f of fresh) this.revealed.add(f);
      window.setTimeout(() => this.stage?.reveal(id), this.campReady ? 400 : 2200);
      for (const f of fresh) this.app.markSeen(`camp:${f}`);
      this.say(`New at camp: ${camp.built.find((i) => i.id === id)?.name ?? 'something'}.`);
    }
    this.campReady = true;
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
    const since = w.lastAt === null ? null : (Date.now() - w.lastAt) / 60_000;
    const due = w.today < w.target && (since === null ? new Date().getHours() >= 9 : since >= 120);
    this.flask.dataset.due = String(due);
    this.flask.style.setProperty('--level', String(Math.min(1, w.today / Math.max(1, w.target))));
    (this.flask.querySelector('.flask-n') as HTMLElement).textContent = `${w.today}/${w.target}`;
    const ring = this.flask.querySelector('.flask-ring') as HTMLElement;
    if (ring.dataset.k !== `${w.today}/${w.target}`) {
      ring.dataset.k = `${w.today}/${w.target}`;
      ring.replaceChildren(ringSvg(w.today, w.target));
    }
    this.flask.setAttribute('aria-label', `Drink a glass of water. ${w.today} of ${w.target} today.${due ? ' Time for water.' : ''} Hold for more.`);
  }

  private openFlaskMenu(): void {
    const w = this.app.view().derived.water;
    if (!w) return;
    const close = (): void => this.flaskMenu.close();
    const less = h('button', { class: 'btn', type: 'button', onclick: () => (this.glass(-1), close()) }, 'Remove a glass');
    less.disabled = w.today === 0;
    this.flaskMenu.replaceChildren(
      h('h2', { class: 'opts-title', text: 'Water' }),
      h('p', { class: 'opts-hint', text: `${w.today} of ${w.target} glasses today${w.streak > 1 ? ` · full ${w.streak} days in a row` : ''}. The goal is in Setup.` }),
      h('div', { class: 'opts-foot' }, less, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Close')),
    );
    this.flaskMenu.showModal();
    less.focus();
    this.flaskMenu.addEventListener('close', () => this.flask.focus(), { once: true });
  }

  // The world's labels and touches ------------------------------------------------------------

  private pokeable(el: HTMLElement): void {
    let down: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    el.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 500) this.stage?.poke(e.clientX, e.clientY);
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
    const bar = h('div', { class: 'reel-progress' });
    const card = h('div', { class: 'reel-card glass', 'aria-live': 'polite' });
    const skip = h('button', { class: 'reel-skip', type: 'button', text: 'Close' });
    this.reel.replaceChildren(h('div', { class: 'bars top' }), h('div', { class: 'bars bottom' }), card, bar, skip);
    for (let i = 0; i < cards.length; i++) bar.append(h('span', {}));
    this.reel.hidden = false;
    this.root.classList.add('replaying');
    skip.focus();
    let k = 0;
    const show = (c: Card): void => {
      card.replaceChildren(h('span', { class: 'reel-k', text: c.kicker }), h('span', { class: `reel-t${c.quote ? ' quote' : ''}`, text: c.quote ? `“${c.text}”` : c.text }));
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
    this.reel.hidden = true;
    this.root.classList.remove('replaying');
    if (refocus) (this.dayLabels.get(date) && this.index === 2 ? this.dayLabels.get(date) : (this.panels[this.index]?.querySelector(`[data-date="${date}"]`) as HTMLElement | null))?.focus();
  }

  // Paging ----------------------------------------------------------------------------------------

  private settle(n: number): void {
    if (n !== this.index) {
      this.index = n;
      this.stage?.whoosh();
    }
    this.fresh(n);
    this.navButtons.forEach((b, i) => b.setAttribute('aria-current', i === n ? 'page' : 'false'));
    this.panels.forEach((p, i) => p.setAttribute('aria-hidden', i === n ? 'false' : 'true'));
    this.panels.forEach((p, i) => ((p as HTMLElement & { inert: boolean }).inert = i !== n));
    this.root.dataset.screen = SCREENS[n];
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
    const lift = Math.min(1, p.scrollTop / Math.max(1, fold * 0.6));
    this.stage?.setDimmed(lift >= 1);
    this.root.style.setProperty('--lift', String(lift));
    this.root.dataset.lifted = String(lift > 0.55);
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
