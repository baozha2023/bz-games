<template>
  <div
    class="game-card-frame"
    :class="[
      `game-card-frame--${ratio}`,
      { 'game-card-frame--interactive': interactive !== false },
      { 'game-card-frame--active': frameUrl },
    ]"
    @click="handleClick"
  >
    <div class="game-card-frame-content" :style="contentStyle">
      <slot />
    </div>
    <img
      v-if="frameUrl"
      class="game-card-frame-border"
      :src="frameUrl"
      alt=""
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FrameContentInset } from "../../../../shared/types";

const props = defineProps<{
  ratio: "square" | "wide";
  frameUrl?: string | null;
  contentInsetPercent?: FrameContentInset;
  interactive?: boolean;
}>();

const emit = defineEmits<{
  (event: "click"): void;
}>();

const contentStyle = computed(() => {
  if (!props.frameUrl || !props.contentInsetPercent) return undefined;
  const inset = props.contentInsetPercent;
  return {
    padding: `${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}%`,
  };
});

function handleClick(): void {
  if (props.interactive !== false) emit("click");
}
</script>

<style scoped>
.game-card-frame {
  position: relative;
  display: block;
  width: 100%;
  box-sizing: border-box;
  overflow: visible;
  background: transparent;
}

.game-card-frame-content {
  position: relative;
  z-index: 1;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: visible;
}

.game-card-frame--interactive,
.game-card-frame--interactive .game-card-frame-content {
  cursor: pointer;
}

.game-card-frame-border {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
  transition: filter 0.25s ease;
}

.game-card-frame--interactive:hover .game-card-frame-border {
  filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.22));
}
</style>
