<template>
  <GameCardBase
    :game="game"
    ratio="square"
    :import-tasks="importTasks"
    :frame-product-id="frameProductId"
    :preview-url="previewIconUrl"
    :interactive="interactive"
    @click="$emit('click', $event)"
    @cancel-import="$emit('cancel-import', $event)"
    @retry-import="$emit('retry-import', $event)"
    @dismiss-import="$emit('dismiss-import', $event)"
  >
    <template #visual>
      <GameIcon :game-id="game.id" />
    </template>
  </GameCardBase>
</template>

<script setup lang="ts">
import GameCardBase from "./GameCardBase.vue";
import GameIcon from "./GameIcon.vue";
import type { ResolvedGameManifest as GameManifest } from "../../../../shared/game-manifest";
import type { GameImportTaskState } from "../../../../shared/types";

defineProps<{
  game: GameManifest;
  importTasks?: GameImportTaskState[];
  frameProductId?: string;
  previewIconUrl?: string;
  interactive?: boolean;
}>();

defineEmits<{
  (event: "click", id: string): void;
  (event: "cancel-import", taskId: string): void;
  (event: "retry-import", taskId: string): void;
  (event: "dismiss-import", taskId: string): void;
}>();
</script>
