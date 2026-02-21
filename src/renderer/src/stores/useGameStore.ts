import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { GameManifest } from '../../../shared/game-manifest';
import type { GameRecord, UnlockedAchievement } from '../../../shared/types';

export const useGameStore = defineStore('game', () => {
  const games = ref<GameManifest[]>([]);
  const records = ref<GameRecord[]>([]);
  const runningGameIds = ref<Set<string>>(new Set());
  const isLoading = ref(false);

  async function loadGames() {
    isLoading.value = true;
    try {
      const [manifests, recs] = await Promise.all([
        window.electronAPI.game.getAll(),
        window.electronAPI.game.getAllRecords()
      ]);
      games.value = manifests;
      records.value = recs;
    } finally {
      isLoading.value = false;
    }
  }

  async function addGame() {
    const res = await window.electronAPI.game.load();
    if (res.success && res.manifest) {
      await loadGames();
    }
    return res;
  }

  async function removeGame(id: string) {
    await window.electronAPI.game.remove(id);
    await loadGames();
  }

  async function launchGame(id: string, version?: string) {
    await window.electronAPI.game.launch(id, version);
  }

  async function reorderGames(newOrderIds: string[]) {
    // Optimistic update
    const sorted = newOrderIds
      .map(id => games.value.find(g => g.id === id))
      .filter((g): g is GameManifest => !!g);
    
    // Keep any that weren't in the list
    const remaining = games.value.filter(g => !newOrderIds.includes(g.id));
    games.value = [...sorted, ...remaining];

    // Persist
    await window.electronAPI.game.reorder(newOrderIds);
  }
  
  function getGameRecord(id: string) {
    return records.value.find(r => r.id === id);
  }

  function getUnlockedAchievements(gameId: string): UnlockedAchievement[] {
    const record = getGameRecord(gameId);
    return record?.unlockedAchievements || [];
  }
  
  // Listen for process events
  window.electronAPI.game.onProcessEvent((type, id) => {
    if (type === 'start') {
      runningGameIds.value.add(id);
    } else if (type === 'end') {
      runningGameIds.value.delete(id);
    }
  });

  // Listen for achievement events and update local state
  // Notification is handled in App.vue to avoid using useMessage in store
  window.electronAPI.game.onAchievementUnlocked((gameId, achievementId) => {
    // Update local record
    const record = records.value.find(r => r.id === gameId);
    if (record) {
      if (!record.unlockedAchievements) record.unlockedAchievements = [];
      if (!record.unlockedAchievements.some(a => a.id === achievementId)) {
        record.unlockedAchievements.push({ id: achievementId, unlockedAt: Date.now() });
      }
    }
  });

  return { 
    games, 
    records, 
    runningGameIds, 
    isLoading, 
    loadGames, 
    addGame, 
    removeGame, 
    launchGame,
    reorderGames,
    getGameRecord,
    getUnlockedAchievements
  };
});
