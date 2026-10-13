# M9: the game screen

Date: 2026-10-13. Decided with Xander.

## What he asked for

- "The story to occupy 65% of the screen and UI only 40% so it feels like a game", then scroll
  down for organised, colour-coded detail. Less UI, fewer words.
- "Tap for done or empty for not done but hold 0.7 sec for attempted or rest options."
- Swipe for week, month and year, each with the landscape further zoomed out; base camp on the
  other side with items and trophies, a leaderboard per habit tag, a journal and an advice corner.
- Coloured habit tags: broad, known families; each habit tagged into a group; groups become the
  "subreddits" with leaderboards and leagues.

## His answers (2026-10-13)

1. Solo for now. No other players, no public boards.
2. One base camp screen, to the left of Today. Week, month and year to the right.
   Order, left to right: **Base camp | Today | Week | Month | Year**.
3. Leagues measure **consistency with your own targets**.
4. The nine tag families are fine for now.

## What was built

| Piece | Where | Notes |
|---|---|---|
| Pager | `src/game/game.ts` | Native horizontal scroll-snap over one fixed WebGL canvas. Hash per screen (`#camp`, `#today`, `#week`, `#month`, `#year`), kept across reloads. |
| World | `src/game/stage.ts` | Reuses the M2 feel-test world, camp and Ari. Camera follows the pager position continuously, pulling back screen by screen. Ari straightens as the day fills; closing the day live plays the M2 reward (rise, satchel, kick the fire, take the route). A day already closed shows him on the route. Fire level follows today's progress. Pauses when the sheet covers it and when the tab is hidden. |
| Tap / hold | `src/game/hold.ts` | Under 700 ms is a tap; past it opens the options. Moving 10 px is a swipe. Keyboard: Enter or Space taps, Shift+F10 or the menu key opens the options. Right-click opens them on desktop. |
| Today sheet | `src/game/today.ts` | Day pills (3-day edit window), week ring with the climb mark, alerts only when needed, two-column chips in tag colours, the flask. Below: habits grouped by tag family, the week gauge. |
| Week, month, year | `src/game/views.ts` | Week: days as coloured blocks, each habit's share of its weekly plan, weeks behind. Month: calendar, counts, each habit's held days. Year: chapter and stage track, a strip of weekly verdicts, six months of days. |
| Base camp | `src/game/basecamp.ts` | Tabs: Trophies (trophies and Ari's gear), Leagues, Journal, Advice. |
| Standings, leagues, trophies, advice | `src/core/insights.ts` | Pure, derived, tested (`tests/unit/insights.test.ts`). Nothing new is stored except journal notes. |
| Tags in the form | `src/ui/setup/habitForm.ts` | Suggested from the name as it is typed; one select to change. Stored on the habit (`tag`), applies to history like the name. |
| Plain checklist | `#list` | The M8 checklist stays, reached by a skip link first in the tab order. Keyboard and screen reader users keep the full contract. |

## Calls I made (change any of them)

- **G-1 Tap on a counted habit** (Qbank) sets the full target; tap again empties it. Amounts go
  through the hold menu ("Save amount"). Reason: one gesture for every habit, as asked.
- **G-2 Attempted on a yes-or-no habit** is stored as 0.5: it warms the fire (half credit in the
  day's progress) but never counts as held, so it does not move the week.
- **G-3 League tiers** sit on the climb bands so the words mean the same thing everywhere:
  Foothills under 50%, Trail 50%, Ridge 70% (the steep bar), Summit 85%. Consistency is the
  mean share over the last four ended weeks; a brand-new habit is judged on this week so far.
- **G-4 "Leaderboard per tag", solo**: each league's board ranks your own habits in that group.
  When multiplayer comes, the same group ids are where other players join.
- **G-5 Gear** is earned by days shown up: satchel 1, wool scarf 15, ice axe 60, storm lantern
  180, summit flag 365 (the scarf, axe and lantern match the resolve tiers from M5).
- **G-6 Trophies**: first camp, first climb, seven fires (7-day streak), thirty fires, summit push,
  steep line, comeback, full flask (water 7 days), chapter two.
- **G-7 Advice** is at most three lines, from the record only: the shortest rope this week when
  short of the climb, the distance to a summit push when the climb is secured, the steep line
  when offered, fatigue, the longest streak to protect, water.
- **G-8 Journal**: one note per day, up to 1,000 characters, saved on leaving the box or with Save.
- **G-9** `?world=off` runs the screens on a painted sky. Used by the end-to-end tests (software
  WebGL is too slow to share the main thread) and available for very slow phones.

## Round 2 (2026-10-13): alive, glass, scenes

Xander: water gets its own scene "no matter the stage we are at or what we are doing"; the main
screen's UI still took too much space, so lose the background and keep a minimal checklist "like
liquid glass"; base camp shows Ari opening his journal "in real time", same imagery as Today; the
week was too far out: show Ari and the obstacles he crossed, and a tap on a day plays "a quick
montage of all the activities we did and all the story beats"; month stays milestones; the year
shows the whole terrain and trail with only an indicator of where you are. "More lively, reactive,
interactive and alive."

| Piece | Where |
|---|---|
| Full-screen world, glass panels, captions under the tabs | `index.html` (.glass), `src/game/game.ts` |
| Drink scene (any screen, any new glass: flask, Today's bar, another device) | `Stage.drink`, `props.buildFlask` |
| Journal scene at base camp; his pencil keeps pace with your typing | `Stage.compose`, `props.buildJournal` |
| Week: camps, obstacles, posts ahead; pins on the world | `src/game/trail.ts` (`WeekTrail`) |
| Day replay: captions plus hard cuts around his ghost double | `src/game/montage.ts`, `Stage.playMontage` |
| Year: the whole route, the walked part lit, one beacon | `trail.ts` (`YearRoute`), `world.ts` (one ground under everything) |
| Life: snow, idle glances at the summit light, a nod per habit done, touch Ari and he looks at you, touch the fire and it throws sparks | `Stage` |

Calls made this round:

- **G-10 Every new glass plays the drink**, whatever raised it (flask, Today's water bar, a sync from another device). Removing one does not.
- **G-11 Flask**: tap for a glass, hold for "Remove a glass". The full bar with − stays in Today's detail.
- **G-12 A closed day's reward walk now ends at tomorrow's camp** (about 6 m up the trail), so the week's trail and Ari agree. Tomorrow he is back at a fire.
- **G-13 Trail beats** (`src/game/beats.ts`): each walked day crosses one of five obstacles (stream, boulders, fallen pine, ice, scree), chosen from the date so every device tells the same story. Partial days get halfway. Rest days leave a tent, sick days a storm tent, missed days a snowdrift. Placeholders until the authored story (M11 onward).
- **G-14 The year route has 52 stages**: a full year of weekly climbs reaches the summit. The beacon sits at stage ÷ 52 of the route; chapter marks every 4 stages.
- **G-15 Replay**: the day's beat, each habit (done first, then not), the flask, the journal line, how it ended; at most 9 captions, 1.25 s each; tap or Close to stop.
- **G-16 Base camp opens on the Journal tab.** Today's note box floats over the world so you write while he does; earlier pages, trophies, leagues and advice are below.

## Not yet

- Multiplayer leagues and shared leaderboards (solo by decision).
- Ari's gear visible on the model; story scenes per chore (M11 onward).
- Month and year landscapes are camera moves over the same world; a proper year map comes with the
  route art.
