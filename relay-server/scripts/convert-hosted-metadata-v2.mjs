import mysql from "mysql2/promise";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const LOCALES = ["zh-CN", "zh-TW", "en-US", "ja-JP", "de-DE"];
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function parseJsonValue(value) {
  if (value && typeof value === "object") return value;
  return JSON.parse(String(value));
}

function copyWithout(value, keys) {
  const result = { ...object(value) };
  for (const key of keys) delete result[key];
  return result;
}

function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : "zh-CN";
}

function convertGame(raw) {
  const value = object(raw);
  if (value.defaultLocale && value.localizations) {
    const defaultLocale = normalizeLocale(value.defaultLocale);
    const localizations = {};
    for (const [locale, bundle] of Object.entries(
      object(value.localizations),
    )) {
      if (!LOCALES.includes(locale)) continue;
      const item = object(bundle);
      localizations[locale] = {
        name: String(item.name || value.name || value.id || "未命名游戏"),
        summary: String(item.summary || value.summary || ""),
        tags: Array.isArray(item.tags)
          ? item.tags.map(String)
          : Array.isArray(value.tags)
            ? value.tags.map(String)
            : [],
      };
    }
    if (!localizations[defaultLocale]) {
      localizations[defaultLocale] = {
        name: String(value.name || value.id || "未命名游戏"),
        summary: String(value.summary || ""),
        tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
      };
    }
    return {
      ...copyWithout(value, ["name", "summary", "tags"]),
      defaultLocale,
      localizations,
    };
  }
  const defaultLocale = "zh-CN";
  return {
    ...copyWithout(value, ["name", "summary", "tags"]),
    defaultLocale,
    localizations: {
      [defaultLocale]: {
        name: String(value.name || value.id || "未命名游戏"),
        summary: String(value.summary || ""),
        tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
      },
    },
  };
}

function manifestItemId(value) {
  const id = String(value || "").trim();
  if (!id || RESERVED.has(id.toLowerCase())) return null;
  return id;
}

function convertManifest(raw, game, version) {
  if (!raw) return undefined;
  const value = object(raw);
  const gameDefault = object(game.localizations)[game.defaultLocale] || {};
  const versionDefault =
    object(version.localizations)[game.defaultLocale] || {};
  const defaultLocale = game.defaultLocale;
  const oldStats = Array.isArray(value.statistics) ? value.statistics : [];
  const statistics = [];
  const statisticLabels = {};
  for (const entry of oldStats) {
    let id = "";
    let label = "";
    let mode = "increment";
    if (typeof entry === "string") id = entry;
    else {
      const record = object(entry);
      const pair = Object.entries(record)[0];
      if (pair) {
        id = pair[0];
        if (typeof pair[1] === "string") label = pair[1];
        else {
          const details = object(pair[1]);
          label = typeof details.label === "string" ? details.label : "";
          mode = details.mode === "full" ? "full" : "increment";
        }
      }
    }
    id = manifestItemId(id);
    if (!id || statistics.some((item) => item.id === id)) continue;
    statistics.push({ id, mode });
    statisticLabels[id] = label || id;
  }
  if (
    Array.isArray(value.statistics) &&
    value.statistics.every((entry) => object(entry).id)
  ) {
    statistics.length = 0;
    for (const entry of value.statistics) {
      const id = manifestItemId(entry.id);
      if (!id || statistics.some((item) => item.id === id)) continue;
      statistics.push({
        id,
        mode: entry.mode === "full" ? "full" : "increment",
      });
      statisticLabels[id] = id;
    }
  }
  const achievements = [];
  const achievementText = {};
  for (const entry of Array.isArray(value.achievements)
    ? value.achievements
    : []) {
    const item = object(entry);
    const id = manifestItemId(item.id);
    if (!id || achievements.some((candidate) => candidate.id === id)) continue;
    achievements.push({
      id,
      ...(item.icon ? { icon: String(item.icon) } : {}),
    });
    achievementText[id] = {
      title: String(item.title || id),
      description: String(item.description || ""),
    };
  }
  const existing = object(value.localizations);
  const locales = Object.keys(object(game.localizations)).filter((locale) =>
    LOCALES.includes(locale),
  );
  if (!locales.includes(game.defaultLocale)) locales.push(game.defaultLocale);
  const localizations = {};
  for (const locale of locales) {
    const source = object(existing[locale]);
    const gameBundle = object(game.localizations)[locale] || gameDefault;
    const versionBundle =
      object(version.localizations)[locale] || versionDefault;
    const sourceAchievements = object(source.achievements);
    const sourceStatistics = object(source.statistics);
    const localizedAchievements = {};
    for (const item of achievements) {
      const text = object(sourceAchievements[item.id]);
      localizedAchievements[item.id] = {
        title: String(text.title || achievementText[item.id]?.title || item.id),
        description: String(
          text.description || achievementText[item.id]?.description || "",
        ),
      };
    }
    const localizedStatistics = {};
    for (const item of statistics)
      localizedStatistics[item.id] = String(
        sourceStatistics[item.id] || statisticLabels[item.id] || item.id,
      );
    localizations[locale] = {
      name: String(
        source.name || gameBundle.name || gameDefault.name || game.id,
      ),
      description: String(
        source.description ||
          versionBundle.description ||
          gameBundle.summary ||
          "",
      ),
      achievements: localizedAchievements,
      statistics: localizedStatistics,
    };
  }
  const result = copyWithout(value, [
    "name",
    "description",
    "statistics",
    "achievements",
    "localizations",
  ]);
  return {
    ...result,
    manifestVersion: 2,
    defaultLocale,
    localizations,
    statistics,
    achievements,
  };
}

function convertVersion(raw, game) {
  const value = object(raw);
  const existing = object(value.localizations);
  const defaultSource = object(existing[game.defaultLocale]);
  const localizations = {};
  for (const locale of Object.keys(object(game.localizations))) {
    if (!LOCALES.includes(locale)) continue;
    const item = object(existing[locale]);
    const gameBundle =
      object(game.localizations)[locale] ||
      object(game.localizations)[game.defaultLocale];
    const description = String(
      item.description ||
        defaultSource.description ||
        value.description ||
        gameBundle.summary ||
        `Version ${value.version || "unknown"}`,
    );
    const releaseNotes =
      item.releaseNotes ?? defaultSource.releaseNotes ?? value.releaseNotes;
    localizations[locale] = {
      description,
      ...(releaseNotes !== undefined && String(releaseNotes).trim()
        ? { releaseNotes: String(releaseNotes) }
        : {}),
    };
  }
  const result = copyWithout(value, [
    "description",
    "releaseNotes",
    "gameManifest",
  ]);
  const converted = { ...result, localizations };
  if (value.gameManifest !== undefined)
    converted.gameManifest = convertManifest(
      value.gameManifest,
      game,
      converted,
    );
  return converted;
}

const apply = process.argv.includes("--apply");
if (process.argv.includes("--service-env")) {
  const pid = execFileSync(
    "systemctl",
    ["show", "-p", "MainPID", "--value", "bz-games-relay"],
    { encoding: "utf8" },
  ).trim();
  if (!/^\d+$/.test(pid) || pid === "0")
    throw new Error("relay_service_not_running");
  const serviceEnv = fs
    .readFileSync(`/proc/${pid}/environ`, "utf8")
    .split("\0");
  for (const entry of serviceEnv) {
    const separator = entry.indexOf("=");
    if (separator > 0)
      process.env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
}
const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];
for (const key of required)
  if (!process.env[key]) throw new Error(`${key}_required`);
const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE,
  connectionLimit: 2,
});
const connection = await pool.getConnection();
try {
  const [games] = await connection.query(
    "SELECT game_id, published_metadata_json FROM hosted_games",
  );
  const [revisions] = await connection.query(
    "SELECT id, game_id, metadata_json FROM hosted_game_metadata_revisions",
  );
  const [versions] = await connection.query(
    "SELECT id, game_id, metadata_json FROM hosted_game_versions",
  );
  const gameMap = new Map();
  const gameUpdates = [];
  const revisionUpdates = [];
  for (const row of games) {
    if (!row.published_metadata_json) continue;
    const converted = convertGame(parseJsonValue(row.published_metadata_json));
    gameMap.set(row.game_id, converted);
    gameUpdates.push([JSON.stringify(converted), row.game_id]);
  }
  for (const row of revisions) {
    const converted = convertGame(parseJsonValue(row.metadata_json));
    if (!gameMap.has(row.game_id)) gameMap.set(row.game_id, converted);
    revisionUpdates.push([JSON.stringify(converted), row.id]);
  }
  const versionUpdates = [];
  for (const row of versions) {
    const game = gameMap.get(row.game_id);
    if (!game) throw new Error(`missing_game_metadata:${row.game_id}`);
    const converted = convertVersion(parseJsonValue(row.metadata_json), game);
    versionUpdates.push([JSON.stringify(converted), row.id]);
  }
  if (apply) {
    await connection.beginTransaction();
    for (const [json, id] of gameUpdates)
      await connection.query(
        "UPDATE hosted_games SET published_metadata_json = ? WHERE game_id = ?",
        [json, id],
      );
    for (const [json, id] of revisionUpdates)
      await connection.query(
        "UPDATE hosted_game_metadata_revisions SET metadata_json = ? WHERE id = ?",
        [json, id],
      );
    for (const [json, id] of versionUpdates)
      await connection.query(
        "UPDATE hosted_game_versions SET metadata_json = ? WHERE id = ?",
        [json, id],
      );
    await connection.commit();
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      games: gameUpdates.length,
      revisions: revisions.length,
      versions: versionUpdates.length,
    }),
  );
} catch (error) {
  try {
    await connection.rollback();
  } catch {}
  throw error;
} finally {
  connection.release();
  await pool.end();
}
