import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  appRoot: "",
  userData: "",
  handlers: new Map<string, (info: { version: string }) => void>(),
  downloadUpdate: vi.fn(async () => undefined),
  quitAndInstall: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => mocks.userData,
    getVersion: () => "3.2.1",
    isPackaged: true,
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, handler: (info: { version: string }) => void) => {
      mocks.handlers.set(event, handler);
    }),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: mocks.downloadUpdate,
    quitAndInstall: mocks.quitAndInstall,
  },
}));

vi.mock("../../window", () => ({ mainWindow: null }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/appPath", () => ({
  getAppRoot: () => mocks.appRoot,
}));

import { UpdateService } from "./UpdateService";

async function snapshotDirectories(): Promise<string[]> {
  const root = path.join(mocks.userData, ".update-snapshots");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe("UpdateService snapshots", () => {
  let testRoot = "";

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bz-update-service-"));
    mocks.appRoot = path.join(testRoot, "app");
    mocks.userData = path.join(testRoot, "user-data");
    mocks.handlers.clear();
    mocks.downloadUpdate.mockClear();
    mocks.quitAndInstall.mockClear();

    await fs.mkdir(path.join(mocks.appRoot, "games"), { recursive: true });
    await fs.mkdir(path.join(mocks.appRoot, "db"), { recursive: true });
    await fs.writeFile(path.join(mocks.appRoot, "config.json"), "{}");
    await fs.writeFile(path.join(mocks.appRoot, "games", "game.txt"), "game");
    await fs.writeFile(path.join(mocks.appRoot, "db", "data.db"), "db");
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("does not create a snapshot before downloading the update", async () => {
    const service = new UpdateService();

    await service.downloadUpdate();

    expect(mocks.downloadUpdate).toHaveBeenCalledOnce();
    expect(await snapshotDirectories()).toEqual([]);
  });

  it("creates one snapshot after download and reuses it when installing", async () => {
    const service = new UpdateService();
    service.init();

    mocks.handlers.get("update-downloaded")?.({ version: "3.3.0" });
    mocks.handlers.get("update-downloaded")?.({ version: "3.3.0" });

    await vi.waitFor(async () => {
      expect(await snapshotDirectories()).toHaveLength(1);
    });

    service.installUpdate();
    await vi.waitFor(() => expect(mocks.quitAndInstall).toHaveBeenCalledOnce());
    expect(await snapshotDirectories()).toHaveLength(1);

    const [snapshotName] = await snapshotDirectories();
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(
          mocks.userData,
          ".update-snapshots",
          snapshotName,
          "snapshot-meta.json",
        ),
        "utf-8",
      ),
    );
    expect(metadata.targetVersion).toBe("3.3.0");
  });

  it("creates the missing target-version snapshot when install is clicked", async () => {
    const service = new UpdateService();
    service.init();
    mocks.handlers.get("update-available")?.({ version: "3.4.0" });

    service.installUpdate();

    await vi.waitFor(() => expect(mocks.quitAndInstall).toHaveBeenCalledOnce());
    expect(await snapshotDirectories()).toHaveLength(1);
  });

  it("does not install when the required snapshot cannot be created", async () => {
    await fs.rm(path.join(mocks.appRoot, "db"), {
      recursive: true,
      force: true,
    });
    const service = new UpdateService();
    service.init();
    mocks.handlers.get("update-available")?.({ version: "3.5.0" });

    service.installUpdate();

    await vi.waitFor(() => expect(service.getState().status).toBe("error"));
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(await snapshotDirectories()).toEqual([]);
  });
});
