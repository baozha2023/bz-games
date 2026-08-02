<template>
  <n-image-preview :show="show" :src="src" @update:show="handleShowChange" />
</template>

<script setup lang="ts">
import { NImagePreview } from "naive-ui";

defineProps<{
  show: boolean;
  src: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

function handleShowChange(nextShow: boolean) {
  if (!nextShow) emit("close");
}
</script>
