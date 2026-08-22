import { defineStore } from "pinia";
import { ref } from "vue";
import type { GameManifest } from "../../../shared/game-manifest";
import type {
  GameImportStartResult,
  GameImportTaskState,
  GameRecord,
  GameType,
  MarketTaskState,
  UnlockedAchievement,
} from "../../../shared/types";
import { useSettingsStore } from "./useSettingsStore";
import { invalidateGameAssetCache } from "../composables/useImageCache";

export const useGameStore = defineStore("game", () => {
  const settingsStore = useSettingsStore();
  const games = ref<GameManifest[]>([]);
  const records = ref<GameRecord[]>([]);
  const runningGameIds = ref<Set<string>>(new Set());
  const newAchievements = ref<Set<string>>(new Set()); // key: gameId@version@achievementId
  const isLoading = ref(false);
  const isRefreshing = ref(false);
  const importTasks = ref<GameImportTaskState[]>([]);
  const pendingStopTimers = new Map<string, number>();
  let runningGameIdsRevision = 0;
  let importRefreshTimer: number | null = null;
  let hasLoadedGames = false;
  let activeBackgroundRefreshes = 0;
  let refreshChain: Promise<void> = Promise.resolve();
  let fullRefreshPromise: Promise<void> | null = null;

  function enqueueRefresh(operation: () => Promise<void>): Promise<void> {
    const result = refreshChain.then(operation, operation);
    refreshChain = result.catch(() => undefined);
    return result;
  }

  function runRefresh(
    operation: () => Promise<void>,
    initial: boolean,
  ): Promise<void> {
    if (initial) {
      isLoading.value = true;
    } else {
      activeBackgroundRefreshes += 1;
      isRefreshing.value = true;
    }
    return enqueueRefresh(operation).finally(() => {
      if (initial) {
        isLoading.value = false;
      } else {
        activeBackgroundRefreshes -= 1;
        isRefreshing.value = activeBackgroundRefreshes > 0;
      }
    });
  }

  function loadGames(): Promise<void> {
    if (fullRefreshPromise) return fullRefreshPromise;
    const initial = !hasLoadedGames && games.value.length === 0;
    const request = runRefresh(async () => {
      // getAll() performs disk reconciliation and rebuilds the main-process
      // record cache, so records must be read only after it completes.
      const manifests = await window.electronAPI.game.getAll();
      const recs = await window.electronAPI.game.getAllRecords();
      // Commit both snapshots together after all I/O has completed. Vue batches
      // these assignments, so consumers never render a half-updated library.
      games.value = manifests;
      records.value = recs;
      hasLoadedGames = true;
    }, initial);
    fullRefreshPromise = request.finally(() => {
      fullRefreshPromise = null;
    });
    return fullRefreshPromise;
  }

  function replaceSelectedById<T extends { id: string }>(
    current: T[],
    selectedIds: Set<string>,
    replacements: Map<string, T>,
  ): T[] {
    const inserted = new Set<string>();
    const next: T[] = [];
    for (const item of current) {
      if (!selectedIds.has(item.id)) {
        next.push(item);
        continue;
      }
      const replacement = replacements.get(item.id);
      if (replacement) {
        next.push(replacement);
        inserted.add(item.id);
      }
    }
    for (const id of selectedIds) {
      const replacement = replacements.get(id);
      if (replacement && !inserted.has(id)) next.push(replacement);
    }
    return next;
  }

  function refreshGames(gameIds: string[]): Promise<void> {
    const selectedIds = new Set(gameIds.filter(Boolean));
    if (selectedIds.size === 0) return Promise.resolve();
    if (!hasLoadedGames) return loadGames();

    return runRefresh(async () => {
      const ids = Array.from(selectedIds);
      const [manifests, allRecords] = await Promise.all([
        Promise.all(ids.map((id) => window.electronAPI.game.getManifest(id))),
        window.electronAPI.game.getAllRecords(),
      ]);
      const manifestsById = new Map<string, GameManifest>();
      manifests.forEach((manifest, index) => {
        if (manifest) manifestsById.set(ids[index], manifest);
      });
      const recordsById = new Map(
        allRecords
          .filter((record) => selectedIds.has(record.id))
          .map((record) => [record.id, record] as const),
      );

      // Preserve every unaffected object and its position. Existing games are
      // replaced in place, deleted games disappear, and new games append.
      games.value = replaceSelectedById(
        games.value,
        selectedIds,
        manifestsById,
      );
      records.value = replaceSelectedById(
        records.value,
        selectedIds,
        recordsById,
      );
    }, false);
  }

  async function addGame(sourcePath?: string) {
    const res = await window.electronAPI.game.load(sourcePath);
    if (res.success && res.manifest) {
      invalidateGameAssetCache(res.manifest.id);
      await refreshGames([res.manifest.id]);
    }
    return res;
  }

  async function loadImportTasks() {
    const [manualSnapshots, marketSnapshots] = await Promise.all([
      window.electronAPI.game.getImportTasks(),
      window.electronAPI.market.getAllTaskStates(),
    ]);
    const snapshots = [
      ...manualSnapshots,
      ...marketSnapshots
        .filter((task) => task.installStarted)
        .map(toMarketImportTask),
    ];
    const merged = new Map(
      importTasks.value.map((task) => [task.taskId, task] as const),
    );
    for (const task of snapshots) {
      const current = merged.get(task.taskId);
      if (!current || task.updatedAt >= current.updatedAt) {
        merged.set(task.taskId, task);
      }
    }
    importTasks.value = Array.from(merged.values()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    if (importTasks.value.some((task) => task.status === "completed")) {
      scheduleImportRefresh();
    }
  }

  async function startImport(
    sourcePath: string,
    draft?: Parameters<typeof window.electronAPI.game.startImport>[1],
  ): Promise<GameImportStartResult> {
    const result = await window.electronAPI.game.startImport(sourcePath, draft);
    if (result.success && result.task) upsertImportTask(result.task);
    return result;
  }

  async function cancelImport(taskId: string) {
    if (taskId.startsWith("market:")) {
      return window.electronAPI.market.cancelTask(taskId.slice(7));
    }
    return window.electronAPI.game.cancelImport(taskId);
  }

  async function retryImport(taskId: string) {
    if (taskId.startsWith("market:")) {
      const task = importTasks.value.find((item) => item.taskId === taskId);
      if (!task) return { success: false, error: "taskNotRetryable" };
      try {
        await window.electronAPI.market.downloadAndInstall(
          task.gameId,
          task.version,
          Number(task.params?.sourceIdx || 0),
        );
        importTasks.value = importTasks.value.filter(
          (item) => item.taskId !== taskId,
        );
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: "unknown",
          params: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    const result = await window.electronAPI.game.retryImport(taskId);
    if (result.success && result.task) upsertImportTask(result.task);
    return result;
  }

  async function dismissImport(taskId: string) {
    const dismissed = taskId.startsWith("market:")
      ? await window.electronAPI.market.dismissTask(taskId.slice(7))
      : await window.electronAPI.game.dismissImport(taskId);
    if (dismissed) {
      importTasks.value = importTasks.value.filter(
        (task) => task.taskId !== taskId,
      );
    }
    return dismissed;
  }

  function upsertImportTask(task: GameImportTaskState) {
    if (task.status === "canceled") {
      importTasks.value = importTasks.value.filter(
        (item) => item.taskId !== task.taskId,
      );
      return;
    }
    const index = importTasks.value.findIndex(
      (item) => item.taskId === task.taskId,
    );
    if (index >= 0) {
      importTasks.value[index] = task;
    } else {
      importTasks.value.push(task);
    }
    if (task.status === "completed") scheduleImportRefresh();
  }

  function toMarketImportTask(task: MarketTaskState): GameImportTaskState {
    return {
      taskId: `market:${task.taskId}`,
      sourcePath: "",
      gameId: task.gameId,
      gameName: task.gameName || task.gameId,
      version: task.version,
      existingGame: records.value.some((record) => record.id === task.gameId),
      source: "market",
      status:
        task.status === "completed"
          ? "completed"
          : task.status === "error"
            ? "failed"
            : task.status === "canceled"
              ? "canceled"
              : "copying",
      progress: task.progress,
      error: task.error,
      params: { sourceIdx: task.sourceIdx },
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  function scheduleImportRefresh() {
    if (importRefreshTimer !== null) window.clearTimeout(importRefreshTimer);
    importRefreshTimer = window.setTimeout(() => {
      importRefreshTimer = null;
      void refreshCompletedImports();
    }, 150);
  }

  async function refreshCompletedImports() {
    try {
      const completedTasks = importTasks.value.filter(
        (task) => task.status === "completed",
      );
      if (completedTasks.length === 0) return;
      const completedIds = completedTasks.map((task) => task.taskId);
      for (const task of completedTasks) {
        invalidateGameAssetCache(task.gameId);
      }
      await refreshGames(completedTasks.map((task) => task.gameId));
      await Promise.all(
        completedIds.map((taskId) =>
          taskId.startsWith("market:")
            ? window.electronAPI.market.dismissTask(taskId.slice(7))
            : window.electronAPI.game.dismissImport(taskId),
        ),
      );
      importTasks.value = importTasks.value.filter(
        (task) => !completedIds.includes(task.taskId),
      );
    } catch (error) {
      console.error("[GameStore] Failed to refresh completed imports", error);
    }
  }

  async function addGameWithManifest(
    sourcePath: string,
    draft: {
      id: string;
      name: string;
      version: string;
      description?: string;
      author: string;
      entry?: string;
      web_url?: string;
      platformVersion?: string;
      icon?: string;
      cover?: string;
      type: GameType;
      minPlayers?: number;
      maxPlayers?: number;
    },
  ) {
    const res = await window.electronAPI.game.loadWithManifest(
      sourcePath,
      draft,
    );
    if (res.success && res.manifest) {
      invalidateGameAssetCache(draft.id);
      await refreshGames([res.manifest.id]);
    }
    return res;
  }

  async function removeGame(id: string, versions?: string[]) {
    await window.electronAPI.game.remove(id, versions);
    invalidateGameAssetCache(id);
    await refreshGames([id]);
  }

  async function toggleFavorite(id: string) {
    const isFav = await window.electronAPI.game.toggleFavorite(id);
    const record = records.value.find((r) => r.id === id);
    if (record) {
      record.isFavorite = isFav;
    }
    return isFav;
  }

  async function launchGame(id: string, version?: string) {
    return await window.electronAPI.game.launch(id, version);
  }

  async function reorderGames(newOrderIds: string[]) {
    // Optimistic update
    const sorted = newOrderIds
      .map((id) => games.value.find((g) => g.id === id))
      .filter((g): g is GameManifest => !!g);

    // Keep any that weren't in the list
    const remaining = games.value.filter((g) => !newOrderIds.includes(g.id));
    games.value = [...sorted, ...remaining];

    // Persist
    await window.electronAPI.game.reorder(newOrderIds);
  }

  function getGameRecord(id: string) {
    return records.value.find((r) => r.id === id);
  }

  function getUnlockedAchievements(
    gameId: string,
    version: string,
  ): UnlockedAchievement[] {
    const record = getGameRecord(gameId);
    if (!record) return [];

    const gameVersion = record.versions.find((v) => v.version === version);
    return gameVersion?.unlockedAchievements || [];
  }

  function markAchievementsAsSeen() {
    newAchievements.value.clear();
  }

  async function syncRunningGameIds() {
    const revision = runningGameIdsRevision;
    try {
      const ids = new Set(await window.electronAPI.game.getRunningIds());
      if (revision !== runningGameIdsRevision) return;
      for (const [id, timer] of pendingStopTimers) {
        if (!ids.has(id)) continue;
        window.clearTimeout(timer);
        pendingStopTimers.delete(id);
      }
      runningGameIds.value = ids;
    } catch (error) {
      console.error("[GameStore] Failed to sync running games", error);
    }
  }

  // Listen for process events
  window.electronAPI.game.onProcessEvent((type, id) => {
    runningGameIdsRevision += 1;
    if (type === "start") {
      const pending = pendingStopTimers.get(id);
      if (pending) {
        window.clearTimeout(pending);
        pendingStopTimers.delete(id);
      }
      runningGameIds.value.add(id);
    } else if (type === "end") {
      const pending = pendingStopTimers.get(id);
      if (pending) {
        window.clearTimeout(pending);
        pendingStopTimers.delete(id);
      }
      const timer = window.setTimeout(() => {
        runningGameIds.value.delete(id);
        pendingStopTimers.delete(id);
      }, 5000);
      pendingStopTimers.set(id, timer);
      loadGames();
      settingsStore.loadUserData();
    }
  });
  void syncRunningGameIds();

  // Listen for achievement events and update local state
  // Notification is handled in App.vue to avoid using useMessage in store
  window.electronAPI.game.onAchievementUnlocked(
    (gameId, version, achievementId) => {
      // Update local record
      const record = records.value.find((r) => r.id === gameId);
      if (record) {
        const gameVersion = record.versions.find((v) => v.version === version);
        if (gameVersion) {
          if (!gameVersion.unlockedAchievements)
            gameVersion.unlockedAchievements = [];
          if (
            !gameVersion.unlockedAchievements.some(
              (a) => a.id === achievementId,
            )
          ) {
            gameVersion.unlockedAchievements.push({
              id: achievementId,
              unlockedAt: Date.now(),
            });
            newAchievements.value.add(`${gameId}@${version}@${achievementId}`);
          }
        }
      }
    },
  );

  window.electronAPI.game.onImportEvent(({ task }) => {
    upsertImportTask(task);
  });

  window.electronAPI.market.onEvent(({ task }) => {
    const taskId = `market:${task.taskId}`;
    const alreadyVisible = importTasks.value.some(
      (item) => item.taskId === taskId,
    );
    if (!task.installStarted && !alreadyVisible) return;
    upsertImportTask(toMarketImportTask(task));
  });

  return {
    games,
    records,
    runningGameIds,
    newAchievements,
    isLoading,
    isRefreshing,
    importTasks,
    loadGames,
    refreshGames,
    loadImportTasks,
    startImport,
    cancelImport,
    retryImport,
    dismissImport,
    addGame,
    addGameWithManifest,
    removeGame,
    toggleFavorite,
    launchGame,
    syncRunningGameIds,
    reorderGames,
    getGameRecord,
    getUnlockedAchievements,
    markAchievementsAsSeen,
  };
});
