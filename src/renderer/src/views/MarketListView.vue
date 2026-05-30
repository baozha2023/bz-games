<template>
  <div class="market-list-root">
    <n-space justify="space-between" align="center" style="margin-bottom: 20px;">
      <h1 style="margin: 0;">{{ t('marketList.title') }}</h1>
      <n-button :loading="isLoading" @click="loadSources(true)">
        {{ t('market.refresh') }}
      </n-button>
    </n-space>

    <n-alert v-if="loadError" type="error" style="margin-bottom: 16px;">
      <n-space justify="space-between" align="center" style="width: 100%;">
        <span>{{ loadError }}</span>
        <n-button quaternary size="small" @click="loadSources()">
          {{ t('market.retry') }}
        </n-button>
      </n-space>
    </n-alert>

    <n-space v-if="isLoading && sources.length === 0" vertical size="large">
      <n-skeleton v-for="index in 3" :key="index" text :repeat="2" />
    </n-space>

    <n-empty
      v-else-if="sources.length === 0"
      :description="t('marketList.empty')"
    />

    <div v-else class="source-grid">
      <div
        v-for="(source, index) in displayedSources"
        :key="source.marketId"
        class="source-card"
        @click="enterMarket(index)"
      >
        <CachedImg
          v-if="source.coverUrl"
          :src="source.coverUrl"
          class="source-cover"
        />
        <div v-else class="source-cover-placeholder">
          <n-icon size="48" color="var(--bz-text-secondary)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </n-icon>
        </div>
        <div class="source-info">
          <n-space align="center" :size="8">
            <strong class="source-name">{{ source.marketName }}</strong>
            <n-tag v-if="source.marketId === 'official'" size="small" type="info">
              {{ t('marketList.official') }}
            </n-tag>
            <n-tag v-if="source.marketId === 'github-release-market'" size="small" type="success">
              GitHub
            </n-tag>
            <n-tag v-if="source.featured" size="small" type="warning">
              {{ t('market.featured') }}
            </n-tag>
          </n-space>
          <n-text depth="3" class="source-time">{{ formatTime(source.generatedAt) }}</n-text>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { MarketSource } from "../../../shared/types";
import CachedImg from "../components/CachedImg.vue";

interface DisplaySource extends MarketSource {
  originalIndex: number;
}

const { t } = useI18n();
const router = useRouter();

const isLoading = ref(false);
const loadError = ref("");
const sources = ref<DisplaySource[]>([]);

const displayedSources = computed(() => {
  return [...sources.value].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.marketName.localeCompare(b.marketName, "zh-CN");
  });
});

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${min}`;
  } catch {
    return "";
  }
}

async function loadSources(forceRefresh = false): Promise<void> {
  isLoading.value = true;
  loadError.value = "";
  try {
    const directory = await window.electronAPI.market.getSources(forceRefresh);
    sources.value = directory.sources
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter((s) => s.visibility !== "hidden");
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    loadError.value = text;
  } finally {
    isLoading.value = false;
  }
}

function enterMarket(index: number): void {
  const source = displayedSources.value[index];
  router.push(`/market/${source.originalIndex}`);
}

onMounted(async () => {
  await loadSources();
});

</script>

<style scoped>
.market-list-root {
  padding: 24px;
}

.source-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.source-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
}

.source-card:hover {
  border-color: var(--bz-green);
  background: var(--bz-green-soft);
}

.source-cover {
  width: 100%;
  height: 160px;
  object-fit: cover;
  background: var(--bz-bg-panel);
}

.source-cover-placeholder {
  width: 100%;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bz-bg-panel);
}

.source-info {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-name {
  font-size: 16px;
}

.source-time {
  font-size: 12px;
}
</style>
