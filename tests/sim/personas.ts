/**
 * Ten people for the 14-week speedrun. Each has habits, a time zone, devices and a way of using
 * the app, written as a plan for each day: what they do, when (minutes after local midnight;
 * past 1440 is after midnight), on which device. Seeded, so every run is the same run.
 */
import type { Definition } from '../../src/core/habits/versions';
import type { SkipReason } from '../../src/core/model/types';

export type Ev =
  | { t: number; dev?: number; kind: 'open' }
  | { t: number; dev?: number; kind: 'done'; habit: string }
  | { t: number; dev?: number; kind: 'amount'; habit: string; v: number }
  | { t: number; dev?: number; kind: 'attempt'; habit: string; v?: number }
  | { t: number; dev?: number; kind: 'skip'; habit: string; reason: SkipReason }
  | { t: number; dev?: number; kind: 'glass'; n?: number }
  | { t: number; dev?: number; kind: 'unglass' }
  | { t: number; dev?: number; kind: 'note'; text: string }
  | { t: number; dev?: number; kind: 'backfill'; habit: string; v?: number; daysAgo?: number }
  | { t: number; dev?: number; kind: 'correct'; habit: string; daysAgo: number; v: number | null }
  | { t: number; dev?: number; kind: 'edit'; habit: string; def: Definition }
  | { t: number; dev?: number; kind: 'archive' | 'restore'; habit: string }
  | { t: number; dev?: number; kind: 'add'; name: string; def: Definition }
  | { t: number; dev?: number; kind: 'remove'; habit: string }
  | { t: number; dev?: number; kind: 'boundary'; minutes: number }
  | { t: number; dev?: number; kind: 'zone'; zone: string }
  | { t: number; dev?: number; kind: 'offline'; on: boolean }
  | { t: number; dev?: number; kind: 'roundtrip' }
  | { t: number; dev?: number; kind: 'undo'; habit: string }
  | { t: number; dev?: number; kind: 'replay'; daysAgo: number };

export interface Persona {
  id: string;
  name: string;
  age: number;
  role: string;
  zone: string;
  devices: number;
  habits: Array<{ name: string; def: Definition }>;
  water: number;
  /** The plan for day `d` (0 = first day), with a seeded random source. */
  plan(d: number, rnd: () => number, dow: number): Ev[];
}

const daily = { kind: 'daily' } as const;
const bin = (): Definition => ({ type: 'binary', target: 1, schedule: daily });
const num = (target: number, unit: string, minimum = target / 2): Definition => ({ type: 'numeric', target, minimum, unit, schedule: daily });
const dur = (target: number): Definition => ({ type: 'duration', target, minimum: target / 2, unit: 'min', schedule: daily });
const weekly = (n: number): Definition => ({ type: 'binary', target: 1, schedule: { kind: 'perWeek', n } });
const glasses = (from: number, to: number, n: number, dev = 0): Ev[] => Array.from({ length: n }, (_, i) => ({ t: Math.round(from + ((to - from) * i) / Math.max(1, n - 1)), dev, kind: 'glass' as const }));
const jitter = (rnd: () => number, t: number, by: number): number => Math.round(t + (rnd() - 0.5) * 2 * by);

export const PERSONAS: Persona[] = [
  {
    id: 'rafa',
    name: 'Rafa',
    age: 25,
    role: 'Final-year medical student preparing for the FMGE, night duties twice a week',
    zone: 'Asia/Manila',
    devices: 1,
    habits: [
      { name: 'Qbank', def: num(50, 'questions', 25) },
      { name: 'Review mistakes', def: bin() },
      { name: 'Anki', def: num(120, 'cards', 60) },
      { name: 'Sleep by 23:30', def: bin() },
    ],
    water: 8,
    plan(d, rnd, dow) {
      const ev: Ev[] = [{ t: jitter(rnd, 420, 30), kind: 'open' }];
      const night = dow === 2 || dow === 5;
      const exam = d >= 56 && d < 63;
      if (exam) {
        ev.push({ t: 480, kind: 'skip', habit: 'Anki', reason: 'exam' });
        ev.push({ t: 1300, kind: 'amount', habit: 'Qbank', v: 80 + Math.round(rnd() * 40) });
        ev.push({ t: 1310, kind: 'done', habit: 'Review mistakes' });
        ev.push(...glasses(500, 1300, 5));
        return ev;
      }
      if (night) {
        // After a night duty: logs at 01:30 and 03:40 (before the 04:00 boundary) count for today.
        ev.push({ t: 1530, kind: 'amount', habit: 'Qbank', v: 30 });
        ev.push({ t: 1660, kind: 'skip', habit: 'Sleep by 23:30', reason: 'night' });
        ev.push(...glasses(480, 1500, 4));
        if (rnd() < 0.5) ev.push({ t: 1655, kind: 'done', habit: 'Review mistakes' });
        return ev;
      }
      if (rnd() < 0.85) ev.push({ t: jitter(rnd, 1080, 90), kind: 'amount', habit: 'Qbank', v: rnd() < 0.7 ? 50 : 35 });
      if (rnd() < 0.75) ev.push({ t: jitter(rnd, 1140, 60), kind: 'done', habit: 'Review mistakes' });
      if (rnd() < 0.6) ev.push({ t: jitter(rnd, 1250, 40), kind: 'amount', habit: 'Anki', v: rnd() < 0.6 ? 120 : 70 });
      if (rnd() < 0.5) ev.push({ t: 1395, kind: 'done', habit: 'Sleep by 23:30' });
      ev.push(...glasses(470, 1320, rnd() < 0.5 ? 8 : 5));
      if (d % 7 === 6) ev.push({ t: 1300, kind: 'replay', daysAgo: 1 });
      if (d === 30 || d === 70) ev.push({ t: 1200, kind: 'roundtrip' });
      return ev;
    },
  },
  {
    id: 'maya',
    name: 'Maya',
    age: 31,
    role: 'ICU nurse on rotating twelve-hour night shifts; moves her day boundary to 10:00',
    zone: 'Europe/London',
    devices: 1,
    habits: [
      { name: 'Walk outside', def: dur(20) },
      { name: 'Stretch', def: bin() },
      { name: 'Call home', def: weekly(2) },
    ],
    water: 10,
    plan(d, rnd, dow) {
      const ev: Ev[] = [];
      if (d === 2) ev.push({ t: 600, kind: 'boundary', minutes: 600 });
      const onNights = Math.floor(d / 4) % 2 === 0;
      if (onNights) {
        // Logs at 07:30 after the shift, for the day that began yesterday at 10:00.
        ev.push({ t: 1440 + 450, kind: 'open' });
        if (rnd() < 0.6) ev.push({ t: 1440 + 455, kind: 'amount', habit: 'Walk outside', v: 15 + Math.round(rnd() * 15) });
        if (rnd() < 0.5) ev.push({ t: 1440 + 460, kind: 'done', habit: 'Stretch' });
        ev.push(...glasses(1200, 1440 + 440, 6));
        if (rnd() < 0.3) ev.push({ t: 1440 + 470, kind: 'skip', habit: 'Stretch', reason: 'night' });
      } else {
        ev.push({ t: jitter(rnd, 700, 60), kind: 'open' });
        if (rnd() < 0.8) ev.push({ t: jitter(rnd, 900, 120), kind: 'amount', habit: 'Walk outside', v: 25 });
        if (rnd() < 0.7) ev.push({ t: jitter(rnd, 1300, 60), kind: 'done', habit: 'Stretch' });
        if (dow === 0 || dow === 3) ev.push({ t: 1200, kind: 'done', habit: 'Call home' });
        ev.push(...glasses(700, 1350, 8));
      }
      return ev;
    },
  },
  {
    id: 'dev',
    name: 'Dev',
    age: 34,
    role: 'Software engineer and power user: 16 habits, a phone and a laptop, offline on the train',
    zone: 'America/New_York',
    devices: 2,
    habits: [
      { name: 'Deep work', def: dur(90) },
      { name: 'Code review', def: bin() },
      { name: 'Gym', def: weekly(3) },
      { name: 'Read', def: num(20, 'pages') },
      { name: 'Meditate', def: dur(10) },
      { name: 'No sugar', def: { type: 'avoid', target: 1, schedule: daily } },
      { name: 'Journal', def: bin() },
      { name: 'Spanish', def: num(15, 'min') },
      { name: 'Floss', def: bin() },
      { name: 'Vitamins', def: bin() },
      { name: 'Inbox zero', def: bin() },
      { name: 'Walk', def: num(8000, 'steps') },
      { name: 'Guitar', def: weekly(4) },
      { name: 'Plan tomorrow', def: bin() },
      { name: 'Call parents', def: weekly(1) },
      { name: 'Bed by 23:00', def: bin() },
    ],
    water: 8,
    plan(d, rnd, dow) {
      const ev: Ev[] = [{ t: 420, dev: 0, kind: 'open' }];
      // Phone offline on the train 08:00 to 09:00; logs on both devices.
      ev.push({ t: 480, dev: 0, kind: 'offline', on: true });
      ev.push({ t: 490, dev: 0, kind: 'done', habit: 'Vitamins' });
      if (rnd() < 0.7) ev.push({ t: 500, dev: 0, kind: 'amount', habit: 'Read', v: 20 });
      ev.push({ t: 540, dev: 0, kind: 'offline', on: false });
      ev.push({ t: 600, dev: 1, kind: 'amount', habit: 'Deep work', v: rnd() < 0.7 ? 90 : 60 });
      if (rnd() < 0.8) ev.push({ t: 700, dev: 1, kind: 'done', habit: 'Code review' });
      if (rnd() < 0.6) ev.push({ t: 800, dev: 1, kind: 'done', habit: 'Inbox zero' });
      // The same habit tapped on both devices within a minute: a conflict to resolve.
      if (d % 9 === 4) {
        ev.push({ t: 900, dev: 0, kind: 'amount', habit: 'Walk', v: 6000 });
        ev.push({ t: 900, dev: 1, kind: 'amount', habit: 'Walk', v: 9000 });
      } else if (rnd() < 0.7) ev.push({ t: 1100, dev: 0, kind: 'amount', habit: 'Walk', v: 7000 + Math.round(rnd() * 4000) });
      if ([1, 3, 5].includes(dow)) ev.push({ t: 1080, dev: 0, kind: 'done', habit: 'Gym' });
      if (rnd() < 0.5) ev.push({ t: 1200, dev: 0, kind: 'amount', habit: 'Meditate', v: 10 });
      if (rnd() < 0.8) ev.push({ t: 1300, dev: 0, kind: 'done', habit: 'No sugar' });
      for (const h of ['Journal', 'Floss', 'Plan tomorrow', 'Bed by 23:00']) if (rnd() < 0.6) ev.push({ t: jitter(rnd, 1350, 30), dev: 0, kind: 'done', habit: h });
      if (rnd() < 0.5) ev.push({ t: 1250, dev: 1, kind: 'amount', habit: 'Spanish', v: 15 });
      if ([0, 2, 4, 6].includes(dow) && rnd() < 0.7) ev.push({ t: 1260, dev: 0, kind: 'done', habit: 'Guitar' });
      if (dow === 0) ev.push({ t: 1100, dev: 0, kind: 'done', habit: 'Call parents' });
      ev.push(...glasses(480, 1320, 7, d % 2));
      if (d === 21) ev.push({ t: 1000, dev: 1, kind: 'edit', habit: 'Read', def: num(30, 'pages') });
      if (d === 35) ev.push({ t: 1000, dev: 1, kind: 'archive', habit: 'Guitar' });
      if (d === 49) ev.push({ t: 1000, dev: 0, kind: 'restore', habit: 'Guitar' });
      if (d % 30 === 29) ev.push({ t: 1380, dev: 1, kind: 'roundtrip' });
      if (d % 10 === 3) ev.push({ t: 1390, dev: 0, kind: 'undo', habit: 'Floss' });
      return ev;
    },
  },
  {
    id: 'lena',
    name: 'Lena',
    age: 29,
    role: 'New mother on parental leave; uses the app in snatches and often catches up the next morning',
    zone: 'Europe/Berlin',
    devices: 1,
    habits: [
      { name: 'Eat breakfast', def: bin() },
      { name: 'Fresh air', def: dur(15) },
      { name: 'Pelvic floor', def: bin() },
      { name: 'Message a friend', def: weekly(2) },
    ],
    water: 10,
    plan(d, rnd) {
      const ev: Ev[] = [];
      // Three-day gaps now and then (a sick baby, a bad week).
      if ((d >= 17 && d <= 19) || (d >= 44 && d <= 47) || (d >= 80 && d <= 82)) return ev;
      ev.push({ t: jitter(rnd, 400, 120), kind: 'open' });
      if (rnd() < 0.6) ev.push({ t: jitter(rnd, 500, 60), kind: 'backfill', habit: 'Fresh air', v: 20 });
      if (rnd() < 0.5) ev.push({ t: jitter(rnd, 505, 60), kind: 'backfill', habit: 'Eat breakfast' });
      if (rnd() < 0.7) ev.push({ t: jitter(rnd, 600, 120), kind: 'done', habit: 'Eat breakfast' });
      if (rnd() < 0.4) ev.push({ t: jitter(rnd, 900, 200), kind: 'amount', habit: 'Fresh air', v: 10 + Math.round(rnd() * 20) });
      if (rnd() < 0.3) ev.push({ t: jitter(rnd, 1300, 100), kind: 'done', habit: 'Pelvic floor' });
      if (rnd() < 0.25) ev.push({ t: 1250, kind: 'done', habit: 'Message a friend' });
      ev.push(...glasses(400, 1300, 3 + Math.round(rnd() * 5)));
      if (rnd() < 0.15) ev.push({ t: 1350, kind: 'note', text: 'Barely slept. Still went outside for ten minutes.' });
      return ev;
    },
  },
  {
    id: 'tomas',
    name: 'Tomás',
    age: 68,
    role: 'Retired teacher; large text, reduced motion, very regular mornings; two weeks visiting his daughter abroad',
    zone: 'America/Mexico_City',
    devices: 1,
    habits: [
      { name: 'Morning walk', def: dur(30) },
      { name: 'Blood pressure pill', def: bin() },
      { name: 'Crossword', def: bin() },
      { name: 'Garden', def: weekly(3) },
    ],
    water: 6,
    plan(d, rnd, dow) {
      const ev: Ev[] = [];
      if (d === 40) ev.push({ t: 300, kind: 'zone', zone: 'Europe/Madrid' });
      if (d === 54) ev.push({ t: 300, kind: 'zone', zone: 'America/Mexico_City' });
      ev.push({ t: jitter(rnd, 390, 10), kind: 'open' });
      ev.push({ t: jitter(rnd, 395, 10), kind: 'done', habit: 'Blood pressure pill' });
      if (rnd() < 0.9) ev.push({ t: jitter(rnd, 460, 15), kind: 'amount', habit: 'Morning walk', v: 30 + Math.round(rnd() * 10) });
      if (rnd() < 0.8) ev.push({ t: jitter(rnd, 600, 30), kind: 'done', habit: 'Crossword' });
      if ([1, 3, 6].includes(dow) && !(d >= 40 && d < 54)) ev.push({ t: 660, kind: 'done', habit: 'Garden' });
      ev.push(...glasses(420, 1140, 6));
      return ev;
    },
  },
  {
    id: 'priya',
    name: 'Priya',
    age: 27,
    role: 'PhD student and perfectionist: corrects the record, fiddles with schedules, journals every night',
    zone: 'Asia/Kolkata',
    devices: 1,
    habits: [
      { name: 'Write 500 words', def: num(500, 'words', 250) },
      { name: 'Read papers', def: num(2, 'papers', 1) },
      { name: 'Yoga', def: weekly(3) },
      { name: 'No phone in bed', def: { type: 'avoid', target: 1, schedule: daily } },
    ],
    water: 8,
    plan(d, rnd, dow) {
      const ev: Ev[] = [{ t: jitter(rnd, 480, 20), kind: 'open' }];
      ev.push({ t: jitter(rnd, 700, 60), kind: 'attempt', habit: 'Write 500 words', v: 200 });
      ev.push({ t: jitter(rnd, 1000, 60), kind: 'amount', habit: 'Write 500 words', v: rnd() < 0.7 ? 520 : 380 });
      if (rnd() < 0.7) ev.push({ t: 1100, kind: 'amount', habit: 'Read papers', v: rnd() < 0.5 ? 2 : 1 });
      if ([2, 4, 6].includes(dow)) ev.push({ t: 1150, kind: 'done', habit: 'Yoga' });
      if (rnd() < 0.7) ev.push({ t: 1400, kind: 'done', habit: 'No phone in bed' });
      ev.push({ t: 1410, kind: 'note', text: `Day ${d + 1}. ${rnd() < 0.5 ? 'Good writing session, slow reading.' : 'Fought the introduction all day.'}` });
      // She corrects the record: last week's values, sometimes beyond the edit window.
      if (d % 5 === 2 && d > 6) ev.push({ t: 1420, kind: 'correct', habit: 'Write 500 words', daysAgo: 3 + Math.floor(rnd() * 6), v: 500 });
      if (d === 28) ev.push({ t: 1000, kind: 'edit', habit: 'Yoga', def: weekly(4) });
      if (d === 60) ev.push({ t: 1000, kind: 'edit', habit: 'Write 500 words', def: num(750, 'words', 400) });
      ev.push(...glasses(500, 1350, 6));
      if (d % 7 === 0) ev.push({ t: 1430, kind: 'replay', daysAgo: 3 });
      return ev;
    },
  },
  {
    id: 'kai',
    name: 'Kai',
    age: 20,
    role: 'University student: logs everything at midnight, vanishes for a week in exam season, comes back',
    zone: 'Australia/Sydney',
    devices: 2,
    habits: [
      { name: 'Lecture notes', def: bin() },
      { name: 'Gym', def: weekly(3) },
      { name: 'Cook', def: bin() },
    ],
    water: 8,
    plan(d, rnd, dow) {
      const ev: Ev[] = [];
      if (d >= 50 && d < 58) return ev; // gone a week: the app opens again on day 58
      const at = rnd() < 0.5 ? 1430 : 1440 + 30; // 23:50 or 00:30 (still today, before 04:00)
      ev.push({ t: at, dev: rnd() < 0.6 ? 0 : 1, kind: 'open' });
      if (rnd() < 0.7) ev.push({ t: at + 1, dev: 0, kind: 'done', habit: 'Lecture notes' });
      if ([1, 3, 5].includes(dow) && rnd() < 0.6) ev.push({ t: at + 2, dev: 1, kind: 'done', habit: 'Gym' });
      if (rnd() < 0.4) ev.push({ t: at + 3, dev: 0, kind: 'done', habit: 'Cook' });
      ev.push({ t: at + 4, dev: 0, kind: 'glass', n: 1 });
      ev.push({ t: at + 4, dev: 0, kind: 'glass', n: 1 });
      ev.push({ t: at + 5, dev: 0, kind: 'glass', n: 1 });
      if (d === 58) ev.push({ t: at + 6, dev: 0, kind: 'replay', daysAgo: 5 });
      return ev;
    },
  },
  {
    id: 'amara',
    name: 'Amara',
    age: 38,
    role: 'Amateur marathoner: durations and counts, partial efforts, a week off injured',
    zone: 'Africa/Lagos',
    devices: 1,
    habits: [
      { name: 'Run', def: dur(40) },
      { name: 'Push-ups', def: num(50, 'reps', 25) },
      { name: 'Mobility', def: dur(15) },
      { name: 'Protein', def: bin() },
    ],
    water: 12,
    plan(d, rnd) {
      const ev: Ev[] = [{ t: 330, kind: 'open' }];
      const injured = d >= 63 && d < 70;
      if (injured) {
        for (const h of ['Run', 'Push-ups']) ev.push({ t: 340, kind: 'skip', habit: h, reason: 'sick' });
        ev.push({ t: 900, kind: 'amount', habit: 'Mobility', v: 15 });
        ev.push(...glasses(400, 1300, 10));
        return ev;
      }
      ev.push({ t: jitter(rnd, 360, 15), kind: 'attempt', habit: 'Run', v: 20 });
      ev.push({ t: jitter(rnd, 420, 15), kind: 'amount', habit: 'Run', v: rnd() < 0.8 ? 40 + Math.round(rnd() * 30) : 25 });
      ev.push({ t: jitter(rnd, 1100, 60), kind: 'amount', habit: 'Push-ups', v: rnd() < 0.7 ? 50 : 30 });
      if (rnd() < 0.6) ev.push({ t: 1200, kind: 'amount', habit: 'Mobility', v: 15 });
      if (rnd() < 0.85) ev.push({ t: 800, kind: 'done', habit: 'Protein' });
      ev.push(...glasses(360, 1320, rnd() < 0.6 ? 12 : 9));
      if (rnd() < 0.1) ev.push({ t: 1330, kind: 'unglass' });
      return ev;
    },
  },
  {
    id: 'jon',
    name: 'Jon',
    age: 42,
    role: 'Recovering from burnout and depression: two small habits, many hard days, rest and sick days',
    zone: 'America/Los_Angeles',
    devices: 1,
    habits: [
      { name: 'Get dressed', def: bin() },
      { name: 'Ten-minute walk', def: dur(10) },
    ],
    water: 6,
    plan(d, rnd) {
      const ev: Ev[] = [];
      const mood = Math.sin(d / 9) + (rnd() - 0.5);
      if (mood < -0.9 && rnd() < 0.6) return ev; // a day not opened at all
      ev.push({ t: jitter(rnd, 660, 120), kind: 'open' });
      if (mood < -0.4) {
        ev.push({ t: 670, kind: 'skip', habit: rnd() < 0.5 ? 'Ten-minute walk' : 'Get dressed', reason: rnd() < 0.5 ? 'sick' : 'rest' });
        return ev;
      }
      if (rnd() < 0.8) ev.push({ t: 680, kind: 'done', habit: 'Get dressed' });
      if (rnd() < 0.6) ev.push({ t: jitter(rnd, 1000, 120), kind: 'amount', habit: 'Ten-minute walk', v: rnd() < 0.7 ? 10 : 5 });
      ev.push(...glasses(700, 1200, 2 + Math.round(rnd() * 4)));
      if (rnd() < 0.1) ev.push({ t: 1300, kind: 'note', text: 'Hard day. Did one thing.' });
      return ev;
    },
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 33,
    role: 'Product designer who distrusts gamification; avoid-habits, deletes one, moves her day to midnight',
    zone: 'America/Sao_Paulo',
    devices: 1,
    habits: [
      { name: 'No social media', def: { type: 'avoid', target: 1, schedule: daily } },
      { name: 'Read 20 pages', def: num(20, 'pages') },
      { name: 'Sketch', def: bin() },
      { name: 'Cold shower', def: bin() },
    ],
    water: 8,
    plan(d, rnd) {
      const ev: Ev[] = [{ t: jitter(rnd, 540, 60), kind: 'open' }];
      if (d === 10) ev.push({ t: 600, kind: 'remove', habit: 'Cold shower' });
      if (d === 20) ev.push({ t: 600, kind: 'boundary', minutes: 0 });
      if (d === 30) ev.push({ t: 600, kind: 'add', name: 'Write by hand', def: bin() });
      if (rnd() < 0.75) ev.push({ t: 1380, kind: 'done', habit: 'No social media' });
      if (rnd() < 0.65) ev.push({ t: jitter(rnd, 1320, 60), kind: 'amount', habit: 'Read 20 pages', v: rnd() < 0.7 ? 20 : 12 });
      if (rnd() < 0.5) ev.push({ t: jitter(rnd, 1200, 90), kind: 'done', habit: 'Sketch' });
      if (d < 10 && rnd() < 0.3) ev.push({ t: 420, kind: 'done', habit: 'Cold shower' });
      if (d > 30 && rnd() < 0.5) ev.push({ t: 1300, kind: 'done', habit: 'Write by hand' });
      ev.push(...glasses(600, 1300, 5));
      return ev;
    },
  },
];
