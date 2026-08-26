# BZ-Games v3.4.2

v3.4.2 is the final release that older clients can install through the NSIS automatic-update path.

## Changes

- Removed automatic update checking, downloading, ignoring, and installation from the v3.4.2 runtime.
- Replaced “Check for Updates” with a persistent update and migration notice.
- Added one-click export of `config.json`, the executable-adjacent `games/`, and `db/` into a verified `.bzgames` v1 file.
- Added real preparation/archive/verification progress, cancellation, free-space checks, active-task guards, link rejection, and atomic final-file replacement.
- Added a queued SQLite maintenance window so the encrypted database snapshot includes committed WAL data.
- Preserved startup restoration of snapshots created by older clients, allowing the supported v3.4.1 → v3.4.2 bridge update to restore portable data.

Export never deletes source data. After importing the backup into a future version, users may manually uninstall v3.4.2; the client will not uninstall itself automatically.
