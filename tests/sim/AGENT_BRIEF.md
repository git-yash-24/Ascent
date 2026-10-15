# Persona review brief (14-week speedrun of Ascent)

You are one of ten people who used **Ascent** for fourteen weeks in a speedrun. Your persona,
your habits and how you use the app are in `tests/sim/personas.ts` (find your `id`). You are
both the person and a sharp tester reviewing what happened to you.

## What Ascent is

A habit tracker told as a year-long story. You keep a short list of daily habits, plus a water
flask. Each day is a camp on a mountain route walked by Ari, a hooded climber. The game screen
shows a 3D camp; the checklist floats over it.

How you log:

- Hold a habit row: done.
- Tap a row: the options (amount, Mark done, Attempted, rest options: Rest day, Sick, Exam,
  Night duty, Travel, Skip).

How a day comes out:

| Outcome | When |
|---|---|
| Closed ("camp made") | Every counted habit is fulfilled or rested |
| Partial | Some done |
| Missed | Nothing done |
| Rested or excused | Rest or sick |

A day ends at a boundary (default 04:00, editable), so late nights count for the right day.

The weekly climb:

- Each week gets a verdict (summit, climb, hold, slip, rest) from the share of the week's plan
  done.
- A verdict moves you up stages: 52 stages, about one a week.
- The week's weather is the "canon" from the last ended week's verdict:

  | Last week | Canon |
  |---|---|
  | Climb, summit | Clear |
  | No verdict yet, rest, sick | Calm |
  | Hold | Snow |
  | Slip | Storm |

- The season turns the canon into one of 12 kinds of weather (blizzard in winter, thunder in
  summer, and so on).
- Rest and sick days are always calm.

Other parts of the game:

- **Momentum**: 0 to 3 after missed days. The fire burns down. Any effort today resets it.
- **Story days earned**: days you showed up.
- **Chains**: streaks per habit.
- **Water**: glasses toward a target, which make Ari tired or fresh.
- **Replays**: tap a day on the Week screen. The replay shows habits in recorded order with
  their times, "logged later" for backfills, and "time not recorded" when there is no time.
- **Base camp**: a journal (one note a day), leagues and trophies.
- **Setup**: habits, settings, correcting the record, backup and restore, a 14-day record check.
- **Environment Lab**: sliders for time, season, weather and moon.

It is an experiment in a claude.ai artifact. The owner plans to rebuild it from scratch as a
proper web app, so premise-level and design feedback matters as much as bugs.

## What you have

- `.sim/<id>.json`: 98 simulated days (15 Oct 2026 to 20 Jan 2027) driven through the app's real
  controller and sync store.
  - Per day: outcome, progress, story day, stage, the week's verdict so far, canon and weather
    kind, season, momentum, water, action timings, the M10 record check, whether devices agree,
    replay card stats, and any rejections.
  - `final`: chains, weekly verdicts and scores, lifetime counts, the replay sweep.
  - `issues`: anything automated checks flagged.
- `.sim/run1/`: an earlier run, kept for reference only. Bugs already found and fixed by the
  speedrun (do not report these again, but you may say how they would have felt):
  1. A restore from backup erased every entry's recorded times (replays said "time not recorded").
  2. A record made while travelling in a zone ahead was called "logged later".
  3. Marking one habit done and straight away opening another closed the second options sheet.
- `.sim/ui-<id>.json`: 7 days lived in the real app in a browser, with the world on, at 4320×
  speed (a day in 20 seconds), in your own time zone. Actions go through the interface.
  - It includes per-day state, samples of the sky and weather every 6 simulated hours, frame
    times, replays watched, console errors, and UI actions that failed (with the error).
  - Frame times are from software rendering on a 2-core server, not a phone. Do not judge
    performance from them.
- `.sim/shots/<id>-dNN-HH.png`: screenshots on days 1, 4 and 7 at 07:00, 13:00, 18:30 and 22:00.
  Look at them (Read the PNG).
- The source in `src/`: game screen `src/game/`, rules `src/core/`, data `src/data/`, Setup
  `src/ui/setup/`.

## What to do

1. **Live it.** Read your persona and your data as yourself. How did each of the 14 weeks feel?
   What did the app say to you, in weather, the fire, verdicts and words? When did you feel
   seen, nagged, punished, bored or proud?
2. **Test it.** Look for real bugs and for things that are technically correct but wrong for a
   person like you. Back every claim with evidence: a day number, a field, a screenshot, a code
   path.
   - You may write and run small Node scripts to analyse the JSON. Put them under
     `/tmp/claude-0/-home-claude-ascent/b48746bb-3a4a-5bed-aeec-ad37633b031a/scratchpad/agents/`.
   - Do **not** run browsers, builds or the test suites. The machine has 2 cores, shared.
   - Do **not** modify anything in the repository.
3. **Judge the premise.** Would you keep using it? What about the story and game framing helps
   or hurts you specifically?

## What to return

A short prose summary (under 200 words) in your persona's voice, then **one JSON block** fenced
with three backticks and `json`, exactly this shape:

```json
{
  "id": "<persona id>",
  "verdict": "keep | maybe | quit",
  "quitWeek": null,
  "oneLine": "<their verdict in one sentence, in their voice>",
  "weeks": [{ "week": 1, "mood": 1, "word": "curious", "why": "<short>" }],
  "lovedMost": ["<short>", "<short>"],
  "gripes": [{ "about": "premise | mechanics | world | ui | data | words", "text": "<short, in voice>", "severity": 1 }],
  "issues": [{ "title": "<short>", "severity": "critical | high | medium | low", "kind": "bug | design | copy | performance | accessibility", "evidence": "<day, field, file:line or screenshot>", "fix": "<concrete suggestion>" }],
  "requests": ["<top 3, short>"],
  "forTheRebuild": ["<what the from-scratch web app must do differently, 2 to 4 items>"]
}
```

`weeks` has 14 entries. `mood` runs from -2 to 2. Gripe `severity` runs from 1 to 3. Keep the
JSON valid.
