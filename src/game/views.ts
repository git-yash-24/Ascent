/**
 * Week, month and year: each further back on the mountain, each sheet a summary first and the
 * organised detail below. Colour carries the same meaning everywhere: ember for days made,
 * frost for rest, grey for excused, a dashed outline for days missed; habits in their tag colour.
 */
import { addDays, compareDateKeys, weekStart } from '../core/model/date';
import { CLIMB } from '../core/habits/weekly';
import { standings, type Standing } from '../core/insights';
import type { DateKey, DayOutcome, Verdict } from '../core/model/types';
import type { View } from '../ui/controller';
import { h } from '../ui/dom';
import { pct, VERDICT_WORDS } from '../ui/format';
import { bar, dot, section, tiny, weekGauge } from './ui';
import { YEAR_STAGES, type TrailDay } from './trail';

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const OUTCOME_WORD: Record<DayOutcome, string> = {
  closed: 'camp made',
  partial: 'partial',
  rested: 'rest day',
  excused: 'sick, excused',
  missed: 'stayed put',
  free: 'nothing due',
  inProgress: 'today',
};

function dayCell(v: View, d: DateKey, label: string, cls = 'cell'): HTMLElement {
  const future = compareDateKeys(d, v.today) > 0;
  const dd = v.derived.days[d];
  const outcome = future ? 'future' : d === v.today ? 'today' : dd?.outcome ?? 'free';
  const el = h('span', { class: `${cls} o-${outcome}`, title: `${d}: ${future ? 'to come' : OUTCOME_WORD[(dd?.outcome ?? 'free') as DayOutcome]}` }, label);
  const f = dd?.progress ?? 0;
  if (!future) el.style.setProperty('--f', String(Math.round(f * 100) / 100));
  return el;
}

/** This week, Monday to Sunday, for the trail in the world. */
export function weekDays(v: View): TrailDay[] {
  const mon = weekStart(v.today);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(mon, i);
    const future = compareDateKeys(d, v.today) > 0;
    return { date: d, label: WD_LONG[i] ?? '', outcome: future ? 'future' : d === v.today ? 'inProgress' : v.derived.days[d]?.outcome ?? 'free', isToday: d === v.today };
  });
}

function standingRows(list: Standing[], pick: (s: Standing) => number | null, note: (s: Standing) => string): HTMLElement[] {
  return [...list]
    .sort((a, b) => a.family.id.localeCompare(b.family.id) || a.habit.name.localeCompare(b.habit.name))
    .map((s) =>
      h(
        'div',
        { class: 'g-row' },
        h('div', { class: 'g-row-top' }, h('span', { class: 'g-row-name' }, dot(s.family), s.habit.name), h('span', { class: 'g-row-val', text: pct(pick(s)) })),
        bar(pick(s), s.family.color),
        h('span', { class: 'g-row-meta', text: note(s) }),
      ),
    );
}

export class WeekSheet {
  readonly caption = h('div', { class: 'caption' });
  readonly compact = h('div', { class: 'glass block' });
  readonly detail = h('div', { class: 'detail' });

  /** `play`: replay a day in the world. */
  constructor(private readonly play: (d: DateKey) => void) {}

  render(v: View): void {
    const c = v.derived.climb;
    const cur = c.current;
    const steep = cur?.steep ?? false;
    const barAt = steep ? CLIMB.steepBar : CLIMB.climb;
    const score = cur?.score ?? 0;
    const mon = weekStart(v.today);
    this.caption.replaceChildren(
      h('span', { class: 'cap-day', text: `Week of ${short(mon)} · Stage ${c.stage + 1}` }),
      h('span', { class: 'cap-line', text: cur ? verdictLine(cur.verdict, score, barAt) : 'The week is unwritten.' }),
    );
    const days = h('div', { class: 'weekdays', role: 'group', 'aria-label': 'Days this week. Tap one to replay it.' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i);
      const future = compareDateKeys(d, v.today) > 0;
      const col = h('button', { class: 'wd', type: 'button', 'data-date': d, onclick: () => this.play(d) }, dayCell(v, d, '', 'wd-bar'), h('span', { class: 'wd-l', text: WD[i] ?? '' }));
      col.disabled = future;
      col.setAttribute('aria-label', `${WD_LONG[i]}: ${future ? 'to come' : d === v.today ? 'today' : OUTCOME_WORD[v.derived.days[d]?.outcome ?? 'free']}, ${pct(v.derived.days[d]?.progress ?? 0)}${future ? '' : '. Replay the day'}`);
      days.append(col);
    }
    const list = standings(v.snapshot, v.derived, v.today);
    const past = [...c.weeks].reverse().slice(0, 6);
    const focused = (document.activeElement as HTMLElement | null)?.dataset.date;
    this.compact.replaceChildren(
      h(
        'div',
        { class: 'big-head' },
        h('span', { class: 'big-v', text: pct(score) }),
        h('span', { class: 'big-l', text: cur ? `${steep ? 'Steep line · ' : ''}${verdictLine(cur.verdict, score, barAt)}` : 'No habits yet' }),
      ),
      weekGauge(score, barAt, [
        { at: CLIMB.hold, label: 'hold' },
        { at: barAt, label: 'climb' },
        { at: CLIMB.summit, label: 'summit' },
      ], pct(score)),
      days,
    );
    if (focused) (this.compact.querySelector(`[data-date="${focused}"]`) as HTMLElement | null)?.focus();
    this.detail.replaceChildren(
      h('div', { class: 'g-stats' }, tiny('week streak', String(c.weeklyChain)), tiny('head start', `${Math.round((cur?.headstartIn ?? 0) * 100)}%`), tiny('stage', `${c.stage + 1}`)),
      h('div', { class: 'glass block' }, section('Each habit this week', ...standingRows(list, (s) => s.thisWeek, (s) => `${s.group.name}${s.chain > 1 ? ` · streak ${s.chain}` : ''}`))),
      past.length
        ? h(
            'div',
            { class: 'glass block' },
            section(
              'Weeks behind',
              ...past.map((w) =>
                h('div', { class: `wk v-${w.verdict}` }, h('span', { class: 'wk-d', text: short(w.week) }), h('span', { class: 'wk-v', text: VERDICT_WORDS[w.verdict].done }), h('span', { class: 'wk-s', text: pct(w.score) })),
              ),
            ),
          )
        : '',
    );
  }
}

const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class MonthSheet {
  readonly caption = h('div', { class: 'caption' });
  readonly compact = h('div', { class: 'glass block' });
  readonly detail = h('div', { class: 'detail' });

  render(v: View): void {
    const first = `${v.today.slice(0, 8)}01`;
    const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`));
    const cal = h('div', { class: 'cal', role: 'grid', 'aria-label': `${name} calendar` });
    for (const l of WD) cal.append(h('span', { class: 'cal-h', 'aria-hidden': 'true', text: l }));
    const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cal.append(h('span', { class: 'cal-pad' }));
    const counts: Record<string, number> = { closed: 0, partial: 0, rested: 0, missed: 0 };
    const dates: DateKey[] = [];
    for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) {
      dates.push(d);
      cal.append(dayCell(v, d, String(Number(d.slice(8))), 'cal-d'));
      const o = v.derived.days[d]?.outcome;
      if (compareDateKeys(d, v.today) < 0 && o) {
        const k = o === 'excused' ? 'rested' : o;
        if (k in counts) counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    const shown = (counts.closed ?? 0) + (counts.partial ?? 0);
    this.caption.replaceChildren(h('span', { class: 'cap-day', text: name }), h('span', { class: 'cap-line', text: `${shown} ${shown === 1 ? 'day' : 'days'} on the route this month` }));

    // Per habit: days held or done out of the days it was due, this month so far.
    const list = standings(v.snapshot, v.derived, v.today);
    const rows = list.map((s) => {
      let due = 0;
      let held = 0;
      for (const d of dates) {
        if (compareDateKeys(d, v.today) > 0) break;
        const st = v.derived.days[d]?.states[s.habit.id];
        if (!st || st === 'unscheduled') continue;
        if (st === 'held' || st === 'fulfilled') held++;
        if (st !== 'skipped' && (d !== v.today || st === 'held' || st === 'fulfilled')) due++;
      }
      return { s, share: due ? held / due : null, note: `${held} of ${due} due days · ${s.group.name}` };
    });
    this.compact.replaceChildren(cal, h('div', { class: 'g-legend key' }, key('o-closed', 'camp made'), key('o-partial', 'partial'), key('o-rested', 'rest'), key('o-missed', 'missed')));
    this.detail.replaceChildren(
      h('div', { class: 'g-stats' }, tiny('made', String(counts.closed)), tiny('partial', String(counts.partial)), tiny('rest', String(counts.rested)), tiny('missed', String(counts.missed))),
      h(
        'div',
        { class: 'glass block' },
        section(
          'Each habit this month',
          ...rows
            .sort((a, b) => a.s.family.id.localeCompare(b.s.family.id))
            .map((r) =>
              h(
                'div',
                { class: 'g-row' },
                h('div', { class: 'g-row-top' }, h('span', { class: 'g-row-name' }, dot(r.s.family), r.s.habit.name), h('span', { class: 'g-row-val', text: pct(r.share) })),
                bar(r.share, r.s.family.color),
                h('span', { class: 'g-row-meta', text: r.note }),
              ),
            ),
        ),
      ),
      h('div', { class: 'glass block' }, section('Last 30 days', h('p', { class: 'g-line', text: `${pct(v.derived.rates.last30)} of due habits held · last 7 days ${pct(v.derived.rates.last7)}` }))),
    );
  }
}

export class YearSheet {
  readonly caption = h('div', { class: 'caption' });
  readonly compact = h('div', { class: 'glass block' });
  readonly detail = h('div', { class: 'detail' });

  render(v: View): void {
    const c = v.derived.climb;
    const d = v.derived;
    this.caption.replaceChildren(
      h('span', { class: 'cap-day', text: `Chapter ${c.chapter + 1} · Stage ${c.stage + 1}` }),
      h('span', { class: 'cap-line', text: `${d.lifetime.daysShownUp} ${d.lifetime.daysShownUp === 1 ? 'day' : 'days'} on the mountain` }),
    );
    const inChapter = c.stage % CLIMB.stagesPerChapter;
    const stages = h('div', { class: 'stages', role: 'img', 'aria-label': `Stage ${inChapter + 1} of ${CLIMB.stagesPerChapter} in chapter ${c.chapter + 1}` });
    for (let i = 0; i < CLIMB.stagesPerChapter; i++) stages.append(h('span', { class: i < inChapter ? 'st done' : i === inChapter ? 'st here' : 'st' }));

    const strip = h('div', { class: 'vstrip', role: 'list', 'aria-label': 'Weekly verdicts' });
    const weeks = [...c.weeks, ...(c.current ? [c.current] : [])].slice(-52);
    for (const w of weeks) {
      const s = h('span', { class: `vs ${w === c.current ? 'live' : `v-${w.verdict}`}`, role: 'listitem', title: `${w.week}: ${VERDICT_WORDS[w.verdict].done} ${pct(w.score)}` });
      s.setAttribute('aria-label', `Week of ${short(w.week)}: ${w === c.current ? 'in progress' : VERDICT_WORDS[w.verdict].done}`);
      strip.append(s);
    }

    // A year of days, one column per week (the newest on the right).
    const heat = h('div', { class: 'heat', 'aria-hidden': 'true' });
    const end = addDays(weekStart(v.today), 6);
    const start = addDays(weekStart(v.today), -7 * 25);
    for (let d = start; compareDateKeys(d, end) <= 0; d = addDays(d, 1)) heat.append(dayCell(v, d, '', 'hd'));

    const best = Object.values(d.chains).reduce((m, x) => Math.max(m, x.best), 0);
    const counts = countVerdicts(c.weeks.map((w) => w.verdict));
    this.compact.replaceChildren(
      h('div', { class: 'big-head' }, h('span', { class: 'big-v', text: `Ch ${c.chapter + 1}` }), h('span', { class: 'big-l', text: `Stage ${c.stage + 1} of ${YEAR_STAGES} on the route` })),
      stages,
    );
    this.detail.replaceChildren(
      h('div', { class: 'glass block' }, section('Weeks', strip, h('div', { class: 'g-legend key' }, key('v-summit', 'summit'), key('v-climb', 'climb'), key('v-hold', 'hold'), key('v-slip', 'slip'), key('v-rest', 'rest')))),
      h('div', { class: 'glass block' }, section('Six months of days', heat)),
      h('div', { class: 'g-stats' }, tiny('days shown up', String(d.lifetime.daysShownUp)), tiny('best streak', String(best)), tiny('climbs', String((counts.climb ?? 0) + (counts.summit ?? 0)))),
    );
  }
}

function countVerdicts(vs: Verdict[]): Partial<Record<Verdict, number>> {
  const out: Partial<Record<Verdict, number>> = {};
  for (const x of vs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function key(cls: string, label: string): HTMLElement {
  return h('span', { class: 'key-i' }, h('span', { class: `key-sw ${cls}` }), label);
}

function verdictLine(verdict: Verdict, score: number, barAt: number): string {
  if (verdict === 'rest') return 'Rest week';
  if (score >= CLIMB.summit) return 'Summit push';
  if (score >= barAt) return 'Climb secured';
  return `${Math.ceil((barAt - score) * 100)}% to the climb`;
}

function short(d: DateKey): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
}
