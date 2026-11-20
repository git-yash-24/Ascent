# M6: store, adapters, journal, sync

## Shape

- `src/data/backend.ts`: the Backend contract (read all, put/get one entry, put a whole document, subscribe).
- `src/data/adapters/memory.ts`: the reference backend, with failure injection.
- `src/data/adapters/artifactDb.ts`: the artifact database (`claude.use("db")`, contract 0.2.46).
- `src/data/sync/journal.ts`: the local journal over browser storage, guarded for storage that is missing or throws.
- `src/data/sync/fold.ts`: remote documents into one snapshot; per-document validation; conflicts.
- `src/data/store.ts`: `SyncedStore`, the write path and the status.

## Decisions

| ID | Decision | Why |
| --- | --- | --- |
| D-M6-1 | One log document per month **per device** (`log-YYYY-MM~<device>`); each device writes only its own | The database is last-writer-wins by arrival with no transactions. Per-device documents remove create races and stale overwrites; replicas fold every device's entries with the core rule (later write time wins), so all devices converge whatever the arrival order |
| D-M6-2 | Entries stored as arrays `[value, skip, writeTime]` | `update` merges objects recursively, so an undo stored as an object would keep the old value; arrays replace wholesale |
| D-M6-3 | A write is confirmed by reading it back before the journal drops it | "A record is never shown as safe before it is" |
| D-M6-4 | The journal keeps only the latest change per habit-day or document | Writes set values; replay is idempotent |
| D-M6-5 | A conflict is two devices writing different values to one habit-day within 60 s; listed for 7 days | X03; edits hours apart are ordinary corrections, not conflicts |
| D-M6-6 | Each stored entry is validated on its own when read; a bad one is set aside with a problem note | One corrupt entry must not cost the rest of the month |
| D-M6-7 | Store unreachable at open: the last synced copy from device storage, logging allowed, reconnect before writing | Spec failure modes |
| D-M6-8 | Everything lives under the viewer's private `data/users/<id>/` | Private even from anyone the page is shared with |

Document budget: about 12 log documents a year per device plus 4 single documents; five years
on three devices is about 185 of the database's 5,000.

## Status

| Status | Shown as | Meaning |
| --- | --- | --- |
| synced | nothing | stored on the account and read back |
| saving | moving dot | sent, waiting for confirmation |
| local | hollow dot, "saved here" | in the device journal, not yet on the account |
| unsaved | solid warning dot | in memory only |

## The three platform questions

Answered on Xander's phone (Samsung SM-S928B, Android 16, Claude app webview) with the sync
probe artifact, 2026-10-13.

| Question | Result |
| --- | --- |
| 1. Merge write confirmation time | 7 ticks: 2897, 1947, 1945, 1940, 1845, 1707, 1912 ms; median 1.94 s. Each covers the write, the read-back and a full re-read of the store. The tap itself is on screen and in the journal within the same frame, so the 50 ms and 100 ms budgets are unaffected; "Saving" shows for about 2 s. |
| 2. Offline journal entry survives a restart and syncs | Pass: 1 change made in airplane mode survived a full close of the app and synced on reopening. |
| 3. Browser storage persists across Claude app restarts on Android | Pass: same device id across 3 opens with force-closes between. |

M6 acceptance ("offline test passes or is documented as unsupported"): passed.

Follow-up for M8: the re-read after each flush costs most of the 2 s. Once the checklist exists,
measure whether confirming by read-back alone, with the full re-read deferred, shortens
"Saving" without weakening the guarantee.
