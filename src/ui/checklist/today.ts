/**
 * Today: the accessible checklist (spec: Accessibility; build plan M8).
 *
 * Works with no world, no sound, no motion and no mouse. Rows are keyed by habit and updated
 * in place, so focus and a half-typed number survive every save and sync event.
 */
import { addDays, compareDateKeys, weekStart } from '../../core/model/date';
import { entryOn } from '../../core/model/entries';
import { CLIMB } from '../../core/habits/weekly';
import { versionOn } from '../../core/habits/versions';
import type { DateKey, Habit, HabitDayState, HabitVersion, SkipReason } from '../../core/model/types';
import type { Controller, View } from '../controller';
import { clear, glyph, h } from '../dom';
import {
  dayChip,
  editWindow,
  isAmount,
  longDate,
  pct,
  scheduleText,
  SKIP_REASONS,
  skipLabel,
  STATE_WORDS,
  unitOf,
  VERDICT_WORDS,
} from '../format';

interface Row {
  li: HTMLLIElement;
  key: string;
  glyphSlot: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  tap?: HTMLButtonElement;
  input?: HTMLInputElement;
  value?: HTMLElement;
  more: HTMLButtonElement;
  skips: HTMLElement;
  lastState?: string;
}

const COACH: Record<string, string> = {
  empty: 'The fire is out. One thing first.',
  inProgress: 'The fire is out. One thing first.',
  partial: 'Moving. Keep the pace.',
  closed: 'Camp is made. Rest well.',
  rested: 'Rest is part of the climb.',
  excused: 'Get well. The mountain waits.',
  missed: 'That day is behind you.',
  free: 'Nothing is due. A quiet day.',
};

export class TodayView {
  readonly root: HTMLElement;
  private rows = new Map<string, Row>();
  private list: HTMLUListElement;
  private later: HTMLUListElement;
  private laterWrap: HTMLElement;
  private summary: HTMLElement;
  private days: HTMLElement;
  private banners: HTMLElement;
  private loggingFor: HTMLElement;
  private announce: HTMLElement;

  constructor(private readonly app: Controller) {
    this.summary = h('section', { class: 'summary', 'aria-label': 'Where you stand' });
    this.days = h('nav', { class: 'days', 'aria-label': 'Day to log' });
    this.loggingFor = h('p', { class: 'logging-for', role: 'status' });
    this.banners = h('div', { class: 'banners' });
    this.list = h('ul', { class: 'habits', 'aria-label': 'Habits due' });
    this.later = h('ul', { class: 'habits later', 'aria-label': 'Not due' });
    this.laterWrap = h('section', { class: 'later-wrap' }, h('h2', { class: 'sub', text: 'Not due' }), this.later);
    this.announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    this.root = h('main', { class: 'today', id: 'today' }, this.summary, this.banners, this.days, this.loggingFor, this.list, this.laterWrap, this.announce);
  }

  render(v: View): void {
    this.renderSummary(v);
    this.renderBanners(v);
    this.renderDays(v);
    this.renderRows(v);
  }

  private say(text: string): void {
    this.announce.textContent = '';
    // A fresh text node makes screen readers announce the same message twice in a row.
    requestAnimationFrame(() => (this.announce.textContent = text));
  }

  private renderSummary(v: View): void {
    const d = v.derived;
    const day = d.days[v.today];
    const f = day?.progress ?? 0;
    const cur = d.climb.current;
    const outcome = day?.outcome ?? 'free';
    const anyLogged = Object.values(day?.states ?? {}).some((s) => s !== 'open' && s !== 'unscheduled' && s !== 'missed');
    const coach = anyLogged || outcome === 'free' ? COACH[outcome] ?? '' : COACH.empty;
    const steep = cur?.steep ?? false;
    const bar = steep ? CLIMB.steepBar : CLIMB.climb;
    clear(this.summary);
    this.summary.append(
      h('p', { class: 'coach', text: coach ?? '' }),
      h(
        'div',
        { class: 'stats' },
        stat('Story day', String(d.storyDayEarned)),
        stat('Stage', `${d.climb.stage + 1}`, `Chapter ${d.climb.chapter + 1}`),
        stat('Week streak', String(d.climb.weeklyChain)),
      ),
      meter('Today’s walk', f, pct(f), [], 'walk'),
      meter(
        steep ? 'This week · steep line' : 'This week',
        cur?.score ?? 0,
        cur ? weekText(cur.score ?? 0, bar, cur.verdict, cur.comeback) : '—',
        [
          { at: CLIMB.hold, label: 'hold' },
          { at: bar, label: 'climb' },
          { at: CLIMB.summit, label: 'summit' },
        ],
        'week',
      ),
    );
  }

  private renderBanners(v: View): void {
    clear(this.banners);
    const st = v.store;
    if (v.pendingJump) {
      this.banners.append(
        banner('Your clock moved ahead', `Is today ${longDate(v.pendingJump.to)}? Days are not closed until you confirm.`, [
          ['Yes, it is', () => this.app.confirmJump(true)],
          ['No, keep my day', () => this.app.confirmJump(false)],
        ]),
      );
    }
    if (st.offline) this.banners.append(banner('Offline', 'Showing your last synced record. Ticks are saved on this device and sync when you are back.', []));
    if (st.noDeviceStorage) this.banners.append(banner('This device cannot keep offline copies', 'Ticks are saved only once they reach your account.', []));
    if (st.problems.length) this.banners.append(banner('Some stored data could not be read', 'It is set aside, not shown. See Setup, Sync.', [['Open Setup', () => (location.hash = '#setup-sync')]]));
    if (st.rejected.length) this.banners.append(banner('Some changes were refused by your account', 'See Setup, Sync.', [['Open Setup', () => (location.hash = '#setup-sync')]]));
    if (v.backupDue) this.banners.append(banner('Weekly backup', 'Save a copy of your record to this device.', [['Save a backup', () => (location.hash = '#setup-backup')]]));
    if (v.steepAvailable) {
      this.banners.append(
        banner('Take the steep line?', 'This week the climb needs 70%. Reach it and next week starts 10% ahead. Fall short and you hold.', [
          ['Take the steep line', () => this.report(this.app.chooseSteep(), 'Steep line taken. The bar is 70% this week.')],
        ]),
      );
    }
  }

  private renderDays(v: View): void {
    clear(this.days);
    for (const d of editWindow(v.today)) {
      const out = v.derived.days[d]?.outcome;
      const b = h(
        'button',
        {
          class: 'chip',
          'aria-pressed': d === v.viewDate ? 'true' : 'false',
          'aria-label': `${dayChip(d, v.today)}, ${longDate(d)}${out && d !== v.today ? `, ${out}` : ''}`,
          onclick: () => this.app.setViewDate(d),
        },
        dayChip(d, v.today),
      );
      this.days.append(b);
    }
    this.loggingFor.textContent = v.viewDate === v.today ? longDate(v.today) : `Logging for ${longDate(v.viewDate)}`;
    this.loggingFor.classList.toggle('past', v.viewDate !== v.today);
  }

  private visible(v: View): Array<{ h: Habit; ver: HabitVersion; state: HabitDayState; due: boolean }> {
    const date = v.viewDate;
    const out: Array<{ h: Habit; ver: HabitVersion; state: HabitDayState; due: boolean }> = [];
    for (const hb of v.snapshot.habits.habits) {
      if (compareDateKeys(hb.createdOn, date) > 0) continue;
      const ver = versionOn(hb, date);
      if (!ver || ver.archived) continue;
      const state = v.derived.days[date]?.states[hb.id] ?? 'open';
      const due = state !== 'unscheduled';
      // A chosen-weekday habit on an off day is not shown: a tick there would not count.
      if (!due && ver.schedule.kind === 'weekdays') continue;
      out.push({ h: hb, ver, state, due });
    }
    return out;
  }

  private renderRows(v: View): void {
    const items = this.visible(v);
    const keep = new Set<string>();
    const due: HTMLLIElement[] = [];
    const later: HTMLLIElement[] = [];
    for (const it of items) {
      const key = `${it.h.id}|${isAmount(it.ver) ? 'amount' : 'tap'}`;
      keep.add(key);
      let row = this.rows.get(key);
      if (!row) {
        row = this.buildRow(it.h, it.ver, key);
        this.rows.set(key, row);
      }
      this.updateRow(row, v, it.h, it.ver, it.state);
      (it.due ? due : later).push(row.li);
    }
    for (const [key, row] of this.rows) {
      if (!keep.has(key)) {
        row.li.remove();
        this.rows.delete(key);
      }
    }
    syncChildren(this.list, due);
    syncChildren(this.later, later);
    this.laterWrap.hidden = later.length === 0;
    if (items.length === 0) {
      this.list.replaceChildren(h('li', { class: 'empty', text: 'No habits yet. Add one in Setup.' }));
    }
  }

  private buildRow(hb: Habit, ver: HabitVersion, key: string): Row {
    const id = hb.id;
    const glyphSlot = h('span', { class: 'glyph-slot' });
    const name = h('span', { class: 'name' });
    const meta = h('span', { class: 'meta' });
    const skipsId = `skips-${id}`;
    const more = h('button', { class: 'more', 'aria-expanded': 'false', 'aria-controls': skipsId }, h('span', { 'aria-hidden': 'true', text: '•••' }));
    const skips = h('div', { class: 'skips', id: skipsId, role: 'group', hidden: true });
    for (const r of SKIP_REASONS) {
      skips.append(h('button', { class: 'skip', onclick: () => this.doSkip(hb, r.reason) }, r.label));
    }
    skips.append(h('button', { class: 'skip clear', onclick: () => this.doClear(hb) }, 'Clear'));
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      skips.hidden = !open;
      if (open) (skips.querySelector('button') as HTMLButtonElement | null)?.focus();
    });
    skips.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        more.setAttribute('aria-expanded', 'false');
        skips.hidden = true;
        more.focus();
      }
    });

    const text = h('span', { class: 'text' }, name, meta);
    const row: Row = { li: h('li', { class: 'habit', 'data-id': id }), key, glyphSlot, name, meta, more, skips };

    if (!isAmount(ver)) {
      const tap = h('button', { class: 'tap', role: 'checkbox', 'aria-checked': 'false', onclick: () => this.doToggle(hb) }, glyphSlot, text);
      row.tap = tap;
      row.li.append(h('div', { class: 'line' }, tap, more), skips);
    } else {
      const inputId = `amount-${id}`;
      const input = h('input', {
        id: inputId,
        class: 'amount',
        type: 'number',
        inputmode: 'numeric',
        min: '0',
        step: 'any',
        'aria-describedby': `meta-${id}`,
      });
      meta.id = `meta-${id}`;
      const value = h('span', { class: 'value', 'aria-hidden': 'true' });
      const commit = (): void => {
        if (input.value.trim() === '') return;
        const n = Number(input.value);
        if (!Number.isFinite(n) || n < 0) {
          this.say('Use a number from 0 up.');
          return;
        }
        this.doSet(hb, n);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      });
      const step = (dir: 1 | -1): void => {
        const v = this.app.view();
        const ver2 = versionOn(hb, v.viewDate) ?? ver;
        const cur = entryOn(v.snapshot, v.viewDate, hb.id)?.v ?? 0;
        const inc = Math.max(1, Math.round(ver2.target / 10));
        this.doSet(hb, Math.max(0, cur + dir * inc));
      };
      const minus = h('button', { class: 'step', onclick: () => step(-1) }, h('span', { 'aria-hidden': 'true', text: '−' }));
      const plus = h('button', { class: 'step', onclick: () => step(1) }, h('span', { 'aria-hidden': 'true', text: '+' }));
      const full = h('button', { class: 'full', onclick: () => this.doSet(hb, (versionOn(hb, this.app.view().viewDate) ?? ver).target) }, 'Full');
      row.input = input;
      row.value = value;
      const label = h('label', { class: 'head', for: inputId }, glyphSlot, text, value);
      row.li.append(h('div', { class: 'line' }, label, more), h('div', { class: 'controls' }, minus, input, plus, full), skips);
    }
    return row;
  }

  private updateRow(row: Row, v: View, hb: Habit, ver: HabitVersion, state: HabitDayState): void {
    const e = entryOn(v.snapshot, v.viewDate, hb.id);
    const chain = v.derived.chains[hb.id];
    row.li.dataset.state = state;
    if (row.lastState !== state) {
      row.glyphSlot.replaceChildren(glyph(state));
      row.lastState = state;
    }
    row.name.textContent = hb.name;
    const parts: string[] = [];
    if (e?.skip !== undefined) parts.push(skipLabel(e.skip));
    if (ver.schedule.kind === 'perWeek' || ver.schedule.kind === 'perMonth') parts.push(quotaText(v, hb, ver));
    else parts.push(scheduleText(ver.schedule));
    if (chain && chain.current > 1) parts.push(`streak ${chain.current}`);
    row.meta.textContent = parts.join(' · ');
    row.more.setAttribute('aria-label', `More options for ${hb.name}`);

    if (row.tap) {
      const done = state === 'fulfilled';
      row.tap.setAttribute('aria-checked', done ? 'true' : state === 'skipped' ? 'mixed' : 'false');
      row.tap.setAttribute('aria-label', `${hb.name}, ${STATE_WORDS[state]}${ver.type === 'avoid' ? ', avoided today' : ''}`);
    }
    if (row.input && row.value) {
      const unit = unitOf(ver);
      const val = e?.v;
      row.value.textContent = `${val ?? 0} / ${ver.target}${unit ? ` ${unit}` : ''}`;
      row.input.setAttribute('aria-label', `${hb.name}, ${unit || 'amount'}, target ${ver.target}, ${STATE_WORDS[state]}`);
      if (document.activeElement !== row.input) row.input.value = val === undefined ? '' : String(val);
      row.input.placeholder = '0';
      const [minus, , plus] = row.li.querySelectorAll<HTMLButtonElement>('.controls button');
      minus?.setAttribute('aria-label', `Less ${hb.name}`);
      plus?.setAttribute('aria-label', `More ${hb.name}`);
      row.li.querySelector('.full')?.setAttribute('aria-label', `Set ${hb.name} to the full ${ver.target}`);
    }
  }

  // Actions ----------------------------------------------------------------------------------

  private mark(): number {
    return performance.now();
  }

  private measured(t0: number): void {
    const ms = performance.now() - t0;
    const w = window as unknown as { __ascent?: { tapToStored: number[] } };
    w.__ascent?.tapToStored.push(ms);
  }

  private doToggle(hb: Habit): void {
    const t0 = this.mark();
    const r = this.app.toggle(hb.id);
    this.measured(t0);
    this.after(hb, r);
  }

  private doSet(hb: Habit, n: number): void {
    const t0 = this.mark();
    const r = this.app.setValue(hb.id, n);
    this.measured(t0);
    this.after(hb, r);
  }

  private doSkip(hb: Habit, reason: SkipReason): void {
    const r = this.app.skip(hb.id, reason);
    this.collapse(hb);
    this.after(hb, r);
  }

  private doClear(hb: Habit): void {
    const r = this.app.clearEntry(hb.id);
    this.collapse(hb);
    this.after(hb, r);
  }

  private collapse(hb: Habit): void {
    for (const row of this.rows.values()) {
      if (row.li.dataset.id !== hb.id) continue;
      row.more.setAttribute('aria-expanded', 'false');
      row.skips.hidden = true;
      row.more.focus();
    }
  }

  private after(hb: Habit, r: { ok: true } | { ok: false; message: string }): void {
    if (!r.ok) {
      this.say(r.message);
      return;
    }
    const v = this.app.view();
    const state = v.derived.days[v.viewDate]?.states[hb.id] ?? 'open';
    const f = v.derived.days[v.viewDate]?.progress ?? 0;
    this.say(`${hb.name} ${STATE_WORDS[state]}. ${v.viewDate === v.today ? 'Today' : 'That day'} ${pct(f)}.`);
  }

  private report(r: { ok: true } | { ok: false; message: string }, okText: string): void {
    this.say(r.ok ? okText : r.message);
  }
}

function quotaText(v: View, hb: Habit, ver: HabitVersion): string {
  const s = ver.schedule;
  if (s.kind !== 'perWeek' && s.kind !== 'perMonth') return '';
  const days = s.kind === 'perWeek' ? weekDates(v.viewDate) : monthDates(v.viewDate);
  let held = 0;
  for (const d of days) {
    const st = v.derived.days[d]?.states[hb.id];
    if (st === 'held' || st === 'fulfilled') held++;
  }
  return `${held} of ${s.n} this ${s.kind === 'perWeek' ? 'week' : 'month'}`;
}

function weekDates(d: DateKey): DateKey[] {
  const mon = weekStart(d);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
}

function monthDates(d: DateKey): DateKey[] {
  const first = `${d.slice(0, 8)}01`;
  const out: DateKey[] = [];
  for (let x = first; x.slice(0, 7) === d.slice(0, 7); x = addDays(x, 1)) out.push(x);
  return out;
}

function stat(label: string, value: string, note?: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'label', text: label }), h('span', { class: 'num', text: value }), note ? h('span', { class: 'note', text: note }) : null);
}

/**
 * The live week line. Below the climb ledge it names the distance, not a verdict: on a Monday
 * morning the week is unwritten, not slipping.
 */
function weekText(score: number, bar: number, verdict: string, comeback: boolean): string {
  const extra = comeback ? ' · comeback climb' : '';
  if (verdict === 'rest') return 'Rest week';
  if (score >= bar) return `${pct(score)} · ${VERDICT_WORDS[verdict === 'summit' ? 'summit' : 'climb'].now}${extra}`;
  return `${pct(score)} · ${Math.ceil((bar - score) * 100)}% to the climb${extra}`;
}

function meter(label: string, value: number, text: string, marks: Array<{ at: number; label: string }>, kind: string): HTMLElement {
  const fill = h('span', { class: 'fill' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  const track = h('span', { class: 'track', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value * 100)), 'aria-label': label, 'aria-valuetext': text }, fill);
  for (const m of marks) {
    const tick = h('span', { class: 'tick', title: `${Math.round(m.at * 100)}% ${m.label}` });
    tick.style.left = `${m.at * 100}%`;
    track.append(tick);
  }
  return h('div', { class: `meter m-${kind}` }, h('div', { class: 'meter-head' }, h('span', { class: 'label', text: label }), h('span', { class: 'val', text })), track);
}

function banner(title: string, body: string, actions: Array<[string, () => void]>): HTMLElement {
  return h(
    'div',
    { class: 'banner', role: 'region', 'aria-label': title },
    h('p', { class: 'b-title', text: title }),
    h('p', { class: 'b-body', text: body }),
    actions.length ? h('div', { class: 'b-actions' }, ...actions.map(([t, fn]) => h('button', { class: 'btn', onclick: fn }, t))) : null,
  );
}

/** Put `want` in order under `parent`, moving only what moved (keeps focus on kept nodes). */
function syncChildren(parent: HTMLElement, want: HTMLElement[]): void {
  for (const c of [...parent.children]) if (!want.includes(c as HTMLElement)) c.remove();
  want.forEach((el, i) => {
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
}

