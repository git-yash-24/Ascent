# SMART habits, story-chosen chores, built-in water

Decided with Xander, 2026-10-13.

## The story chooses the chore

People never pick a "scene" for a habit. Which of Ari's chores a habit becomes is chosen by the
story for each scene, so it follows the plot and stays fresh. `Habit.category` remains in the
data as a starting hint for the story engine (M12); new habits get a neutral default.

## The habit form follows SMART

| SMART | Question | Notes |
| --- | --- | --- |
| Specific | What will you do? | |
| Measurable | How will you measure it? | Done or not / A number (with "Of what?") / Minutes / Avoid it |
| Achievable | How many each day? | The hold point is set to half automatically and shown, not asked |
| Time-bound | How often? and At a set time? (optional) | Every day / On set days / Times a week; "times a month" stays for existing habits only |

A set time is stored on the habit version (`time`, 'HH:MM', habits schema 2). Timed habits come
first on the checklist, in time order. Once the time has passed and the habit is not done, the
row is marked as due now.

## Water, built in for everyone

- A system habit (`system: 'water'`, id `water`): 8 glasses a day by default, held from 6,
  changeable in Setup. It is created for every player at setup, and for existing records on
  their next open.
- Its own bar on Today: one tap "+ Glass", "−", the glasses as cells, and the time since the
  last glass. It has its own streak.
- It never counts toward the story day, the weekly climb or the stars. It feeds Ari's condition
  instead (his flask, from M9). Being required for everyone, it should neither inflate nor hold
  back anyone's story.
- Reminders happen in the app only: the bar turns to "Time for water" after two hours without a
  glass, or with none yet by 09:00. A published artifact cannot notify while closed (no service
  workers or notifications). Real phone reminders would need the standalone web app or scheduled
  tasks.

The regression hash was updated: derived output gained the `water` field.
