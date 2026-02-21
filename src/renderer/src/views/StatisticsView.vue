<template>
  <div style="padding: 24px;">
    <n-page-header :title="t('statistics.title')" @back="$router.push({ name: 'Library' })" />
    <n-divider />
    
    <n-grid x-gap="12" y-gap="12" :cols="1" md="2" lg="3">
      <n-grid-item v-for="stat in stats" :key="stat.id">
        <n-card :title="stat.name" hoverable>
          <template #header-extra>
            <n-tag type="info" size="small">{{ stat.version }}</n-tag>
          </template>
          <n-statistic :label="t('statistics.playtime')" :value="formatTime(stat.playtime)" />
          <template #footer>
            <n-text depth="3" style="font-size: 12px;">
              {{ t('statistics.lastPlayed') }}: {{ stat.lastPlayedAt ? new Date(stat.lastPlayedAt).toLocaleString() : t('statistics.never') }}
            </n-text>
          </template>
        </n-card>
      </n-grid-item>
    </n-grid>
    
    <n-empty v-if="stats.length === 0" :description="t('statistics.empty')" style="margin-top: 100px;" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'

const { t } = useI18n()
const gameStore = useGameStore()

interface GameStat {
  id: string;
  name: string;
  playtime: number;
  lastPlayedAt?: number;
  version: string;
}

const stats = ref<GameStat[]>([])

onMounted(async () => {
  await gameStore.loadGames()
  
  const allRecords = await window.electronAPI.game.getAllRecords();
  
  stats.value = allRecords.map(record => {
      // Find name from manifest (loaded in gameStore)
      const manifest = gameStore.games.find(m => m.id === record.id);
      return {
          id: record.id,
          name: manifest ? manifest.name : record.id,
          playtime: record.playtime || 0,
          lastPlayedAt: record.lastPlayedAt,
          version: record.latestVersion
      };
  }).sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
})

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
</script>
