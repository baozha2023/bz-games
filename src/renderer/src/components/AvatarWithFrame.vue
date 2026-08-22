<template>
  <div
    class="awf-wrapper"
    :class="{ 'awf-wrapper--hoverable': hoverable }"
    :style="wrapperStyle"
  >
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
import {
  getAvatarFrameByFileName,
  normalizeAvatarFrameFileName,
} from '../../../shared/avatar-frames'

const props = defineProps<{
  src?: string
  name?: string
  size: number
  frameFileName?: string
  hoverable?: boolean
}>()

const frameDataUrl = ref<string | null>(null)
const frameNaturalWidth = ref<number>(0)
const frameNaturalHeight = ref<number>(0)
let frameLoadRequestId = 0

async function loadFrame(value: unknown) {
  const requestId = ++frameLoadRequestId
  const fileName = normalizeAvatarFrameFileName(value)
  if (!fileName) {
    frameDataUrl.value = null
    frameNaturalWidth.value = 0
    frameNaturalHeight.value = 0
    return
  }

  try {
    const dataUrl = await window.electronAPI.settings.getAvatarFrameImage?.(fileName)
    if (requestId !== frameLoadRequestId) return
    if (!dataUrl) {
      frameDataUrl.value = null
      frameNaturalWidth.value = 0
      frameNaturalHeight.value = 0
      return
    }
    frameDataUrl.value = dataUrl
    const img = new Image()
    img.onload = () => {
      if (requestId !== frameLoadRequestId) return
      frameNaturalWidth.value = img.naturalWidth
      frameNaturalHeight.value = img.naturalHeight
    }
    img.onerror = () => {
      if (requestId !== frameLoadRequestId) return
      frameDataUrl.value = null
      frameNaturalWidth.value = 0
      frameNaturalHeight.value = 0
    }
    img.src = dataUrl
  } catch {
    if (requestId !== frameLoadRequestId) return
    frameDataUrl.value = null
    frameNaturalWidth.value = 0
    frameNaturalHeight.value = 0
  }
}

watch(() => props.frameFileName, loadFrame, { immediate: true })

const wrapperStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

const overlayStyle = computed(() => {
  const w = frameNaturalWidth.value
  const h = frameNaturalHeight.value
  const frame = getAvatarFrameByFileName(props.frameFileName)
  if (!w || !h || !frame) return { display: 'none' }

  const { top, right, bottom, left } = frame.contentInsetPx
  const contentWidth = w - left - right
  const contentHeight = h - top - bottom
  if (contentWidth <= 0 || contentHeight <= 0) return { display: 'none' }

  return {
    width: `${((w / contentWidth) * 100).toFixed(2)}%`,
    height: `${((h / contentHeight) * 100).toFixed(2)}%`,
    top: `${((-top / contentHeight) * 100).toFixed(2)}%`,
    left: `${((-left / contentWidth) * 100).toFixed(2)}%`,
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

.awf-wrapper--hoverable {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.awf-wrapper--hoverable:hover {
  transform: scale(1.08);
}

.awf-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 1;
}

.awf-wrapper--hoverable .awf-overlay {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
  transition: filter 0.2s ease;
}

.awf-wrapper--hoverable:hover .awf-overlay {
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.22));
}
</style>
