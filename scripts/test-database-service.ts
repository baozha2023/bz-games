import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  BzGamesDatabase,
  bzGamesDatabase,
} from "../src/main/services/storage/database/BzGamesDatabase";
import { storeService } from "../src/main/services/storage/StoreService";
import { playSessionDatabaseService } from "../src/main/services/storage/database/PlaySessionDatabaseService";
import {
  isValidDownloadUrl,
  isValidMarketImageUrl,
  type GameRecord,
} from "../src/shared/types";
import {
  resolveGameHostingPortalUrl,
  resolveMarketDownloadUrl,
  resolveMarketImageUrl,
} from "../src/main/services/market/HostedGameUrl";
import { RequestInterceptor } from "../src/main/utils/requestInterceptor";

const source = new BzGamesDatabase("source.db", "database-service-test");

function game(id: string, favorite?: boolean): GameRecord {
  return {
    id,
    versions: [
      {
        version: "1.0.0",
        libraryId: "builtin",
        relativePath: `${id}/1.0.0`,
        addedAt: 1,
        installSource: "manual",
        marketId: null,
        stats: {},
        unlockedAchievements: [],
        playtime: 0,
      },
    ],
    latestVersion: "1.0.0",
    addedAt: 1,
    isFavorite: favorite,
  };
}

async function seedBusinessRecords(
  database: BzGamesDatabase,
  prefix: string,
): Promise<void> {
  await database.run(
    `INSERT INTO play_sessions
      (id, game_id, game_name, version, start_time, end_time, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`${prefix}-session`, prefix, prefix, "1.0.0", 1, 2, 1],
  );
  assert.equal(
    await database.recordAchievement({
      gameId: prefix,
      gameName: prefix,
      version: "1.0.0",
      achievementId: "achievement",
      achievementName: "achievement",
      unlockedAt: 1,
    }),
    true,
  );
  await database.recordStats([
    {
      gameId: prefix,
      gameName: prefix,
      version: "1.0.0",
      statId: "score",
      statName: "score",
      value: 1,
      mode: "full",
      reportedAt: 1,
    },
  ]);
}

async function count(
  database: BzGamesDatabase,
  table: string,
): Promise<number> {
  const row = await database.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM "${table}"`,
  );
  return row?.count || 0;
}

async function verifyReinstallRestoresDerivedData(): Promise<void> {
  await storeService.init();
  const gameId = "reinstall-cache";
  const version = "1.0.0";
  const gameRoot = path.join(process.cwd(), "games", gameId);
  const versionPath = path.join(gameRoot, version);
  await fs.mkdir(versionPath, { recursive: true });

  const installed = game(gameId, true);
  await storeService.addGame(installed);
  assert.equal(
    await storeService.unlockAchievement(
      gameId,
      version,
      "shared-achievement",
      "Reinstall Cache",
      "Shared Achievement",
    ),
    true,
  );
  await bzGamesDatabase.recordStats([
    {
      gameId,
      gameName: "Reinstall Cache",
      version,
      statId: "score",
      statName: "Score",
      value: 2,
      mode: "increment",
      reportedAt: 10,
    },
    {
      gameId,
      gameName: "Reinstall Cache",
      version,
      statId: "score",
      statName: "Score",
      value: 3,
      mode: "increment",
      reportedAt: 11,
    },
  ]);
  await bzGamesDatabase.run(
    `INSERT INTO play_sessions
      (id, game_id, game_name, version, start_time, end_time, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["reinstall-session", gameId, "Reinstall Cache", version, 20, 30, 10],
  );
  await storeService.refreshGameDerivedData();
  const originalUnlockedAt = storeService
    .getGames()
    .find((item) => item.id === gameId)
    ?.versions.find((item) => item.version === version)
    ?.unlockedAchievements.find(
      (item) => item.id === "shared-achievement",
    )?.unlockedAt;
  assert.equal(typeof originalUnlockedAt, "number");

  await storeService.removeGame(gameId);
  assert.equal(
    storeService.getGames().some((item) => item.id === gameId),
    false,
  );

  const nextVersion = "2.0.0";
  const nextVersionPath = path.join(gameRoot, nextVersion);
  await fs.mkdir(versionPath, { recursive: true });
  await fs.mkdir(nextVersionPath, { recursive: true });
  const reinstalled = game(gameId);
  reinstalled.versions.push({
    version: nextVersion,
    libraryId: "builtin",
    relativePath: `${gameId}/${nextVersion}`,
    addedAt: 2,
    installSource: "manual",
    marketId: null,
    stats: {},
    unlockedAchievements: [],
    playtime: 0,
  });
  reinstalled.latestVersion = nextVersion;
  await storeService.addGame(reinstalled);

  const restored = storeService.getGames().find((item) => item.id === gameId);
  assert(restored, "reinstalled game should be restored immediately");
  assert.equal(restored.isFavorite, true);
  const restoredVersion = restored.versions.find(
    (item) => item.version === version,
  );
  assert(restoredVersion, "reinstalled version should be present");
  assert.deepEqual(restoredVersion.unlockedAchievements, [
    { id: "shared-achievement", unlockedAt: originalUnlockedAt },
  ]);
  assert.equal(restoredVersion.stats.score, 5);
  assert.equal(restoredVersion.playtime, 10);
  assert.equal(restored.lastPlayedAt, 20);

  const isolatedVersion = restored.versions.find(
    (item) => item.version === nextVersion,
  );
  assert(isolatedVersion, "new version should be present");
  assert.deepEqual(isolatedVersion.unlockedAchievements, []);
  assert.deepEqual(isolatedVersion.stats, {});
  assert.equal(isolatedVersion.playtime, 0);
  assert.equal(
    await storeService.unlockAchievement(gameId, version, "shared-achievement"),
    false,
    "restored achievements must remain idempotent",
  );
  assert.equal(restoredVersion.unlockedAchievements.length, 1);
  assert.equal(await count(bzGamesDatabase, "achievement_unlocks"), 1);
}

async function verifyExternalLibraryLifecycle(): Promise<void> {
  const libraryRoot = path.join(process.cwd(), "external-library");
  await fs.mkdir(libraryRoot, { recursive: true });
  await storeService.addGameStoragePath(libraryRoot);
  const library = (await bzGamesDatabase.getGameLibraries()).find(
    (item) => item.root_path === libraryRoot,
  );
  assert(library, "external library should be active after registration");

  const gameId = "external-history";
  const version = "1.0.0";
  const versionPath = path.join(libraryRoot, gameId, version);
  await fs.mkdir(versionPath, { recursive: true });
  await fs.writeFile(path.join(versionPath, "payload.bin"), "payload");
  const installed = game(gameId);
  installed.versions[0].libraryId = library.id;
  installed.versions[0].relativePath = `${gameId}/${version}`;
  await storeService.addGame(installed);
  await bzGamesDatabase.recordAchievement({
    gameId,
    gameName: "External History",
    version,
    achievementId: "kept",
    achievementName: "Kept",
    unlockedAt: 1,
  });

  const result = await storeService.removeGameStoragePath(libraryRoot);
  assert.deepEqual(
    {
      removedGames: result.removedGames,
      removedVersions: result.removedVersions,
    },
    { removedGames: 1, removedVersions: 1 },
  );
  await assert.rejects(fs.stat(versionPath));
  assert.equal(
    (await bzGamesDatabase.getGameLibraries()).some(
      (item) => item.id === library.id,
    ),
    false,
  );
  const removedLibrary = await bzGamesDatabase.get<{
    lifecycle_state: string;
    removed_at: number | null;
  }>("SELECT lifecycle_state, removed_at FROM game_libraries WHERE id = ?", [
    library.id,
  ]);
  assert.equal(removedLibrary?.lifecycle_state, "removed");
  assert.equal(typeof removedLibrary?.removed_at, "number");
  assert.equal(
    await count(bzGamesDatabase, "achievement_unlocks"),
    2,
    "removing a library must preserve achievement history",
  );

  await storeService.addGameStoragePath(libraryRoot);
  const reactivated = (await bzGamesDatabase.getGameLibraries()).find(
    (item) => item.root_path === libraryRoot,
  );
  assert.equal(reactivated?.id, library.id);

  await storeService.setDefaultGameStoragePath(libraryRoot);
  await bzGamesDatabase.close();
  await bzGamesDatabase.initialize();
  const librariesAfterRestart = await bzGamesDatabase.getGameLibraries();
  assert.equal(
    librariesAfterRestart.find((item) => item.id === library.id)?.is_default,
    1,
    "an active external library must remain a valid default after restart",
  );
  assert.equal(
    librariesAfterRestart.find((item) => item.id === "builtin")?.is_default,
    0,
  );
  await storeService.setDefaultGameStoragePath(
    path.join(process.cwd(), "games"),
  );
  const librariesAfterSwitchBack = await bzGamesDatabase.getGameLibraries();
  assert.equal(
    librariesAfterSwitchBack.find((item) => item.id === "builtin")?.is_default,
    1,
    "switching back to the built-in library must not violate the unique default index",
  );
  assert.equal(
    librariesAfterSwitchBack.find((item) => item.id === library.id)?.is_default,
    0,
  );
}

function localDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function verifyManualUnlockProgressData(): Promise<void> {
  const originalUserData = structuredClone(storeService.getUserData());
  const replaceUserData = (userData: typeof originalUserData) =>
    (
      storeService as unknown as {
        getStore(): { set(key: "userData", value: typeof userData): void };
      }
    )
      .getStore()
      .set("userData", userData);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayString = localDateString(yesterday);

  replaceUserData({
    ...originalUserData,
    checkIn: {
      ...originalUserData.checkIn,
      lastCheckInDate: yesterdayString,
      consecutiveDays: 4,
      maxConsecutiveDays: 6,
      totalDays: 10,
    },
  });
  const continued = await storeService.performCheckIn();
  assert.equal(continued.success, true);
  assert.equal(storeService.getUserData().checkIn.consecutiveDays, 5);
  assert.equal(storeService.getUserData().checkIn.maxConsecutiveDays, 6);

  replaceUserData({
    ...storeService.getUserData(),
    checkIn: {
      ...storeService.getUserData().checkIn,
      lastCheckInDate: "2000-01-01",
      consecutiveDays: 5,
      maxConsecutiveDays: 6,
    },
  });
  const afterMissedDay = await storeService.performCheckIn();
  assert.equal(afterMissedDay.success, true);
  assert.equal(storeService.getUserData().checkIn.consecutiveDays, 1);
  assert.equal(storeService.getUserData().checkIn.maxConsecutiveDays, 6);

  const targetStart = new Date(2027, 1, 6, 0, 0, 0, 0).getTime();
  const targetEnd = new Date(2027, 1, 7, 0, 0, 0, 0).getTime();
  const beforeMidnight = targetStart - 30 * 60 * 1000;
  const afterMidnight = targetEnd + 40 * 60 * 1000;
  const activeNow = new Date(2027, 1, 6, 12, 30, 0, 0).getTime();

  await bzGamesDatabase.run(
    `INSERT INTO play_sessions
      (id, game_id, game_name, version, start_time, end_time, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "date-playtime-before-midnight",
      "date-playtime",
      "date-playtime",
      "1.0.0",
      beforeMidnight,
      targetStart + 20 * 60 * 1000,
      50 * 60 * 1000,
    ],
  );
  await bzGamesDatabase.run(
    `INSERT INTO play_sessions
      (id, game_id, game_name, version, start_time, end_time, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "date-playtime-after-midnight",
      "date-playtime",
      "date-playtime",
      "1.0.0",
      targetEnd - 10 * 60 * 1000,
      afterMidnight,
      50 * 60 * 1000,
    ],
  );
  await bzGamesDatabase.run(
    `INSERT INTO play_sessions
      (id, game_id, game_name, version, start_time, end_time, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "date-playtime-active",
      "date-playtime",
      "date-playtime",
      "1.0.0",
      new Date(2027, 1, 6, 12, 0, 0, 0).getTime(),
      null,
      null,
    ],
  );

  try {
    const duration = await playSessionDatabaseService.getPlayDurationForDate(
      "2027-02-06",
      activeNow,
    );
    assert.equal(duration, 60 * 60 * 1000);
  } finally {
    await bzGamesDatabase.run(
      "DELETE FROM play_sessions WHERE id LIKE 'date-playtime-%'",
    );
    replaceUserData(originalUserData);
  }
}

async function main(): Promise<void> {
  try {
    assert.equal(
      resolveGameHostingPortalUrl(),
      "https://relay.example.com/admin/game-hosting",
    );
    assert.equal(
      resolveGameHostingPortalUrl("ws://127.0.0.1:38090/"),
      "http://127.0.0.1:38090/admin/game-hosting",
    );
    assert.throws(() => resolveGameHostingPortalUrl(""));
    const hostedUrl =
      "games.bzgames.top/com.example.game/1.2.3/package/%E6%B8%B8%E6%88%8F%E5%8C%85.zip";
    assert.equal(isValidDownloadUrl(hostedUrl), true);
    assert.equal(isValidDownloadUrl(`https://${hostedUrl}`), true);
    assert.equal(isValidDownloadUrl("games.bzgames.top.evil/file.zip"), false);
    assert.equal(
      isValidDownloadUrl(
        "games.bzgames.top/com.example.game/1.2.3/package/..%2Fgame.zip",
      ),
      false,
    );
    const resolvedHostedUrl = resolveMarketDownloadUrl(hostedUrl);
    assert.equal(
      resolvedHostedUrl,
      "https://relay.example.com/api/v1/game-hosting/assets/com.example.game/1.2.3/package/%E6%B8%B8%E6%88%8F%E5%8C%85.zip",
    );
    const hostedIcon =
      "games.bzgames.top/com.example.game/1.2.3/icon/%E5%9B%BE%E6%A0%87.png";
    assert.equal(isValidMarketImageUrl(hostedIcon, "icon"), true);
    assert.equal(isValidMarketImageUrl(hostedIcon, "cover"), false);
    assert.equal(
      resolveMarketImageUrl(hostedIcon),
      "https://relay.example.com/api/v1/game-hosting/assets/com.example.game/1.2.3/icon/%E5%9B%BE%E6%A0%87.png",
    );
    assert.throws(() => resolveMarketDownloadUrl(hostedIcon));
    assert.equal(
      isValidDownloadUrl(
        "games.bzgames.top/123e4567-e89b-42d3-a456-426614174000/Game%20One.zip",
      ),
      false,
    );
    assert.equal(
      resolveMarketDownloadUrl("https://cdn.example.com/game.zip"),
      "https://cdn.example.com/game.zip",
    );
    assert.equal(
      new RequestInterceptor(() => null).buildHeaders(resolvedHostedUrl)[
        "x-relay-token"
      ],
      "hosted-game-test-token",
    );

    const legacyDirect = new Database("legacy.db");
    legacyDirect.pragma("cipher='chacha20'");
    legacyDirect.key(
      crypto.createHash("sha256").update("database-service-test").digest(),
    );
    legacyDirect.exec(`
      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_present INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE game_versions (
        game_id TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        is_present INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (game_id, version)
      );
      INSERT INTO games (id, added_at) VALUES ('legacy-game', 1);
      INSERT INTO game_versions (game_id, version, path, added_at)
        VALUES ('legacy-game', '1.0.0', 'C:/legacy-game', 1);
    `);
    legacyDirect.close();

    const rejectedLegacy = new BzGamesDatabase(
      "legacy.db",
      "database-service-test",
    );
    await assert.rejects(
      rejectedLegacy.initialize(),
      /SQLITE_ERROR|SQL logic error|database_(application_id|user_version|schema)/,
    );
    await rejectedLegacy.close();

    await source.initialize();

    const mismatchedPathGame = game("path-identity");
    mismatchedPathGame.versions[0].relativePath = "other-game/1.0.0";
    await assert.rejects(
      source.saveGames([mismatchedPathGame]),
      /game_version_relative_path_invalid/,
    );

    await source.saveGames([game("remote", true)]);
    await seedBusinessRecords(source, "remote");

    await source.suspendForSnapshot();
    let queuedReadSettled = false;
    const queuedRead = source.getGames().then((games) => {
      queuedReadSettled = true;
      return games;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      queuedReadSettled,
      false,
      "database work must wait while a consistent snapshot is copied",
    );
    await fs.copyFile("source.db", "database-snapshot.db");
    source.resumeAfterSnapshot();
    assert.equal((await queuedRead).length, 1);
    const snapshot = new BzGamesDatabase(
      "database-snapshot.db",
      "database-service-test",
    );
    try {
      await snapshot.initialize();
      assert.equal((await snapshot.getGames()).length, 1);
      assert.deepEqual(await snapshot.checkIntegrity(), []);
    } finally {
      await snapshot.close();
    }

    await source.softDelete("remote");
    assert.deepEqual(await source.getGames(), []);
    await source.saveGames([game("remote")]);
    const restored = await source.getGames();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].isFavorite, true);
    assert.equal(restored[0].versions[0].unlockedAchievements.length, 1);

    const marketGame = game("market-game");
    marketGame.versions[0].installSource = "market";
    marketGame.versions[0].marketId = "official";
    await source.saveGames([marketGame]);
    const persistedMarketVersion = (await source.getGames())[0].versions[0];
    assert.equal(persistedMarketVersion.installSource, "market");
    assert.equal(persistedMarketVersion.marketId, "official");

    await verifyReinstallRestoresDerivedData();
    await verifyExternalLibraryLifecycle();
    await verifyManualUnlockProgressData();

    for (const table of [
      "games",
      "play_sessions",
      "achievement_unlocks",
      "stats_reports",
    ]) {
      assert.deepEqual(
        await source.all(`PRAGMA foreign_key_list("${table}")`),
        [],
      );
    }
    assert.equal(
      (await source.all(`PRAGMA foreign_key_list("game_versions")`)).length,
      2,
    );

    for (const wrongKey of [null, "wrong-database-key"]) {
      let rejected = false;
      let directDatabase: Database.Database | undefined;
      try {
        directDatabase = new Database("source.db", { readonly: true });
        if (wrongKey) {
          directDatabase.pragma("cipher='chacha20'");
          directDatabase.key(
            crypto.createHash("sha256").update(wrongKey).digest(),
          );
        }
        directDatabase.prepare("SELECT * FROM games").get();
      } catch {
        rejected = true;
      } finally {
        directDatabase?.close();
      }
      assert.equal(rejected, true);
    }

    assert.deepEqual(await source.checkIntegrity(), []);
    console.log("database repository and game library tests passed");
  } finally {
    await source.close();
    await bzGamesDatabase.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
