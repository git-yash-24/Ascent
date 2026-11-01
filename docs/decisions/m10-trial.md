# M10: 14 days of real use (from 14 Oct 2026)

Build plan, gate 2: "You: 14 days of real use. Daily export diffed against the log. Accept when:
zero lost or wrong records; export and restore identical. Rollback: fix and restart the 14 days."
This is Xander's approval point; the build waits on it.

## How the check is run

- **Daily, automatic, per device** (`src/data/trial.ts`, Setup → Data → "The 14-day check").
  Once a day, after the record has opened from the account store, the app fingerprints every
  entry (date, habit, value, write time) and compares it with the previous day's fingerprint.
  The fingerprint is kept in this browser, beside the record, not in it.
  - **Lost**: an entry that existed is gone. Entries are never deleted (a clear keeps a
    tombstone), so any loss is a fault.
  - **Changed**: a value moved without a newer write time. Nobody edited it, so it is a sync or
    storage fault.
  - **Edits**: changes with a newer write time (your own taps, corrections) are counted, not
    flagged.
  - **Round trip**: the record exported to a backup and read back is identical.
- Skipped while the account store could not be read (an offline copy would look like losses).
- Read-only: it never writes to the record.
- "Check now" runs it on demand.

This replaces saving an export file every day: the same diff, done by the app. Weekly backups
(the existing prompt) still matter: they are the restore path if a check ever fails.

## Accept when

Fourteen check days on the phone you use, every one with:

- 0 lost;
- 0 changed;
- an identical round trip.

The section then says "The 14 days are clean on this device".

## If a check fails

1. Save a backup at once.
2. Note what the section lists (habit, date, before and after).
3. Report it.

Each failure becomes a test before the fix (regression rule). Then the 14 days restart.

## Meanwhile

Changes to the beta during M10 are allowed only if they keep the record format. The world, art,
replay and presentation work of 13 and 14 Oct changed no stored schema; the per-device choices
(light, shake) live in browser storage.

## Speedrun (ten personas, 98 days each)

Ten simulated people ran 98 days through the real Controller and sync layer (`npx vitest run --config vitest.sim.config.ts`) plus a 7-day warped UI run (`tests/sim/ui-speedrun.mjs`). Result: 0 entries lost or changed, round trips identical, devices agree. Every persona's verdict was "maybe".

Fixed: second Mark-done sheet closing itself; restore dropping replay times; eastward-zone replays saying "logged later"; water counted as effort; "Moving" coach line and "WEEK 10%" caption (now pace); winter clear variety; southern-hemisphere seasons from the time zone.

Open, needs a rules decision: whole-day rest/sick state excused from scores and weather (Jon, Kai); weekly verdict relative to own baseline; closing a day at a core subset; eastward zone-change day filing (needs zone per act, so after M10); text-size setting; replay card overflow.
