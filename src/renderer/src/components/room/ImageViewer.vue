<template>
  <teleport to="body">
    <div v-if="show" class="image-viewer-overlay" @click="emit('close')">
      <img :src="src" class="viewer-image" @click.stop />
    </div>
  </teleport>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean
  src: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='10' cy='10' r='6.5' fill='none' stroke='%23fff' stroke-width='1.8' opacity='.9'/%3E%3Cline x1='14.6' y1='14.6' x2='21' y2='21' stroke='%23fff' stroke-width='2' stroke-linecap='round' opacity='.9'/%3E%3Cpath d='M7 10h6' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' opacity='.9'/%3E%3C/svg%3E") 12 12, pointer;
}

.viewer-image {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  cursor: default;
  user-select: none;
}
</style>
