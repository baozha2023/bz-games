import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

import { config } from "../src/config.js";

const OLD_KIND = "platform-snapshot";
const NEW_KIND = "platform-snapshot-v2";
const PROTECTED_KINDS = ["feedback-image", "forum-image"];
const TABLES = ["user_platform_snapshots", "cloud_sync_limits"];
const BACKUP_ROOT = "/var/backups";
const BACKUP_NAME_PATTERN = /^bz-games-cloud-v1-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SMOKE_GITHUB_ID = "__bz_games_cloud_v2_smoke__";
const SMOKE_LOGIN = "bz-games-cloud-v2-smoke";
const EXPECTED_COLUMNS = {
  user_platform_snapshots: [
    "user_id",
    "protocol_version",
    "data_model_version",
    "file_storage_id",
    "snapshot_version",
    "size",
    "sha256",
    "content_type",
    "created_at",
    "updated_at",
  ],
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

async function hashReadable(readable, destination) {
  const hash = crypto.createHash("sha256");
  let length = 0;
  const handle = destination
    ? await fs.open(destination, "wx", 0o600)
    : null;
  try {
    for await (const chunk of readable) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      hash.update(bytes);
      if (handle) await handle.write(bytes);
    }
    if (handle) await handle.sync();
    return { length, sha256: hash.digest("hex") };
  } catch (error) {
    if (handle) await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function hashFile(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    return await hashReadable(handle.createReadStream({ autoClose: false }));
  } finally {
    await handle.close();
  }
}

async function fingerprintFiles(database, bucket, kinds, copyDir) {
  const files = await database
    .collection(`${config.MONGODB_BUCKET_NAME}.files`)
    .find({ "metadata.kind": { $in: kinds } })
    .sort({ _id: 1 })
    .toArray();
  const result = [];
  for (const file of files) {
    const fingerprint = await hashReadable(
      bucket.openDownloadStream(file._id),
      copyDir ? path.join(copyDir, `${String(file._id)}.bin`) : undefined,
    );
    result.push({
      id: String(file._id),
      kind: String(file.metadata?.kind || ""),
      length: fingerprint.length,
      sha256: fingerprint.sha256,
      filename: file.filename,
      chunkSize: file.chunkSize,
      contentType: file.contentType || "application/octet-stream",
      metadata: normalize(file.metadata || {}),
    });
  }
  return result;
}

async function connect() {
  invariant(config.MYSQL_USER, "mysql_not_configured");
  invariant(config.MONGODB_URI, "mongodb_not_configured");
  const sql = await mysql.createConnection({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
  });
  const mongo = new MongoClient(config.MONGODB_URI);
  await mongo.connect();
  const database = mongo.db(config.MONGODB_DB_NAME);
  const bucket = new GridFSBucket(database, {
    bucketName: config.MONGODB_BUCKET_NAME,
  });
  return { sql, mongo, database, bucket };
}

async function close(connections) {
  await Promise.allSettled([connections.sql.end(), connections.mongo.close()]);
}

export function normalizeBackupDir(backupDir) {
  invariant(typeof backupDir === "string", "backup_dir_required");
  invariant(path.posix.isAbsolute(backupDir), "backup_dir_must_be_absolute");
  const resolved = path.posix.resolve(backupDir);
  invariant(
    path.posix.dirname(resolved) === BACKUP_ROOT &&
      BACKUP_NAME_PATTERN.test(path.posix.basename(resolved)),
    "backup_dir_outside_allowed_root",
  );
  return resolved;
}

async function validateBackupDir(backupDir, { mustExist }) {
  const resolved = normalizeBackupDir(backupDir);
  const rootRealPath = await fs.realpath(BACKUP_ROOT);
  invariant(rootRealPath === BACKUP_ROOT, "backup_root_is_not_canonical");
  if (mustExist) {
    const stat = await fs.lstat(resolved);
    invariant(stat.isDirectory() && !stat.isSymbolicLink(), "unsafe_backup_dir");
    invariant((await fs.realpath(resolved)) === resolved, "backup_dir_is_not_canonical");
  }
  return resolved;
}

async function backup(backupDir) {
  backupDir = await validateBackupDir(backupDir, { mustExist: false });
  await fs.mkdir(backupDir, { recursive: false, mode: 0o700 });
  await validateBackupDir(backupDir, { mustExist: true });
  const connections = await connect();
  try {
    const mysqlBackup = {};
    for (const table of TABLES) {
      const [createRows] = await connections.sql.query(
        `SHOW CREATE TABLE \`${table}\``,
      );
      const [rows] = await connections.sql.query(`SELECT * FROM \`${table}\``);
      mysqlBackup[table] = {
        createSql: createRows[0]["Create Table"],
        rows: normalize(rows),
      };
    }
    const mongoDir = path.join(backupDir, "mongo");
    await fs.mkdir(mongoDir, { mode: 0o700 });
    const oldFiles = await fingerprintFiles(
      connections.database,
      connections.bucket,
      [OLD_KIND],
      mongoDir,
    );
    const protectedFiles = await fingerprintFiles(
      connections.database,
      connections.bucket,
      PROTECTED_KINDS,
    );
    const oldIds = oldFiles.map((file) => new ObjectId(file.id));
    const chunkCount = oldIds.length
      ? await connections.database
          .collection(`${config.MONGODB_BUCKET_NAME}.chunks`)
          .countDocuments({ files_id: { $in: oldIds } })
      : 0;
    const manifest = {
      format: "bz-games-cloud-v1-production-backup",
      createdAt: new Date().toISOString(),
      mysql: mysqlBackup,
      mongo: {
        oldFiles,
        oldChunkCount: chunkCount,
        oldTotalBytes: oldFiles.reduce((sum, file) => sum + file.length, 0),
      },
      protectedFiles,
    };
    await fs.writeFile(
      path.join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    await verifyBackup(backupDir, connections);
    console.log(
      JSON.stringify({
        ok: true,
        mysqlRows: Object.fromEntries(
          TABLES.map((table) => [table, mysqlBackup[table].rows.length]),
        ),
        oldFiles: oldFiles.length,
        oldChunks: chunkCount,
        oldBytes: manifest.mongo.oldTotalBytes,
        protected: Object.fromEntries(
          PROTECTED_KINDS.map((kind) => [
            kind,
            protectedFiles.filter((file) => file.kind === kind).length,
          ]),
        ),
      }),
    );
  } finally {
    await close(connections);
  }
}

async function readManifest(backupDir) {
  backupDir = await validateBackupDir(backupDir, { mustExist: true });
  const manifest = JSON.parse(
    await fs.readFile(path.join(backupDir, "manifest.json"), "utf8"),
  );
  invariant(
    manifest.format === "bz-games-cloud-v1-production-backup",
    "invalid_backup_manifest",
  );
  return manifest;
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryPath, filePath);
}

async function readPurgeState(backupDir) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(backupDir, "purge-state.json"), "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function verifyBackup(backupDir, existingConnections) {
  const manifest = await readManifest(backupDir);
  const connections = existingConnections || (await connect());
  try {
    for (const file of manifest.mongo.oldFiles) {
      const fingerprint = await hashFile(
        path.join(backupDir, "mongo", `${file.id}.bin`),
      );
      invariant(
        fingerprint.length === file.length,
        `backup_size_mismatch:${file.id}`,
      );
      invariant(
        fingerprint.sha256 === file.sha256,
        `backup_hash_mismatch:${file.id}`,
      );
    }
    if (!existingConnections) console.log(JSON.stringify({ ok: true }));
  } finally {
    if (!existingConnections) await close(connections);
  }
}

async function purge(backupDir) {
  backupDir = await validateBackupDir(backupDir, { mustExist: true });
  const manifest = await readManifest(backupDir);
  await verifyBackup(backupDir);
  const connections = await connect();
  try {
    const current = await fingerprintFiles(
      connections.database,
      connections.bucket,
      [OLD_KIND],
    );
    const manifestSha256 = sha256(JSON.stringify(manifest));
    const statePath = path.join(backupDir, "purge-state.json");
    let purgeState = await readPurgeState(backupDir);
    if (!purgeState) {
      invariant(
        JSON.stringify(current) === JSON.stringify(manifest.mongo.oldFiles),
        "old_mongo_data_changed_after_backup",
      );
      purgeState = {
        format: "bz-games-cloud-v1-purge-state",
        manifestSha256,
        phase: "started",
        startedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(statePath, purgeState);
    } else {
      invariant(
        purgeState.format === "bz-games-cloud-v1-purge-state" &&
          purgeState.manifestSha256 === manifestSha256,
        "invalid_purge_state",
      );
    }
    const expectedById = new Map(
      manifest.mongo.oldFiles.map((file) => [file.id, file]),
    );
    for (const file of current) {
      const expected = expectedById.get(file.id);
      invariant(
        expected && JSON.stringify(file) === JSON.stringify(expected),
        `old_mongo_data_changed_after_backup:${file.id}`,
      );
    }
    for (const file of current) {
      await connections.bucket.delete(new ObjectId(file.id));
    }
    purgeState = {
      ...purgeState,
      phase: "objects_removed",
      objectsRemovedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(statePath, purgeState);
    for (const table of TABLES) {
      await connections.sql.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
    purgeState = {
      ...purgeState,
      phase: "completed",
      completedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(statePath, purgeState);
    console.log(
      JSON.stringify({
        ok: true,
        deletedFiles: current.length,
        droppedTables: TABLES,
      }),
    );
  } finally {
    await close(connections);
  }
}

async function verifyClean(backupDir) {
  backupDir = await validateBackupDir(backupDir, { mustExist: true });
  const manifest = await readManifest(backupDir);
  const purgeState = await readPurgeState(backupDir);
  invariant(purgeState?.phase === "completed", "purge_not_completed");
  invariant(
    purgeState.manifestSha256 === sha256(JSON.stringify(manifest)),
    "purge_manifest_mismatch",
  );
  const connections = await connect();
  try {
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      const [columns] = await connections.sql.query(
        `SHOW COLUMNS FROM \`${table}\``,
      );
      invariant(
        JSON.stringify(columns.map((column) => column.Field)) ===
          JSON.stringify(EXPECTED_COLUMNS[table]),
        `unexpected_columns:${table}`,
      );
      const [[count]] = await connections.sql.query(
        `SELECT COUNT(*) AS count FROM \`${table}\``,
      );
      invariant(Number(count.count) === 0, `table_not_empty:${table}`);
    }
    const [[retiredLimitTable]] = await connections.sql.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'cloud_sync_limits'`,
    );
    invariant(
      Number(retiredLimitTable.count) === 0,
      "retired_cloud_sync_limits_table_remains",
    );
    const oldFiles = await fingerprintFiles(
      connections.database,
      connections.bucket,
      [OLD_KIND],
    );
    invariant(oldFiles.length === 0, "old_mongo_files_remain");
    const newFiles = await fingerprintFiles(
      connections.database,
      connections.bucket,
      [NEW_KIND],
    );
    invariant(newFiles.length === 0, "cloud_v2_test_files_remain");
    const oldIds = manifest.mongo.oldFiles.map((file) => new ObjectId(file.id));
    const oldChunks = oldIds.length
      ? await connections.database
          .collection(`${config.MONGODB_BUCKET_NAME}.chunks`)
          .countDocuments({ files_id: { $in: oldIds } })
      : 0;
    invariant(oldChunks === 0, "old_mongo_chunks_remain");
    const protectedFiles = await fingerprintFiles(
      connections.database,
      connections.bucket,
      PROTECTED_KINDS,
    );
    invariant(
      JSON.stringify(protectedFiles) ===
        JSON.stringify(manifest.protectedFiles),
      "protected_mongo_files_changed",
    );
    console.log(
      JSON.stringify({
        ok: true,
        mysqlRows: Object.fromEntries(
          Object.keys(EXPECTED_COLUMNS).map((table) => [table, 0]),
        ),
        oldFiles: 0,
        oldChunks: 0,
        newFiles: 0,
        protected: Object.fromEntries(
          PROTECTED_KINDS.map((kind) => [
            kind,
            protectedFiles.filter((file) => file.kind === kind).length,
          ]),
        ),
      }),
    );
  } finally {
    await close(connections);
  }
}

async function inspectCloudState() {
  const connections = await connect();
  try {
    const [[snapshotCount]] = await connections.sql.query(
      "SELECT COUNT(*) AS count FROM user_platform_snapshots",
    );
    const [[cloudLimitCount]] = await connections.sql.query(
      `SELECT COUNT(*) AS count FROM rate_limit_records
       WHERE endpoint_key IN ('cloud.upload', 'cloud.download')`,
    );
    const mysqlRows = {
      user_platform_snapshots: Number(snapshotCount.count),
      cloud_rate_limit_records: Number(cloudLimitCount.count),
    };
    const files = connections.database.collection(
      `${config.MONGODB_BUCKET_NAME}.files`,
    );
    const mongoFiles = {};
    for (const kind of [OLD_KIND, NEW_KIND, ...PROTECTED_KINDS]) {
      mongoFiles[kind] = await files.countDocuments({ "metadata.kind": kind });
    }
    console.log(JSON.stringify({ ok: true, mysqlRows, mongoFiles }));
  } finally {
    await close(connections);
  }
}

async function ensureSmokeUser() {
  const connections = await connect();
  try {
    const now = new Date();
    await connections.sql.query(
      `INSERT INTO users
         (github_id, login, name, nickname, is_online, last_online_at,
          avatar_url, profile_url, email, role, created_at, updated_at,
          last_login_at)
       VALUES (?, ?, 'Cloud V2 Smoke Test', '云同步测试', 0, NULL,
               '', '', '', 'player', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         login = VALUES(login), name = VALUES(name), nickname = VALUES(nickname),
         is_online = 0, last_online_at = NULL, avatar_url = '',
         profile_url = '', email = '', role = 'player', updated_at = VALUES(updated_at)`,
      [SMOKE_GITHUB_ID, SMOKE_LOGIN, now, now, now],
    );
    const [[user]] = await connections.sql.query(
      "SELECT id, github_id, login, role FROM users WHERE github_id = ? LIMIT 1",
      [SMOKE_GITHUB_ID],
    );
    invariant(
      user?.github_id === SMOKE_GITHUB_ID &&
        user.login === SMOKE_LOGIN &&
        user.role === "player",
      "invalid_smoke_test_user",
    );
    console.log(JSON.stringify({ ok: true, userId: String(user.id) }));
  } finally {
    await close(connections);
  }
}

async function deleteSmokeCloudState(connections, userId) {
  const [rows] = await connections.sql.query(
    "SELECT file_storage_id FROM user_platform_snapshots WHERE user_id = ?",
    [userId],
  );
  for (const row of rows) {
    try {
      await connections.bucket.delete(new ObjectId(row.file_storage_id));
    } catch {}
  }
  await connections.sql.query(
    "DELETE FROM user_platform_snapshots WHERE user_id = ?",
    [userId],
  );
  await connections.sql.query(
    `DELETE FROM rate_limit_records
     WHERE github_id = ? AND endpoint_key IN ('cloud.upload', 'cloud.download')`,
    [SMOKE_GITHUB_ID],
  );
}

async function productionTest() {
  invariant(!config.CLOUD_V2_MAINTENANCE, "cloud_v2_still_in_maintenance");
  const connections = await connect();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  let userId;
  try {
    const [[user]] = await connections.sql.query(
      `SELECT id, github_id, login, role
       FROM users
       WHERE github_id = ? AND login = ?
       LIMIT 1`,
      [SMOKE_GITHUB_ID, SMOKE_LOGIN],
    );
    invariant(
      user?.github_id === SMOKE_GITHUB_ID &&
        user.login === SMOKE_LOGIN &&
        user.role === "player",
      "dedicated_production_test_user_missing",
    );
    userId = user.id;
    await deleteSmokeCloudState(connections, userId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await connections.sql.query(
      `INSERT INTO auth_sessions
         (token_hash, user_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tokenHash, userId, now, now, expiresAt],
    );
    const body = JSON.stringify({
      formatVersion: 2,
      dataModelVersion: 4,
      createdAt: now.toISOString(),
      config: "production-smoke-redacted-config",
      databaseSql: "BEGIN; COMMIT;",
    });
    const headers = {
      "x-relay-token": config.RELAY_TOKEN,
      authorization: `Bearer ${token}`,
    };
    const base = `http://${config.HOST}:${config.PORT}`;
    const missingDownload = await fetch(
      `${base}/api/v2/cloud/platform-snapshot`,
      { headers },
    );
    invariant(
      missingDownload.status === 404,
      `missing_download_status:${missingDownload.status}`,
    );
    const rejectedUpload = await fetch(
      `${base}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 2 }),
      },
    );
    invariant(
      rejectedUpload.status === 400,
      `rejected_upload_status:${rejectedUpload.status}`,
    );
    const upload = await fetch(`${base}/api/v2/cloud/platform-snapshot`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    invariant(upload.status === 200, `upload_status:${upload.status}`);
    const meta = await fetch(`${base}/api/v2/cloud/platform-snapshot/meta`, {
      headers,
    });
    invariant(meta.status === 200, `meta_status:${meta.status}`);
    const metadata = await meta.json();
    invariant(
      metadata.snapshot.protocolVersion === 2,
      "meta_protocol_mismatch",
    );
    invariant(metadata.snapshot.dataModelVersion === 4, "meta_model_mismatch");
    const downloadResponse = await fetch(
      `${base}/api/v2/cloud/platform-snapshot`,
      { headers },
    );
    invariant(
      downloadResponse.status === 200,
      `download_status:${downloadResponse.status}`,
    );
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    invariant(downloaded.toString("utf8") === body, "download_body_mismatch");
    invariant(
      downloadResponse.headers.get("x-file-sha256") === sha256(downloaded),
      "download_hash_mismatch",
    );
    console.log(
      JSON.stringify({
        ok: true,
        missingDownloadStatus: missingDownload.status,
        rejectedUploadStatus: rejectedUpload.status,
        uploadStatus: upload.status,
        metaStatus: meta.status,
        downloadStatus: downloadResponse.status,
        sha256: sha256(downloaded),
      }),
    );
  } finally {
    try {
      if (userId) await deleteSmokeCloudState(connections, userId);
      await connections.sql.query(
        "DELETE FROM auth_sessions WHERE token_hash = ?",
        [tokenHash],
      );
    } finally {
      await close(connections);
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const [command, backupDir] = args;
  if (command === "backup") await backup(backupDir);
  else if (command === "verify-backup") await verifyBackup(backupDir);
  else if (command === "purge") await purge(backupDir);
  else if (command === "verify-clean") await verifyClean(backupDir);
  else if (command === "inspect") await inspectCloudState();
  else if (command === "ensure-smoke-user") await ensureSmokeUser();
  else if (command === "production-test") await productionTest();
  else
    throw new Error(
      "usage: cloud-v2-production-ops.js <backup|verify-backup|purge|verify-clean|inspect|ensure-smoke-user|production-test> [backup-dir]",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
