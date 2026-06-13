<template>
  <img :src="resolvedSrc" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { useImageCache } from "../composables/useImageCache";

const MARKET_IMAGE_TTL_MS = 60 * 60 * 1000;

const props = defineProps<{ src: string }>();

const resolvedSrc = ref(props.src);

let controller: AbortController | null = null;

const { load: loadCached } = useImageCache();

async function resolve(src: string) {
  if (controller) {
    controller.abort();
  }
  controller = new AbortController();

  resolvedSrc.value = src;
  if (!src) return;

  try {
    const dataUrl = await loadCached(src, () =>
      window.electronAPI.market.getCachedImage(src),
      MARKET_IMAGE_TTL_MS,
    );
    if (!controller.signal.aborted) {
      resolvedSrc.value = dataUrl || src;
    }
  } catch {
    if (!controller.signal.aborted) {
      resolvedSrc.value = src;
    }
  }
}

watch(() => props.src, resolve, { immediate: true });

onUnmounted(() => {
  if (controller) {
    controller.abort();
  }
});
</script>
