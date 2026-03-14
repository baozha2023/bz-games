import { defineStore } from "pinia";
import { ref } from "vue";
import type { GameManifest } from "../../../shared/game-manifest";
import type { GameRecord, UnlockedAchievement } from "../../../shared/types";
import { useSettingsStore } from "./useSettingsStore";

export const useGameStore = defineStore("game", () => {
  const settingsStore = useSettingsStore();
  const games = ref<GameManifest[]>([]);
  const records = ref<GameRecord[]>([]);
  const runningGameIds = ref<Set<string>>(new Set());
  const newAchievements = ref<Set<string>>(new Set()); // key: gameId@version@achievementId
  const isLoading = ref(false);
  const pendingStopTimers = new Map<string, number>();

  async function loadGames() {
    isLoading.value = true;
    try {
      const [manifests, recs] = await Promise.all([
        window.electronAPI.game.getAll(),
        window.electronAPI.game.getAllRecords(),
      ]);
      games.value = manifests;
      records.value = recs;
    } finally {
      isLoading.value = false;
    }
  }

  async function addGame(sourcePath?: string) {
    const res = await window.electronAPI.game.load(sourcePath);
    if (res.success && res.manifest) {
      await loadGames();
    }
    return res;
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
      platformVersion?: string;
      icon?: string;
      cover?: string;
      type: "singleplayer" | "multiplayer" | "singlemultiple";
      minPlayers?: number;
      maxPlayers?: number;
    },
  ) {
    const res = await window.electronAPI.game.loadWithManifest(sourcePath, draft);
    if (res.success && res.manifest) {
      await loadGames();
    }
    return res;
  }

  async function removeGame(id: string, versions?: string[]) {
    await window.electronAPI.game.remove(id, versions);
    await loadGames();
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
    await window.electronAPI.game.launch(id, version);
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

  // Listen for process events
  window.electronAPI.game.onProcessEvent((type, id) => {
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

  return {
    games,
    records,
    runningGameIds,
    newAchievements,
    isLoading,
    loadGames,
    addGame,
    addGameWithManifest,
    removeGame,
    toggleFavorite,
    launchGame,
    reorderGames,
    getGameRecord,
    getUnlockedAchievements,
    markAchievementsAsSeen,
  };
});
