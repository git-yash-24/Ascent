# Ascent

A habit tracker through which you live a year-long, wordless story on a mountain supply route.

Planning documents (claude.ai):

- Master plan, stage 1 audit, stage 2 specification, story bible, test matrix and build plan.

## Play it on this computer

- **No install:** double-click `Play Ascent.html`. It is the whole game in one file and works
  offline in Chrome, Edge or Firefox. Progress is saved in that browser on this computer.
- **Live development:** double-click `start.bat` (needs Node.js 20 or newer from nodejs.org).
  It installs once, then opens the game at http://localhost:5173 and reloads on every save.
- `Play Ascent.html` is rebuilt with `npm run play`.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | local dev server |
| `npm run play` | build the single-file `Play Ascent.html` at the project root |
| `npm run typecheck` | strict TypeScript check |
| `npm test` | unit and property tests |
| `npm run artifact` | build, then write `dist/artifact.html` in the shape the Artifact tool publishes |
| `npm run check` | all of the above, in order; must pass before any release |

## Layout

- `src/core` pure TypeScript: model, habit engine, story engine. No browser code.
- `src/data` store interface, adapters, sync journal, backup.
- `src/story-content` canon timeline, scene files, daily-moment library, continuity checker.
- `src/ui` checklist, setup, panels. Must work with no world at all.
- `src/world`, `src/cinema`, `src/audio` presentation layers.
- `src/shell` boot, capability checks, routing.
- `assets` models, animations and sounds, each with its licence in `assets/LICENCES.md`.
- `tests` unit, property, end-to-end, fixtures.

Rule: nothing in `src/core` or `src/data` imports from the presentation layers.

## Milestones

- M1: scaffold, capability check page.
- M2, M3: feel tests in low-poly 3D and silhouette theatre (`prototypes/`).
- M4, gate 1: 3D chosen for the MVP; Pine as the storytelling reference (`docs/decisions/gate-1.md`).
- M5: core engine: model, schemas, migrations, habit engine, `derive` (`docs/decisions/m5-engine.md`), and the weekly climb (`docs/decisions/weekly-climb.md`).

- M6: store, memory and artifact database adapters, local journal, sync status; sync probe page (`docs/decisions/m6-data.md`).

- M7: export (JSON and CSV), import with dry run and a safety export first, weekly backup prompt (`docs/decisions/m7-backup.md`).

- M8: the beta page: accessible checklist and Setup, working with no world (`docs/decisions/m8-checklist.md`). `npm run test:e2e` for the browser tests.
- SMART habit form, story-chosen chores, built-in water bar (`docs/decisions/smart-water.md`).

Next: M9, world v1 in 3D behind the checklist.
