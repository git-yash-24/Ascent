# M7: export, import with dry run, weekly backup prompt

Implemented in `src/data/backup/backup.ts`; tests in `tests/unit/backup.test.ts`.

| Piece | Behaviour |
| --- | --- |
| Export | One JSON file (`ascent-backup-YYYY-MM-DD.json`): every stored document, the app version and the schema numbers. A CSV of the daily log (date, habit id, habit name, value, skip) for spreadsheets. |
| Import, step 1 | `prepareImport` parses the whole file, migrates old schemas, and rejects the file whole if any document is invalid, names a habit the backup lacks, or holds a date in the wrong month. It returns a dry-run summary and an export of the current data (`…-before-import.json`), to be saved before anything changes. |
| Import, step 2 | `SyncedStore.replaceAll` makes the store hold exactly the backup. Every backup entry is rewritten at the import time, so it wins over anything stored; every stored entry the backup lacks is cleared. Everything goes through the journal and sync, like any other write. |
| Weekly prompt | `backupDue`: due when 7 or more days have passed since the last backup (or since first use), only after a day closes, never during a scene, never on the very first launch. The last backup date is kept per device. |

Saving the file uses the artifact's `downloads` capability. It is wired into Setup in M8, where
the dry run is shown and the person confirms.

## Tests

- I10: export, then parse, gives the identical snapshot on 200 random histories. Through the
  store, a second device reads the identical record, habits, days and climb.
- X14: an older backup is migrated, the dry run reports added, removed and changed entries,
  added and removed habits, changed settings and the date range, and the current data is
  exported first.
- Every rejection path rejects the file whole.
