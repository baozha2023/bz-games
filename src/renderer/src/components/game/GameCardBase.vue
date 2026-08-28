<template>
  <GameCardFrame
    :ratio="ratio"
    :frame-url="frameUrl"
    :content-inset-percent="contentInsetPercent"
    :interactive="interactive"
    @click="handleClick"
  >
    <n-card
      :hoverable="false"
      :style="{ cursor: interactive ? 'pointer' : 'default' }"
      content-style="padding: 0;"
    >
      <template #cover>
        <div class="game-card-visual" :class="`game-card-visual--${ratio}`">
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt=""
            class="game-card-visual-image"
          />
          <slot v-else name="visual" />
          <GameImportOverlay
            v-if="importTasks?.length"
            :tasks="importTasks"
            :compact="ratio === 'square'"
            @cancel="emit('cancel-import', $event)"
            @retry="emit('retry-import', $event)"
            @dismiss="emit('dismiss-import', $event)"
          />
          <n-icon
            v-if="isFavorite"
            :size="ratio === 'square' ? 18 : 24"
            color="#d03050"
            class="favorite-icon"
          >
            <Heart />
          </n-icon>
        </div>
      </template>
      <div v-if="ratio === 'wide'" class="game-card-info">
        <n-ellipsis class="game-card-title">
          {{ game.name }}
        </n-ellipsis>
        <n-text depth="3" class="game-card-author">{{ game.author }}</n-text>
      </div>
    </n-card>
  </GameCardFrame>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { NCard, NEllipsis, NText, NIcon } from "naive-ui";
import { Heart } from "@vicons/ionicons5";
import type { ResolvedGameManifest as GameManifest } from "../../../../shared/game-manifest";
import type { GameImportTaskState } from "../../../../shared/types";
import { useGameStore } from "../../stores/useGameStore";
import { useGameCardFrameAsset } from "../../composables/useGameCardFrameAsset";
import GameCardFrame from "./GameCardFrame.vue";
import GameImportOverlay from "./GameImportOverlay.vue";

const props = defineProps<{
  game: GameManifest;
  ratio: "square" | "wide";
  importTasks?: GameImportTaskState[];
  frameProductId?: string;
  previewUrl?: string;
  interactive?: boolean;
}>();

const emit = defineEmits<{
  (event: "click", id: string): void;
  (event: "cancel-import", taskId: string): void;
  (event: "retry-import", taskId: string): void;
  (event: "dismiss-import", taskId: string): void;
}>();

const gameStore = useGameStore();
const interactive = computed(() => props.interactive !== false);
const isFavorite = computed(() =>
  Boolean(gameStore.getGameRecord(props.game.id)?.isFavorite),
);
const { frameUrl, contentInsetPercent } = useGameCardFrameAsset(
  toRef(props, "frameProductId"),
  props.ratio,
);

function handleClick(): void {
  if (interactive.value) emit("click", props.game.id);
}
</script>

<style scoped>
.game-card-visual {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: transparent;
}

.game-card-visual--wide {
  aspect-ratio: 16 / 9;
}

.game-card-visual--square {
  aspect-ratio: 1 / 1;
}

.game-card-visual-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.favorite-icon {
  position: absolute;
  top: 8px;
  right: 8px;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
}

.game-card-visual--square .favorite-icon {
  top: 4px;
  right: 4px;
}

.game-card-info {
  padding: 12px;
}

.game-card-title {
  display: block;
  max-width: 100%;
  font-weight: bold;
  font-size: 16px;
}

.game-card-author {
  font-size: 12px;
}
</style>
