/**
 * Today's sheet: the compact part under the world (chips and the flask), and the organised
 * detail further down. Chips are keyed by habit and updated in place so focus survives saves.
 */
import { entryOn } from '../core/model/entries';
import { versionOn } from '../core/habits/versions';
import { CLIMB } from '../core/habits/weekly';
import { tagOf, type TagFamily } from '../core/tags';
import type { Habit, HabitDayState, HabitVersion, SkipReason } from '../core/model/types';
import type { Controller, View } from '../ui/controller';
import { glyph, h } from '../ui/dom';
import { dayChip, editWindow, longDate, pct, skipLabel, STATE_WORDS, unitOf, VERDICT_WORDS } from '../ui/format';
import { holdable } from './hold';
import { campState, momentumStep, waterDue } from '../core/world';
import { reducedMotion } from '../ui/motion';
import { bar, dot, section, weekGauge, type OptionsSheet } from './ui';

const COACH: Record<string, string> = {
  empty: 'Embers from last night. One thing first.',
  first: 'The first morning. One thing, and she sets off.',
  cold: 'The fire is out. One thing relights it.',
  partial: 'Moving. Keep the pace.',
  closed: 'Camp is made. Ari takes the route.',
  rested: 'Rest is part of the climb.',
  excused: 'Get well. The mountain waits.',
  missed: 'That day is behind you.',
  free: 'Nothing is due. A quiet day.',
};

interface Chip {
  li: HTMLLIElement;
  btn: HTMLButtonElement;
  glyph: HTMLElement;
  name: HTMLElement;
  val: HTMLElement;
  state?: string;
}

export interface TodayHooks {
  /** A tap landed: the world answers (spark, fire, sound). */
  pulse(x: number, y: number, done: boolean): void;
  say(text: string): void;
}

export class TodaySheet {
  readonly caption: HTMLElement;
  readonly compact: HTMLElement;
  readonly detail: HTMLElement;
  private chips = new Map<string, Chip>();
  private list: HTMLUListElement;
  private head: HTMLElement;
  private alerts: HTMLElement;
  private water: HTMLElement;
  private body: HTMLElement;
  private weekEl: HTMLElement;
  private last: View | null = null;
  private undoBar: HTMLElement;
  private undoTimer = 0;
  /** A finger is on the list, or a change was just made: rows keep their places until it settles. */
  private pressing = false;
  private settleAt = 0;
  private resortTimer = 0;

  constructor(
    private readonly app: Controller,
    private readonly opts: OptionsSheet,
    private readonly hooks: TodayHooks,
  ) {
    this.caption = h('div', { class: 'caption', 'aria-live': 'off' });
    this.head = h('div', { class: 'sheet-head' });
    this.alerts = h('div', { class: 'alerts' });
    this.list = h('ul', { class: 'chips', 'aria-label': 'Habits. Hold to mark done; tap for the amount, attempted or rest.' });
    this.undoBar = h('div', { class: 'undo', hidden: true, role: 'status' });
    this.list.addEventListener('pointerdown', () => (this.pressing = true));
    const release = (): void => {
      if (!this.pressing) return;
      this.pressing = false;
      this.settleAt = performance.now() + 700;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    this.water = h('section', { class: 'flask glass', 'aria-label': 'Water today' });
    this.body = h('div', { class: 'detail-body' });
    this.weekEl = h('div', { class: 'detail-body' });
    // Over the world: only the checklist (and an alert when one needs you).
    this.compact = h('div', { class: 'compact-today' }, this.alerts, this.undoBar, this.list, h('span', { id: 'chip-how', class: 'sr-only', text: 'Hold to mark done. Tap for options.' }));
    // Scrolling down: the day you are logging and its habits first; then water (always today),
    // then the week and what comes next at camp.
    this.detail = h('div', { class: 'detail' }, h('div', { class: 'glass block' }, this.head, this.body), this.water, this.weekEl);
    setInterval(() => this.last && this.renderWater(this.last), 60_000);
  }

  render(v: View): void {
    this.last = v;
    this.renderCaption(v);
    this.renderHead(v);
    this.renderAlerts(v);
    this.renderChips(v);
    this.renderWater(v);
    this.renderDetail(v);
  }

  private renderCaption(v: View): void {
    const d = v.derived;
    const day = d.days[v.today];
    const outcome = day?.outcome ?? 'free';
    const anyLogged = Object.values(day?.states ?? {}).some((s) => s !== 'open' && s !== 'unscheduled' && s !== 'missed');
    const waiting = d.storyDayEarned === 0 ? COACH.first : momentumStep(d, v.today) >= 3 ? COACH.cold : COACH.empty;
    const line = outcome === 'free' ? COACH.free : anyLogged ? COACH[outcome] ?? COACH.partial : waiting;
    this.caption.replaceChildren(
      h('span', { class: 'cap-day', text: `Trail day ${Math.max(1, d.storyDayEarned)} · Stage ${d.climb.stage + 1} · Week ${pct(d.climb.current?.score ?? 0)}` }),
      h('span', { class: 'cap-line coach', text: line ?? '' }),
    );
  }

  private renderHead(v: View): void {
    const pills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Day to log' });
    for (const d of editWindow(v.today)) {
      pills.append(
        h(
          'button',
          { class: 'pill', type: 'button', 'aria-pressed': d === v.viewDate ? 'true' : 'false', 'aria-label': `${dayChip(d, v.today)}, ${longDate(d)}`, onclick: () => this.app.setViewDate(d) },
          dayChip(d, v.today),
        ),
      );
    }
    const summary = daySummary(v, this.visible(v));
    this.head.replaceChildren(
      h('div', { class: 'head-l' }, pills, h('p', { class: 'head-sub', text: v.viewDate === v.today ? summary : `Logging for ${longDate(v.viewDate)} · ${summary}` })),
    );
    this.head.classList.toggle('past', v.viewDate !== v.today);
  }

  private renderAlerts(v: View): void {
    const items: HTMLElement[] = [];
    const st = v.store;
    const alert = (text: string, action?: [string, () => void]): HTMLElement =>
      h('div', { class: 'alert', role: 'status' }, h('span', { text }), action ? h('button', { class: 'btn small', type: 'button', onclick: action[1] }, action[0]) : null);
    if (v.pendingJump) {
      items.push(
        h(
          'div',
          { class: 'alert', role: 'alert' },
          h('span', { text: `Your clock moved ahead. Is today ${longDate(v.pendingJump.to)}?` }),
          h('button', { class: 'btn small', type: 'button', onclick: () => this.app.confirmJump(true) }, 'Yes'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => this.app.confirmJump(false) }, 'No'),
        ),
      );
    }
    if (st.offline) items.push(alert('Offline. Ticks are kept here and sync later.'));
    if (st.noDeviceStorage) items.push(alert('This device cannot keep offline copies.'));
    if (st.problems.length || st.rejected.length) items.push(alert('Some data needs a look.', ['Open', () => (location.hash = '#setup-sync')]));
    if (v.backupDue) items.push(alert('Weekly backup due.', ['Save', () => (location.hash = '#setup-backup')]));
    if (v.steepAvailable) {
      items.push(
        alert('Steep line: 70% this week for a 10% head start next week.', [
          'Take it',
          () => {
            const r = this.app.chooseSteep();
            this.hooks.say(r.ok ? 'Steep line taken. The bar is 70% this week.' : r.message);
          },
        ]),
      );
    }
    this.alerts.replaceChildren(...items);
    this.alerts.hidden = items.length === 0;
  }

  private visible(v: View): Array<{ h: Habit; ver: HabitVersion; state: HabitDayState }> {
    const out: Array<{ h: Habit; ver: HabitVersion; state: HabitDayState }> = [];
    for (const hb of v.snapshot.habits.habits) {
      if (hb.system || hb.createdOn > v.viewDate) continue;
      const ver = versionOn(hb, v.viewDate);
      if (!ver || ver.archived) continue;
      const state = v.derived.days[v.viewDate]?.states[hb.id] ?? 'open';
      if (state === 'unscheduled' && ver.schedule.kind === 'weekdays') continue;
      out.push({ h: hb, ver, state });
    }
    return out
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (a.x.ver.time ?? '99:99').localeCompare(b.x.ver.time ?? '99:99') || a.i - b.i)
      .map(({ x }) => x);
  }

  private renderChips(v: View): void {
    // Open first, settled (done or rested) below, not due last; the usual order inside each.
    const items = this.visible(v)
      .map((x, i) => ({ x, i }))
      .sort((a, b) => rank(a.x.state) - rank(b.x.state) || a.i - b.i)
      .map(({ x }) => x);
    const keep = new Set<string>();
    const order: HTMLLIElement[] = [];
    for (const it of items) {
      keep.add(it.h.id);
      let c = this.chips.get(it.h.id);
      if (!c) {
        c = this.buildChip(it.h);
        this.chips.set(it.h.id, c);
      }
      this.updateChip(c, v, it.h, it.ver, it.state);
      order.push(c.li);
    }
    for (const [id, c] of this.chips) {
      if (!keep.has(id)) {
        c.li.remove();
        this.chips.delete(id);
      }
    }
    for (const c of [...this.list.children]) if (!order.includes(c as HTMLLIElement)) c.remove();
    const now = performance.now();
    if (this.pressing || now < this.settleAt) {
      // Never move a row under a finger or straight after a change: new rows join the end, the
      // rest wait until the press is over.
      for (const el of order) if (el.parentElement !== this.list) this.list.append(el);
      window.clearTimeout(this.resortTimer);
      this.resortTimer = window.setTimeout(() => this.last && this.renderChips(this.last), Math.max(80, this.settleAt - now + 20));
    } else this.reorder(order);
    if (items.length === 0) this.list.replaceChildren(h('li', { class: 'empty', text: 'No habits yet. Add one in Setup.' }));
  }

  /** Move rows to their new places, gliding from where they were; focus stays on its row. */
  private reorder(order: HTMLLIElement[]): void {
    const same = order.every((el, i) => this.list.children[i] === el);
    if (same) return;
    const before = new Map<HTMLLIElement, number>();
    for (const el of order) if (el.parentElement === this.list) before.set(el, el.getBoundingClientRect().top);
    const focused = document.activeElement as HTMLElement | null;
    const hadFocus = focused && this.list.contains(focused) ? focused : null;
    order.forEach((el, i) => {
      if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] ?? null);
    });
    if (hadFocus && document.activeElement !== hadFocus) hadFocus.focus({ preventScroll: true });
    if (reducedMotion()) return;
    for (const [el, top] of before) {
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetWidth;
      el.style.transition = 'transform .32s cubic-bezier(.2, .8, .2, 1)';
      el.style.transform = '';
    }
  }

  private buildChip(hb: Habit): Chip {
    const g = h('span', { class: 'gchip-glyph' });
    const name = h('span', { class: 'gchip-name' });
    const val = h('span', { class: 'gchip-val' });
    const btn = h('button', { class: 'gchip', type: 'button', 'aria-haspopup': 'dialog', 'aria-describedby': 'chip-how', 'data-id': hb.id }, g, h('span', { class: 'gchip-text' }, name, val));
    // Hold is done (the quick way); a tap opens everything else, Mark done included.
    holdable(btn, {
      tap: (p) => void this.options(hb.id, btn, p.via === 'key', p.via === 'pointer' ? p : undefined),
      hold: () => this.markDone(hb.id, btn),
      menu: () => void this.options(hb.id, btn, true),
    });
    return { li: h('li', {}, btn), btn, glyph: g, name, val };
  }

  private updateChip(c: Chip, v: View, hb: Habit, ver: HabitVersion, state: HabitDayState): void {
    const { family } = tagOf(hb);
    const e = entryOn(v.snapshot, v.viewDate, hb.id);
    c.btn.style.setProperty('--fam', family.color);
    c.btn.style.setProperty('--tint', family.tint);
    c.btn.dataset.state = state;
    if (c.state !== state) {
      c.glyph.replaceChildren(glyph(state));
      c.state = state;
    }
    c.name.textContent = hb.name;
    const unit = unitOf(ver);
    const counted = ver.type === 'numeric' || ver.type === 'duration';
    let val = '';
    if (e?.skip !== undefined) val = skipLabel(e.skip);
    else if (counted) val = `${fmt(e?.v ?? 0)}/${fmt(ver.target)}${unit ? ` ${unit}` : ''}`;
    else if (state === 'attempted') val = 'attempted';
    else if (ver.time) val = clockText(ver.time);
    else if (state === 'unscheduled') val = 'not due';
    c.val.textContent = val;
    c.btn.setAttribute('aria-label', `${hb.name}, ${family.name}, ${STATE_WORDS[state]}${val && val !== 'not due' ? `, ${val}` : ''}`);
  }

  /** Hold: done, or empty again when it already was. Saved first; the world answers after. */
  private markDone(id: string, el: HTMLElement): void {
    const v0 = this.app.view();
    const date = v0.viewDate;
    const prev = this.app.entryFields(date, id);
    const t0 = performance.now();
    this.settleAt = t0 + 700;
    const r = this.app.tapDone(id);
    (window as unknown as { __ascent?: { tapToStored: number[] } }).__ascent?.tapToStored.push(performance.now() - t0);
    this.report(id, r);
    if (!r.ok) return;
    const v = this.app.view();
    const state = v.derived.days[date]?.states[id];
    const b = el.getBoundingClientRect();
    this.hooks.pulse(b.left + b.width / 2, b.top + b.height / 2, state === 'fulfilled');
    this.offerUndo(id, date, prev);
  }

  /** Tap: the options sheet (amount, mark done, attempted, rest). */
  private async options(id: string, opener: HTMLElement, typing: boolean, from?: { x: number; y: number }): Promise<void> {
    const v = this.app.view();
    const hb = v.snapshot.habits.habits.find((x) => x.id === id);
    const ver = hb ? versionOn(hb, v.viewDate) : undefined;
    if (!hb || !ver) return;
    const date = v.viewDate;
    const prev = this.app.entryFields(date, id);
    const cur = entryOn(v.snapshot, date, id)?.v;
    const done = v.derived.days[date]?.states[id] === 'fulfilled';
    const day = date === v.today ? null : longDate(date);
    const choice = await this.opts.open({ name: hb.name, family: tagOf(hb).family, ver, opener, done, day, typing, ...(from ? { from: { x: from.x, y: from.y } } : {}), ...(cur !== undefined ? { current: cur } : {}) });
    if (!choice) return;
    this.settleAt = performance.now() + 600;
    const r =
      choice.kind === 'attempt'
        ? choice.amount !== undefined
          ? this.app.setValue(id, choice.amount)
          : this.app.attempt(id)
        : choice.kind === 'skip'
          ? this.app.skip(id, choice.reason)
          : choice.kind === 'clear'
            ? this.app.clearEntry(id)
            : this.app.complete(id);
    this.report(id, r);
    if (!r.ok) return;
    const state = this.app.view().derived.days[date]?.states[id];
    const b = opener.getBoundingClientRect();
    if (choice.kind === 'done' || choice.kind === 'attempt') this.hooks.pulse(b.left + b.width / 2, b.top + b.height / 2, state === 'fulfilled');
    this.offerUndo(id, date, prev);
  }

  /** A few seconds to take it back: Undo restores exactly what was there, not an empty entry. */
  private offerUndo(id: string, date: string, prev: { v?: number; skip?: SkipReason } | null): void {
    const v = this.app.view();
    const hb = v.snapshot.habits.habits.find((x) => x.id === id);
    const state = v.derived.days[date]?.states[id] ?? 'open';
    window.clearTimeout(this.undoTimer);
    const undo = h('button', { class: 'btn small ghost', type: 'button' }, 'Undo');
    undo.addEventListener('click', () => {
      window.clearTimeout(this.undoTimer);
      this.undoBar.hidden = true;
      this.settleAt = performance.now() + 600;
      const r = this.app.revert(date, id, prev);
      this.hooks.say(r.ok ? `${hb?.name ?? 'Habit'}: undone.` : r.message);
      (this.chips.get(id)?.btn as HTMLElement | undefined)?.focus();
    });
    this.undoBar.replaceChildren(h('span', { text: `${hb?.name ?? 'Habit'} · ${STATE_WORDS[state]}` }), undo);
    this.undoBar.hidden = false;
    this.undoTimer = window.setTimeout(() => {
      if (!this.undoBar.contains(document.activeElement)) this.undoBar.hidden = true;
      else this.undoTimer = window.setTimeout(() => (this.undoBar.hidden = true), 4000);
    }, 6000);
  }

  private report(id: string, r: { ok: true } | { ok: false; message: string }): void {
    if (!r.ok) {
      this.hooks.say(r.message);
      return;
    }
    const v = this.app.view();
    const hb = v.snapshot.habits.habits.find((x) => x.id === id);
    const state = v.derived.days[v.viewDate]?.states[id] ?? 'open';
    this.hooks.say(`${hb?.name ?? 'Habit'} ${STATE_WORDS[state]}. ${v.viewDate === v.today ? 'Today' : 'That day'} ${pct(v.derived.days[v.viewDate]?.progress ?? 0)}.`);
  }

  private renderWater(v: View): void {
    const w = v.derived.water;
    this.water.hidden = !w;
    if (!w) return;
    const full = w.today >= w.target;
    const due = waterDue(w, Date.now(), v.snapshot.profile?.settings.timeZone);
    this.water.dataset.due = String(due);
    const cells = h('span', { class: 'flask-cells', 'aria-hidden': 'true' });
    for (let i = 0; i < w.target; i++) cells.append(h('span', { class: i < w.today ? 'fc on' : 'fc' }));
    const line = full ? `Flask full${w.streak > 1 ? ` · ${w.streak} days` : ''}` : due ? 'Time for water' : `${w.today} of ${w.target} glasses`;
    const add = h('button', { class: 'btn glass', type: 'button', 'aria-label': `Add a glass of water. ${w.today} of ${w.target} today.` }, '+ Glass');
    add.addEventListener('click', () => {
      const r = this.app.addGlass(1);
      const now = this.app.view().derived.water;
      this.hooks.say(r.ok ? `${now?.today ?? 0} of ${now?.target ?? 0} glasses.` : r.message);
      (this.water.querySelector('.glass') as HTMLButtonElement | null)?.focus();
    });
    const less = h('button', { class: 'btn ghost less', type: 'button', 'aria-label': 'Remove a glass' }, h('span', { 'aria-hidden': 'true', text: '−' }));
    less.disabled = w.today === 0;
    less.addEventListener('click', () => {
      const r = this.app.addGlass(-1);
      this.hooks.say(r.ok ? 'One glass removed.' : r.message);
      (this.water.querySelector('.less') as HTMLButtonElement | null)?.focus();
    });
    const refocus = (document.activeElement as HTMLElement | null)?.classList;
    const which = refocus?.contains('glass') && this.water.contains(document.activeElement) ? 'glass' : refocus?.contains('less') && this.water.contains(document.activeElement) ? 'less' : null;
    this.water.replaceChildren(h('div', { class: 'flask-text' }, h('span', { class: 'flask-l', text: line }), cells), less, add);
    if (which) (this.water.querySelector(`.${which}`) as HTMLButtonElement | null)?.focus();
  }

  private renderDetail(v: View): void {
    const date = v.viewDate;
    const items = this.visible(v);
    const fams = new Map<string, { family: TagFamily; rows: HTMLElement[]; groups: Set<string> }>();
    for (const it of items) {
      const { family, group } = tagOf(it.h);
      const e = entryOn(v.snapshot, date, it.h.id);
      const credit = it.ver.target > 0 ? Math.min(1, (e?.v ?? 0) / it.ver.target) : 0;
      const chain = v.derived.chains[it.h.id];
      const unit = unitOf(it.ver);
      const counted = it.ver.type === 'numeric' || it.ver.type === 'duration';
      const text = e?.skip !== undefined ? skipLabel(e.skip) : counted ? `${fmt(e?.v ?? 0)} of ${fmt(it.ver.target)}${unit ? ` ${unit}` : ''}` : STATE_WORDS[it.state];
      const row = h(
        'div',
        { class: 'g-row', 'data-state': it.state },
        h('div', { class: 'g-row-top' }, h('span', { class: 'g-row-name', text: it.h.name }), h('span', { class: 'g-row-val', text })),
        bar(it.state === 'skipped' ? 0 : credit, family.color),
        h('span', { class: 'g-row-meta', text: [group.name, chain && chain.current > 1 ? `streak ${chain.current}` : '', chain && chain.best > 1 ? `best ${chain.best}` : ''].filter(Boolean).join(' · ') }),
      );
      const f = fams.get(family.id) ?? { family, rows: [], groups: new Set<string>() };
      f.rows.push(row);
      f.groups.add(group.name);
      fams.set(family.id, f);
    }
    const groups = [...fams.values()].map((f) =>
      h(
        'div',
        { class: 'fam' },
        h('h4', { class: 'fam-h' }, dot(f.family), h('span', { text: f.family.name })),
        ...f.rows,
      ),
    );
    groups.forEach((g, i) => g.style.setProperty('--fam', [...fams.values()][i]!.family.color));

    const cur = v.derived.climb.current;
    const steep = cur?.steep ?? false;
    const barAt = steep ? CLIMB.steepBar : CLIMB.climb;
    const score = cur?.score ?? 0;
    const week = section(
      steep ? 'This week · steep line' : 'This week',
      h('p', { class: 'g-line', text: cur ? weekLong(score, barAt, cur.verdict, cur.comeback, cur.headstartIn) : 'The week starts with your first habit.' }),
      weekGauge(score, barAt, [
        { at: CLIMB.hold, label: 'hold' },
        { at: barAt, label: 'climb' },
        { at: CLIMB.summit, label: 'summit' },
      ], pct(score)),
      h('div', { class: 'g-legend', 'aria-hidden': 'true' }, h('span', { text: '30% hold' }), h('span', { text: `${Math.round(barAt * 100)}% climb` }), h('span', { text: '85% summit' })),
    );
    // Group headings only earn their place with more than one group.
    const rows = fams.size > 1 ? groups : [...fams.values()].flatMap((f) => f.rows);
    this.body.replaceChildren(...rows);
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': `This week ${pct(score)}; the climb needs ${Math.round(barAt * 100)}%` });
    ring.style.setProperty('--p', String(Math.round(score * 100)));
    ring.style.setProperty('--bar', String(Math.round(barAt * 100)));
    ring.append(h('span', { class: 'ring-v', text: pct(score) }), h('span', { class: 'ring-l', text: 'week' }));
    // Score and threshold side by side, above the gauge.
    const line = week.querySelector('.g-line')!;
    const ref = line.nextSibling;
    const top = h('div', { class: 'week-top' }, ring, line);
    week.insertBefore(top, ref);
    this.weekEl.replaceChildren(h('div', { class: 'glass block' }, week, nextAtCamp(v.derived.storyDayEarned)));
  }
}

function weekLong(score: number, bar: number, verdict: string, comeback: boolean, headstart: number): string {
  const bits = [verdict === 'rest' ? 'Rest week' : score >= bar ? VERDICT_WORDS[score >= CLIMB.summit ? 'summit' : 'climb'].now : `the climb needs ${Math.round(bar * 100)}%`];
  if (headstart > 0) bits.push(`${Math.round(headstart * 100)}% head start`);
  if (comeback) bits.push('comeback climb: two stages if you make it');
  return `This week ${pct(score)} · ${bits.join(' · ')}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function clockText(t: string): string {
  const [hh, mm] = t.split(':').map(Number);
  const h12 = (((hh ?? 0) + 11) % 12) + 1;
  return `${h12}:${String(mm ?? 0).padStart(2, '0')} ${(hh ?? 0) < 12 ? 'am' : 'pm'}`;
}


/**
 * The next thing Ari makes at camp, and honestly how far off it is. Trail days are the story
 * clock: days with at least one habit held or done, or rested; sick days and misses do not count.
 */
function nextAtCamp(storyDay: number): HTMLElement | null {
  const n = campState(storyDay).next;
  if (!n) return null;
  return h(
    'div',
    { class: 'head-next' },
    h('p', { text: `Next at camp: ${n.name}, after ${n.inDays} more trail ${n.inDays === 1 ? 'day' : 'days'}.` }),
    h('p', { class: 'head-def', text: 'A trail day is any day with at least one habit held or done, or a rest day.' }),
  );
}

/** Sorting: what still needs you, then what is settled, then what is not due today. */
function rank(s: HabitDayState): number {
  return s === 'fulfilled' || s === 'skipped' ? 1 : s === 'unscheduled' ? 2 : 0;
}

/** What the day stands at, in counts, never a percentage that hides what it is out of. */
function daySummary(v: View, items: Array<{ state: HabitDayState }>): string {
  const out = v.derived.days[v.viewDate]?.outcome;
  if (out === 'rested') return 'Rest day: everything rested';
  if (out === 'excused') return 'Sick day: paused';
  const due = items.filter((i) => i.state !== 'unscheduled' && i.state !== 'skipped');
  if (due.length === 0) return 'Nothing due';
  const done = due.filter((i) => i.state === 'fulfilled').length;
  const held = due.filter((i) => i.state === 'held').length;
  const rest = items.filter((i) => i.state === 'skipped').length;
  return [`${done} of ${due.length} done`, held ? `${held} held` : '', rest ? `${rest} resting` : ''].filter(Boolean).join(' · ');
}
