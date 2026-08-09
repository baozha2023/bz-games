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
const destination = new BzGamesDatabase(
  "destination.db",
  "database-service-test",
);

function game(id: string, favorite?: boolean): GameRecord {
  return {
    id,
    versions: [
      {
        version: "1.0.0",
        path: `C:/${id}`,
        addedAt: 1,
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
  installed.versions[0].path = versionPath;
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
  reinstalled.versions[0].path = versionPath;
  reinstalled.versions.push({
    version: nextVersion,
    path: nextVersionPath,
    addedAt: 2,
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

async function main(): Promise<void> {
  try {
    assert.equal(resolveGameHostingPortalUrl(), "https://relay.example.com/admin/game-hosting");
    assert.equal(resolveGameHostingPortalUrl("ws://127.0.0.1:38090/"), "http://127.0.0.1:38090/admin/game-hosting");
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

    await source.initialize();
    await destination.initialize();

    await source.saveGames([game("remote", true)]);
    await seedBusinessRecords(source, "remote");

    await source.softDelete("remote");
    assert.deepEqual(await source.getGames(), []);
    await source.saveGames([game("remote")]);
    const restored = await source.getGames();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].isFavorite, true);
    assert.equal(restored[0].versions[0].unlockedAchievements.length, 1);

    await verifyReinstallRestoresDerivedData();

    for (const table of [
      "games",
      "game_versions",
      "play_sessions",
      "achievement_unlocks",
      "stats_reports",
    ]) {
      assert.deepEqual(
        await source.all(`PRAGMA foreign_key_list("${table}")`),
        [],
      );
    }

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

    await destination.saveGames([game("local", false)]);
    await seedBusinessRecords(destination, "local");
    await destination.recordStats([
      {
        gameId: "local",
        gameName: "local",
        version: "1.0.0",
        statId: "score",
        statName: "score",
        value: 200,
        mode: "full",
        reportedAt: 200,
      },
    ]);
    await source.recordStats([
      {
        gameId: "local",
        gameName: "local",
        version: "1.0.0",
        statId: "score",
        statName: "score",
        value: 100,
        mode: "full",
        reportedAt: 100,
      },
    ]);

    const dump = await source.exportCloudSqlDump();
    assert.match(dump, /INSERT OR IGNORE INTO "play_sessions"/);
    assert.doesNotMatch(dump, /DELETE\s+FROM/i);
    assert.doesNotMatch(dump, /event_sequence/);
    assert.doesNotMatch(dump, /INSERT OR IGNORE INTO "games"/);
    assert.doesNotMatch(dump, /INSERT OR IGNORE INTO "game_versions"/);

    await destination.importCloudSqlDump(dump);
    await destination.importCloudSqlDump(dump);

    for (const table of [
      "play_sessions",
      "achievement_unlocks",
      "stats_reports",
    ]) {
      assert.equal(
        await count(destination, table),
        table === "stats_reports" ? 4 : 2,
        `${table} should merge exactly once`,
      );
    }
    const destinationGames = await destination.getGames();
    assert.deepEqual(
      destinationGames.map((item) => item.id),
      ["local"],
      "cloud import must not modify device-local game entities",
    );
    assert.equal(
      destinationGames[0].versions[0].stats.score,
      200,
      "full statistics must be rebuilt by report time on a replacement device",
    );
    assert.deepEqual(await source.checkIntegrity(), []);
    assert.deepEqual(await destination.checkIntegrity(), []);
    console.log("database repository and cloud merge tests passed");
  } finally {
    await source.close();
    await destination.close();
    await bzGamesDatabase.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
