<template>
  <div class="image-selection-panel">
    <n-space align="center">
      <n-button
        secondary
        :loading="selecting"
        :disabled="disabled || images.length >= maxImages"
        @click="emit('select')"
      >
        {{ selectLabel }}
      </n-button>
      <n-text depth="3">{{ limitsLabel }}</n-text>
      <n-button
        v-if="images.length"
        text
        type="error"
        :disabled="clearDisabled"
        @click="emit('clear')"
      >
        {{ clearLabel }}
      </n-button>
    </n-space>

    <div v-if="images.length" class="image-selection-grid">
      <div v-for="image in images" :key="image.id" class="image-selection-item">
        <img :src="image.previewUrl" :alt="image.fileName" />
        <button
          type="button"
          :aria-label="removeLabel"
          :disabled="disabled"
          @click="emit('remove', image.id)"
        >
          ×
        </button>
        <div class="image-selection-name" :title="image.fileName">
          {{ image.fileName }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ImageSelectionItem {
  id: string;
  fileName: string;
  previewUrl: string;
}

withDefaults(
  defineProps<{
    images: ImageSelectionItem[];
    selectLabel: string;
    limitsLabel: string;
    clearLabel: string;
    removeLabel: string;
    selecting?: boolean;
    disabled?: boolean;
    clearDisabled?: boolean;
    maxImages?: number;
  }>(),
  {
    selecting: false,
    disabled: false,
    clearDisabled: false,
    maxImages: 4,
  },
);

const emit = defineEmits<{
  select: [];
  clear: [];
  remove: [imageId: string];
}>();
</script>

<style scoped>
.image-selection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 144px);
  gap: 12px;
  margin-top: 12px;
}

.image-selection-item {
  position: relative;
  min-width: 0;
}

.image-selection-item img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: contain;
  background: var(--n-color-modal);
}

.image-selection-item button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  cursor: pointer;
}

.image-selection-item button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.image-selection-name {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}
</style>
