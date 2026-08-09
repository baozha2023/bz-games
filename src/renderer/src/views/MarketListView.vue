<template>
  <div class="market-list-root">
    <n-space justify="space-between" align="center" style="margin-bottom: 20px">
      <h1 style="margin: 0">{{ t("marketList.title") }}</h1>
      <n-space align="center" :size="8">
        <n-input
          v-if="isSearchExpanded"
          v-model:value="keyword"
          clearable
          autofocus
          :placeholder="t('marketList.searchPlaceholder')"
          style="width: 240px"
          @blur="handleSearchBlur"
        />
        <n-button quaternary circle @click="toggleSearch">
          <template #icon>
            <n-icon><SearchOutline /></n-icon>
          </template>
        </n-button>
        <n-button @click="openGameHosting">
          {{ t("marketList.gameHosting") }}
        </n-button>
        <n-button :loading="isLoading" @click="loadSources(true)">
          {{ t("market.refresh") }}
        </n-button>
      </n-space>
    </n-space>

    <n-alert v-if="loadError" type="error" style="margin-bottom: 16px">
      <n-space justify="space-between" align="center" style="width: 100%">
        <span>{{ loadError }}</span>
        <n-button quaternary size="small" @click="loadSources()">
          {{ t("market.retry") }}
        </n-button>
      </n-space>
    </n-alert>

    <n-space v-if="isLoading && sources.length === 0" vertical size="large">
      <n-grid
        :cols="'2 s:3 m:4 l:5 xl:6'"
        :x-gap="24"
        :y-gap="24"
        responsive="screen"
      >
        <n-grid-item v-for="index in 6" :key="index">
          <n-card size="small" embedded>
            <n-skeleton height="140px" />
            <n-skeleton text style="margin-top: 12px" />
            <n-skeleton text :width="120" />
          </n-card>
        </n-grid-item>
      </n-grid>
    </n-space>

    <n-empty
      v-else-if="sources.length === 0"
      :description="t('marketList.empty')"
    />
    <n-empty
      v-else-if="displayedSources.length === 0"
      :description="t('marketList.empty')"
    />

    <n-grid
      v-else
      :cols="'2 s:3 m:4 l:5 xl:6'"
      :x-gap="24"
      :y-gap="24"
      responsive="screen"
    >
      <n-grid-item
        v-for="source in displayedSources"
        :key="source.marketId"
        @click="enterMarket(source.originalIndex)"
      >
        <div class="source-card-shell">
          <n-card hoverable size="small" embedded content-style="padding: 0;">
            <template #cover>
              <div
                style="
                  aspect-ratio: 16/9;
                  width: 100%;
                  background: var(--bz-bg-card-placeholder);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  overflow: hidden;
                "
              >
                <CachedImg
                  v-if="source.coverUrl"
                  :src="source.coverUrl"
                  style="width: 100%; height: 100%; object-fit: cover"
                />
                <n-icon v-else size="48" color="var(--bz-text-secondary)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                    />
                  </svg>
                </n-icon>
              </div>
            </template>
            <div style="padding: 12px">
              <n-space align="center" :size="4" wrap>
                <n-ellipsis
                  style="max-width: 100%; font-weight: bold; font-size: 16px"
                >
                  {{ source.marketName }}
                </n-ellipsis>
                <n-tag
                  v-if="source.marketId === 'official'"
                  size="small"
                  type="info"
                >
                  {{ t("marketList.official") }}
                </n-tag>
                <n-tag
                  v-if="source.marketId === 'github-release-market'"
                  size="small"
                  type="success"
                >
                  GitHub
                </n-tag>
                <n-tag v-if="source.featured" size="small" type="warning">
                  {{ t("market.featured") }}
                </n-tag>
              </n-space>
              <n-text depth="3" style="font-size: 12px">{{
                formatTime(source.generatedAt)
              }}</n-text>
            </div>
          </n-card>
        </div>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { SearchOutline } from "@vicons/ionicons5";
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
const keyword = ref("");
const isSearchExpanded = ref(false);

async function openGameHosting() {
  try {
    const opened = await window.electronAPI.market.openGameHosting();
    if (!opened) loadError.value = t("marketList.gameHostingOpenFailed");
  } catch {
    loadError.value = t("marketList.gameHostingOpenFailed");
  }
}

const displayedSources = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  const sorted = [...sources.value].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.marketName.localeCompare(b.marketName, "zh-CN");
  });
  if (!text) return sorted;
  return sorted.filter((source) => {
    return (
      source.marketName.toLowerCase().includes(text) ||
      source.marketId.toLowerCase().includes(text)
    );
  });
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

function toggleSearch(): void {
  isSearchExpanded.value = true;
}

function handleSearchBlur(): void {
  if (!keyword.value.trim()) {
    isSearchExpanded.value = false;
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

function enterMarket(sourceIndex: number): void {
  router.push(`/market/${sourceIndex}`);
}

onMounted(async () => {
  await loadSources();
});
</script>

<style scoped>
.market-list-root {
  padding: 24px;
}

.source-card-shell {
  position: relative;
  min-width: 0;
  border-radius: 12px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.source-card-shell:hover {
  transform: translateY(-3px);
}

.source-card-shell :deep(.n-card) {
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  overflow: hidden;
}
</style>
