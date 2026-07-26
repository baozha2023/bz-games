<template>
  <div
    class="achievement-icon"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <img v-if="iconUrl" :src="iconUrl" :class="{ locked }" alt="" />
    <n-icon
      v-else
      :size="size"
      :color="locked ? 'var(--bz-icon-locked)' : 'var(--bz-amber)'"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M20.2 2H3.8C2.8 2 2 2.8 2 3.8v4.4c0 1 .8 1.8 1.8 1.8h.4c.5 2.8 3 4.9 6 5v.5c0 .8.7 1.5 1.5 1.5h.6v2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h7.4c1.1 0 2-.9 2-2s-.9-2-2-2h-2v-2h.6c.8 0 1.5-.7 1.5-1.5v-.5c3-.1 5.5-2.2 6-5h.4c1 0 1.8-.8 1.8-1.8V3.8C22 2.8 21.2 2 20.2 2M5.8 8h-2V4h2zm14.4 0h-2V4h2z"
        />
      </svg>
    </n-icon>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useImageCache, gameAssetKey } from "../../composables/useImageCache";

const props = withDefaults(
  defineProps<{
    gameId: string;
    version: string;
    achievementId: string;
    hasCustomIcon?: boolean;
    locked?: boolean;
    size?: number;
  }>(),
  {
    hasCustomIcon: false,
    locked: false,
    size: 48,
  },
);

const iconUrl = ref<string | null>(null);
const { load } = useImageCache();

watch(
  () =>
    [
      props.gameId,
      props.version,
      props.achievementId,
      props.hasCustomIcon,
    ] as const,
  async ([gameId, version, achievementId, hasCustomIcon]) => {
    iconUrl.value = null;
    if (!hasCustomIcon || !gameId || !version || !achievementId) return;
    iconUrl.value = await load(
      gameAssetKey(gameId, version, `achievement:${achievementId}`),
      () =>
        window.electronAPI.game.getAchievementIcon(
          gameId,
          version,
          achievementId,
        ),
      0,
    );
  },
  { immediate: true },
);
</script>

<style scoped>
.achievement-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.achievement-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.achievement-icon img.locked {
  filter: grayscale(1);
  opacity: 0.55;
}
</style>
