<template>
  <div class="awf-wrapper" :style="wrapperStyle">
    <n-avatar round :size="size" :src="src">
      <template v-if="!src">
        {{ name?.charAt(0)?.toUpperCase() || '?' }}
      </template>
    </n-avatar>
    <img
      v-if="frameDataUrl"
      class="awf-overlay"
      :src="frameDataUrl"
      :style="overlayStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAvatar } from 'naive-ui'

const FRAME_MARGIN = 60

const props = defineProps<{
  src?: string
  name?: string
  size: number
  frameFileName?: string
}>()

const frameDataUrl = ref<string | null>(null)
const frameNaturalWidth = ref<number>(0)

async function loadFrame(fileName: string) {
  try {
    const dataUrl = await window.electronAPI.settings.getAvatarFrameImage?.(fileName)
    if (!dataUrl) return
    frameDataUrl.value = dataUrl
    const img = new Image()
    img.onload = () => {
      frameNaturalWidth.value = img.naturalWidth
    }
    img.src = dataUrl
  } catch {
    // ignore
  }
}

watch(
  () => props.frameFileName,
  (name) => {
    if (name) loadFrame(name)
    else {
      frameDataUrl.value = null
      frameNaturalWidth.value = 0
    }
  },
  { immediate: true },
)

const wrapperStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

const overlayStyle = computed(() => {
  const w = frameNaturalWidth.value
  if (!w) return { display: 'none' }

  const contentSize = w - FRAME_MARGIN * 2
  const scale = w / contentSize
  const offsetPercent = -50 * (scale - 1)

  return {
    width: `${(scale * 100).toFixed(2)}%`,
    height: `${(scale * 100).toFixed(2)}%`,
    top: `${offsetPercent.toFixed(2)}%`,
    left: `${offsetPercent.toFixed(2)}%`,
  }
})
</script>

<style scoped>
.awf-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.awf-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 1;
}
</style>
