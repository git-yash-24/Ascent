# M8: the accessible checklist and Setup

The beta page (`index.html`, `src/shell/app.ts`, `src/ui/`) works with no world, no sound,
no motion and no mouse. It is published at the Ascent artifact address. That address is where
Xander's real record lives from now on; the M1 capability page moved to
`prototypes/capabilities.html`.

## Today

- **Summary.** A coach line chosen by today's state, the story day, stage and chapter, the week
  streak, today's walk (f), and the week gauge with ledges at 30, 50 (70 on the steep line) and
  85%. Below the climb ledge the gauge names the distance ("38% to the climb"), not a verdict:
  a week in progress is unwritten, not slipping.
- **Day chips.** Today and the three days before (the edit window), with a "Logging for" line
  when another day is chosen.
- **Habit rows.**
  - Yes-or-no habits are one large checkbox; amounts have −, a number field, + and Full.
  - A ••• disclosure opens rest, sick, exam, night duty, travel, skip and clear.
  - State is carried by shape as well as colour: hollow, dot, half, filled with a tick, slashed,
    crossed, dashed.
- **Banners** appear only when needed: a clock jump to confirm (T18), offline, no device storage,
  set-aside data, refused writes, the weekly backup, and the steep line when it can be chosen.

## Setup

- Habits: add, edit (a new version from today when the rules change), archive, restore, and
  delete after archiving with the habit's name typed.
- Settings: identity, day boundary, sound, music, reduced motion.
- Correct the record, with its log.
- Backup: save JSON or CSV through the downloads capability; restore with the dry run, a safety
  save of current data, then replace.
- Sync: status, device id, conflicts with "Use the other value", set-aside data, refused writes.

## Other changes

- The store renders the device copy at once on open, then the account's state.
- A write counts as synced once it is read back; the full re-read runs in the background (the
  M6 follow-up). Confirmed writes stay in the view during that refresh, so nothing blinks.

## Tests

`npm run test:e2e` runs `tests/e2e/app.e2e.mjs` in Chromium at phone size:

- first launch;
- X12 and X13: a full day by touch in under 10 s, every tap stored in under 100 ms;
- X16: keyboard only, including Escape and focus return;
- X17: every control named, and state carried by shape;
- reload keeps the record;
- the day chips;
- the Setup flows;
- no sideways scroll on Today or Setup.

All pass. Unit and property suites: 152 tests.
