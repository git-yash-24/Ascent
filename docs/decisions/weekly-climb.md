# The weekly climb

Decided with Xander, 2026-10-13. Implemented in `src/core/habits/weekly.ts`.

## Why

Daily participation keeps the story moving, but nothing asked for a strong week. Xander wanted
challenge, adversity and curiosity: a week's effort should decide whether Ari climbs to the next
stage or is pushed back, with story reasons for both.

## Two tracks

| Track | Moves by | Can go back? |
| --- | --- | --- |
| Story (episodes, companions) | each day shown up (closed, rested, partial) | no |
| Altitude (Ari's stage on the mountain) | once a week, on the Sunday boundary | yes, one stage at most |

Chapters (new regions) open when Ari reaches the top stage of the current chapter: 4 stages a
chapter. If the story reaches the end of a chapter's episodes before the climb does, camp-life
moments fill the gap until it does.

## The week's score

Each habit is measured in its own unit against its plan for the week:

- daily and weekday habits: the week's total against target × planned days (a big Sunday counts);
- X a week: days held against X;
- X a month: days held against the week's share of X.

Each habit is capped at 100% of its plan, and the score is the mean across habits, so one habit
cannot carry another and extra habits cannot inflate it. Planned rest and sick days come out of
the plan. A live week is scored against the whole week's plan, so the gauge rises day by day and
crossing 50% midweek secures the climb.

## Verdicts

| Score | Verdict | Stages |
| --- | --- | --- |
| 85% or more | summit push: climb plus a rare reward | +1 |
| 50 to 84% | climb | +1 |
| 30 to 49% | hold (a storm pins him down) | 0 |
| under 30% | slip (avalanche, retreat for supplies) | −1 |
| nothing planned | rest week | 0 |

## Rules on top

| Rule | Detail |
| --- | --- |
| Comeback | After 2 weeks in a row under 50%, the next climb is 2 stages. At most once in 8 weeks, so it cannot shorten the year. |
| Steep line | Optional, chosen before anything is logged in the week; unlocked after 4 counted weeks. The climb bar rises to 70%. Reaching it earns a normal one-stage climb plus a 10% head start on next week's score. 50 to 69% on the steep line holds. |
| Sick days | A day with every habit skipped as sick is *excused*: streaks hold, nothing is missed, the story does not advance, and the day leaves the week's plan. |
| Rest-heavy weeks | 4 or more rested or excused days: the week can hold but not climb. |
| Floor | A slip never crosses the current chapter's base camp. |
| Weekly chain | Consecutive weeks at 50% or more; rest weeks are neutral. |

## Consequences for the plan

- This deliberately reverses one line of the original brief, "the story must not punish
  misses": altitude can now be lost. The guardrails (one stage at most, chapter floor, the
  comeback, no shame framing, Ari never shown defeated for more than a day) keep it from
  becoming a guilt machine.
- Invariant I8 changes: canon *content* (episodes, companions, possessions) still depends only
  on the story day, but Ari's *location* now depends on the climb. The story bible's scene
  staging must take location from the climb from M12 on.
- The test matrix gains the cases in `tests/unit/weekly.test.ts` and a climb property in
  `tests/property/invariants.test.ts`.
- Profile documents move to schema 2 (the steep-line choices); schema 1 profiles migrate.
