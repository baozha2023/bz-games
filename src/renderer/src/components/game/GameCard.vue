<template>
  <GameCardBase
    :game="game"
    ratio="wide"
    :import-tasks="importTasks"
    :frame-product-id="frameProductId"
    :preview-url="previewCoverUrl"
    :interactive="interactive"
    @click="$emit('click', $event)"
    @cancel-import="$emit('cancel-import', $event)"
    @retry-import="$emit('retry-import', $event)"
    @dismiss-import="$emit('dismiss-import', $event)"
  >
    <template #visual>
      <GameCover :game-id="game.id" />
    </template>
  </GameCardBase>
</template>

<script setup lang="ts">
import GameCardBase from "./GameCardBase.vue";
import GameCover from "./GameCover.vue";
import type { ResolvedGameManifest as GameManifest } from "../../../../shared/game-manifest";
import type { GameImportTaskState } from "../../../../shared/types";

defineProps<{
  game: GameManifest;
  importTasks?: GameImportTaskState[];
  frameProductId?: string;
  previewCoverUrl?: string;
  interactive?: boolean;
}>();

defineEmits<{
  (event: "click", id: string): void;
  (event: "cancel-import", taskId: string): void;
  (event: "retry-import", taskId: string): void;
  (event: "dismiss-import", taskId: string): void;
}>();
</script>
