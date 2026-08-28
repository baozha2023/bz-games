import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  userData: "",
  storage: "",
  prepareGameImport: vi.fn(),
  loadGameFromPath: vi.fn(),
  loadGameFromPathWithManifest: vi.fn(),
  cleanupInterruptedImportTarget: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
}));
vi.mock("../storage/StoreService", () => ({
  storeService: {
    getGameStoragePath: () => mocks.storage,
    getDefaultGameStoragePath: () => mocks.storage,
    getGameStorageRoots: () => [mocks.storage],
    getSettings: () => ({ language: "zh-CN" }),
  },
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./GameLoader", () => ({
  GameLoader: {
    prepareGameImport: mocks.prepareGameImport,
    loadGameFromPath: mocks.loadGameFromPath,
    loadGameFromPathWithManifest: mocks.loadGameFromPathWithManifest,
    cleanupInterruptedImportTarget: mocks.cleanupInterruptedImportTarget,
  },
}));

import { GameType } from "../../../shared/types";
import { GameImportTaskService } from "./GameImportTaskService";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bz-import-service-test-"));
  mocks.userData = path.join(root, "user-data");
  mocks.storage = path.join(root, "games");
  mocks.prepareGameImport.mockReset();
  mocks.loadGameFromPath.mockReset();
  mocks.loadGameFromPathWithManifest.mockReset();
  mocks.cleanupInterruptedImportTarget.mockReset();
  mocks.prepareGameImport.mockImplementation(async (sourcePath: string) => ({
    sourcePath,
    existingGame: false,
    manifest: {
      id: `local.game.${path.basename(sourcePath)}`,
      name: path.basename(sourcePath),
      version: "1.0.0",
      author: "test",
      platformVersion: ">=1.0.0",
      entry: "index.html",
      type: GameType.Singleplayer,
    },
  }));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("GameImportTaskService", () => {
  it("keeps two new game imports as independent placeholder tasks", async () => {
    const releases: Array<() => void> = [];
    mocks.loadGameFromPath.mockImplementation(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return { success: true, manifest: {} };
    });
    const service = new GameImportTaskService();
    const events: Array<{ taskId: string; gameId: string }> = [];
    service.onEvent(({ task }) => {
      events.push({ taskId: task.taskId, gameId: task.gameId });
    });

    const first = await service.startImport(path.join(root, "first-game"));
    const second = await service.startImport(path.join(root, "second-game"));

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.task?.taskId).not.toBe(second.task?.taskId);
    expect(service.getTasks()).toMatchObject([
      { gameId: "local.game.first-game", existingGame: false },
      { gameId: "local.game.second-game", existingGame: false },
    ]);
    expect(new Set(events.map((event) => event.taskId))).toEqual(
      new Set([first.task?.taskId, second.task?.taskId]),
    );

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    for (const release of releases) release();
    await vi.waitFor(() =>
      expect(
        service.getTasks().every((task) => task.status === "completed"),
      ).toBe(true),
    );
  });

  it("runs no more than two imports concurrently and starts the queued task", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    mocks.loadGameFromPath.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { success: true, manifest: {} };
    });
    const service = new GameImportTaskService();

    await service.startImport(path.join(root, "one"));
    await service.startImport(path.join(root, "two"));
    await service.startImport(path.join(root, "three"));
    await vi.waitFor(() =>
      expect(mocks.loadGameFromPath).toHaveBeenCalledTimes(2),
    );
    expect(
      service.getTasks().filter((task) => task.status === "queued"),
    ).toHaveLength(1);

    releases.shift()?.();
    await vi.waitFor(() =>
      expect(mocks.loadGameFromPath).toHaveBeenCalledTimes(3),
    );
    expect(maximumActive).toBe(2);
    for (const release of releases) release();
    await vi.waitFor(() =>
      expect(
        service.getTasks().every((task) => task.status === "completed"),
      ).toBe(true),
    );
  });

  it("rejects a duplicate active game version", async () => {
    let release: (() => void) | undefined;
    mocks.loadGameFromPath.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { success: false, error: "canceled" };
    });
    const service = new GameImportTaskService();
    const source = path.join(root, "same");

    expect((await service.startImport(source)).success).toBe(true);
    const duplicate = await service.startImport(source);

    expect(duplicate).toMatchObject({ success: false, error: "versionExists" });
    const task = service.getTasks()[0];
    await service.cancelImport(task.taskId);
    release?.();
  });

  it("removes a queued task staging directory immediately when canceled", async () => {
    const releases: Array<() => void> = [];
    mocks.loadGameFromPath.mockImplementation(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return { success: true, manifest: {} };
    });
    const service = new GameImportTaskService();
    await service.startImport(path.join(root, "running-one"));
    await service.startImport(path.join(root, "running-two"));
    const queued = await service.startImport(path.join(root, "queued"));
    const stagingPath = path.join(
      mocks.storage,
      ".imports",
      queued.task!.taskId,
    );
    await fs.mkdir(stagingPath, { recursive: true });

    expect(await service.cancelImport(queued.task!.taskId)).toBe(true);
    await expect(fs.stat(stagingPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    for (const release of releases) release();
    await vi.waitFor(() =>
      expect(
        service
          .getTasks()
          .filter((task) => task.status !== "canceled")
          .every((task) => task.status === "completed"),
      ).toBe(true),
    );
  });

  it("cleans an atomically moved target when a finalizing task was interrupted", async () => {
    const taskId = "interrupted-finalize";
    const stagingPath = path.join(mocks.storage, ".imports", taskId);
    await fs.mkdir(mocks.userData, { recursive: true });
    await fs.writeFile(
      path.join(mocks.userData, "pending-import-tasks.json"),
      JSON.stringify([
        {
          state: {
            taskId,
            sourcePath: path.join(root, "source"),
            gameId: "local.game.interrupted",
            gameName: "Interrupted",
            version: "1.0.0",
            existingGame: false,
            source: "manual",
            status: "finalizing",
            progress: 95,
            createdAt: 1,
            updatedAt: 1,
          },
          stagingPath,
        },
      ]),
    );
    const service = new GameImportTaskService();

    await service.restoreTasks();

    expect(mocks.cleanupInterruptedImportTarget).toHaveBeenCalledWith(
      mocks.storage,
      "local.game.interrupted",
      "1.0.0",
      taskId,
    );
    expect(service.getTasks()[0]).toMatchObject({
      status: "interrupted",
      error: "interrupted",
    });
  });

  it("persists finalizing before allowing the atomic move to continue", async () => {
    let persistedStatus = "";
    mocks.loadGameFromPath.mockImplementation(
      async (_sourcePath, _provenance, options) => {
        await options.onProgress({
          phase: "finalizing",
          processedBytes: 1,
          totalBytes: 1,
          processedFiles: 1,
          totalFiles: 1,
        });
        const snapshot = JSON.parse(
          await fs.readFile(
            path.join(mocks.userData, "pending-import-tasks.json"),
            "utf8",
          ),
        );
        persistedStatus = snapshot[0].state.status;
        return { success: true, manifest: {} };
      },
    );
    const service = new GameImportTaskService();

    await service.startImport(path.join(root, "finalizing-barrier"));
    await vi.waitFor(() => expect(persistedStatus).toBe("finalizing"));
    await vi.waitFor(() =>
      expect(service.getTasks()[0].status).toBe("completed"),
    );
  });
});
