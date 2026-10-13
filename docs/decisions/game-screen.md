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

## MVP round: the opening, companionship, ownership, a living world

Asked for: "whatever can be properly included in the MVP and also a start animation for first
timers", from everything decided since the last beta (story direction, the attachment and
Homescapes briefs; the full plan is in the Docs plan, tabs Story Engine, Attachment, Homescapes).

| Piece | Where |
|---|---|
| Opening scene: down through the snow to the fire, the knot, the map caught, she looks up, the second cup | `Stage.playIntro`, `introStep`, `introPose`; `GameView.startOnboarding` |
| Your mark: symbol and colour on the flag, pennants, pack and a carved stone; optional expedition name | `ExpeditionDoc` (schema 1), `src/game/kit.ts`, `src/game/onboard.ts`, Setup "Your expedition" |
| Camp that travels: improvements by story day, next one named in Today's detail | `src/core/world.ts` (`CAMP_SCHEDULE`, `campState`), `Kit.setBuilt`, `GameView.renderCamp` |
| Weather from the last ended week; sky by your clock | `weatherOf`, `Stage.setWeather`, `skyAt` |
| After missed days she watches the trail; the fire burns low; one tap relights it | `momentumStep`, `Stage.setMomentum` |
| HUD: gear top left, tabs on the top row, flask as a ring gauge, all rest after 4.5 s idle; detail is a full-screen blurred layer with its own title bar | `index.html`, `GameView` |

Calls made this round:

- **G-17 The opening plays once**, on a first launch, before the welcome card (which now sits as glass over the camp). Skip ends it at once; reduced motion shows the still camp with the cup poured. Someone who began before it existed sees it once with a short "Your mark" card. Setup can play it again. Recorded as `expedition.introOn`.
- **G-18 The mark is optional and decorative**: five symbols, six colours, ash by default. It is part of the record, synced and in backups. No mark is offered for purchase, ever.
- **G-19 The second cup and seat are yours.** The cup fills when the day closes (with a chime when it happens live) and empties if the day reopens.
- **G-20 Arrival nod** once per day, or after 4 hours away; never on quick tab switches.
- **G-21 Camp improvements by story day**: windbreak 5, cooking stone 12, lantern 20, woodpile 30, pennants 45, bench 60, tarp 90, wind chime 120. A new one is shown once (the camera finds it); none is ever taken away.
- **G-22 Weather is the last ended week**: climb or summit clear, hold snow, slip storm. A climb secured this week clears the sky early. Rest and sick days are always calm. Unchecked habits never make her shiver.
- **G-23 Momentum floor**: after 1 to 3 missed days she glances back at the trail; at 3 the fire is down to embers. It never gets worse than that, and any effort today ends it at once.
- **G-24 Touching Ari** makes her look at you at most once every 10 s; the fire still sparks every time.
- **G-25 User-facing text calls Ari "she".**

## UI audit round (13 Oct): gestures, honest numbers, modals, readability

Asked for: hold marks a habit done and a tap opens the other options (Xander), and the fixes in
section 0 of `Ascent_UI_Cinematic_Experience_Claude_Guideline.md`, inside the current five screens.

Before → after:

| Area | Before | After |
|---|---|---|
| Habit chip | Tap filled the whole target (0 → 50/50); hold opened options | Hold 0.7 s = done (again = empty); tap opens the sheet: amount (total so far), Mark done, Attempted, rest options, Clear. Button semantics, state in the name |
| Undo | None on the game screen | A few seconds of Undo after any change; it restores exactly the prior entry (12/50, a sick day), not empty |
| Ghost click | n/a | The click that ends the opening tap is swallowed near the tap point, so it cannot press a button in the new sheet |
| Keyboard | Enter toggled done | Enter opens the sheet with Mark done (or the amount) focused; Shift+F10 too; #list stays plain checkboxes |
| Camp reveal | Marked seen 0.4 to 2.2 s before it played | Earned, waiting, shown are separate. Plays only on Camp/Today with nothing else up and the tab visible; marked seen when it finishes; cut short by leaving, it waits. Several at once: newest plays, all named |
| Faded HUD | Opacity 0 but focusable and tappable | Idle recedes to low contrast, never while focused; when the detail is up the tabs, flask and gear are inert and focus moves to the detail's Back button |
| Opening, replay | div with aria-modal, background reachable | Background inert (pager, tabs, flask, labels, header); focus returns; Alt+PageUp/Down blocked; replay closes from Close, Escape or the backdrop only |
| Reduced motion | System preference in some places, Setup in others | One policy (`src/ui/motion.ts`): system OR Setup, live; CSS, scrolling and the stage all follow |
| Water | "Water" under a selected past day, but always wrote today; 9 am by device clock | Titled "Water today" and placed outside the day's block; one reminder policy in the record's zone (`waterDue`) |
| Save status | Hidden in game mode | Dot always; words when not synced ("Saved on this device", "Not saved yet", "Offline · saved on this device"), still visible over the detail |
| Numbers | "Today 0% · 50% to the climb" | "0 of 2 done" (rest and sick days named); "This week 8% · the climb needs 50%"; insights say points; "Next at camp: …, after 4 more trail days" with the trail-day rule stated |
| Detail order | Day picker, week ring, water, groups | Day and its habits, then water, then the week and camp; group headings only with more than one group |
| Scene | Shade to 0.62 black plus 4% zoom from a third of the way down; nav hid at 33% | Shade follows how much the detail covers, max 0.3, no zoom; nav steps aside when the detail reaches the top. Cool rim light on Ari; round, fewer embers; round snow and stars |

Calls made:

- **G-26 Hold is done, tap is options** on the game screen. The flask keeps tap = a glass (a glass is an increment, not a completion).
- **G-27 The rest sentence is exact**: a rested habit leaves the day's count and keeps its streak; when everything rests the day still counts on the trail; a sick day is paused.
- **G-28 Camp follows the record**: improvements are derived from trail days, so only a correction of the record can remove one; a reveal is never repeated once seen.
- **G-29 Trail day** is the user-facing name for a story day: at least one habit held or done, or a rest day.

Measured contrast on the detail glass over a bright fire pixel: ink 11.8:1, muted 5.4:1, the
trail-day note 5.5:1, warn 7.6:1, frost 7.8:1; chip text over the brightest fire 4.6:1; the
primary button's dark label on ember 6.0:1. `--dim` (3.2:1) is no longer used for text on pins.

Not done here (needs a choice): the Camp / Today / Journey dock-and-sheet model of sections 5 to
7. The brief asks for it to be prototyped and compared with this repaired model before either ships.

## Dock preview, framing, the return beat (13 Oct, continued)

Asked for: "continue further" on the audit brief, so steps 4 and 5: prototype the dock model
next to the repaired tabs, a camera that frames around the UI, one complete emotional interaction,
and independent life; then the test matrix.

| Piece | Where |
|---|---|
| Dock preview: Camp (home, one dock), Today (the dock's list, opened), Journey (Week, Month, Year as one control), Journal | `GameView.applyLayout`, `renderDockTop`, `.game.dock` CSS; `src/ui/layout.ts` |
| Switch per device in Setup ("Game screen layout"), or `?ui=dock` / `?ui=tabs` | `SetupView.layoutPick` |
| Camera frames Ari in the open part of the screen: the shift follows the checklist's height and the caption | `Stage.setOcclusion`, `GameView.frameAround` |
| Return beat: after most of a day away (or missed days) she picks up your cup from beside her, holds it out, sets it at your place; framed from your seat | `Stage.greet(away)`, act `offer` |
| Her own routine: hands to the fire (cold or low fire), a log pushed in, a look up the trail; every 26 to 60 s, never during anything else, off in reduced motion | `Stage.ambient`, acts `warm`, `tend`, `route` |

Calls made:

- **G-30 Both layouts ship side by side for now**; tabs stay the default. The dock is a preview to compare on real data, not a second permanent system: one of the two goes once Xander picks.
- **G-31 In the dock, hold is still done and a tap still opens the options** (G-26 holds in both layouts).
- **G-32 No swiping between places in the dock**: every move is a labelled button, so the world under the dock never fights a swipe.
- **G-33 The return beat does not fill the cup**: the cup fills only when a day closes (G-19); after an absence she gives it back to you.

Test matrix run (world off unless noted; results, not plans):

| Case | Tabs | Dock |
|---|---|---|
| 390×844 portrait, world on | Ari framed above the chips | Ari, hands and fire above the dock |
| 360×640, 320×568 | All controls on screen (tabs tighten at 340 px) | All on screen |
| 844×390 landscape | Usable; chips low | Usable; dock covers about half the height |
| 195×422 (390 px at 200% zoom) | Tabs scroll and keep the current one in view; chips stack | Dock header wraps; rows wrap |
| Reduced motion, keyboard, screen reader names | Covered by e2e (21 + dock test) | Covered by the dock e2e |

Still untested here: a real phone's soft keyboard over the amount field, iOS Safari, and the
night scene's darkness on an actual screen.

## Not yet

- Multiplayer leagues and shared leaderboards (solo by decision).
- Ari's gear visible on the model; story scenes per chore (M11 onward).
- Month and year landscapes are camera moves over the same world; a proper year map comes with the
  route art.
