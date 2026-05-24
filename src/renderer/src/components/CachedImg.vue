<template>
  <img :src="resolvedSrc" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";

const props = defineProps<{ src: string }>();

const resolvedSrc = ref(props.src);

let controller: AbortController | null = null;

async function resolve(src: string) {
  if (controller) {
    controller.abort();
  }
  controller = new AbortController();

  resolvedSrc.value = src;
  if (!src) return;

  try {
    const dataUrl = await window.electronAPI.market.getCachedImage(src);
    if (!controller.signal.aborted) {
      resolvedSrc.value = dataUrl;
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
