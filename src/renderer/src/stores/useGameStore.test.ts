import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getAllRecords: vi.fn(),
  getManifest: vi.fn(),
  getRunningIds: vi.fn(),
}));

let processEventHandler:
  | ((type: "start" | "end", id: string) => void)
  | undefined;

vi.mock("./useSettingsStore", () => ({
  useSettingsStore: () => ({ loadUserData: vi.fn() }),
}));
vi.mock("../composables/useImageCache", () => ({
  invalidateGameAssetCache: vi.fn(),
}));

import { useGameStore } from "./useGameStore";

const game = (id: string, name = id) =>
  ({
    id,
    name,
    version: "1.0.0",
    author: "test",
    platformVersion: ">=1.0.0",
    entry: "index.html",
    type: "singleplayer",
  }) as any;

const record = (id: string) =>
  ({
    id,
    versions: [],
    latestVersion: "1.0.0",
    addedAt: 1,
  }) as any;

beforeEach(() => {
  mocks.getAll.mockReset();
  mocks.getAllRecords.mockReset();
  mocks.getManifest.mockReset();
  mocks.getRunningIds.mockReset();
  mocks.getRunningIds.mockResolvedValue([]);
  processEventHandler = undefined;
  vi.stubGlobal("window", {
    electronAPI: {
      game: {
        getAll: mocks.getAll,
        getAllRecords: mocks.getAllRecords,
        getManifest: mocks.getManifest,
        getRunningIds: mocks.getRunningIds,
        onProcessEvent: vi.fn((callback) => {
          processEventHandler = callback;
          return vi.fn();
        }),
        onAchievementUnlocked: vi.fn(() => vi.fn()),
        onImportEvent: vi.fn(() => vi.fn()),
      },
      market: { onEvent: vi.fn(() => vi.fn()) },
    },
    setTimeout,
    clearTimeout,
  });
  setActivePinia(createPinia());
});

describe("useGameStore refresh behavior", () => {
  it("restores running games from the main-process snapshot", async () => {
    mocks.getRunningIds.mockResolvedValue(["game.running"]);

    const store = useGameStore();

    await vi.waitFor(() =>
      expect(store.runningGameIds).toEqual(new Set(["game.running"])),
    );
  });

  it("does not let an older snapshot overwrite a process event", async () => {
    let releaseSnapshot!: (ids: string[]) => void;
    mocks.getRunningIds.mockReturnValue(
      new Promise<string[]>((resolve) => {
        releaseSnapshot = resolve;
      }),
    );

    const store = useGameStore();
    await vi.waitFor(() => expect(processEventHandler).toBeDefined());
    processEventHandler?.("start", "game.started");
    releaseSnapshot([]);
    await vi.waitFor(() =>
      expect(store.runningGameIds).toEqual(new Set(["game.started"])),
    );
  });

  it("coalesces concurrent full refresh requests", async () => {
    let release!: (games: any[]) => void;
    mocks.getAll.mockReturnValue(
      new Promise<any[]>((resolve) => {
        release = resolve;
      }),
    );
    mocks.getAllRecords.mockResolvedValue([]);
    const store = useGameStore();

    const first = store.loadGames();
    const second = store.loadGames();

    expect(store.isLoading).toBe(true);
    expect(store.isRefreshing).toBe(false);
    await vi.waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(1));
    release([]);
    await Promise.all([first, second]);
    expect(store.isLoading).toBe(false);
    expect(mocks.getAllRecords).toHaveBeenCalledTimes(1);
  });

  it("keeps existing cards visible until a targeted refresh commits", async () => {
    const firstGame = game("game.first");
    const secondGame = game("game.second");
    const secondRecord = record("game.second");
    mocks.getAll.mockResolvedValue([firstGame, secondGame]);
    mocks.getAllRecords
      .mockResolvedValueOnce([record("game.first"), secondRecord])
      .mockResolvedValueOnce([secondRecord]);
    const store = useGameStore();
    await store.loadGames();
    const visibleSecondGame = store.games[1];

    let finishManifest!: (manifest: null) => void;
    mocks.getManifest.mockReturnValue(
      new Promise<null>((resolve) => {
        finishManifest = resolve;
      }),
    );
    const refresh = store.refreshGames(["game.first"]);

    expect(store.isLoading).toBe(false);
    expect(store.isRefreshing).toBe(true);
    expect(store.games).toEqual([firstGame, secondGame]);
    finishManifest(null);
    await refresh;

    expect(store.games).toEqual([secondGame]);
    expect(store.games[0]).toBe(visibleSecondGame);
    expect(store.records).toEqual([secondRecord]);
    expect(store.isRefreshing).toBe(false);
  });
});
