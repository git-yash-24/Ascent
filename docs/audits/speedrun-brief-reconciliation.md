# Speedrun brief reconciled with the repo (15 Oct 2026)

Input: `ASCENT-SPEEDRUN-INSIGHTS-CLAUDE-BRIEF.md`. The brief was written from a 50-line export of the report and the master archive, without repo access. This audit replaces its "unknown" rows with what the repo and the run actually show.

## Evidence the brief said was missing (it exists)

| Brief says unavailable | Where it is |
|---|---|
| Persona rows, weekly moods, quotes, gripes, requests | `.sim/reviews/<id>.json` (10 files, gitignored), summarised in the published report |
| Weekly verdicts and scores per persona | `.sim/summary.json`, `.sim/<id>.json` |
| The seven bugs | Fixed: second Mark-done sheet closed itself (`ui.ts`); restore dropped replay times (`backup.ts`); eastward zone replays said "logged later" (`timeline.ts`, `montage.ts`); water counted as effort (`world.ts`); "Moving" line and "WEEK 10%" caption (`today.ts`); southern-hemisphere seasons and winter sky variety (`conditions.ts`, `app.ts`). Commit 5c1ae56. |
| Replay times | `Entry.acts` exists from 13 Oct (record times, 24 per habit-day). Older entries are date-only and show no clock. |

Limit that stays true: ten scripted agents with "maybe" verdicts are not ten retained people.

## Already built (do not rebuild)

Tabs Camp / Today / Week / Month / Year; full-width habit rows, open first and done below, held still during a press; HUD hides after 4.5 s idle and is inert/focus-safe (G-35); hold = done, tap = options, flask tap = +1; non-WebGL checklist (D17); reduced motion; honest timeline with `at / started / loggedOn / elsewhere`; Lab sliders (preview only, write nothing).

## Added this pass (no rule change, no record-format change)

**Today is different** (brief I1, preview-only semantics). On Today, one panel picks Rest, Sick, Night duty, Exam or Travel, lets you keep chosen habits, shows "N will be marked X, M kept open" before confirming, and writes the same per-habit skips the options sheet writes, on open habits only. One "Undo all" restores every habit. Exam and Travel are never auto-excused: the habits you keep stay open and count. e2e covers apply, keep, and undo.

## Conflict register (brief vs canon) and my call

| Topic | Call |
|---|---|
| Neutral/paused week, never Slip (I3) | **Needs owner approval.** Changes D12/D14. Not implemented. Jon's three Slip weeks and a month of gale are the evidence. Ship behind a flag with old-vs-new differential tests on seeded histories first. |
| "Your rhythm" vs own baseline (I2) | Additive and informational only. Not implemented. Needs comparable-week rules (>= 3 countable days, last 4 completed weeks, percentage points). Canonical bands unchanged. |
| Weather as verdict (G-22) vs the brief's "no punishing storms" | **Needs owner approval.** The sim shows storms landing on ill weeks (Jon, Kai). Smallest change: a week that is mostly rest/sick shows shelter weather, not a storm. |
| Zone per act, eastward day filing (Tomás) | Record-format change; wait until after M10. |
| Hemisphere vs the fictional mountain | Done as cosmetic season from the device zone only. Say if the mountain should stay fixed instead. |
| Rebuild as a new web app | Brief and master disagree. Plan: parity tests first (the sim harness and e2e suite are the parity suite), no blind rewrite. |
| Real local weather | Not built; canon weather stays the last ended week. |

## Open items from the run that need no decision

Replay cards cap at nine; header text on bright sky needs a scrim; text-size setting; close-up camera cap; stable row-order option; "1 glass" pluralisation; restore writes only changed entries.

## Owner decisions needed

1. Approve neutral week for fewer than 3 countable days (D12/D14).
2. Approve calm weather for rest-heavy weeks.
3. Approve "Your rhythm" as an informational line on Week.
4. Hemisphere: cosmetic (current) or fixed mountain.
5. Is the rebuild immediate or after real-user feedback.
