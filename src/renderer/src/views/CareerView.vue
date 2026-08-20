<template>
  <div class="career-page">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <template #suffix>
        <div class="career-search">
          <n-input
            v-if="isSearchExpanded"
            v-model:value="currentSearchKeyword"
            clearable
            autofocus
            :placeholder="t('common.searchGame')"
            @blur="handleSearchBlur"
            @keydown.esc="closeSearch"
          />
          <n-button
            quaternary
            circle
            :aria-label="t('common.searchGame')"
            :title="t('common.searchGame')"
            @click="isSearchExpanded = true"
          >
            <template #icon>
              <n-icon>
                <SearchOutline />
              </n-icon>
            </template>
          </n-button>
        </div>
      </template>

      <n-tab-pane name="statistics" :tab="t('statistics.title')">
        <StatisticsView
          v-if="activeTab === 'statistics'"
          v-model:search-keyword="statisticsSearchKeyword"
        />
      </n-tab-pane>

      <n-tab-pane name="achievements">
        <template #tab>
          <span class="career-tab-label">
            {{ t("achievement.title") }}
            <span v-if="hasNewAchievements" class="career-tab-dot"></span>
          </span>
        </template>
        <AchievementsView
          v-if="activeTab === 'achievements'"
          v-model:search-keyword="achievementsSearchKeyword"
        />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { SearchOutline } from "@vicons/ionicons5";
import { useGameStore } from "../stores/useGameStore";
import StatisticsView from "./StatisticsView.vue";
import AchievementsView from "./AchievementsView.vue";

const { t } = useI18n();
const gameStore = useGameStore();
const activeTab = ref<"statistics" | "achievements">("statistics");
const statisticsSearchKeyword = ref("");
const achievementsSearchKeyword = ref("");
const isSearchExpanded = ref(false);
const hasNewAchievements = computed(() => gameStore.newAchievements.size > 0);

const currentSearchKeyword = computed({
  get: () =>
    activeTab.value === "statistics"
      ? statisticsSearchKeyword.value
      : achievementsSearchKeyword.value,
  set: (value: string) => {
    if (activeTab.value === "statistics") {
      statisticsSearchKeyword.value = value;
    } else {
      achievementsSearchKeyword.value = value;
    }
  },
});

watch(activeTab, () => {
  if (currentSearchKeyword.value.trim()) {
    isSearchExpanded.value = true;
  }
});

function handleSearchBlur() {
  if (!currentSearchKeyword.value.trim()) {
    isSearchExpanded.value = false;
  }
}

function closeSearch() {
  currentSearchKeyword.value = "";
  isSearchExpanded.value = false;
}
</script>

<style scoped>
.career-page {
  padding: 24px;
}

.career-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.career-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.career-search :deep(.n-input) {
  width: min(260px, 32vw);
}

.career-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--bz-red);
  box-shadow: 0 0 4px rgba(208, 48, 80, 0.4);
}
</style>
