<template>
  <div style="padding: 24px;">
    <n-page-header :title="t('statistics.title')" @back="$router.push({ name: 'Library' })">
      <template #extra>
        <n-space align="center" :size="8">
          <n-input
            v-if="isSearchExpanded"
            v-model:value="searchKeyword"
            clearable
            autofocus
            :placeholder="t('common.searchGame')"
            style="width: 260px;"
            @blur="handleSearchBlur"
          />
          <n-button quaternary circle @click="toggleSearch">
            <template #icon>
              <n-icon>
                <SearchOutline />
              </n-icon>
            </template>
          </n-button>
        </n-space>
      </template>
    </n-page-header>
    <n-divider />

    <n-card style="margin-bottom: 16px;">
      <div v-if="isLoadingHeatmap" class="heatmap-skeleton">
        <n-skeleton height="20px" width="30%" style="margin-bottom: 16px;" />
        <n-skeleton height="140px" />
        <n-skeleton height="16px" width="40%" style="margin-top: 12px;" />
      </div>
      <CalendarHeatmap
        v-else
        :daily-durations="dailyDurations"
        :selected-date="selectedDate"
        @select-date="handleHeatmapDateSelect"
      />
    </n-card>

    <n-grid x-gap="12" y-gap="12" :cols="1" md="2" lg="3">
      <n-grid-item v-for="game in filteredGames" :key="game.id">
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
    
    <n-empty v-if="filteredGames.length === 0" :description="t('statistics.empty')" style="margin-top: 100px;" />

    <n-modal
      v-model:show="showSessionModal"
      preset="card"
      style="width: min(760px, calc(100vw - 32px));"
      :title="t('statistics.dayRecordsTitle', { date: selectedDate })"
      :bordered="false"
    >
      <div class="session-modal-content">
        <div v-if="isLoadingSessions">
          <n-space vertical :size="12">
            <n-skeleton height="56px" :repeat="3" />
          </n-space>
        </div>
        <n-empty
          v-else-if="selectedDateSessions.length === 0"
          :description="t('statistics.dayRecordsEmpty')"
        />
        <n-space v-else vertical :size="12">
          <n-card
            v-for="session in selectedDateSessions"
            :key="session.id"
            size="small"
            embedded
          >
            <div class="session-row">
              <div>
                <div class="session-game">{{ session.game_name }}</div>
                <div class="session-meta">
                  {{ t('statistics.version') }}: {{ session.version }}
                </div>
              </div>
              <div class="session-side">
                <div>{{ formatSessionDuration(session.duration_ms) }}</div>
                <div class="session-meta">{{ formatSessionRange(session.start_time, session.end_time) }}</div>
              </div>
            </div>
          </n-card>
        </n-space>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchOutline } from '@vicons/ionicons5'
import { useGameStore } from '../stores/useGameStore'
import CalendarHeatmap from '../components/CalendarHeatmap.vue'
import type { GameManifest } from '../../../shared/game-manifest'

const { t } = useI18n()
const gameStore = useGameStore()

interface PlaySession {
  id: string
  game_id: string
  game_name: string
  version: string
  start_time: number
  end_time: number | null
  duration_ms: number | null
}

const selectedVersions = ref<Record<string, string>>({})
const manifestCache = ref<Record<string, GameManifest>>({})
const searchKeyword = ref('')
const isSearchExpanded = ref(false)
const isLoadingHeatmap = ref(true)
const dailyDurations = ref<{ date: string; total_duration_ms: number }[]>([])
const selectedDate = ref('')
const showSessionModal = ref(false)
const isLoadingSessions = ref(false)
const selectedDateSessions = ref<PlaySession[]>([])

const games = computed(() => gameStore.games)
const filteredGames = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return games.value
  return games.value.filter((game) => {
    return game.name.toLowerCase().includes(keyword) || game.id.toLowerCase().includes(keyword)
  })
})

function toggleSearch() {
  isSearchExpanded.value = true
}

function handleSearchBlur() {
  if (!searchKeyword.value.trim()) {
    isSearchExpanded.value = false
  }
}

async function loadStatsData() {
  try {
    const durations = await window.electronAPI.stats.getDailyPlayDurations(365)
    dailyDurations.value = durations
  } catch (e) {
    console.error('[StatisticsView] Failed to load stats data:', e)
  } finally {
    isLoadingHeatmap.value = false
  }
}

async function handleHeatmapDateSelect(date: string) {
  selectedDate.value = date
  showSessionModal.value = true
  isLoadingSessions.value = true
  try {
    selectedDateSessions.value = await window.electronAPI.stats.getSessionsByDate(date)
  } catch (e) {
    console.error('[StatisticsView] Failed to load sessions by date:', e)
    selectedDateSessions.value = []
  } finally {
    isLoadingSessions.value = false
  }
}

const ensureDefaultVersionSelection = () => {
  for (const game of games.value) {
    if (!selectedVersions.value[game.id]) {
      selectedVersions.value[game.id] = game.version
      manifestCache.value[`${game.id}@${game.version}`] = game
    }
  }
}

onMounted(async () => {
  await gameStore.loadGames()
  ensureDefaultVersionSelection()
  loadStatsData()
})

watch(games, () => {
  ensureDefaultVersionSelection()
})

function getVersionOptions(gameId: string) {
  const record = gameStore.getGameRecord(gameId);
  if (!record || !record.versions) return [];
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

function formatSessionDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return t('statistics.noPlay')
  const minutes = Math.floor(durationMs / 60000)
  if (minutes < 60) return `${minutes}${t('statistics.minute')}`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours}${t('statistics.hour')}`
  return `${hours}${t('statistics.hour')}${remainingMinutes}${t('statistics.minute')}`
}

function formatSessionRange(startTime: number, endTime: number | null): string {
  const start = new Date(startTime)
  const end = endTime ? new Date(endTime) : null
  const startLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (!end) return startLabel
  const endLabel = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${startLabel} - ${endLabel}`
}

function getLabel(gameId: string, key: string): string {
    const manifest = getManifest(gameId);
    if (manifest?.statistics) {
        for (const stat of manifest.statistics) {
            if (typeof stat === 'object' && Object.keys(stat)[0] === key) {
                const value = Object.values(stat)[0] as any;
                if (typeof value === 'string') return value;
                if (value && typeof value === 'object' && value.label) return value.label;
            }
        }
    }

    const i18nKey = `statistics.${key}`;
    const label = t(i18nKey);
    if (label !== i18nKey) return label;

    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
</script>

<style scoped>
.session-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.session-modal-content {
  max-height: 80vh;
  overflow-y: auto;
  padding-right: 4px;
}

.session-game {
  font-weight: 600;
}

.session-side {
  text-align: right;
  flex-shrink: 0;
}

.session-meta {
  font-size: 12px;
  color: var(--bz-text-secondary);
  margin-top: 4px;
}
</style>
