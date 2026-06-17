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
      <div class="heatmap-wrapper">
        <CalendarHeatmap
          v-if="hasLoadedHeatmap"
          :daily-durations="dailyDurations"
          :selected-date="selectedDate"
          @select-date="handleHeatmapDateSelect"
        />
        <div v-else class="heatmap-placeholder" />
        <div v-if="!hasLoadedHeatmap" class="heatmap-mask">
          <n-button type="primary" size="large" :loading="isLoadingHeatmap" @click="loadStatsData">
            {{ t('statistics.loadHeatmap') }}
          </n-button>
        </div>
      </div>
    </n-card>

    <n-empty v-if="statCards.length === 0" :description="t('statistics.empty')" style="margin-top: 24px;" />

    <n-list v-else style="margin-top: 16px; background: transparent;">
      <n-list-item v-for="(card, index) in statCards" :key="card.id" v-show="index < visibleCount" class="stagger-card-enter">
        <n-card :title="card.name" hoverable size="small">
          <template #header-extra>
            <n-select 
              size="small" 
              style="width: 120px;" 
              :value="selectedVersions[card.id]" 
              :options="card.versionOptions"
              @update:value="(v) => handleVersionChange(card.id, v)"
            />
          </template>
          
          <div v-if="card.stats.length > 0">
            <n-grid :cols="2" x-gap="12" y-gap="12">
               <n-grid-item v-for="stat in card.stats" :key="stat.key">
                 <n-statistic :label="stat.label" :value="stat.value" />
               </n-grid-item>
            </n-grid>
          </div>
          <n-empty v-else :description="t('statistics.noStats')" size="small" />

          <template #footer>
            <n-text depth="3" style="font-size: 12px;">
              {{ t('statistics.lastPlayed') }}: {{ card.lastPlayed }}
            </n-text>
          </template>
        </n-card>
      </n-list-item>
    </n-list>

    <n-modal
      v-model:show="showSessionModal"
      preset="card"
      style="width: min(760px, calc(100vw - 32px));"
      :title="t('statistics.dayRecordsTitle', { date: selectedDate })"
      :bordered="false"
    >
      <div class="session-modal-content">
        <div v-if="isLoadingSessions" class="session-loading">
          <n-spin size="large" />
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
import { ref, onMounted, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchOutline } from '@vicons/ionicons5'
import { useGameStore } from '../stores/useGameStore'
import CalendarHeatmap from '../components/CalendarHeatmap.vue'
import { useGameListView } from '../composables/useGameListView'

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

const isLoadingHeatmap = ref(false)
const hasLoadedHeatmap = ref(false)
const dailyDurations = ref<{ date: string; total_duration_ms: number }[]>([])
const selectedDate = ref('')
const showSessionModal = ref(false)
const isLoadingSessions = ref(false)
const selectedDateSessions = ref<PlaySession[]>([])

const games = computed(() => gameStore.games)
const {
  searchKeyword,
  isSearchExpanded,
  selectedVersions,
  visibleCount,
  filteredItems: filteredGames,
  toggleSearch,
  handleSearchBlur,
  activateStaggerRendering,
  initializeManifestCache,
  handleVersionChange,
  getManifest,
} = useGameListView(games)

async function loadStatsData() {
  if (isLoadingHeatmap.value || hasLoadedHeatmap.value) return
  isLoadingHeatmap.value = true
  await nextTick()
  try {
    const [durations] = await Promise.all([
      window.electronAPI.stats.getDailyPlayDurations(365),
      new Promise((resolve) => setTimeout(resolve, 180)),
    ])
    dailyDurations.value = durations
    hasLoadedHeatmap.value = true
  } catch (e) {
    console.error('[StatisticsView] Failed to load stats data:', e)
  } finally {
    isLoadingHeatmap.value = false
  }
}

async function handleHeatmapDateSelect(date: string) {
  selectedDate.value = date
  selectedDateSessions.value = []
  showSessionModal.value = true
  isLoadingSessions.value = true
  await nextTick()
  try {
    const [sessions] = await Promise.all([
      window.electronAPI.stats.getSessionsByDate(date),
      new Promise((resolve) => setTimeout(resolve, 180)),
    ])
    selectedDateSessions.value = sessions
  } catch (e) {
    console.error('[StatisticsView] Failed to load sessions by date:', e)
    selectedDateSessions.value = []
  } finally {
    isLoadingSessions.value = false
  }
}

onMounted(async () => {
  await gameStore.loadGames()
  initializeManifestCache(gameStore.games)
  activateStaggerRendering()
})

const statCards = computed(() => filteredGames.value.map((game) => {
  const keys = getStatKeys(game.id)
  return {
    id: game.id,
    name: game.name,
    versionOptions: buildVersionOptions(game.id),
    stats: keys.map((key) => ({
      key,
      label: getLabel(game.id, key),
      value: getValue(game.id, key),
    })),
    lastPlayed: getLastPlayed(game.id),
  }
}))

function buildVersionOptions(gameId: string) {
  const record = gameStore.getGameRecord(gameId);
  if (!record || !record.versions) return [];
  return record.versions
    .map(v => v.version)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
    .map(v => ({ label: v, value: v }));
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
.stagger-card-enter {
  animation: stagger-fade-in 0.3s ease-out both;
}

@keyframes stagger-fade-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.heatmap-wrapper {
  position: relative;
}

.heatmap-placeholder {
  min-height: 160px;
}

.heatmap-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(3px);
  z-index: 1;
}

.session-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.session-modal-content {
  max-height: 80vh;
  min-height: 160px;
  overflow-y: auto;
  padding-right: 4px;
}

.session-loading {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
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
