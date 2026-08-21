<template>
  <n-card content-style="padding: 0;" class="import-placeholder-card">
    <template #cover>
      <div class="placeholder-art" :class="{ compact }">
        <img :src="compact ? defaultIconUrl : defaultCoverUrl" />
        <GameImportOverlay
          :tasks="[task]"
          :compact="compact"
          @cancel="$emit('cancel', $event)"
          @retry="$emit('retry', $event)"
          @dismiss="$emit('dismiss', $event)"
        />
      </div>
    </template>
    <div v-if="!compact" class="placeholder-info">
      <n-ellipsis class="placeholder-name">{{ task.gameName }}</n-ellipsis>
      <span class="placeholder-meta">
        v{{ task.version }} ·
        {{ t(`library.importTask.status.${task.status}`) }}
      </span>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NEllipsis } from "naive-ui";
import { useI18n } from "vue-i18n";
import type { GameImportTaskState } from "../../../../shared/types";
import defaultIconUrl from "../../../../../resources/default_icon.png";
import defaultCoverUrl from "../../../../../resources/default_cover.png";
import GameImportOverlay from "./GameImportOverlay.vue";

defineProps<{ task: GameImportTaskState; compact?: boolean }>();
defineEmits<{
  (event: "cancel", taskId: string): void;
  (event: "retry", taskId: string): void;
  (event: "dismiss", taskId: string): void;
}>();
const { t } = useI18n();
</script>

<style scoped>
.import-placeholder-card {
  cursor: default;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--bz-info-blue) 34%, transparent);
  box-shadow:
    0 10px 28px rgba(14, 31, 58, 0.12),
    0 0 0 1px rgba(100, 164, 255, 0.05);
}
.placeholder-art {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--bz-bg-card-placeholder);
}
.placeholder-art.compact {
  aspect-ratio: 1 / 1;
}
.placeholder-art img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.82;
  transform: scale(0.96);
  filter: saturate(0.78);
}
.placeholder-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 11px 12px 12px;
}
.placeholder-name {
  max-width: 100%;
  font-size: 15px;
  font-weight: 700;
}
.placeholder-meta {
  color: var(--bz-text-secondary);
  font-size: 11px;
}
</style>
