/**
 * Base camp, left of Today: trophies and gear, a league for every tag group (solo: consistency
 * against your own targets), the journal, and the advice corner. Four tabs, so the part under
 * the world stays small.
 */
import { advice, leagues, standings, TIERS, trophies, type League, type Trophy } from '../core/insights';
import { NOTE_MAX } from '../core/model/schemas';
import type { Controller, View } from '../ui/controller';
import { h } from '../ui/dom';
import { longDate, pct } from '../ui/format';
import { bar, dot } from './ui';

type Tab = 'trophies' | 'leagues' | 'journal' | 'advice';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'journal', label: 'Journal' },
  { id: 'trophies', label: 'Trophies' },
  { id: 'leagues', label: 'Leagues' },
  { id: 'advice', label: 'Advice' },
];

export class BaseCampSheet {
  readonly caption = h('div', { class: 'caption' });
  readonly compact = h('div', { class: 'glass block camp-tabs' });
  readonly detail = h('div', { class: 'detail' });
  private tab: Tab = 'journal';
  /** Over the world: one line for the tab (or today's note while Ari writes). */
  private peek = h('div', { class: 'peek', role: 'tabpanel', id: 'camp-panel' });
  private tabs: HTMLElement;
  private body = h('div', { class: 'tab-body', role: 'tabpanel' });
  private note: HTMLTextAreaElement;
  private noteState = h('span', { class: 'note-state', role: 'status' });
  private noteDate = '';

  constructor(
    private readonly app: Controller,
    private readonly say: (t: string) => void,
    /** Ari writes when you do. */
    private readonly onType: () => void = () => undefined,
  ) {
    this.tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Base camp' });
    for (const t of TABS) {
      const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': 'false', 'aria-controls': 'camp-panel' }, t.label);
      b.addEventListener('click', () => {
        this.tab = t.id;
        this.render(this.app.view());
      });
      b.addEventListener('keydown', (e) => {
        const i = TABS.findIndex((x) => x.id === this.tab);
        const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
        if (next < 0) return;
        e.preventDefault();
        this.tab = TABS[next]!.id;
        this.render(this.app.view());
        (this.tabs.children[next] as HTMLElement).focus();
      });
      this.tabs.append(b);
    }

    this.note = h('textarea', { class: 'note', rows: '2', maxlength: String(NOTE_MAX), 'aria-label': 'Today’s note', placeholder: 'One line about today. What helped, what got in the way.' });
    this.note.addEventListener('input', () => {
      this.noteState.textContent = 'Not saved yet';
      this.onType();
    });
    this.note.addEventListener('blur', () => this.saveNote(false));
    this.compact.append(this.tabs, this.peek);
    this.detail.append(h('div', { class: 'glass block' }, this.body));
  }

  private saveNote(announce: boolean): void {
    const v = this.app.view();
    const cur = v.snapshot.notes.entries[this.noteDate] ?? '';
    if (this.note.value.trim() === cur) {
      this.noteState.textContent = cur ? 'Saved' : '';
      return;
    }
    const r = this.app.saveNote(this.noteDate, this.note.value);
    this.noteState.textContent = r.ok ? 'Saved' : r.message;
    if (announce) this.say(r.ok ? 'Note saved.' : r.message);
  }

  render(v: View): void {
    const list = standings(v.snapshot, v.derived, v.today);
    const earned = trophies(v.derived).filter((t) => t.earned).length;
    this.caption.replaceChildren(h('span', { class: 'cap-day', text: 'Base camp' }), h('span', { class: 'cap-line', text: `${earned} ${earned === 1 ? 'mark' : 'marks'} earned · the tent, the gear, the notes` }));
    [...this.tabs.children].forEach((b, i) => {
      const on = TABS[i]!.id === this.tab;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    this.peek.setAttribute('aria-labelledby', `tab-${this.tab}`);
    this.body.setAttribute('aria-labelledby', `tab-${this.tab}`);
    if (this.tab === 'journal') {
      this.renderJournal(v);
      return;
    }
    const more = h('p', { class: 'peek-more', 'aria-hidden': 'true', text: 'Scroll for more' });
    if (this.tab === 'trophies') {
      const all = trophies(v.derived);
      const next = all.filter((t) => !t.earned).sort((a, b) => b.progress - a.progress)[0];
      this.peek.replaceChildren(h('p', { class: 'peek-line', text: `${earned} of ${all.length} earned${next ? ` · next: ${next.name}, ${Math.round(next.progress * 100)}%` : ''}` }), more);
      this.body.replaceChildren(...this.trophyGrid(all));
    } else if (this.tab === 'leagues') {
      const ls = leagues(list);
      const top = ls[0];
      this.peek.replaceChildren(
        h('p', { class: 'peek-line', text: top ? `${ls.length} ${ls.length === 1 ? 'league' : 'leagues'} · best: ${top.group.name}, ${TIERS.find((t) => t.id === top.tier)?.name ?? ''}` : 'Add a habit to join its league.' }),
        more,
      );
      this.body.replaceChildren(...this.leagueCards(ls));
    } else {
      const tips = advice(v.derived, list, v.today, v.steepAvailable).map((a) => {
        const card = h('p', { class: 'advice', text: a.text });
        if (a.family) card.style.setProperty('--fam', a.family.color);
        return card;
      });
      this.peek.replaceChildren(...tips.slice(0, 1), tips.length > 1 ? more : '');
      this.body.replaceChildren(...tips.slice(1));
    }
  }

  private trophyGrid(all: Trophy[]): HTMLElement[] {
    const grid = (kind: Trophy['kind']): HTMLElement => {
      const ul = h('ul', { class: 'trophies' });
      for (const t of all.filter((x) => x.kind === kind)) {
        const badge = h('span', { class: `badge ${t.kind}`, 'aria-hidden': 'true', text: t.name.slice(0, 1) });
        badge.style.setProperty('--p', String(Math.round(t.progress * 100)));
        ul.append(
          h(
            'li',
            { class: t.earned ? 'trophy on' : 'trophy', 'aria-label': `${t.name}: ${t.earned ? 'earned' : `${Math.round(t.progress * 100)}% there`}. ${t.how}.` },
            badge,
            h('span', { class: 'tr-name', text: t.name }),
            h('span', { class: 'tr-how', text: t.how }),
          ),
        );
      }
      return ul;
    };
    return [h('h3', { class: 'g-sec-h', text: 'Trophies' }), grid('trophy'), h('h3', { class: 'g-sec-h', text: 'Ari’s gear' }), grid('item')];
  }

  private leagueCards(ls: League[]): HTMLElement[] {
    if (ls.length === 0) return [h('p', { class: 'empty', text: 'Add a habit to join its league.' })];
    const intro = h('p', { class: 'hint', text: 'A league for every tag group. For now you climb against your own targets: consistency over the last four weeks.' });
    return [
      intro,
      ...ls.map((l) => {
        const tier = TIERS.find((t) => t.id === l.tier)!;
        const card = h(
          'article',
          { class: `league t-${l.tier}`, 'aria-label': `${l.group.name} league` },
          h(
            'header',
            { class: 'league-h' },
            dot(l.family),
            h('span', { class: 'league-name' }, h('b', { text: l.group.name }), h('span', { text: ` · ${l.family.name}` })),
            h('span', { class: 'tier', text: tier.name.replace(' league', '') }),
          ),
          h('ol', { class: 'board' }, ...l.board.map((s) => h('li', {}, h('span', { class: 'b-name', text: s.habit.name }), bar(s.consistency, l.family.color), h('span', { class: 'b-v', text: pct(s.consistency) })))),
          h('p', { class: 'league-next', text: l.next ? `${pct(l.consistency)} now · ${Math.round(l.next.at * 100)}% reaches ${TIERS.find((t) => t.id === l.next!.tier)!.name}` : `${pct(l.consistency)} · the top league` }),
        );
        card.style.setProperty('--fam', l.family.color);
        card.style.setProperty('--tint', l.family.tint);
        return card;
      }),
    ];
  }

  private renderJournal(v: View): void {
    const date = v.today;
    const stored = v.snapshot.notes.entries[date] ?? '';
    if (this.noteDate !== date || (document.activeElement !== this.note && this.note.value.trim() !== stored)) {
      this.noteDate = date;
      this.note.value = stored;
      this.noteState.textContent = stored ? 'Saved' : '';
    }
    const past = Object.entries(v.snapshot.notes.entries)
      .filter(([d]) => d < date)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14);
    const save = h('button', { class: 'btn small', type: 'button', onclick: () => this.saveNote(true) }, 'Save note');
    // Today's note sits over the world, so you write while Ari does.
    if (!this.peek.contains(this.note)) {
      this.peek.replaceChildren(h('label', { class: 'g-sec-h', for: 'note-today', text: longDate(date) }), this.note, h('div', { class: 'note-row' }, this.noteState, save));
      this.note.id = 'note-today';
    }
    this.body.replaceChildren(
      h('h3', { class: 'g-sec-h', text: 'Earlier pages' }),
      past.length
        ? h('ol', { class: 'notes' }, ...past.map(([d, t]) => h('li', {}, h('span', { class: 'n-d', text: longDate(d) }), h('span', { class: 'n-t', text: t }))))
        : h('p', { class: 'hint', text: 'Notes from earlier days collect here.' }),
    );
  }
}
