# M5: core engine, assumptions and decisions

M5 builds the model, schemas, migrations framework, habit engine and `derive`, as specified in
stage 2 and the build plan. Where the spec left a rule open, the choice is listed here so it can
be challenged before M6 builds on it.

## Assumptions

| ID | Rule left open | Choice | Why |
| --- | --- | --- | --- |
| A-M5-1 | How an unlogged day of an "X a week" or "X a month" habit counts | Not a miss. Quota habits take part in a day's outcome only on days logged held, fulfilled or skipped. The quota is judged per week or month in the chain (H24) | Otherwise a 3-a-week habit would mark four days a week as missed, and the story would stall on days the plan allows off |
| A-M5-2 | Today's progress with a quota habit not yet logged | Excluded from today's f, still shown on the checklist | Same reason; f must not punish a planned day off |
| A-M5-3 | Forgiveness window for week and month units | 7 units, not 7 days | With 7 days, a weekly habit could miss every other week and keep its chain |
| A-M5-4 | Does restoring an archived habit continue the old chain? | No; archive ends the chain, restore starts a new one | The spec starts new chains on schedule or type changes; a long archive is a larger break |
| A-M5-5 | What makes the "first closed week" record | An ended Monday-to-Sunday week, every non-free day closed or rested, at least one closed, at least 3 non-free days | A week with one scheduled day should not earn the week's mark |
| A-M5-6 | The 7-day and 30-day rates | Mean progress f over ended non-free days in the window (rested 1, missed 0), null below 3 days | The spec says "consistency"; f keeps partial days honest instead of rounding them up |
| A-M5-7 | Fatigue after an absence | The fatigue window starts after the latest run of 3 or more consecutive missed days | Spec: "resets to fresh on the first day back"; the absence itself is not counted against the return |
| A-M5-8 | An attempted value (above 0, below the minimum) at the day's end | The state stays "attempted" rather than becoming "missed"; it counts as not held | It records the honest truth that something was done |
| A-M5-9 | A log on a non-chosen weekday | State "unscheduled"; it does not count for the day or the chain | Prevents a weekday habit from turning a free day into a story day |
| A-M5-10 | Two edits to a habit's definition on the same day | The later edit replaces the version starting that day | A version is only immutable once a later one exists |
| A-M5-11 | Eastward travel where the local date jumps twice | Roll one date at a time; while catching up, each day lasts at least 12 hours | "Travelling never creates or deletes a day" (T11) |
| A-M5-12 | Undo across devices | Stored as a cleared entry (a tombstone with its write time), so an older write cannot resurrect the value | Merge is last-write-wins per habit-day |

## Matrix coverage in M5

- H01 to H24: `tests/unit/habits.test.ts`.
- T01 to T18: `tests/unit/time.test.ts`. T17 is measured on the build machine; the phone budget
  is checked with the performance probe at M9.
- I1 (with a convergence check), I2, I3, I6, I9, I11: `tests/property/invariants.test.ts`,
  300 random histories each by default. Set `VITE_PROPERTY_RUNS` for longer runs.
- Regression: 1,000 seeded histories hashed in `tests/property/regression.test.ts`. A change to
  the hash must be explained in the release notes.

## Bugs found by the tests while building

- The checklist write path validated values by hand and crashed on `null`; it now runs the
  zod entry schema on all untrusted input (found by I9).
- The day clock first rolled twice within minutes after an eastward crossing; fixed by the
  catch-up rule in A-M5-11.
