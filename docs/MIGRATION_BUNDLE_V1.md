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

## v4 importer behavior

The importer treats every archive as untrusted. It tests the archive, enforces the four-entry root allowlist, rejects traversal/absolute paths/links, validates the manifest and exact 3.4.2 source version, and extracts into staging before changing live data.

The isolated `backup/v1/V1ImportAdapter.ts` opens the old database read-only, creates a fresh final-schema v4 database, and converts every version location to `library_id + relative_path`; it never updates the old database in place. Paths below `sourceGamesRoot` are rebased onto `<newAppRoot>/games`. Paths outside it become external-library references and unavailable roots are reported for reconnection. Legacy databases, WAL/SHM files, `.imports`, obsolete configuration fields, and old update state are discarded. Plaintext `game.json` files are encrypted during this conversion. Normal v4 startup and business services contain no v1 schema, absolute-path, or plaintext-manifest compatibility branch.

## Deterministic importer fixture

The V1 regression archive is generated from the fixed synthetic inputs in `scripts/fixtures/` for the future Velopack importer's allowlist, CRC, extraction, and different-install-path remapping tests. `npm run test:v1-fixture` builds the archive and its checksum inside an isolated temporary directory before conversion, so binary outputs are not committed. Use `npm run fixture:migration` only when a local archive under `docs/fixtures/` is needed for manual inspection; identical inputs produce an identical archive.

The sample contains synthetic data only. Its v1 configuration, SQLite database, and converted game manifest use the test-only encryption seed `bzgames-migration-v1-fixture`, which importer tests inject with `node scripts/run-v1-conversion.mjs --fixture <archive> <output>`. It is not a production backup and does not contain the production key or any user data.

The fixture deliberately contains the pre-3.4.2 leftovers `achievement_unlocks.db`, `play_sessions.db`, `stats_reports.db`, `bz_games.db-wal`, `bz_games.db-shm`, and `games/.imports`. A successful conversion must retain only `db/bz_games.db`, remove `.imports`, convert every absolute built-in path to `library_id + relative_path`, discard legacy configuration fields, and encrypt the plaintext `game.json`. `npm run test:v1-fixture` enforces this contract.
