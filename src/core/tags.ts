/**
 * Coloured habit tags: nine broad families, each with one colour, and named groups inside them.
 * A habit's group is suggested from its name and can be changed with one tap. Each group is a
 * community: the same group across players is what leaderboards and leagues will gather around
 * (solo for now; docs/decisions/game-screen.md).
 *
 * Colour theory: the families sit at even steps round the hue wheel at matched lightness, so
 * no family reads as more important than another on the night palette, and neighbours in
 * meaning (study and mind, body and health) sit apart enough to tell at a glance.
 */
import type { Habit } from './model/types';

export interface TagGroup {
  id: string;
  name: string;
  /** Lower-case words or phrases that suggest this group, most specific first. */
  keys: string[];
}

export interface TagFamily {
  id: string;
  name: string;
  /** Main colour, for marks and chips on the dark ground. */
  color: string;
  /** A deep tint of the same hue, for filled surfaces behind text. */
  tint: string;
  groups: TagGroup[];
}

export const FAMILIES: TagFamily[] = [
  {
    id: 'study',
    name: 'Study',
    color: '#7FA6FF',
    tint: '#1B2645',
    groups: [
      { id: 'medical-exams', name: 'Medical exams', keys: ['qbank', 'q bank', 'fmge', 'usmle', 'plab', 'neet', 'nbme', 'uworld', 'amboss', 'mcq', 'review mistakes', 'mistakes', 'anki', 'flashcard', 'exam'] },
      { id: 'languages', name: 'Languages', keys: ['duolingo', 'language', 'spanish', 'french', 'german', 'japanese', 'korean', 'vocab'] },
      { id: 'reading', name: 'Reading', keys: ['read', 'book', 'pages', 'chapter'] },
      { id: 'courses', name: 'Courses', keys: ['course', 'lecture', 'class', 'study', 'revise', 'revision', 'notes'] },
    ],
  },
  {
    id: 'mind',
    name: 'Mind',
    color: '#B897FF',
    tint: '#2A1F45',
    groups: [
      { id: 'meditation', name: 'Meditation', keys: ['meditat', 'breath', 'mindful', 'calm'] },
      { id: 'screen-time', name: 'Screen time', keys: ['no phone', 'phone', 'screen', 'social media', 'instagram', 'tiktok', 'scroll', 'youtube'] },
      { id: 'journaling', name: 'Journaling', keys: ['journal', 'diary', 'reflect'] },
      { id: 'focus', name: 'Focus', keys: ['focus', 'deep', 'pomodoro'] },
    ],
  },
  {
    id: 'spirit',
    name: 'Spirit',
    color: '#E890D8',
    tint: '#3A1C36',
    groups: [
      { id: 'prayer', name: 'Prayer', keys: ['pray', 'prayer', 'namaz', 'salah', 'quran', 'bible', 'gita', 'church', 'temple', 'mass'] },
      { id: 'gratitude', name: 'Gratitude', keys: ['gratitude', 'grateful', 'thank'] },
    ],
  },
  {
    id: 'social',
    name: 'People',
    color: '#FF8FA3',
    tint: '#3D1C25',
    groups: [
      { id: 'family', name: 'Family', keys: ['mom', 'mum', 'dad', 'parent', 'family', 'call home', 'sister', 'brother'] },
      { id: 'friends', name: 'Friends', keys: ['friend', 'text', 'message', 'meet'] },
      { id: 'kindness', name: 'Kindness', keys: ['kind', 'help', 'volunteer', 'compliment'] },
    ],
  },
  {
    id: 'body',
    name: 'Body',
    color: '#FF8B6A',
    tint: '#3D2018',
    groups: [
      { id: 'strength', name: 'Strength', keys: ['gym', 'lift', 'weights', 'push-up', 'pushup', 'push up', 'squat', 'pull-up', 'pullup', 'plank', 'workout'] },
      { id: 'cardio', name: 'Cardio', keys: ['run', 'jog', 'walk', 'steps', 'cycle', 'bike', 'swim', 'cardio', 'hike'] },
      { id: 'mobility', name: 'Mobility', keys: ['yoga', 'stretch', 'mobility', 'posture'] },
      { id: 'sport', name: 'Sport', keys: ['football', 'basketball', 'badminton', 'tennis', 'cricket', 'sport'] },
    ],
  },
  {
    id: 'craft',
    name: 'Craft',
    color: '#F5BE55',
    tint: '#3A2C10',
    groups: [
      { id: 'writing', name: 'Writing', keys: ['write', 'writing', 'blog', 'novel', 'essay'] },
      { id: 'music', name: 'Music', keys: ['guitar', 'piano', 'sing', 'music', 'drum', 'violin'] },
      { id: 'art', name: 'Art and design', keys: ['draw', 'paint', 'sketch', 'design', 'figma', 'art'] },
      { id: 'code', name: 'Code', keys: ['code', 'coding', 'program', 'leetcode', 'github'] },
    ],
  },
  {
    id: 'work',
    name: 'Work',
    color: '#D2D86A',
    tint: '#2F3112',
    groups: [
      { id: 'money', name: 'Money', keys: ['budget', 'save', 'saving', 'invest', 'spend', 'money', 'expense'] },
      { id: 'deep-work', name: 'Deep work', keys: ['work', 'client', 'project', 'email', 'inbox'] },
      { id: 'career', name: 'Career', keys: ['career', 'resume', 'cv', 'apply', 'interview'] },
    ],
  },
  {
    id: 'health',
    name: 'Health',
    color: '#5FD39A',
    tint: '#123323',
    groups: [
      { id: 'hydration', name: 'Hydration', keys: ['water', 'hydrate', 'drink'] },
      { id: 'nutrition', name: 'Nutrition', keys: ['eat', 'fruit', 'vegetable', 'veg', 'protein', 'sugar', 'junk', 'fast', 'meal', 'diet', 'cook'] },
      { id: 'care', name: 'Self-care', keys: ['floss', 'teeth', 'skincare', 'skin', 'shower', 'vitamin', 'medicine', 'meds', 'supplement'] },
    ],
  },
  {
    id: 'rest',
    name: 'Rest',
    color: '#5CCAD6',
    tint: '#11303A',
    groups: [
      { id: 'sleep', name: 'Sleep', keys: ['sleep', 'bed', 'wake', 'alarm', 'early'] },
      { id: 'recovery', name: 'Recovery', keys: ['nap', 'rest', 'sauna', 'recover'] },
    ],
  },
];

const BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

/** Where an unrecognised habit starts; the person can move it with one tap. */
export const FALLBACK = { family: 'mind', group: 'focus' } as const;

export function family(id: string): TagFamily {
  return BY_ID.get(id) ?? (BY_ID.get(FALLBACK.family) as TagFamily);
}

export function group(familyId: string, groupId: string): TagGroup {
  const f = family(familyId);
  return f.groups.find((g) => g.id === groupId) ?? (f.groups[0] as TagGroup);
}

/** Suggest a family and group from a habit's name. Longest matching phrase wins. */
export function suggestTag(name: string): { family: string; group: string } {
  const text = ` ${name.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ')} `;
  let best: { family: string; group: string; len: number } | null = null;
  for (const f of FAMILIES) {
    for (const g of f.groups) {
      for (const k of g.keys) {
        const hit = k.length <= 3 ? text.includes(` ${k} `) : text.includes(k);
        if (hit && (!best || k.length > best.len)) best = { family: f.id, group: g.id, len: k.length };
      }
    }
  }
  return best ? { family: best.family, group: best.group } : { ...FALLBACK };
}

/** The habit's tag: the stored one, or a suggestion for habits created before tags existed. */
export function tagOf(h: Habit): { family: TagFamily; group: TagGroup } {
  const t = h.tag ?? (h.system === 'water' ? { family: 'health', group: 'hydration' } : suggestTag(h.name));
  return { family: family(t.family), group: group(t.family, t.group) };
}
