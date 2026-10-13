# Audit: Living World & Cinematic Innovation Layer (13 Oct 2026)

Checked against the code on `m10-mvp-opening` (PR #10) before any change for this plan.
Status: **implemented**, **partial**, **missing**, **unknown** (needs a real device or a decision).

## Repository and data

| Item | Status | Evidence |
|---|---|---|
| PR stack #1–#10 | Open, unmerged, stacked (#1 on `main`, each on the one before); #1–#9 clean, #10 mergeability computing | `gh api …/pulls/N` |
| Real data | Lives in the beta artifact's database; the code reads it through `ArtifactDbBackend`; no schema change in this phase | `src/data/adapters/artifactDb.ts` |
| Backup | Implemented: JSON + CSV export and import with a dry run (Setup → Backup) | `src/data/backup/backup.ts` |
| Plain checklist without WebGL | Implemented (`#list`, `?world=off`), covered by e2e | `src/ui/checklist/today.ts` |

## Against the plan

| Plan item | Status | What exists | Files |
|---|---|---|---|
| A. HUD hides when idle | **Partial (regression)** | After 4.5 s the tabs and gear recede to 55% (changed on 13 Oct from 0 for focus safety); caption, flask and status stay | `src/game/game.ts` (`wake`), `index.html` (`hud-idle`) |
| A. Tabs only | Partial | Tabs default; dock preview still in code behind a per-device switch | `src/ui/layout.ts`, `GameView.applyLayout` |
| A. Full-width rows, open first, done last | Missing | Two-column pills sorted by time of day only | `TodaySheet.visible`, `.chips` CSS |
| A. Hold = done, tap = options, undo exact | Implemented | 0.7 s hold, options sheet, Undo restores the prior entry | `src/game/hold.ts`, `today.ts`, `controller.revert` |
| B. Prop registry | Missing | Tap on Ari (look) and on the fire (sparks) only | `Stage.poke` |
| B. Flask: tap +1, hold inspect | Partial | Tap +1 and drink scene; hold opens a "Remove a glass" sheet, no close-up | `GameView.openFlaskMenu` |
| B. Water in ml | Not possible yet | No per-glass volume is stored; Setup only says "about 250 ml" as a hint | `Setup.water` |
| C. Sky by clock | Partial | Four keyed palettes by local hour (`skyAt`), no sun position, no shadows that move | `Stage.applySky` |
| C. Clouds, god rays, rare skies, wind field | Missing | Snow particles drift with a per-weather wind constant | `Stage.updateSnow` |
| C. Weather | Implemented (canon) | From the last ended week (clear/snow/storm), calm on rest/sick | `src/core/world.ts` `weatherOf` |
| C. Real forecast | Missing; conflicts with canon | Needs a decision (question 1) and a network source | — |
| C. Audio | Partial | Fire, wind, steps, chimes, drink; no time-of-day layers | `src/prototype/shared/audio.ts` |
| D. Micro-movement every few seconds | Partial | Breathing overlay, idle head drift; authored routine every 26–60 s; return beat | `Stage.compose`, `ambient` |
| D. Rigged Ari | Missing | Code-built low-poly rig with joint rotations | `src/prototype/feel3d/climber.ts` |
| E. Honest replay | Partial | Replay cards from the record; Ari's ghost on the trail | `src/game/montage.ts` |
| E. Timestamps | **Partial: one time per habit per day** | Each habit-day keeps one entry with `at` = when it was last written (and the device). No history of individual actions; backfilled days carry the time of the backfill, not of the act; water keeps one count with the last glass's time | `Entry` in `src/core/model/types.ts` |
| F. Settings in sections | Partial | One long Setup page (habits, water, expedition, settings, correct, backup, sync) | `src/ui/setup/setup.ts` |
| F. Environment Lab | Partial | `?debug` exposes the stage; `?hour=` overrides the sky; no panel | `Stage`, `game.ts` |

## Not verifiable here

iOS Safari, a real phone's frame rate and battery, the soft keyboard over the amount field, how dark
night reads on a real screen. Measured in headless Chromium only: layouts at 195–844 px, 200% zoom,
reduced motion, keyboard, ghost click.

## Proposed PR stack (on top of #10)

1. **Phase 1** (this round): tabs only, HUD hides fully with a safe wake, full-width open-first list.
2. Phase 2: prop registry + flask tap/hold inspector; settings in sections; Environment Lab shell.
3. Phase 3: base-camp light pipeline (clock → sun/sky → shadows → clouds → fog → wind → sound).
4. Phase 4: Ari and art pass with quality tiers.
5. Phase 5: replay truth: start recording each action with its time (forward only, versioned),
   older days shown as undated fragments.

## Open decisions (from the plan, §9)

1. Weather canon. 2. Flask gesture. 3. Replay honesty. 4. Motion sensors. 5. Device target.

## Progress

- Phase 1 done (G-34 to G-37): tabs only, the HUD hides with a safe wake, full-width open-first rows.
- Decisions on §9: weather canon kept (ambience only), flask hold = close-up, honest replays with
  recorded times, shake opt-in. Device target still open.
- Phase 2 done (G-38 to G-41): action times recorded, the flask as a world prop with a close-up,
  Setup in parts, Environment Lab. Phase 5's timestamp prerequisite is now met going forward.
- Water cause and effect (G-42) and Phase 3's base-camp light pipeline (G-43 to G-46). Device target
  set by Xander: an average mid-range 2026 phone; adaptive quality tiers against measured frame time.
  Not measurable here: real-phone frame times (headless software rendering runs at ~3 fps).
