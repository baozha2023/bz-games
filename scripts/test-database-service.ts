import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3-multiple-ciphers";
import { BzGamesDatabase } from "../src/main/services/storage/database/BzGamesDatabase";
import type { GameRecord } from "../src/shared/types";

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

async function main(): Promise<void> {
  try {
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
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
