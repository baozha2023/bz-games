import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRollbackPoint,
  getRollbackRoot,
  preserveRollbackPackage,
} from "./UpdateRollbackService";

describe("UpdateRollbackService", () => {
  let dataRoot = "";

  const readRollbackState = async () =>
    JSON.parse(
      await fs.readFile(
        path.join(getRollbackRoot(dataRoot), "rollback-state.json"),
        "utf8",
      ),
    ) as {
      sourceVersion: string;
      targetVersion: string;
      packageFile: string;
      packageSha256: string;
    };

  beforeEach(async () => {
    dataRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "bz-games-update-rollback-"),
    );
    await fs.mkdir(path.join(dataRoot, ".runtime", "packages"), {
      recursive: true,
    });
    await fs.mkdir(path.join(dataRoot, "db"), { recursive: true });
    await fs.mkdir(path.join(dataRoot, "games"), { recursive: true });
    await fs.writeFile(
      path.join(dataRoot, "config.json"),
      "config-before-update",
    );
    await fs.writeFile(
      path.join(dataRoot, "db", "bz_games.db"),
      "database-before-update",
    );
    await fs.writeFile(path.join(dataRoot, "games", "game.bin"), "game-data");
    await fs.writeFile(
      path.join(
        dataRoot,
        ".runtime",
        "packages",
        "com.bzgames.desktop-4.0.0-stable-full.nupkg",
      ),
      "full-package",
    );
  });

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  it("creates a validated rollback point without copying game files", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });

    await expect(readRollbackState()).resolves.toMatchObject({
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await expect(
      fs.lstat(path.join(getRollbackRoot(dataRoot), "games")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the current full package before Velopack cleans the package cache", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await fs.rm(path.join(dataRoot, ".runtime", "packages"), {
      recursive: true,
      force: true,
    });
    await fs.writeFile(path.join(dataRoot, "config.json"), "latest-config");
    await fs.writeFile(
      path.join(dataRoot, "db", "bz_games.db"),
      "latest-database",
    );

    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });

    const rollbackRoot = getRollbackRoot(dataRoot);
    await expect(
      fs.readFile(path.join(rollbackRoot, "config.json"), "utf8"),
    ).resolves.toBe("latest-config");
    await expect(
      fs.readFile(path.join(rollbackRoot, "db", "bz_games.db"), "utf8"),
    ).resolves.toBe("latest-database");
    await expect(readRollbackState()).resolves.toMatchObject({
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
  });

  it("does not replace the previous rollback point while only downloading a newer update", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await fs.writeFile(
      path.join(
        dataRoot,
        ".runtime",
        "packages",
        "com.bzgames.desktop-4.0.1-stable-full.nupkg",
      ),
      "new-current-full-package",
    );

    const previousState = await readRollbackState();
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.1",
      targetVersion: "4.0.2",
    });

    await expect(readRollbackState()).resolves.toEqual(previousState);
  });

  it("requires the preserved package even when a matching rollback point exists", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });

    await expect(
      createRollbackPoint({
        dataRoot,
        sourceVersion: "4.0.0",
        targetVersion: "4.0.1",
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a preserved package that was modified after download", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    const packageRoot = path.join(dataRoot, ".runtime", "rollback-package");
    const state = JSON.parse(
      await fs.readFile(path.join(packageRoot, "package-state.json"), "utf8"),
    ) as { packageFile: string };
    await fs.appendFile(path.join(packageRoot, state.packageFile), "tampered");

    await expect(
      createRollbackPoint({
        dataRoot,
        sourceVersion: "4.0.0",
        targetVersion: "4.0.1",
      }),
    ).rejects.toThrow("rollback_package_invalid");
  });

  it("keeps the previous valid point when preparing the next one fails", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.2",
    });
    await fs.rm(path.join(dataRoot, "db"), { recursive: true, force: true });

    await expect(
      createRollbackPoint({
        dataRoot,
        sourceVersion: "4.0.0",
        targetVersion: "4.0.2",
      }),
    ).rejects.toBeTruthy();
    await expect(readRollbackState()).resolves.toMatchObject({
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
  });

  it("recovers an interrupted directory replacement before refreshing the point", async () => {
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await fs.rename(
      getRollbackRoot(dataRoot),
      `${getRollbackRoot(dataRoot)}.previous-interrupted`,
    );
    await preserveRollbackPackage({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });

    await createRollbackPoint({
      dataRoot,
      sourceVersion: "4.0.0",
      targetVersion: "4.0.1",
    });
    await expect(fs.lstat(getRollbackRoot(dataRoot))).resolves.toBeTruthy();
  });
});
