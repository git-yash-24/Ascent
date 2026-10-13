/** Trail beats and the day replay's captions. */
import { describe, expect, it } from 'vitest';
import { dayBeat, obstacleFor } from '../../src/game/beats';
import { dayCards } from '../../src/game/montage';
import { derive } from '../../src/core/derive';
import { Q, R, day, log, withHabits } from '../fixtures/build';
import type { View } from '../../src/ui/controller';
import { longDate } from '../../src/ui/format';
import type { Snapshot } from '../../src/core/model/types';

const D = '2026-10-12';

function view(s: Snapshot, today: string): View {
  return { snapshot: s, derived: derive(s, { date: today, ended: false }), today, viewDate: today } as unknown as View;
}

describe('trail beats', () => {
  it('the same day always tells the same story; days differ', () => {
    expect(dayBeat(D, 'closed')).toEqual(dayBeat(D, 'closed'));
    const kinds = new Set(Array.from({ length: 30 }, (_, i) => obstacleFor(day(D, i))));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('only days walked cross an obstacle; rest, sick and missed days leave a mark instead', () => {
    expect(dayBeat(D, 'closed').obstacle).not.toBeNull();
    expect(dayBeat(D, 'partial').obstacle).toBe(dayBeat(D, 'closed').obstacle);
    expect(dayBeat(D, 'partial').line).not.toBe(dayBeat(D, 'closed').line);
    expect(dayBeat(D, 'rested')).toMatchObject({ obstacle: null, camp: 'tent' });
    expect(dayBeat(D, 'excused')).toMatchObject({ obstacle: null, camp: 'storm' });
    expect(dayBeat(D, 'missed')).toMatchObject({ obstacle: null, camp: 'drift' });
    expect(dayBeat(D, 'future').camp).toBe('none');
  });
});

describe('day replay captions', () => {
  it('opens on the beat, lists what was done before what was not, quotes the journal, ends on the outcome', () => {
    let s = withHabits(Q(D), R(D));
    s = log(log(s, D, 'Q', 50), D, 'R', 0);
    s = { ...s, notes: { schema: 1, entries: { [D]: 'Phone in the other room.' } } };
    const cards = dayCards(view(s, day(D, 1)), D);
    expect(cards[0]?.text).toBe(dayBeat(D, 'partial').line);
    expect(cards.map((c) => c.kicker)).toEqual([longDate(D), 'Qbank', 'Review mistakes', 'From the journal', 'The day']);
    expect(cards[1]).toMatchObject({ text: '50 questions' });
    expect(cards[2]).toMatchObject({ text: 'Missed', dim: true });
    expect(cards[3]).toMatchObject({ quote: true, text: 'Phone in the other room.' });
    expect(cards[4]?.text).toBe('Partway up');
  });

  it('a rest day says so', () => {
    const s = log(withHabits(R(D)), D, 'R', 'rest');
    const cards = dayCards(view(s, day(D, 1)), D);
    expect(cards.find((c) => c.kicker === 'Review mistakes')?.text).toBe('Rest day');
    expect(cards.at(-1)?.text).toBe('A rest day');
  });
});
