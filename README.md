# Ascent

A habit tracker through which you live a year-long, wordless story on a mountain supply route.

Planning documents (claude.ai):

- Master plan, stage 1 audit, stage 2 specification, story bible, test matrix and build plan.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | local dev server |
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
- M5: core engine: model, schemas, migrations, habit engine, `derive` (`docs/decisions/m5-engine.md`).

Next: M6, the store interface, adapters, local journal and sync status.
