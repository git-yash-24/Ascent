import { describe, expect, it } from 'vitest';
import { FAMILIES, suggestTag, tagOf } from '../../src/core/tags';
import { Q, R } from '../fixtures/build';

describe('coloured tags', () => {
  it.each([
    ['Qbank', 'study', 'medical-exams'],
    ['Review mistakes', 'study', 'medical-exams'],
    ['FMGE block', 'study', 'medical-exams'],
    ['Workout', 'body', 'strength'],
    ['Run 5 km', 'body', 'cardio'],
    ['No phone first hour', 'mind', 'screen-time'],
    ['Call mom', 'social', 'family'],
    ['Read 20 pages', 'study', 'reading'],
    ['Sleep by 11', 'rest', 'sleep'],
    ['Guitar practice', 'craft', 'music'],
    ['Track spending', 'work', 'money'],
    ['Something unusual', 'mind', 'focus'],
  ])('suggests %s as %s / %s', (name, fam, grp) => {
    expect(suggestTag(name)).toEqual({ family: fam, group: grp });
  });

  it('short keys match whole words only', () => {
    expect(suggestTag('Brunch')).toEqual({ family: 'mind', group: 'focus' });
  });

  it('uses the stored tag, else a suggestion, and water is hydration', () => {
    expect(tagOf({ ...R('2026-10-12'), tag: { family: 'body', group: 'cardio' } }).group.id).toBe('cardio');
    expect(tagOf(Q('2026-10-12')).family.id).toBe('study');
    expect(tagOf({ ...R('2026-10-12'), system: 'water', name: 'Water' }).group.id).toBe('hydration');
  });

  it('every family has a distinct colour and unique group ids', () => {
    expect(new Set(FAMILIES.map((f) => f.color)).size).toBe(FAMILIES.length);
    for (const f of FAMILIES) expect(new Set(f.groups.map((g) => g.id)).size).toBe(f.groups.length);
  });
});
