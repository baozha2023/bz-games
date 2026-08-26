# BZ-Games `.bzgames` Migration Bundle v1

## Purpose

Version 3.4.2 is the final NSIS bridge release. It exports the current portable data into one file for a later Velopack-based client to import. Export never deletes or moves source data; SQLite may perform its normal WAL checkpoint while creating a consistent snapshot. The client also never uninstalls itself; users may manually uninstall v3.4.2 only after verifying a successful import.

## Container and root layout

The file extension is `.bzgames`. The content is an uncompressed 7z container (`-t7z -mx=0`) with this exact root layout:

```text
migration-manifest.json
config.json
games/
db/
```

No additional root entry is permitted. `config.json` and `db/bz_games.db` are required. `games/` is required as a directory but may be empty. External game-library roots are not included.

```json
{
  "format": "bzgames-migration",
  "formatVersion": 1,
  "exportedAt": "2026-08-26T00:00:00.000Z",
  "sourceAppVersion": "3.4.2",
  "sourcePlatform": "win32",
  "sourceArch": "x64",
  "sourceAppRoot": "D:\\BZ-Games",
  "sourceGamesRoot": "D:\\BZ-Games\\games",
  "entries": ["config.json", "games", "db"],
  "totalFiles": 3,
  "totalBytes": 1024
}
```

`totalFiles` and `totalBytes` describe the payload and exclude the manifest itself. The archive CRC plus a successful `7za t` is the v1 transport-integrity contract. The archive has no extra password; the existing encryption of configuration and SQLite payloads remains unchanged.

## Export requirements

- Reject export while a game, marketplace install, or manual game import is active; do not stop those activities automatically.
- Require `db/bz_games.db` to be a regular file, and reject symbolic links, junctions/reparse links, and non-file/non-directory entries instead of following them.
- Reject a destination inside the current application root, including an outside path that resolves back through a junction, so the backup cannot be removed by a later uninstall.
- Check destination and temporary-drive free space separately, or their combined archive/snapshot requirement when both paths are on the same volume.
- Pause and queue SQLite operations, close the worker, copy the entire `db/` directory, and always resume the database in `finally`.
- Write a sibling `.partial-<uuid>` file, test it, and only then atomically replace the selected `.bzgames` file with a same-directory rename. Cancellation waits for 7za to exit; cancellation or failure removes only temporary data and leaves an existing valid backup intact.

## Future importer requirements

The importer must treat every archive as untrusted. It must test the archive, enforce the four-entry root allowlist, reject traversal/absolute paths/links, validate the manifest and supported `formatVersion`, and extract into staging before changing live data.

When the new application root differs, paths equal to or below `sourceGamesRoot` are rebased by their relative suffix onto `<newAppRoot>/games`. Paths outside `sourceGamesRoot` represent external libraries: preserve them unchanged and tell the user to reconnect unavailable locations. The relative live layout remains `config.json`, `games/`, and `db/`.

## Deterministic importer fixture

[`fixtures/BZ-Games-Migration-v1-sample.bzgames`](fixtures/BZ-Games-Migration-v1-sample.bzgames) is the fixed v1 archive for the future Velopack importer's allowlist, CRC, extraction, and different-install-path remapping tests. Its adjacent `.sha256` file records the expected digest. Regenerate both files with `npm run fixture:migration`; identical inputs produce an identical archive.

The sample contains synthetic data only. Its SQLite database uses the test-only encryption seed `bzgames-migration-v1-fixture`, which importer tests must inject explicitly. It is not a production backup and does not contain the production database key or any user data.
