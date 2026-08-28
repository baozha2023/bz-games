import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBackupDir } from "./cloud-v2-production-ops.js";

test("cloud migration backup directories are direct canonical children", () => {
  assert.equal(
    normalizeBackupDir("/var/backups/bz-games-cloud-v1-20260828-120000"),
    "/var/backups/bz-games-cloud-v1-20260828-120000",
  );
  assert.throws(
    () => normalizeBackupDir("/var/backups/bz-games-cloud-v1-safe/../../tmp/x"),
    /backup_dir_outside_allowed_root/,
  );
  assert.throws(
    () => normalizeBackupDir("/var/backups/bz-games-cloud-v1-safe/nested"),
    /backup_dir_outside_allowed_root/,
  );
  assert.throws(
    () => normalizeBackupDir("/tmp/bz-games-cloud-v1-20260828"),
    /backup_dir_outside_allowed_root/,
  );
});
