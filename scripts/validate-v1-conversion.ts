import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { path7za } from "7zip-bin";
import Database from "better-sqlite3-multiple-ciphers";
import crypto from "crypto";
import { DATABASE_ENCRYPTION_SEED } from "../src/shared/AppConstants";
import {
  tryPrepareV1Import,
  V1_ARCHIVE_MANIFEST,
} from "../src/main/services/backup/v1/V1ImportAdapter";
import { validateV4DataRoot } from "../src/main/services/backup/V4DataValidator";
import { readGameManifestFile } from "../src/main/services/game/GameManifestFileService";

const execFileAsync = promisify(execFile);

async function main() {
  const [archivePath, outputRoot] = process.argv.slice(2);
  if (!archivePath || !outputRoot) {
    throw new Error(
      "usage: validate-v1-conversion <archive.bzgames> <output-root>",
    );
  }
  const resolvedArchive = path.resolve(archivePath);
  const resolvedOutput = path.resolve(outputRoot);
  if (await fs.stat(resolvedOutput).catch(() => null)) {
    throw new Error("output_root_must_not_exist");
  }
  const extracted = `${resolvedOutput}.extracted`;
  await fs.mkdir(extracted, { recursive: true });
  try {
    const quiet7za = { windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
    await execFileAsync(
      path7za,
      ["t", "-bso0", "-bsp0", "-bb0", resolvedArchive],
      quiet7za,
    );
    await execFileAsync(
      path7za,
      ["x", "-y", "-bso0", "-bsp0", "-bb0", `-o${extracted}`, resolvedArchive],
      quiet7za,
    );
    if (
      !(await fs
        .stat(path.join(extracted, V1_ARCHIVE_MANIFEST))
        .catch(() => null))
    ) {
      throw new Error("v1_manifest_missing");
    }
    const prepared = await tryPrepareV1Import(extracted, resolvedOutput, {
      totalFiles: 0,
      totalBytes: 0,
    });
    if (!prepared) throw new Error("not_a_v1_backup");
    await validateV4DataRoot(resolvedOutput);

    const db = new Database(path.join(resolvedOutput, "db", "bz_games.db"));
    db.pragma("cipher='chacha20'");
    db.key(
      crypto.createHash("sha256").update(DATABASE_ENCRYPTION_SEED).digest(),
    );
    const count = (sql: string) =>
      Number((db.prepare(sql).get() as { value: number }).value);
    const manifestPaths: string[] = [];
    const pending = [path.join(resolvedOutput, "games")];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile() && entry.name === "game.json") {
          manifestPaths.push(entryPath);
        }
      }
    }
    for (const manifestPath of manifestPaths)
      readGameManifestFile(manifestPath);
    const databaseEntries = await fs.readdir(path.join(resolvedOutput, "db"));
    const result = {
      outputRoot: resolvedOutput,
      games: count("SELECT COUNT(*) value FROM games"),
      versions: count("SELECT COUNT(*) value FROM game_versions"),
      installedVersions: count(
        "SELECT COUNT(*) value FROM game_versions WHERE lifecycle_state='installed'",
      ),
      removedVersions: count(
        "SELECT COUNT(*) value FROM game_versions WHERE lifecycle_state='removed'",
      ),
      activeLibraries: count(
        "SELECT COUNT(*) value FROM game_libraries WHERE lifecycle_state='active' AND removed_at IS NULL",
      ),
      removedLibraries: count(
        "SELECT COUNT(*) value FROM game_libraries WHERE lifecycle_state='removed' AND removed_at IS NOT NULL",
      ),
      playSessions: count("SELECT COUNT(*) value FROM play_sessions"),
      achievements: count("SELECT COUNT(*) value FROM achievement_unlocks"),
      statsEvents: count("SELECT COUNT(*) value FROM stats_reports"),
      absoluteVersionPaths: count(
        "SELECT COUNT(*) value FROM game_versions WHERE relative_path LIKE '%:%' OR relative_path LIKE '/%'",
      ),
      userVersion: db.pragma("user_version", { simple: true }),
      integrity: db.pragma("integrity_check", { simple: true }),
      encryptedBuiltinManifests: manifestPaths.length,
      databaseEntries,
      importsDirectoryPresent: Boolean(
        await fs
          .stat(path.join(resolvedOutput, "games", ".imports"))
          .catch(() => null),
      ),
    };
    db.close();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    await fs.rm(resolvedOutput, { recursive: true, force: true });
    throw error;
  } finally {
    await fs
      .rm(extracted, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      })
      .catch((error) => {
        process.stderr.write(
          `temporary extraction cleanup deferred: ${String(error)}\n`,
        );
      });
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
