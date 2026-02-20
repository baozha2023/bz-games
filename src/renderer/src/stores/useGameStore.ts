import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { GameManifest } from '../../../shared/game-manifest';

export const useGameStore = defineStore('game', () => {
  const games = ref<GameManifest[]>([]);
  const runningGameIds = ref<Set<string>>(new Set());
  const isLoading = ref(false);

  async function loadGames() {
    isLoading.value = true;
    try {
      games.value = await window.electronAPI.game.getAll();
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
  
  // Listen for process events
  window.electronAPI.game.onProcessEvent((type, id) => {
    if (type === 'start') {
      runningGameIds.value.add(id);
    } else if (type === 'end') {
      runningGameIds.value.delete(id);
    }
  });

  return { games, runningGameIds, isLoading, loadGames, addGame, removeGame, launchGame };
});
