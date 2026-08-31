import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "bz-games-v1-import-test-"),
);
const outputRoot = path.join(temporaryRoot, "converted");
const archivePath = path.join(temporaryRoot, "migration-v1.bzgames");

try {
  const buildResult = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "scripts", "build-migration-fixture.mjs"),
      "--output",
      archivePath,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (buildResult.status !== 0) {
    process.stdout.write(buildResult.stdout || "");
    process.stderr.write(buildResult.stderr || "");
    throw new Error(`v1_fixture_build_failed:${buildResult.status}`);
  }
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "scripts", "run-v1-conversion.mjs"),
      "--fixture",
      archivePath,
      outputRoot,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`v1_fixture_conversion_failed:${result.status}`);
  }
  const reportMatch = result.stdout.match(/\{\s*"outputRoot"[\s\S]*\}\s*$/);
  assert.ok(reportMatch, "V1 conversion report is missing");
  const report = JSON.parse(reportMatch[0]);
  assert.equal(report.games, 1);
  assert.equal(report.versions, 1);
  assert.equal(report.installedVersions, 1);
  assert.equal(report.activeLibraries, 1);
  assert.equal(report.removedLibraries, 0);
  assert.equal(report.playSessions, 1);
  assert.equal(report.achievements, 1);
  assert.equal(report.statsEvents, 1);
  assert.equal(report.absoluteVersionPaths, 0);
  assert.equal(report.userVersion, 40000);
  assert.equal(report.integrity, "ok");
  assert.equal(report.encryptedBuiltinManifests, 1);
  assert.deepEqual(report.databaseEntries, ["bz_games.db"]);
  assert.equal(report.importsDirectoryPresent, false);
  const databaseEntries = await fs.readdir(path.join(outputRoot, "db"));
  assert.deepEqual(databaseEntries, ["bz_games.db"]);
  await assert.rejects(fs.stat(path.join(outputRoot, "games", ".imports")));

  const envelope = JSON.parse(
    await fs.readFile(path.join(outputRoot, "config.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(envelope).sort(), [
    "algorithm",
    "format",
    "formatVersion",
    "iv",
    "payload",
    "tag",
  ]);
  assert.equal(envelope.format, "bz-games-config");
  assert.equal(envelope.formatVersion, 4);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update("bzgames-migration-v1-fixture").digest(),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const convertedConfig = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
  assert.equal(convertedConfig.settings.sensitiveWordFilter, false);
  assert.equal(convertedConfig.settings.libraryLayout, "steam");
  assert.deepEqual(convertedConfig.settings.nicknameStyle, {
    color: "#123456",
    font: "rounded",
    effect: "none",
    weight: "bold",
  });
  assert.equal(convertedConfig.settings.chatInputHeight, 204);
  assert.equal(convertedConfig.settings.downloadFloatBall, true);
  for (const legacyField of [
    "feedbackHistory",
    "ignoredUpdateVersion",
    "skipStartupUpdateCheck",
    "migrationNoticeAcknowledgedVersion",
    "gameStoragePath",
    "gameStorageHistory",
    "cloudSessionToken",
    "cloudSessionExpiresAt",
    "cloudUserLogin",
    "cloudUserName",
    "cloudUserProfileUrl",
    "cloudLastUploadedAt",
  ]) {
    assert.equal(legacyField in convertedConfig.settings, false);
  }
  assert.equal(convertedConfig.settings.accountSessionToken, "");
  assert.equal(convertedConfig.settings.accountSessionExpiresAt, "");
  assert.equal(convertedConfig.settings.accountUserLogin, "");
  assert.equal(convertedConfig.settings.accountUserName, "");
  assert.equal(convertedConfig.settings.accountUserProfileUrl, "");
  assert.equal(convertedConfig.settings.githubToken, "");

  const encryptedManifest = JSON.parse(
    await fs.readFile(
      path.join(
        outputRoot,
        "games",
        "com.bz.fixture-game",
        "1.0.0",
        "game.json",
      ),
      "utf8",
    ),
  );
  assert.equal(encryptedManifest.__bzGameManifestEncrypted, true);
  assert.equal(encryptedManifest.algorithm, "aes-256-gcm");
  assert.equal("id" in encryptedManifest, false);
  process.stdout.write("V1 migration fixture conversion passed\n");
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
