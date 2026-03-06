<template>
  <div style="padding: 24px;">
    <n-page-header :title="t('achievement.title')" @back="$router.push({ name: 'Library' })">
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
    
    <div v-if="filteredDisplayGames.length === 0" style="margin-top: 24px;">
       <n-empty :description="t('achievement.noAchievements')" />
    </div>

    <n-list v-else style="margin-top: 24px; background: transparent;">
      <n-list-item v-for="game in filteredDisplayGames" :key="game.id" :class="{ 'golden-card': getGameProgress(game.id).percentage === 100 }">
        <n-thing>
            <template #avatar>
                 <div class="game-icon-wrapper" style="width: 48px; height: 48px; overflow: hidden; border-radius: 4px; background: #333;">
                    <GameIcon :game-id="game.id" :game-name="game.name" :version="selectedVersions[game.id]" style="width: 100%; height: 100%; object-fit: cover;" />
                 </div>
            </template>
            <template #header>
                {{ game.name }}
            </template>
            <template #header-extra>
                <n-space align="center">
                    <n-select 
                        v-model:value="selectedVersions[game.id]" 
                        :options="game.versions.map(v => ({ label: v, value: v }))" 
                        size="small" 
                        style="width: 120px;"
                        @update:value="(v) => handleVersionChange(game.id, v)"
                    />

                    <n-button text style="font-size: 20px;" @click="toggleExpand(game.id)">
                        <n-icon>
                            <ChevronUp v-if="expandedGames[game.id]" />
                            <ChevronDown v-else />
                        </n-icon>
                    </n-button>
                </n-space>
            </template>
            <template #description>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <n-progress 
                        type="line" 
                        :percentage="getGameProgress(game.id).percentage" 
                        :indicator-placement="'inside'" 
                        status="success"
                        style="max-width: 300px;"
                    />
                    <span style="font-size: 12px; color: #666;">
                        {{ t('achievement.progress', { current: getGameProgress(game.id).current, total: getGameProgress(game.id).total }) }}
                    </span>
                </div>
            </template>
        </n-thing>
        
        <n-collapse-transition :show="expandedGames[game.id]">
            <n-grid :cols="1" md="2" lg="4" x-gap="12" y-gap="12" style="margin-top: 16px;">
                <n-grid-item v-for="ach in getGameAchievements(game.id)" :key="ach.id">
                    <n-card size="small" :style="{ opacity: ach.unlocked ? 1 : 0.6, borderColor: ach.unlocked ? '#f0a020' : undefined }">
                        <div v-if="ach.isNew" class="new-dot"></div>
                        <n-space align="center" :wrap="false" :size="24">
                            <div style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <n-icon size="48" :color="ach.unlocked ? '#f0a020' : '#666'">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M20.2 2H3.8C2.8 2 2 2.8 2 3.8v4.4c0 1 .8 1.8 1.8 1.8h.4c.5 2.8 3 4.9 6 5v.5c0 .8.7 1.5 1.5 1.5h.6v2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h7.4c1.1 0 2-.9 2-2s-.9-2-2-2h-2v-2h.6c.8 0 1.5-.7 1.5-1.5v-.5c3-.1 5.5-2.2 6-5h.4c1 0 1.8-.8 1.8-1.8V3.8C22 2.8 21.2 2 20.2 2M5.8 8h-2V4h2zm14.4 0h-2V4h2z"/></svg>
                                </n-icon>
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ ach.title }}</div>
                                <div style="font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" :title="ach.description">{{ ach.description }}</div>
                                <div v-if="ach.unlocked" style="font-size: 10px; color: #f0a020;">
                                    {{ t('achievement.unlockedAt', { date: new Date(ach.unlockedAt!).toLocaleString() }) }}
                                </div>
                                <div v-else style="font-size: 10px; color: #666;">{{ t('achievement.locked') }}</div>
                            </div>
                        </n-space>
                    </n-card>
                </n-grid-item>
                <n-grid-item v-if="getGameAchievements(game.id).length === 0">
                    <n-empty :description="t('achievement.noAchievementsVersion')" />
                </n-grid-item>
            </n-grid>
        </n-collapse-transition>
      </n-list-item>
    </n-list>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronUp, SearchOutline } from '@vicons/ionicons5';
import { useGameStore } from '../stores/useGameStore';
import GameIcon from '../components/game/GameIcon.vue';
import type { GameManifest } from '../../../shared/game-manifest';

const { t } = useI18n();
const gameStore = useGameStore();

const expandedGames = ref<Record<string, boolean>>({});
const selectedVersions = ref<Record<string, string>>({});
const manifestCache = ref<Record<string, GameManifest>>({}); // Key: gameId@version
const searchKeyword = ref('');
const isSearchExpanded = ref(false);

onMounted(async () => {
    await gameStore.loadGames();
    
    // Initialize state
    gameStore.games.forEach(g => {
        const latest = g.version;
        
        selectedVersions.value[g.id] = latest;
        expandedGames.value[g.id] = false;
        
        // Cache initial manifest
        manifestCache.value[`${g.id}@${latest}`] = g;
    });
});

onUnmounted(() => {
    gameStore.markAchievementsAsSeen();
});

const displayGames = computed(() => {
    return gameStore.games
        .map(g => {
            const record = gameStore.getGameRecord(g.id);
            const versions = record?.versions.map(v => v.version).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) || [g.version];
            
            return {
                id: g.id,
                name: g.name,
                latestVersion: g.version,
                versions
            };
        });
});

const filteredDisplayGames = computed(() => {
    const keyword = searchKeyword.value.trim().toLowerCase();
    if (!keyword) return displayGames.value;
    return displayGames.value.filter((game) => {
        return game.name.toLowerCase().includes(keyword) || game.id.toLowerCase().includes(keyword);
    });
});

function toggleSearch() {
    isSearchExpanded.value = true;
}

function handleSearchBlur() {
    if (!searchKeyword.value.trim()) {
        isSearchExpanded.value = false;
    }
}

function getManifest(gameId: string, version?: string): GameManifest | undefined {
    if (!version) return undefined;
    return manifestCache.value[`${gameId}@${version}`];
}

async function handleVersionChange(gameId: string, version: string) {
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

function toggleExpand(gameId: string) {
    expandedGames.value[gameId] = !expandedGames.value[gameId];
}

function getGameAchievements(gameId: string) {
    const version = selectedVersions.value[gameId];
    if (!version) return [];
    
    const manifest = getManifest(gameId, version);
    if (!manifest || !manifest.achievements) return [];
    
    const unlocked = gameStore.getUnlockedAchievements(gameId, version);
    
    const mapped = manifest.achievements.map(a => {
        const u = unlocked.find(ua => ua.id === a.id);
        const isNew = gameStore.newAchievements.has(`${gameId}@${version}@${a.id}`);
        return {
            ...a,
            unlocked: !!u,
            unlockedAt: u?.unlockedAt,
            isNew
        };
    });
    
    // Sort: Unlocked first
    mapped.sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0));
    return mapped;
}

function getGameProgress(gameId: string) {
    const achs = getGameAchievements(gameId);
    const total = achs.length;
    const current = achs.filter(a => a.unlocked).length;
    return {
        total,
        current,
        percentage: total > 0 ? Math.round((current / total) * 100) : 0
    };
}
</script>

<style scoped>
.golden-card {
    position: relative;
    border: 1px solid #ffd700;
    box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
    transition: all 0.3s ease;
    border-radius: 4px;
    animation: golden-burn 2s ease-in-out infinite alternate;
}

.golden-card :deep(.n-thing) {
    z-index: 1;
    position: relative;
}

.golden-card .game-icon-wrapper {
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.6);
    border: 1px solid rgba(255, 215, 0, 0.5);
}

@keyframes golden-burn {
    0% {
        box-shadow: 
            0 0 5px #ffd700,
            0 0 10px rgba(255, 215, 0, 0.5),
            inset 0 0 5px rgba(255, 215, 0, 0.2);
        border-color: #ffd700;
    }
    100% {
        box-shadow: 
            0 0 15px #ffd700,
            0 0 25px rgba(255, 140, 0, 0.6),
            inset 0 0 10px rgba(255, 215, 0, 0.4);
        border-color: #ffaa00;
    }
}

.new-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    background-color: #d03050;
    border-radius: 50%;
    box-shadow: 0 0 4px rgba(208, 48, 80, 0.4);
}
</style>
