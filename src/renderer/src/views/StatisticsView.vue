<template>
  <div style="padding: 24px;">
    <n-page-header :title="t('statistics.title')" @back="$router.push({ name: 'Library' })" />
    <n-divider />
    
    <n-grid x-gap="12" y-gap="12" :cols="1" md="2" lg="3">
      <n-grid-item v-for="game in games" :key="game.id">
        <n-card :title="game.name" hoverable>
          <template #header-extra>
            <n-select 
              size="small" 
              style="width: 120px;" 
              :value="selectedVersions[game.id]" 
              :options="getVersionOptions(game.id)"
              @update:value="(v) => handleVersionChange(game.id, v)"
            />
          </template>
          
          <div v-if="getStatKeys(game.id).length > 0">
            <n-grid :cols="2" x-gap="12" y-gap="12">
               <n-grid-item v-for="key in getStatKeys(game.id)" :key="key">
                 <n-statistic :label="getLabel(game.id, key)" :value="getValue(game.id, key)" />
               </n-grid-item>
            </n-grid>
          </div>
          <n-empty v-else :description="t('statistics.noStats')" size="small" />

          <template #footer>
            <n-text depth="3" style="font-size: 12px;">
              {{ t('statistics.lastPlayed') }}: {{ getLastPlayed(game.id) }}
            </n-text>
          </template>
        </n-card>
      </n-grid-item>
    </n-grid>
    
    <n-empty v-if="games.length === 0" :description="t('statistics.empty')" style="margin-top: 100px;" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'
import type { GameManifest } from '../../../shared/game-manifest'

const { t } = useI18n()
const gameStore = useGameStore()

const selectedVersions = ref<Record<string, string>>({})
const manifestCache = ref<Record<string, GameManifest>>({})

const games = computed(() => gameStore.games)

onMounted(async () => {
  await gameStore.loadGames()
  
  // Initialize selected versions to latest
  for (const game of games.value) {
    if (!selectedVersions.value[game.id]) {
      selectedVersions.value[game.id] = game.version;
      // Cache the loaded manifest (which is the latest)
      manifestCache.value[`${game.id}@${game.version}`] = game;
    }
  }
})

function getVersionOptions(gameId: string) {
  const record = gameStore.getGameRecord(gameId);
  if (!record || !record.versions) return [];
  // Sort descending
  return record.versions
    .map(v => v.version)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
    .map(v => ({ label: v, value: v }));
}

async function handleVersionChange(gameId: string, version: string) {
  selectedVersions.value[gameId] = version;
  const key = `${gameId}@${version}`;
  if (!manifestCache.value[key]) {
      try {
          const manifest = await window.electronAPI.game.getManifest(gameId, version);
          if (manifest) {
              manifestCache.value[key] = manifest;
          }
      } catch (e) {
          console.error(e);
      }
  }
}

function getManifest(gameId: string): GameManifest | undefined {
    const version = selectedVersions.value[gameId];
    if (!version) return undefined;
    return manifestCache.value[`${gameId}@${version}`];
}

function getStatKeys(gameId: string): string[] {
    const manifest = getManifest(gameId);
    
    // Always include 'time' first
    const keys = ['time'];
    
    if (manifest?.statistics) {
        const otherKeys = manifest.statistics.map(s => {
            if (typeof s === 'string') return s;
            return Object.keys(s)[0];
        }).filter(k => k !== 'time');
        
        keys.push(...otherKeys);
    }
    
    return keys;
}

function getValue(gameId: string, key: string): string {
    const record = gameStore.getGameRecord(gameId);
    const version = selectedVersions.value[gameId];
    
    if (!record || !version) return '0';
    
    const gameVersion = record.versions.find(v => v.version === version);
    if (!gameVersion) return '0';

    let val = 0;
    
    if (key === 'time') {
        // Use the dedicated playtime field
        val = Math.round((gameVersion.playtime || 0) / 1000);
    } else {
        if (gameVersion.stats && gameVersion.stats[key] !== undefined) {
            val = gameVersion.stats[key];
        }
    }
    
    if (key === 'time') {
        return formatTime(val);
    }
    return val.toString();
}

function getLastPlayed(gameId: string): string {
    const record = gameStore.getGameRecord(gameId);
    return record?.lastPlayedAt ? new Date(record.lastPlayedAt).toLocaleString() : t('statistics.never');
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getLabel(gameId: string, key: string): string {
    const manifest = getManifest(gameId);
    // Try to find label in manifest first
    if (manifest?.statistics) {
        for (const stat of manifest.statistics) {
            if (typeof stat === 'object' && Object.keys(stat)[0] === key) {
                return Object.values(stat)[0] as string;
            }
        }
    }

    const i18nKey = `statistics.${key}`;
    const label = t(i18nKey);
    if (label !== i18nKey) return label;

    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
</script>
