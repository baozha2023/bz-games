import crypto from "crypto";
import { execFileSync } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin");
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureDirectory = path.join(repositoryRoot, "docs", "fixtures");
const fixturePath = path.join(
  fixtureDirectory,
  "BZ-Games-Migration-v1-sample.bzgames",
);
const checksumPath = `${fixturePath}.sha256`;
const fixtureDatabasePath = path.join(
  repositoryRoot,
  "scripts",
  "fixtures",
  "migration-v1-bz_games.db",
);
const fixtureDatabaseSha256 =
  "48789dff1a7f1e2a1c0e45eba4c1a78bae7d12185842d2bed2756f96455ff146";
const fixtureEncryptionSeed = "bzgames-migration-v1-fixture";
const fixedTime = new Date("2026-08-26T00:00:00.000Z");

function encryptV1Config(value) {
  const key = crypto
    .createHash("sha256")
    .update(fixtureEncryptionSeed)
    .digest();
  const iv = crypto
    .createHash("sha256")
    .update("bzgames-migration-v1-fixture-config-iv")
    .digest()
    .subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    __encrypted: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: payload.toString("base64"),
  };
}

async function listPayload(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.name === "migration-manifest.json") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
      else throw new Error(`Unsupported fixture entry: ${entryPath}`);
    }
  }
  return files;
}

async function setFixedTimes(root) {
  const pending = [root];
  const directories = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    directories.push(directory);
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else await fsp.utimes(entryPath, fixedTime, fixedTime);
    }
  }
  for (const directory of directories.reverse()) {
    await fsp.utimes(directory, fixedTime, fixedTime);
  }
}

async function main() {
  await fsp.mkdir(fixtureDirectory, { recursive: true });
  const sourceDatabase = await fsp.readFile(fixtureDatabasePath);
  const sourceDatabaseSha256 = crypto
    .createHash("sha256")
    .update(sourceDatabase)
    .digest("hex");
  if (sourceDatabaseSha256 !== fixtureDatabaseSha256) {
    throw new Error("Migration fixture database checksum mismatch");
  }
  const stagingRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "bzgames-migration-fixture-"),
  );
  const partialFixturePath = `${fixturePath}.partial-${process.pid}`;

  try {
    const gamesVersionRoot = path.join(
      stagingRoot,
      "games",
      "com.bz.fixture-game",
      "1.0.0",
    );
    const databaseRoot = path.join(stagingRoot, "db");
    await fsp.mkdir(gamesVersionRoot, { recursive: true });
    await fsp.mkdir(databaseRoot, { recursive: true });
    await fsp.writeFile(
      path.join(stagingRoot, "config.json"),
      `${JSON.stringify(
        encryptV1Config({
          settings: {
            playerId: "00000000-0000-4000-8000-000000000001",
            playerName: "Migration Fixture",
            language: "zh-CN",
            filterSensitiveWords: false,
            libraryLayoutMode: "steam",
            nicknameStyle: {
              color: "#123456",
              font: "rounded",
              effect: "retired-effect",
              weight: "bold",
            },
            chatInputHeight: -1,
            downloadFloatBall: true,
            gameStoragePath: "C:\\BZ-Games\\games",
            gameStorageHistory: ["C:\\BZ-Games\\games"],
            cloudSessionToken: "must-not-be-imported",
            cloudSessionExpiresAt: "2030-01-01T00:00:00.000Z",
            cloudUserLogin: "legacy-user",
            cloudUserName: "Legacy User",
            cloudUserProfileUrl: "https://github.com/legacy-user",
            cloudLastUploadedAt: "2026-08-26T00:00:00.000Z",
            githubToken: "must-not-be-imported",
            feedbackHistory: [{ id: "must-be-discarded" }],
            ignoredUpdateVersion: "9.9.9",
            skipStartupUpdateCheck: true,
            migrationNoticeAcknowledgedVersion: "3.4.2",
          },
          userData: {
            bzCoins: 42,
            checkIn: {
              lastCheckInDate: "2026-08-26",
              consecutiveDays: 2,
              maxConsecutiveDays: 3,
              totalDays: 4,
            },
            ownedFrames: [],
            ownedGameCardProducts: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(gamesVersionRoot, "game.json"),
      `${JSON.stringify(
        {
          id: "com.bz.fixture-game",
          name: "Migration Fixture",
          version: "1.0.0",
          author: "BZ-Games",
          platformVersion: ">=3.4.2",
          entry: "index.html",
          type: "singleplayer",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(gamesVersionRoot, "index.html"),
      "<!doctype html><title>BZ-Games migration fixture</title>\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(gamesVersionRoot, "fixture.txt"),
      "BZ-Games migration fixture payload v1\n",
      "utf8",
    );

    await fsp.copyFile(
      fixtureDatabasePath,
      path.join(databaseRoot, "bz_games.db"),
    );
    for (const legacyName of [
      "achievement_unlocks.db",
      "play_sessions.db",
      "stats_reports.db",
      "bz_games.db-wal",
      "bz_games.db-shm",
    ]) {
      await fsp.writeFile(path.join(databaseRoot, legacyName), "", "utf8");
    }
    const legacyImportsRoot = path.join(stagingRoot, "games", ".imports");
    await fsp.mkdir(legacyImportsRoot, { recursive: true });
    await fsp.writeFile(
      path.join(legacyImportsRoot, "orphan.partial"),
      "must be discarded\n",
      "utf8",
    );

    const payloadFiles = await listPayload(stagingRoot);
    const payloadStats = await Promise.all(
      payloadFiles.map((filePath) => fsp.stat(filePath)),
    );
    const manifest = {
      format: "bzgames-migration",
      formatVersion: 1,
      exportedAt: fixedTime.toISOString(),
      sourceAppVersion: "3.4.2",
      sourcePlatform: "win32",
      sourceArch: "x64",
      sourceAppRoot: "C:\\BZ-Games",
      sourceGamesRoot: "C:\\BZ-Games\\games",
      entries: ["config.json", "games", "db"],
      totalFiles: payloadFiles.length,
      totalBytes: payloadStats.reduce((total, stat) => total + stat.size, 0),
    };
    await fsp.writeFile(
      path.join(stagingRoot, "migration-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await setFixedTimes(stagingRoot);

    await fsp.rm(partialFixturePath, { force: true });
    execFileSync(
      path7za,
      [
        "a",
        "-t7z",
        "-mx=0",
        "-mtc=off",
        "-mta=off",
        "-y",
        partialFixturePath,
        "migration-manifest.json",
        "config.json",
        "games",
        "db",
      ],
      { cwd: stagingRoot, stdio: "ignore" },
    );
    execFileSync(path7za, ["t", partialFixturePath], { stdio: "ignore" });

    const checksum = crypto
      .createHash("sha256")
      .update(await fsp.readFile(partialFixturePath))
      .digest("hex");
    await fsp.rename(partialFixturePath, fixturePath);
    await fsp.writeFile(
      checksumPath,
      `${checksum}  ${path.basename(fixturePath)}\n`,
      "utf8",
    );
    console.log(`Generated ${path.relative(repositoryRoot, fixturePath)}`);
    console.log(`SHA-256 ${checksum}`);
  } finally {
    await fsp.rm(partialFixturePath, { force: true });
    await fsp.rm(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
