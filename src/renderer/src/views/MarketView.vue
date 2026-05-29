<template>
  <div class="market-root">
    <n-space justify="space-between" align="center" style="margin-bottom: 20px;">
      <div>
        <n-space size="small" align="center">
          <n-button text @click="$router.push('/markets')">
            <template #icon>
              <n-icon><ChevronBack /></n-icon>
            </template>
          </n-button>
          <h1 style="margin: 0;">{{ marketName || t("market.title") }}</h1>
          <n-text v-if="createdAtLabel" depth="3" style="font-size: 14px;">
            {{ createdAtLabel }}
          </n-text>
        </n-space>
        <n-text depth="3">
          {{ t("market.installPath", { path: installPathLabel }) }}
        </n-text>
      </div>
      <n-space align="center" :size="8">
        <n-input
          v-if="isSearchExpanded"
          v-model:value="keyword"
          clearable
          autofocus
          :placeholder="t('market.searchPlaceholder')"
          style="width: 260px;"
          @blur="handleSearchBlur"
        />
        <n-button quaternary circle @click="toggleSearch">
          <template #icon>
            <n-icon><SearchOutline /></n-icon>
          </template>
        </n-button>
        <n-button :loading="isLoading" @click="loadIndex(true)">
          {{ t("market.refreshGames") }}
        </n-button>
      </n-space>
    </n-space>

    <n-alert v-if="loadError" type="error" style="margin-bottom: 16px;">
      <n-space justify="space-between" align="center" style="width: 100%;">
        <span>{{ loadError }}</span>
        <n-button quaternary size="small" @click="loadIndex(true)">
          {{ t("market.retry") }}
        </n-button>
      </n-space>
    </n-alert>

    <n-space v-if="isLoading && filteredGames.length === 0" vertical size="large">
      <n-skeleton v-for="index in 5" :key="index" text :repeat="2" />
    </n-space>
    <n-empty
      v-else-if="filteredGames.length === 0"
      :description="t('market.empty')"
    />
    <div v-else class="market-game-list">
        <div
          v-for="game in filteredGames"
          :key="game.id"
          class="market-game-entry"
        >
          <div
            class="market-game-item"
            :class="{ active: expandedGames[game.id] }"
            @click="toggleExpand(game.id)"
          >
            <CachedImg
              v-if="game.iconUrl || game.coverUrl"
              :key="`thumb-${game.id}-${refreshCounter}`"
              :src="(game.iconUrl || game.coverUrl)!"
              class="market-thumb"
            />
            <div v-else class="market-thumb market-thumb-placeholder">
              {{ t("market.noImage") }}
            </div>
            <div class="market-game-text">
              <n-space justify="space-between" align="center">
                <n-space align="center" :size="8">
                  <strong>{{ game.name }}</strong>
                  <n-tag v-if="game.featured" size="small" type="warning">
                    {{ t("market.featured") }}
                  </n-tag>
                </n-space>
                <n-button text style="font-size: 20px;" @click.stop="toggleExpand(game.id)">
                  <n-icon>
                    <ChevronUp v-if="expandedGames[game.id]" />
                    <ChevronDown v-else />
                  </n-icon>
                </n-button>
              </n-space>
              <n-text depth="3">{{ game.author }}</n-text>
              <n-text depth="3" class="market-summary">{{ game.summary }}</n-text>
              <n-space size="small" wrap>
                <n-tag size="small" :bordered="false">{{ typeLabel(game.type) }}</n-tag>
                <n-tag
                  v-for="tag in game.tags || []"
                  :key="tag"
                  size="small"
                  :bordered="false"
                  type="success"
                >
                  {{ tag }}
                </n-tag>
              </n-space>
            </div>
          </div>

          <n-collapse-transition :show="expandedGames[game.id]">
            <n-card
              size="small"
              embedded
              class="market-inline-detail"
            >
              <n-space vertical size="large">
                <div class="market-detail-header">
                  <CachedImg
                    v-if="game.coverUrl || game.iconUrl"
                    :key="`cover-${game.id}-${refreshCounter}`"
                    :src="(game.coverUrl || game.iconUrl)!"
                    class="market-cover"
                  />
                  <div v-else class="market-cover market-cover-placeholder">
                    {{ t("market.noImage") }}
                  </div>
                  <div class="market-detail-meta">
                    <n-space align="center" wrap>
                      <n-tag :bordered="false">{{ typeLabel(game.type) }}</n-tag>
                      <n-tag v-if="game.featured" type="warning" :bordered="false">
                        {{ t("market.featured") }}
                      </n-tag>
                      <n-tag
                        v-if="game.visibility === 'deprecated'"
                        type="error"
                        :bordered="false"
                      >
                        {{ t("market.deprecated") }}
                      </n-tag>
                    </n-space>
                    <n-space align="center" :size="4">
                      <n-text depth="3">{{ t("market.author", { author: game.author }) }}</n-text>
                      <n-button v-if="game.author_url" text size="tiny" @click.stop="handleOpenAuthorUrl(game.author_url!)" style="font-size: 16px;">
                        <n-icon><OpenOutline /></n-icon>
                      </n-button>
                    </n-space>
                    <n-text>{{ game.summary }}</n-text>
                    <n-space size="small" wrap>
                      <n-tag
                        v-for="tag in game.tags || []"
                        :key="tag"
                        size="small"
                        type="success"
                        :bordered="false"
                      >
                        {{ tag }}
                      </n-tag>
                    </n-space>
                  </div>
                </div>

                <n-card
                  v-if="getSelectedVersionInfo(game)"
                  size="small"
                  embedded
                  class="market-selected-version-card"
                >
                  <n-space vertical size="small">
                    <strong>{{ t("market.selectedVersion", { version: getSelectedVersionInfo(game)?.version }) }}</strong>
                    <n-text>{{ getSelectedVersionInfo(game)?.releaseNotes || getSelectedVersionInfo(game)?.description }}</n-text>
                    <n-space size="small" wrap>
                      <n-tag
                        v-if="game.latestVersion === getSelectedVersionInfo(game)?.version"
                        size="small"
                        type="success"
                        :bordered="false"
                      >
                        {{ t("market.latest") }}
                      </n-tag>
                      <n-tag
                        v-if="getSelectedVersionInfo(game)?.isPrerelease"
                        size="small"
                        type="warning"
                        :bordered="false"
                      >
                        {{ t("market.prerelease") }}
                      </n-tag>
                      <n-tag
                        v-if="getSelectedVersionInfo(game) && !isVersionPayloadValid(getSelectedVersionInfo(game)!)"
                        size="small"
                        type="error"
                        :bordered="false"
                      >
                        {{ t("market.versionInvalid") }}
                      </n-tag>
                      <n-tag
                        v-if="getSelectedVersionInfo(game) && isInstalled(game.id, getSelectedVersionInfo(game)!.version, game.type)"
                        size="small"
                        type="info"
                        :bordered="false"
                      >
                        {{ t("market.installed") }}
                      </n-tag>
                    </n-space>
                    <n-text depth="3">
                      {{ t("market.platformVersion", { version: getSelectedVersionInfo(game)?.platformVersion }) }}
                    </n-text>
                    <n-text depth="3">
                      <n-space align="center" :size="4">
                        <template v-if="getSelectedVersionInfo(game) && isAssetLoading(getSelectedVersionInfo(game)!)">
                          <n-skeleton text :repeat="1" width="120px" />
                        </template>
                        <template v-else>
                          <span>{{ t("market.packageSize", { size: formatSize(getSelectedVersionInfo(game)) }) }}</span>
                        </template>
                        <n-button
                          v-if="getSelectedVersionInfo(game) && isAssetRefreshable(getSelectedVersionInfo(game)!)"
                          text
                          size="tiny"
                          :disabled="isAssetLoading(getSelectedVersionInfo(game)!)"
                          @click.stop="handleRefreshAsset(getSelectedVersionInfo(game)!.downloadUrl)"
                        >
                          <template #icon>
                            <n-icon><RefreshOutline /></n-icon>
                          </template>
                        </n-button>
                      </n-space>
                    </n-text>
                    <template v-if="getCurrentTask(game)">
                      <n-tag :type="taskTagType(getCurrentTask(game)!.status)" :bordered="false">
                        {{ taskStatusLabel(getCurrentTask(game)!.status) }}
                      </n-tag>
                      <n-progress
                        type="line"
                        :percentage="getCurrentTask(game)!.progress"
                        :indicator-placement="'inside'"
                      />
                      <n-text depth="3">
                        {{ errorMessage(getCurrentTask(game)!) || "" }}
                      </n-text>
                    </template>
                    <n-space>
                      <n-button
                        v-if="getSelectedVersionInfo(game)"
                        type="primary"
                        :disabled="isInstalled(game.id, getSelectedVersionInfo(game)!.version, game.type) || isPlatformIncompatible(game) || isSelectedVersionInvalid(game) || isTaskActive(game)"
                        :loading="isTaskActive(game) && getCurrentTask(game)?.status !== 'paused' && getCurrentTask(game)?.status !== 'interrupted'"
                        @click="handleDownload(game.id, getSelectedVersionInfo(game)!.version)"
                      >
                        <template v-if="isTaskActive(game) && (getCurrentTask(game)?.status === 'paused' || getCurrentTask(game)?.status === 'interrupted')">
                          {{ t("market.taskStatus.paused") }}
                        </template>
                        <template v-else-if="isInstalled(game.id, getSelectedVersionInfo(game)!.version, game.type)">
                          {{ t("market.installed") }}
                        </template>
                        <template v-else-if="isPlatformIncompatible(game)">
                          {{ t("market.platformIncompatible") }}
                        </template>
                        <template v-else>
                          {{ t("market.downloadInstall") }}
                        </template>
                      </n-button>
                      <n-button
                        v-if="isTaskActive(game) && getCurrentTask(game) && canPause(getCurrentTask(game)!)"
                        secondary
                        @click="handlePause(getCurrentTask(game)!.taskId)"
                      >
                        {{ t("market.pauseTask") }}
                      </n-button>
                      <n-tooltip v-if="isTaskActive(game) && getCurrentTask(game) && isNonPausableRunning(getCurrentTask(game)!)" trigger="hover">
                        <template #trigger>
                          <n-button secondary disabled>
                            <n-icon><CloseOutline /></n-icon>
                            {{ t("market.pauseTask") }}
                          </n-button>
                        </template>
                        {{ t("market.cannotPauseExtracting") }}
                      </n-tooltip>
                      <n-button
                        v-if="getCurrentTask(game) && (getCurrentTask(game)!.status === 'paused' || getCurrentTask(game)!.status === 'interrupted')"
                        secondary
                        type="warning"
                        @click="handleResume(getCurrentTask(game)!.taskId)"
                      >
                        {{ t("market.resumeTask") }}
                      </n-button>
                      <n-button
                        v-if="isTaskCancelable(game) && getCurrentTask(game)"
                        secondary
                        @click="handleCancel(getCurrentTask(game)!.taskId)"
                      >
                        {{ t("market.cancelTask") }}
                      </n-button>
                    </n-space>
                  </n-space>
                </n-card>

                <n-space vertical size="small">
                  <strong>{{ t("market.versions") }}</strong>
                  <n-radio-group v-model:value="selectedVersions[game.id]">
                    <n-space vertical size="small" style="width: 100%;">
                      <div
                        v-for="version in game.versions"
                        :key="version.version"
                        class="market-version-item"
                      >
                        <n-space justify="space-between" align="start" style="width: 100%;">
                          <div style="flex: 1;">
                            <n-radio :value="version.version">
                              {{ version.version }}
                            </n-radio>
                            <n-space size="small" wrap style="margin-top: 8px;">
                              <n-tag
                                v-if="game.latestVersion === version.version"
                                size="small"
                                type="success"
                                :bordered="false"
                              >
                                {{ t("market.latest") }}
                              </n-tag>
                              <n-tag
                                v-if="version.isPrerelease"
                                size="small"
                                type="warning"
                                :bordered="false"
                              >
                                {{ t("market.prerelease") }}
                              </n-tag>
                              <n-tag
                                v-if="isInstalled(game.id, version.version, game.type)"
                                size="small"
                                type="info"
                                :bordered="false"
                              >
                                {{ t("market.installed") }}
                              </n-tag>
                              <n-tag
                                v-if="!isVersionPayloadValid(version)"
                                size="small"
                                type="error"
                                :bordered="false"
                              >
                                {{ t("market.versionInvalid") }}
                              </n-tag>
                            </n-space>
                            <div class="market-version-desc">{{ version.description }}</div>
                            <n-text depth="3">
                              {{ t("market.platformVersion", { version: version.platformVersion }) }}
                            </n-text>
                            <br />
                            <n-text depth="3">
                              <n-space align="center" :size="4">
                                <template v-if="isAssetLoading(version)">
                                  <n-skeleton text :repeat="1" width="100px" />
                                </template>
                                <template v-else>
                                  <span>{{ t("market.packageSize", { size: formatSize(version) }) }}</span>
                                </template>
                                <n-button
                                  v-if="isAssetRefreshable(version)"
                                  text
                                  size="tiny"
                                  :disabled="isAssetLoading(version)"
                                  @click.stop="handleRefreshAsset(version.downloadUrl)"
                                >
                                  <template #icon>
                                    <n-icon><RefreshOutline /></n-icon>
                                  </template>
                                </n-button>
                              </n-space>
                            </n-text>
                          </div>
                        </n-space>
                      </div>
                    </n-space>
                  </n-radio-group>
                </n-space>
              </n-space>
            </n-card>
          </n-collapse-transition>
        </div>
      </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useDialog, useMessage } from "naive-ui";
import { ChevronBack, ChevronDown, ChevronUp, CloseOutline, OpenOutline, RefreshOutline, SearchOutline } from "@vicons/ionicons5";
import semver from "semver";
import type {
  MarketGame,
  MarketGameVersion,
  MarketTaskState,
  MarketTaskStatus,
} from "../../../shared/types";
import { isVersionPayloadValid } from "../../../shared/types";
import { isGitHubReleaseUrl } from "../../../shared/types";
import { useSettingsStore } from "../stores/useSettingsStore";
import CachedImg from "../components/CachedImg.vue";
import { useImageCache } from "../composables/useImageCache";
import { useGameStore } from "../stores/useGameStore";

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const gameStore = useGameStore();

const sourceIdx = computed(() => {
  const idx = Number(route.params.sourceIdx);
  return Number.isFinite(idx) ? idx : 0;
});

const isLoading = ref(false);
const loadError = ref("");
const keyword = ref("");
const isSearchExpanded = ref(false);
const games = ref<MarketGame[]>([]);
const taskStates = ref<Record<string, MarketTaskState>>({});
const expandedGames = ref<Record<string, boolean>>({});
const selectedVersions = ref<Record<string, string>>({});
const appVersion = ref("");
const marketName = ref("");
const generatedAt = ref("");
const refreshCounter = ref(0);
const resolvedAssets = ref<Record<string, { sha256?: string; size?: number }>>({});
const loadingAssetUrls = ref(new Set<string>());
const timeoutIds: number[] = [];
const pendingDownloads = new Set<string>();
const pendingCancels = new Set<string>();
const pendingPauses = new Set<string>();
const pendingResumes = new Set<string>();

const TYPE_LABEL_KEYS: Record<MarketGame["type"], string> = {
  singleplayer: "gameDetail.typeSingleplayer",
  multiplayer: "gameDetail.typeMultiplayer",
  singlemultiple: "gameDetail.typeSingleMultiple",
  networkgame: "gameDetail.typeNetworkGame",
};

const ERROR_CODE_KEYS: Record<string, string> = {
  download: "market.downloadError",
  verify: "market.verifyError",
  extract: "market.extractError",
  install: "market.installError",
  manifest: "market.manifestMissing",
};

let cleanupMarketEvent: (() => void) | undefined;

const filteredGames = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  const sorted = [...games.value].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
  if (!text) return sorted;
  return sorted.filter((game) => {
    return (
      game.name.toLowerCase().includes(text) ||
      game.id.toLowerCase().includes(text) ||
      game.author.toLowerCase().includes(text) ||
      (game.tags || []).some((tag) => tag.toLowerCase().includes(text))
    );
  });
});

const installPathLabel = computed(() => {
  return settingsStore.settings?.gameStoragePath || "games/";
});

const createdAtLabel = computed(() => {
  if (!generatedAt.value) return "";
  try {
    const date = new Date(generatedAt.value);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return t("market.createdAt", { time: `${y}-${m}-${d} ${h}:${min}` });
  } catch {
    return "";
  }
});

function taskKey(gameId: string, version: string): string {
  return `${gameId}@${version}`;
}

function toggleExpand(gameId: string): void {
  const wasExpanded = expandedGames.value[gameId];
  expandedGames.value[gameId] = !expandedGames.value[gameId];
  if (!wasExpanded && !expandedGames.value[gameId]) return;
  if (wasExpanded) return;
  resolveMissingAssetInfo(gameId);
}

function resolveMissingAssetInfo(gameId: string): void {
  const game = games.value.find((g) => g.id === gameId);
  if (!game) return;
  for (const version of game.versions) {
    if ((!version.sha256 || version.size == null) && isGitHubReleaseUrl(version.downloadUrl)) {
      loadAssetInfo(version.downloadUrl);
    }
  }
}

async function loadAssetInfo(downloadUrl: string, force?: boolean): Promise<void> {
  if (force) {
    const next = { ...resolvedAssets.value };
    delete next[downloadUrl];
    resolvedAssets.value = next;
  }
  if ((resolvedAssets.value[downloadUrl] && resolvedAssets.value[downloadUrl]!.size != null)
    || loadingAssetUrls.value.has(downloadUrl)) return;
  loadingAssetUrls.value = new Set(loadingAssetUrls.value).add(downloadUrl);
  try {
    const info = await window.electronAPI.market.resolveAssetInfo(downloadUrl);
    if (info.sha256 || info.size != null) {
      resolvedAssets.value = { ...resolvedAssets.value, [downloadUrl]: info };
    }
  } finally {
    const next = new Set(loadingAssetUrls.value);
    next.delete(downloadUrl);
    loadingAssetUrls.value = next;
  }
}

function handleRefreshAsset(downloadUrl: string): void {
  loadAssetInfo(downloadUrl, true);
}

function getResolvedSize(version: { downloadUrl: string; size?: number }): number | null {
  if (version.size != null) return version.size;
  const resolved = resolvedAssets.value[version.downloadUrl];
  return resolved?.size != null ? resolved.size : null;
}

function isAssetLoading(version: { downloadUrl: string; size?: number }): boolean {
  return version.size == null && loadingAssetUrls.value.has(version.downloadUrl);
}

function isAssetRefreshable(version: { downloadUrl: string; sha256?: string; size?: number }): boolean {
  return (!version.sha256 || version.size == null) && isGitHubReleaseUrl(version.downloadUrl);
}

function toggleSearch(): void {
  isSearchExpanded.value = true;
}

function handleSearchBlur(): void {
  if (!keyword.value.trim()) {
    isSearchExpanded.value = false;
  }
}

function getSelectedVersionInfo(game: MarketGame): MarketGameVersion | null {
  return (
    game.versions.find((item) => item.version === selectedVersions.value[game.id]) ||
    game.versions.find((item) => item.version === game.latestVersion) ||
    game.versions[0] ||
    null
  );
}

function getCurrentTask(game: MarketGame): MarketTaskState | null {
  const version = getSelectedVersionInfo(game);
  if (!version) return null;
  return taskStates.value[taskKey(game.id, version.version)] || null;
}

function isTaskActive(game: MarketGame): boolean {
  const task = getCurrentTask(game);
  return task
    ? ["downloading", "verifying", "extracting", "installing", "paused", "interrupted"].includes(task.status)
    : false;
}

function isTaskCancelable(game: MarketGame): boolean {
  const task = getCurrentTask(game);
  return task
    ? !["completed", "error", "canceled"].includes(task.status)
    : false;
}

function canPause(task: MarketTaskState): boolean {
  return ["downloading", "verifying"].includes(task.status)
}

function isNonPausableRunning(task: MarketTaskState): boolean {
  return ["extracting", "installing"].includes(task.status)
}

function typeLabel(type: MarketGame["type"]): string {
  return t(TYPE_LABEL_KEYS[type]);
}

function handleOpenAuthorUrl(url: string) {
  window.electronAPI.settings.openUrl(url);
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSize(version: { downloadUrl: string; size?: number } | null): string {
  if (!version) return "-";
  const resolvedSize = getResolvedSize(version);
  if (resolvedSize != null) return formatBytes(resolvedSize);
  return "-";
}

function taskStatusLabel(status: MarketTaskStatus): string {
  return t(`market.taskStatus.${status}`);
}

function taskTagType(status: MarketTaskStatus): "default" | "success" | "warning" | "error" | "info" {
  if (status === "completed") return "success";
  if (status === "error") return "error";
  if (status === "canceled") return "warning";
  if (status === "paused" || status === "interrupted") return "warning";
  if (status === "downloading") return "info";
  return "default";
}

function errorMessage(task: MarketTaskState): string {
  if (task.errorCode && ERROR_CODE_KEYS[task.errorCode]) {
    return t(ERROR_CODE_KEYS[task.errorCode]);
  }
  return task.message || "";
}

function isPlatformIncompatible(game: MarketGame): boolean {
  const version = getSelectedVersionInfo(game);
  if (!version || !appVersion.value) return false;
  try {
    return !semver.satisfies(appVersion.value, version.platformVersion);
  } catch {
    return true;
  }
}

function isInstalled(gameId: string, version: string, gameType?: string): boolean {
  if (gameType === "networkgame") {
    return Boolean(gameStore.getGameRecord(gameId));
  }
  return Boolean(
    gameStore.getGameRecord(gameId)?.versions.some((item) => item.version === version),
  );
}

function isSelectedVersionInvalid(game: MarketGame): boolean {
  const version = getSelectedVersionInfo(game);
  return version ? !isVersionPayloadValid(version) : false;
}

function friendlyLoadError(raw: string): string {
  if (raw.includes("market_id_mismatch")) {
    return "MARKET_ID_MISMATCH";
  }
  if (raw.includes("market_index_request_failed:404")) {
    return t("market.loadFailed");
  }
  if (raw.includes("market_index_all_sources_failed")) {
    return t("market.loadFailed");
  }
  if (raw.includes("market_index_request_failed")) {
    return t("market.loadFailed");
  }
  return `${t("market.loadFailed")}: ${raw}`;
}

async function syncExistingTasks(): Promise<void> {
  const taskIds = games.value.flatMap((game) =>
    game.versions.map((version) => taskKey(game.id, version.version)),
  );
  const states = await Promise.all(
    taskIds.map((taskId) => window.electronAPI.market.getTaskState(taskId)),
  );
  const next: Record<string, MarketTaskState> = {};
  let needsGameRefresh = false;
  for (const state of states) {
    if (!state) continue;
    if (["downloading", "verifying", "extracting", "installing", "paused", "interrupted"].includes(state.status)) {
      next[state.taskId] = state;
    } else if (state.status === "completed") {
      needsGameRefresh = true;
    }
  }
  taskStates.value = next;
  if (needsGameRefresh) {
    await gameStore.loadGames();
  }
}

const { clear: clearImageCache } = useImageCache();

async function loadIndex(forceRefresh = false): Promise<void> {
  isLoading.value = true;
  loadError.value = "";
  if (forceRefresh) {
    clearImageCache();
    refreshCounter.value++;
  }
  try {
    const index = await window.electronAPI.market.getIndex(sourceIdx.value, forceRefresh);
    games.value = index.games;
    marketName.value = index.marketName || "";
    generatedAt.value = index.generatedAt || "";
    for (const game of index.games) {
      if (!(game.id in expandedGames.value)) {
        expandedGames.value[game.id] = false;
      }
      const selectedVersion = selectedVersions.value[game.id];
      if (!selectedVersion || !game.versions.some((item) => item.version === selectedVersion)) {
        selectedVersions.value[game.id] = game.latestVersion || game.versions[0]?.version || "";
      }
    }
    await syncExistingTasks();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const friendly = friendlyLoadError(text);
    if (friendly === "MARKET_ID_MISMATCH") {
      dialog.error({
        title: t("market.marketIdMismatchTitle"),
        content: t("market.marketIdMismatchDesc"),
        positiveText: t("common.confirm"),
        onPositiveClick: () => {
          router.push("/markets");
        },
      });
    } else {
      loadError.value = friendly;
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleDownload(gameId: string, version: string): Promise<void> {
  const taskId = taskKey(gameId, version);
  if (pendingDownloads.has(taskId)) return;
  const activeStatuses: MarketTaskStatus[] = ["downloading", "verifying", "extracting", "installing", "paused", "interrupted"];
  const current = taskStates.value[taskId];
  if (current && activeStatuses.includes(current.status)) return;
  pendingDownloads.add(taskId);
  try {
    const task = await window.electronAPI.market.downloadAndInstall(gameId, version, sourceIdx.value);
    taskStates.value = {
      ...taskStates.value,
      [task.taskId]: task,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("platform_version_mismatch")) {
      message.error(t("market.platformIncompatible"));
    } else if (text.includes("already_installed")) {
      message.info(t("market.installed"));
    } else {
      message.error(t("market.downloadFailed"));
    }
  } finally {
    pendingDownloads.delete(taskId);
  }
}

async function handleCancel(taskId: string): Promise<void> {
  if (pendingCancels.has(taskId)) return;
  const current = taskStates.value[taskId];
  if (!current || !["downloading", "verifying", "extracting", "installing", "paused", "interrupted"].includes(current.status)) return;
  pendingCancels.add(taskId);
  try {
    await window.electronAPI.market.cancelTask(taskId);
  } finally {
    pendingCancels.delete(taskId);
  }
}

async function handlePause(taskId: string): Promise<void> {
  if (pendingPauses.has(taskId)) return;
  const current = taskStates.value[taskId];
  if (!current || !canPause(current)) return;
  pendingPauses.add(taskId);
  try {
    await window.electronAPI.market.pauseTask(taskId);
    message.info(t("market.taskPaused"));
  } catch {
    message.error(t("common.error"));
  } finally {
    pendingPauses.delete(taskId);
  }
}

async function handleResume(taskId: string): Promise<void> {
  if (pendingResumes.has(taskId)) return;
  pendingResumes.add(taskId);
  try {
    const task = await window.electronAPI.market.resumeTask(taskId);
    if (task) {
      taskStates.value = {
        ...taskStates.value,
        [task.taskId]: task,
      };
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("platform_version_mismatch")) {
      message.error(t("market.platformIncompatible"));
    } else if (text.includes("already_installed")) {
      message.info(t("market.installed"));
    } else if (text.includes("version_not_found")) {
      message.error(t("market.versionNotFound"));
      const { [taskId]: _, ...rest } = taskStates.value;
      taskStates.value = rest;
    } else {
      message.error(t("market.downloadFailed"));
    }
  } finally {
    pendingResumes.delete(taskId);
  }
}

onMounted(async () => {
  await Promise.all([settingsStore.loadSettings(), gameStore.loadGames()]);
  try {
    appVersion.value = await window.electronAPI.settings.getAppVersion();
  } catch {
    appVersion.value = "";
  }

  const pendingSnapshots = await window.electronAPI.market.getPendingTasks();
  for (const snap of pendingSnapshots) {
    const existing = taskStates.value[snap.taskId];
    if (!existing) {
      taskStates.value = {
        ...taskStates.value,
        [snap.taskId]: {
          taskId: snap.taskId,
          gameId: snap.gameId,
          version: snap.version,
          status: snap.status,
          progress: snap.size > 0 ? Math.min(65, Math.round((snap.bytesReceived / snap.size) * 65)) : 0,
          bytesReceived: snap.bytesReceived,
          totalBytes: snap.size,
          createdAt: snap.updatedAt,
          updatedAt: snap.updatedAt,
        },
      };
    }
  }

  cleanupMarketEvent = window.electronAPI.market.onEvent(async ({ task }) => {
    taskStates.value = {
      ...taskStates.value,
      [task.taskId]: task,
    };
    if (task.status === "completed") {
      await gameStore.loadGames();
    }
    if (
      task.status !== "idle" &&
      task.status !== "downloading" &&
      task.status !== "verifying" &&
      task.status !== "extracting" &&
      task.status !== "installing" &&
      task.status !== "paused" &&
      task.status !== "interrupted"
    ) {
      const id = window.setTimeout(() => {
        const { [task.taskId]: _, ...rest } = taskStates.value;
        taskStates.value = rest;
        const idx = timeoutIds.indexOf(id);
        if (idx !== -1) timeoutIds.splice(idx, 1);
      }, 500);
      timeoutIds.push(id);
    }
  });
  await loadIndex();
});

onUnmounted(() => {
  if (cleanupMarketEvent) cleanupMarketEvent();
  for (const id of timeoutIds) {
    window.clearTimeout(id);
  }
  timeoutIds.length = 0;
});
</script>

<style scoped>
.market-root {
  padding: 24px;
}

.market-game-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.market-game-entry {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.market-game-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.market-game-item:hover,
.market-game-item.active {
  border-color: var(--bz-green);
  background: var(--bz-green-soft);
}

.market-thumb {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 8px;
}

.market-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-color-modal);
  border: 1px dashed var(--n-border-color);
  color: var(--n-text-color-3);
  font-size: 13px;
  user-select: none;
}

.market-game-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.market-summary {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.market-detail-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.market-cover {
  width: 320px;
  max-width: 48%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 12px;
}

.market-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-color-modal);
  border: 1px dashed var(--n-border-color);
  color: var(--n-text-color-3);
  font-size: 15px;
  user-select: none;
}

.market-detail-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.market-version-item {
  border: 1px solid var(--bz-border-subtle);
  border-radius: 10px;
  padding: 12px;
}

.market-version-desc {
  margin: 8px 0;
  line-height: 1.6;
}

.market-selected-version-card {
  border-radius: 12px;
}

.market-inline-detail {
  border-radius: 14px;
  margin-top: 4px;
}

@media (max-width: 900px) {
  .market-detail-header {
    flex-direction: column;
  }

  .market-cover {
    width: 100%;
    max-width: 100%;
  }
}
</style>
