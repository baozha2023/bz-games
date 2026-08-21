<template>
  <div
    class="import-overlay"
    :class="{ compact, multiple: tasks.length > 1 }"
    @click.stop
  >
    <div class="overlay-glow"></div>
    <div
      v-for="task in tasks"
      :key="task.taskId"
      class="import-task-row"
      :class="`is-${task.status}`"
    >
      <div class="import-task-heading">
        <span class="status-chip">
          <span class="status-dot"></span>
          {{ statusLabel(task) }}
        </span>
        <span class="version-chip">v{{ task.version }}</span>
      </div>

      <div class="progress-summary">
        <div v-if="task.progress !== null" class="progress-number">
          {{ Math.round(task.progress) }}<small>%</small>
        </div>
        <div v-else class="progress-spinner" aria-hidden="true"></div>
        <div v-if="!compact" class="progress-copy">
          <strong>{{ primaryCopy(task) }}</strong>
          <span>{{ detailCopy(task) }}</span>
        </div>
      </div>

      <div
        v-if="task.progress === null && isRunning(task)"
        class="indeterminate-track"
      >
        <span></span>
      </div>
      <n-progress
        v-else
        type="line"
        :percentage="task.progress || 0"
        :show-indicator="false"
        :height="compact ? 4 : 6"
        :border-radius="99"
        :color="progressColor(task)"
        rail-color="rgba(255, 255, 255, 0.16)"
      />

      <div v-if="canRetry(task) && task.error" class="import-task-error">
        {{ errorLabel(task) }}
      </div>
      <div v-if="canCancel(task) || canRetry(task)" class="import-actions">
        <n-button
          v-if="canCancel(task)"
          size="tiny"
          circle
          quaternary
          :title="t('library.importTask.cancel')"
          :aria-label="t('library.importTask.cancel')"
          @click.stop="$emit('cancel', task.taskId)"
        >
          <template #icon
            ><n-icon><CloseOutline /></n-icon
          ></template>
        </n-button>
        <n-button
          v-if="canRetry(task)"
          size="tiny"
          circle
          quaternary
          :title="t('library.importTask.retry')"
          :aria-label="t('library.importTask.retry')"
          @click.stop="$emit('retry', task.taskId)"
        >
          <template #icon
            ><n-icon><RefreshOutline /></n-icon
          ></template>
        </n-button>
        <n-button
          v-if="canRetry(task)"
          size="tiny"
          circle
          quaternary
          :title="t('library.importTask.remove')"
          :aria-label="t('library.importTask.remove')"
          @click.stop="$emit('dismiss', task.taskId)"
        >
          <template #icon
            ><n-icon><TrashOutline /></n-icon
          ></template>
        </n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { NButton, NIcon, NProgress } from "naive-ui";
import { CloseOutline, RefreshOutline, TrashOutline } from "@vicons/ionicons5";
import type { GameImportTaskState } from "../../../../shared/types";

defineProps<{ tasks: GameImportTaskState[]; compact?: boolean }>();
defineEmits<{
  (event: "cancel", taskId: string): void;
  (event: "retry", taskId: string): void;
  (event: "dismiss", taskId: string): void;
}>();
const { t } = useI18n();

const isRunning = (task: GameImportTaskState) =>
  ["validating", "scanning", "copying", "finalizing"].includes(task.status);
const canCancel = (task: GameImportTaskState) =>
  ["queued", "validating", "scanning", "copying"].includes(task.status);
const canRetry = (task: GameImportTaskState) =>
  ["failed", "interrupted"].includes(task.status);
const statusLabel = (task: GameImportTaskState) =>
  t(`library.importTask.status.${task.status}`);
const primaryCopy = (task: GameImportTaskState) => {
  if (task.status === "failed" || task.status === "interrupted") {
    return t("library.importTask.attention");
  }
  return task.status === "completed"
    ? t("library.importTask.ready")
    : t("library.importTask.working");
};
const detailCopy = (task: GameImportTaskState) => {
  if (task.status === "scanning" && task.totalFiles) {
    return t("library.importTask.filesFound", { count: task.totalFiles });
  }
  if (task.totalBytes) {
    return `${formatBytes(task.processedBytes || 0)} / ${formatBytes(task.totalBytes)}`;
  }
  return task.source === "market"
    ? t("library.importTask.marketInstall")
    : t("library.importTask.localImport");
};
const progressColor = (task: GameImportTaskState) => {
  if (task.status === "failed" || task.status === "interrupted")
    return "#ff6b7a";
  if (task.status === "completed") return "#46d693";
  return "#66a6ff";
};
const errorLabel = (task: GameImportTaskState) => {
  const key = `library.importError.${task.error}`;
  const translated = t(key, task.params || {});
  return translated === key ? task.error : translated;
};
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
</script>

<style scoped>
.import-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 9px;
  padding: 14px;
  color: #fff;
  background:
    linear-gradient(155deg, rgba(9, 16, 30, 0.7), rgba(5, 9, 18, 0.9)),
    radial-gradient(circle at 20% 0%, rgba(74, 144, 245, 0.28), transparent 55%);
  backdrop-filter: blur(7px) saturate(1.15);
  box-sizing: border-box;
  overflow: hidden auto;
  isolation: isolate;
}
.overlay-glow {
  position: absolute;
  z-index: -1;
  width: 120px;
  height: 120px;
  top: -72px;
  right: -48px;
  border-radius: 50%;
  background: rgba(90, 160, 255, 0.28);
  filter: blur(28px);
  pointer-events: none;
}
.import-overlay.compact {
  padding: 9px;
  gap: 6px;
}
.import-task-row {
  position: relative;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.065);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.import-overlay:not(.multiple) .import-task-row {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.compact .import-task-row {
  padding: 0;
  border: 0;
  background: transparent;
}
.import-task-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
  font-size: 11px;
}
.status-chip,
.version-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
}
.status-chip {
  gap: 6px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.version-chip {
  max-width: 48%;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.86;
}
.status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #72aeff;
  box-shadow: 0 0 0 4px rgba(114, 174, 255, 0.15);
  animation: import-pulse 1.8s ease-in-out infinite;
}
.is-failed .status-dot,
.is-interrupted .status-dot {
  background: #ff6b7a;
  box-shadow: 0 0 0 4px rgba(255, 107, 122, 0.14);
  animation: none;
}
.is-completed .status-dot {
  background: #46d693;
  box-shadow: 0 0 0 4px rgba(70, 214, 147, 0.14);
  animation: none;
}
.progress-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.progress-number {
  flex: 0 0 auto;
  font-size: 27px;
  font-weight: 750;
  line-height: 1;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
}
.progress-number small {
  margin-left: 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.65;
}
.progress-spinner {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #82b8ff;
  border-radius: 50%;
  animation: import-spin 0.85s linear infinite;
}
.progress-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.progress-copy strong {
  font-size: 12px;
  font-weight: 650;
}
.progress-copy span {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.62);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.indeterminate-track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
}
.indeterminate-track span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #578fea, #8ac5ff);
  box-shadow: 0 0 12px rgba(102, 166, 255, 0.55);
  animation: import-slide 1.15s ease-in-out infinite;
}
.compact .import-task-heading {
  font-size: 10px;
  margin-bottom: 7px;
}
.compact .version-chip {
  padding: 1px 5px;
}
.compact .progress-summary {
  justify-content: center;
  margin-bottom: 7px;
}
.compact .progress-number {
  font-size: 22px;
}
.import-task-error {
  margin-top: 7px;
  padding: 5px 7px;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(255, 74, 92, 0.14);
  font-size: 10px;
  color: #ffd1d5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.import-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 7px;
}
.import-actions :deep(.n-button) {
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.07);
}
.compact .import-actions {
  position: absolute;
  right: 0;
  bottom: -2px;
}
@keyframes import-pulse {
  0%,
  100% {
    transform: scale(0.9);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
@keyframes import-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes import-slide {
  0% {
    transform: translateX(-110%);
  }
  50% {
    transform: translateX(135%);
  }
  100% {
    transform: translateX(245%);
  }
}
</style>
