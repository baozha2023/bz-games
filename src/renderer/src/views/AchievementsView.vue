<template>
  <div class="career-section">
    <div v-if="achievementCards.length === 0" style="margin-top: 24px">
      <n-empty :description="t('achievement.noAchievements')" />
    </div>

    <n-list v-else style="margin-top: 0; background: transparent">
      <n-list-item
        v-for="(game, index) in achievementCards"
        :key="game.id"
        v-show="index < visibleCount"
        class="stagger-card-enter"
      >
        <n-thing>
          <template #avatar>
            <div
              class="game-icon-wrapper"
              style="
                width: 48px;
                height: 48px;
                overflow: hidden;
                border-radius: 4px;
                background: var(--bz-bg-card-placeholder);
              "
            >
              <GameIcon
                :game-id="game.id"
                :version="selectedVersions[game.id]"
                style="width: 100%; height: 100%; object-fit: cover"
              />
            </div>
          </template>
          <template #header>
            {{ game.name }}
          </template>
          <template #header-extra>
            <n-space align="center">
              <n-select
                v-model:value="selectedVersions[game.id]"
                :options="game.versionOptions"
                size="small"
                style="width: 120px"
                @update:value="(v) => handleVersionChange(game.id, v)"
              />

              <n-button
                text
                style="font-size: 20px"
                @click="toggleExpand(game.id)"
              >
                <n-icon>
                  <ChevronUp v-if="expandedGames[game.id]" />
                  <ChevronDown v-else />
                </n-icon>
              </n-button>
            </n-space>
          </template>
          <template #description>
            <div style="display: flex; align-items: center; gap: 12px">
              <n-progress
                type="line"
                :percentage="game.progress.percentage"
                :indicator-placement="'inside'"
                status="success"
                style="max-width: 300px"
              />
              <span style="font-size: 12px; color: var(--bz-text-secondary)">
                {{
                  t("achievement.progress", {
                    current: game.progress.current,
                    total: game.progress.total,
                  })
                }}
              </span>
            </div>
          </template>
        </n-thing>

        <n-collapse-transition :show="expandedGames[game.id]">
          <n-grid
            :cols="1"
            md="2"
            lg="4"
            x-gap="12"
            y-gap="12"
            style="margin-top: 16px"
          >
            <n-grid-item v-for="ach in game.achievements" :key="ach.id">
              <n-card
                size="small"
                :style="{
                  opacity: ach.unlocked ? 1 : 0.6,
                  borderColor: ach.unlocked ? '#f0a020' : undefined,
                }"
              >
                <div v-if="ach.isNew" class="new-dot"></div>
                <n-space align="center" :wrap="false" :size="24">
                  <AchievementIcon
                    :game-id="game.id"
                    :version="selectedVersions[game.id]"
                    :achievement-id="ach.id"
                    :has-custom-icon="!!ach.icon"
                    :locked="!ach.unlocked"
                    :size="48"
                  />
                  <div style="flex: 1; min-width: 0">
                    <div
                      style="
                        font-weight: bold;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                      "
                    >
                      {{ ach.title }}
                    </div>
                    <div
                      style="
                        font-size: 12px;
                        color: var(--bz-text-tertiary);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                      "
                      :title="ach.description"
                    >
                      {{ ach.description }}
                    </div>
                    <div
                      v-if="ach.unlocked"
                      style="font-size: 10px; color: var(--bz-amber)"
                    >
                      {{
                        t("achievement.unlockedAt", {
                          date: new Date(ach.unlockedAt!).toLocaleString(),
                        })
                      }}
                    </div>
                    <div
                      v-else
                      style="font-size: 10px; color: var(--bz-text-secondary)"
                    >
                      {{ t("achievement.locked") }}
                    </div>
                  </div>
                </n-space>
              </n-card>
            </n-grid-item>
            <n-grid-item v-if="game.achievements.length === 0">
              <n-empty :description="t('achievement.noAchievementsVersion')" />
            </n-grid-item>
          </n-grid>
        </n-collapse-transition>
      </n-list-item>
    </n-list>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, ChevronUp } from "@vicons/ionicons5";
import { useGameStore } from "../stores/useGameStore";
import GameIcon from "../components/game/GameIcon.vue";
import AchievementIcon from "../components/game/AchievementIcon.vue";
import { useGameListView } from "../composables/useGameListView";
import { compareGameVersionsDescending } from "../../../shared/game-manifest";

const { t } = useI18n();
const gameStore = useGameStore();
const searchKeyword = defineModel<string>("searchKeyword", { default: "" });

const expandedGames = ref<Record<string, boolean>>({});

const displayGames = computed(() => {
  return gameStore.games.map((g) => {
    const record = gameStore.getGameRecord(g.id);
    const versions = record?.versions
      .map((v) => v.version)
      .sort(compareGameVersionsDescending) || [g.version];

    return {
      id: g.id,
      name: g.name,
      latestVersion: g.version,
      versions,
    };
  });
});

const {
  selectedVersions,
  visibleCount,
  filteredItems: filteredDisplayGames,
  activateStaggerRendering,
  initializeManifestCache,
  refreshManifestCache,
  handleVersionChange,
  getManifest,
} = useGameListView(displayGames, searchKeyword);

onMounted(async () => {
  await gameStore.loadGames();
  initializeManifestCache(gameStore.games, (gameId) => {
    if (expandedGames.value[gameId] === undefined) {
      expandedGames.value[gameId] = false;
    }
  });
  activateStaggerRendering();
});

watch(
  () => gameStore.games,
  (manifests) => void refreshManifestCache(manifests),
);

onUnmounted(() => {
  gameStore.markAchievementsAsSeen();
});

const achievementCards = computed(() =>
  filteredDisplayGames.value.map((game) => {
    const achievements = getGameAchievements(game.id);
    const total = achievements.length;
    const current = achievements.filter((a) => a.unlocked).length;
    return {
      ...game,
      versionOptions: game.versions.map((v) => ({ label: v, value: v })),
      achievements,
      progress: {
        total,
        current,
        percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      },
    };
  }),
);

function toggleExpand(gameId: string) {
  expandedGames.value[gameId] = !expandedGames.value[gameId];
}

function getGameAchievements(gameId: string) {
  const version = selectedVersions.value[gameId];
  if (!version) return [];

  const manifest = getManifest(gameId, version);
  if (!manifest || !manifest.achievements) return [];

  const unlocked = gameStore.getUnlockedAchievements(gameId, version);

  const mapped = manifest.achievements.map((a) => {
    const u = unlocked.find((ua) => ua.id === a.id);
    const isNew = gameStore.newAchievements.has(`${gameId}@${version}@${a.id}`);
    return {
      ...a,
      unlocked: !!u,
      unlockedAt: u?.unlockedAt,
      isNew,
    };
  });

  mapped.sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0));
  return mapped;
}
</script>

<style scoped>
.career-section {
  padding-top: 0;
}

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

.new-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  background-color: var(--bz-red);
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(208, 48, 80, 0.4);
}
</style>
