<template>
  <div class="career-section">
    <n-card style="margin-bottom: 16px">
      <div class="heatmap-wrapper">
        <CalendarHeatmap
          v-if="hasLoadedHeatmap"
          :daily-durations="dailyDurations"
          :selected-date="selectedDate"
          @select-date="handleHeatmapDateSelect"
          @share="handleShare"
        />
        <div v-else class="heatmap-placeholder" />
        <div v-if="!hasLoadedHeatmap" class="heatmap-mask">
          <n-button
            type="primary"
            size="large"
            :loading="isLoadingHeatmap"
            @click="loadStatsData"
          >
            {{ t("statistics.loadHeatmap") }}
          </n-button>
        </div>
      </div>
    </n-card>

    <n-empty
      v-if="statCards.length === 0"
      :description="t('statistics.empty')"
      style="margin-top: 24px"
    />

    <n-list v-else style="margin-top: 16px; background: transparent">
      <n-list-item
        v-for="(card, index) in statCards"
        :key="card.id"
        v-show="index < visibleCount"
        class="stagger-card-enter"
      >
        <n-card :title="card.name" hoverable size="small">
          <template #header-extra>
            <n-select
              size="small"
              style="width: 120px"
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
            <n-text depth="3" style="font-size: 12px">
              {{ t("statistics.lastPlayed") }}: {{ card.lastPlayed }}
            </n-text>
          </template>
        </n-card>
      </n-list-item>
    </n-list>

    <n-modal
      v-model:show="showSessionModal"
      preset="card"
      style="width: min(760px, calc(100vw - 32px))"
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
                  {{ t("statistics.version") }}: {{ session.version }}
                </div>
              </div>
              <div class="session-side">
                <div>{{ formatSessionDuration(session.duration_ms) }}</div>
                <div class="session-meta">
                  {{ formatSessionRange(session.start_time, session.end_time) }}
                </div>
              </div>
            </div>
          </n-card>
        </n-space>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import html2canvas from "html2canvas";
import { useGameStore } from "../stores/useGameStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import CalendarHeatmap from "../components/CalendarHeatmap.vue";
import { useGameListView } from "../composables/useGameListView";
import { compareGameVersionsDescending } from "../../../shared/game-manifest";

const { t } = useI18n();
const gameStore = useGameStore();
const settingsStore = useSettingsStore();
const message = useMessage();
const searchKeyword = defineModel<string>("searchKeyword", { default: "" });

interface PlaySession {
  id: string;
  game_id: string;
  game_name: string;
  version: string;
  start_time: number;
  end_time: number | null;
  duration_ms: number | null;
}

const isLoadingHeatmap = ref(false);
const hasLoadedHeatmap = ref(false);
const dailyDurations = ref<{ date: string; total_duration_ms: number }[]>([]);
const selectedDate = ref("");
const showSessionModal = ref(false);
const isLoadingSessions = ref(false);
const selectedDateSessions = ref<PlaySession[]>([]);
const isSharing = ref(false);

const games = computed(() => gameStore.games);
const {
  selectedVersions,
  visibleCount,
  filteredItems: filteredGames,
  activateStaggerRendering,
  initializeManifestCache,
  refreshManifestCache,
  handleVersionChange,
  getManifest,
} = useGameListView(games, searchKeyword);

async function loadStatsData() {
  if (isLoadingHeatmap.value || hasLoadedHeatmap.value) return;
  isLoadingHeatmap.value = true;
  await nextTick();
  try {
    const [durations] = await Promise.all([
      window.electronAPI.stats.getDailyPlayDurations(365),
      new Promise((resolve) => setTimeout(resolve, 180)),
    ]);
    dailyDurations.value = durations;
    hasLoadedHeatmap.value = true;
  } catch (e) {
    console.error("[StatisticsView] Failed to load stats data:", e);
  } finally {
    isLoadingHeatmap.value = false;
  }
}

// ── 热力图分享 ──
const HEATMAP_COLORS = ["#ebedf0", "#39d353", "#26a641", "#006d32", "#0e4429"];

function getHeatmapLevel(durationMs: number): number {
  if (durationMs <= 0) return 0;
  const minutes = durationMs / 60000;
  if (minutes < 15) return 1;
  if (minutes < 60) return 2;
  if (minutes < 180) return 3;
  return 4;
}

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function handleShare() {
  if (isSharing.value) return;
  isSharing.value = true;
  let container: HTMLDivElement | null = null;
  try {
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 364);
    const dayOfWeek = startDate.getDay();
    if (dayOfWeek > 0) {
      startDate.setDate(startDate.getDate() - dayOfWeek);
    }

    const durationMap = new Map<string, number>();
    for (const entry of dailyDurations.value) {
      durationMap.set(entry.date, entry.total_duration_ms);
    }

    // 计算热力图格子
    const cells: { date: string; durationMs: number; color: string }[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = formatDateStr(current);
      const durationMs = durationMap.get(dateStr) || 0;
      cells.push({
        date: dateStr,
        durationMs,
        color: HEATMAP_COLORS[getHeatmapLevel(durationMs)],
      });
      current.setDate(current.getDate() + 1);
    }

    // 计算月份标签
    const localizedMonthNames = t("statistics.monthNames");
    const monthNames = (
      localizedMonthNames ||
      "1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月"
    ).split(",");
    const monthLabels: { text: string; col: number; span: number }[] = [];
    let colIdx = 1;
    let prevMonth = -1;
    const mc = new Date(startDate);
    while (mc <= endDate) {
      const weekIdx = Math.floor(colIdx / 7) + 1;
      const month = mc.getMonth();
      if (month !== prevMonth) {
        monthLabels.push({ text: monthNames[month], col: weekIdx, span: 0 });
        prevMonth = month;
      }
      colIdx++;
      mc.setDate(mc.getDate() + 1);
    }
    const totalWeeks = Math.ceil(colIdx / 7);
    for (let i = 0; i < monthLabels.length; i++) {
      const nextCol =
        i < monthLabels.length - 1 ? monthLabels[i + 1].col : totalWeeks + 1;
      monthLabels[i].span = Math.max(1, nextCol - monthLabels[i].col);
    }

    // 统计信息（基于 heatmap 时间范围）
    let totalMs = 0;
    let playDays = 0;
    let longestStreak = 0;
    let currentStreak = 0;
    for (const cell of cells) {
      totalMs += cell.durationMs;
      if (cell.durationMs > 0) {
        playDays++;
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }
    const totalHours = (totalMs / 3600000).toFixed(1);
    const maxDailyMs = cells.reduce((max, c) => Math.max(max, c.durationMs), 0);
    const maxDailyHours = (maxDailyMs / 3600000).toFixed(1);

    // 玩家信息
    const settings = settingsStore.settings;
    const playerName = settings?.playerName || t("statistics.shareNotLoggedIn");
    const avatar = settings?.avatar || "";
    const githubLogin = settings?.cloudUserLogin || "";

    // 构建分享容器
    container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-1;";
    container.innerHTML = renderShareHtml(
      playerName,
      avatar,
      githubLogin,
      cells,
      monthLabels,
      playDays,
      longestStreak,
      totalHours,
      maxDailyHours,
    );
    document.body.appendChild(container);

    await waitForImages(container);

    const shareCard = container.firstElementChild;
    if (!(shareCard instanceof HTMLElement)) {
      throw new Error("share_card_render_failed");
    }
    const canvas = await html2canvas(shareCard, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });

    const dataUrl = canvas.toDataURL("image/png");
    const defaultName = `BZ-Games-Heatmap-${now.toISOString().slice(0, 10)}.png`;

    const result = await window.electronAPI.settings.savePng(
      dataUrl,
      defaultName,
    );
    if (!result.success && !result.canceled) {
      message.error(result.error || t("common.error"));
    }
  } catch (e) {
    console.error("[StatisticsView] Share failed:", e);
    message.error(t("common.error"));
  } finally {
    container?.remove();
    isSharing.value = false;
  }
}

function waitForImages(container: HTMLElement): Promise<void> {
  const pending = Array.from(container.querySelectorAll("img"))
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          const finish = () => {
            window.clearTimeout(timeout);
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          const timeout = window.setTimeout(finish, 3_000);
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          if (image.complete) finish();
        }),
    );
  return Promise.all(pending).then(() => undefined);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function getSafeAvatarSource(value: string): string {
  if (value.length > 8 * 1024 * 1024) return "";
  if (
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      value,
    )
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function renderShareHtml(
  playerName: string,
  avatar: string,
  githubLogin: string,
  cells: { date: string; color: string }[],
  monthLabels: { text: string; col: number; span: number }[],
  playDays: number,
  longestStreak: number,
  totalHours: string,
  maxDailyHours: string,
): string {
  const IMG_WIDTH = 840;
  const PADDING = 48; // 24px * 2
  const availableWidth = IMG_WIDTH - PADDING;

  // 与 CalendarHeatmap 一致的动态尺寸计算
  const DAY_LABEL_RATIO = 1.8;
  const GAP_RATIO = 0.18;
  const MAX_WEEKS = 54;
  const divisor =
    DAY_LABEL_RATIO + GAP_RATIO * 2 + MAX_WEEKS + (MAX_WEEKS - 1) * GAP_RATIO;
  const cellSize = Math.max(8, Math.floor(availableWidth / divisor));
  const gap = Math.max(1, Math.round(cellSize * GAP_RATIO));
  const dayLabelWidth = Math.round(cellSize * DAY_LABEL_RATIO);
  const dayLabels = (t("statistics.weekDays") || ",Mon,,Wed,,Fri,").split(",");
  const cellRows = 7;

  let cellsHtml = "";
  for (let i = 0; i < cells.length; i++) {
    const bg = cells[i].color;
    cellsHtml += `<div style="width:${cellSize}px;height:${cellSize}px;background:${bg};border-radius:2px;"></div>`;
  }

  let monthHtml = "";
  for (const ml of monthLabels) {
    monthHtml += `<span style="grid-column:${ml.col}/span ${ml.span};font-size:10px;color:#666;">${escapeHtml(ml.text)}</span>`;
  }

  let dayLabelHtml = "";
  for (const day of dayLabels) {
    dayLabelHtml += `<span style="font-size:10px;color:#888;text-align:right;height:${cellSize}px;line-height:${cellSize}px;">${escapeHtml(day)}</span>`;
  }

  const safeAvatar = getSafeAvatarSource(avatar);
  const avatarHtml = safeAvatar
    ? `<img src="${escapeHtml(safeAvatar)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid #e5e5e5;" crossorigin="anonymous" />`
    : `<div style="width:48px;height:48px;border-radius:50%;background:#e5e5e5;display:flex;align-items:center;justify-content:center;font-size:20px;color:#999;">?</div>`;

  const githubHtml = githubLogin
    ? `<span style="font-size:14px;color:#666;margin-left:8px;">@${escapeHtml(githubLogin)}</span>`
    : "";

  return `
<div style="width:840px;padding:32px 24px 24px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-sizing:border-box;">
  <div style="display:flex;align-items:center;margin-bottom:24px;">
    ${avatarHtml}
    <div style="margin-left:12px;display:flex;align-items:center;">
      <span style="font-size:18px;font-weight:600;color:#111;">${escapeHtml(playerName)}</span>
      ${githubHtml}
    </div>
  </div>
  <div style="margin-bottom:16px;">
    <div style="display:grid;grid-template-columns:repeat(54,${cellSize}px);margin-bottom:${gap}px;margin-left:${dayLabelWidth + gap * 2}px;gap:${gap}px;">
      ${monthHtml}
    </div>
    <div style="display:flex;gap:${gap * 2}px;">
      <div style="display:flex;flex-direction:column;gap:${gap}px;width:${dayLabelWidth}px;flex-shrink:0;">
        ${dayLabelHtml}
      </div>
      <div style="display:grid;grid-auto-flow:column;grid-template-rows:repeat(${cellRows},${cellSize}px);grid-auto-columns:${cellSize}px;gap:${gap}px;">
        ${cellsHtml}
      </div>
    </div>
  </div>
  <div style="display:flex;justify-content:center;gap:36px;padding-top:16px;border-top:1px solid #e5e5e5;">
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#111;">${playDays}</div>
      <div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(t("statistics.shareTotalDays"))}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#111;">${longestStreak}</div>
      <div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(t("statistics.shareLongestStreak"))}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#111;">${totalHours}</div>
      <div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(t("statistics.shareTotalHours"))}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#111;">${maxDailyHours}</div>
      <div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(t("statistics.shareMaxDailyHours"))}</div>
    </div>
  </div>
  <div style="text-align:center;margin-top:16px;font-size:11px;color:#bbb;">BZ-Games</div>
</div>`;
}

async function handleHeatmapDateSelect(date: string) {
  selectedDate.value = date;
  selectedDateSessions.value = [];
  showSessionModal.value = true;
  isLoadingSessions.value = true;
  await nextTick();
  try {
    const [sessions] = await Promise.all([
      window.electronAPI.stats.getSessionsByDate(date),
      new Promise((resolve) => setTimeout(resolve, 180)),
    ]);
    selectedDateSessions.value = sessions;
  } catch (e) {
    console.error("[StatisticsView] Failed to load sessions by date:", e);
    selectedDateSessions.value = [];
  } finally {
    isLoadingSessions.value = false;
  }
}

onMounted(async () => {
  await gameStore.loadGames();
  initializeManifestCache(gameStore.games);
  activateStaggerRendering();
});

watch(
  () => gameStore.games,
  (manifests) => void refreshManifestCache(manifests),
);

const statCards = computed(() =>
  filteredGames.value.map((game) => {
    const keys = getStatKeys(game.id);
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
    };
  }),
);

function buildVersionOptions(gameId: string) {
  const record = gameStore.getGameRecord(gameId);
  if (!record || !record.versions) return [];
  return record.versions
    .map((v) => v.version)
    .sort(compareGameVersionsDescending)
    .map((v) => ({ label: v, value: v }));
}

function getStatKeys(gameId: string): string[] {
  const manifest = getManifest(gameId);

  const keys = ["time"];

  if (manifest?.statistics) {
    const otherKeys = manifest.statistics
      .map((s) => {
        if (typeof s === "string") return s;
        return Object.keys(s)[0];
      })
      .filter((k) => k !== "time");

    keys.push(...otherKeys);
  }

  return keys;
}

function getValue(gameId: string, key: string): string {
  const record = gameStore.getGameRecord(gameId);
  const version = selectedVersions.value[gameId];

  if (!record || !version) return "0";

  const gameVersion = record.versions.find((v) => v.version === version);
  if (!gameVersion) return "0";

  let val = 0;

  if (key === "time") {
    val = Math.round((gameVersion.playtime || 0) / 1000);
  } else {
    if (gameVersion.stats && gameVersion.stats[key] !== undefined) {
      val = gameVersion.stats[key];
    }
  }

  if (key === "time") {
    return formatTime(val);
  }
  return val.toString();
}

function getLastPlayed(gameId: string): string {
  const record = gameStore.getGameRecord(gameId);
  return record?.lastPlayedAt
    ? new Date(record.lastPlayedAt).toLocaleString()
    : t("statistics.never");
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
  if (!durationMs || durationMs <= 0) return t("statistics.noPlay");
  const minutes = Math.floor(durationMs / 60000);
  if (minutes < 60) return `${minutes}${t("statistics.minute")}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}${t("statistics.hour")}`;
  return `${hours}${t("statistics.hour")}${remainingMinutes}${t("statistics.minute")}`;
}

function formatSessionRange(startTime: number, endTime: number | null): string {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const startLabel = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!end) return startLabel;
  const endLabel = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${startLabel} - ${endLabel}`;
}

function getLabel(gameId: string, key: string): string {
  const manifest = getManifest(gameId);
  if (manifest?.statistics) {
    for (const stat of manifest.statistics) {
      if (typeof stat === "object" && Object.keys(stat)[0] === key) {
        const value = Object.values(stat)[0] as any;
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && value.label)
          return value.label;
      }
    }
  }

  const i18nKey = `statistics.${key}`;
  const label = t(i18nKey);
  if (label !== i18nKey) return label;

  return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
</script>

<style scoped>
.career-section {
  padding-top: 12px;
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
  box-sizing: border-box;
  border: 1px solid var(--bz-border-subtle);
  border-radius: 6px;
  background: var(--bz-bg-panel);
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
