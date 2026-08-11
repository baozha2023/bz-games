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
import { normalizeAvatarFrameFileName } from '../../../shared/avatar-frames'

const FRAME_MARGIN = 60

const props = defineProps<{
  src?: string
  name?: string
  size: number
  frameFileName?: string
}>()

const frameDataUrl = ref<string | null>(null)
const frameNaturalWidth = ref<number>(0)
let frameLoadRequestId = 0

async function loadFrame(value: unknown) {
  const requestId = ++frameLoadRequestId
  const fileName = normalizeAvatarFrameFileName(value)
  if (!fileName) {
    frameDataUrl.value = null
    frameNaturalWidth.value = 0
    return
  }

  try {
    const dataUrl = await window.electronAPI.settings.getAvatarFrameImage?.(fileName)
    if (requestId !== frameLoadRequestId) return
    if (!dataUrl) {
      frameDataUrl.value = null
      frameNaturalWidth.value = 0
      return
    }
    frameDataUrl.value = dataUrl
    const img = new Image()
    img.onload = () => {
      if (requestId !== frameLoadRequestId) return
      frameNaturalWidth.value = img.naturalWidth
    }
    img.onerror = () => {
      if (requestId !== frameLoadRequestId) return
      frameDataUrl.value = null
      frameNaturalWidth.value = 0
    }
    img.src = dataUrl
  } catch {
    if (requestId !== frameLoadRequestId) return
    frameDataUrl.value = null
    frameNaturalWidth.value = 0
  }
}

watch(() => props.frameFileName, loadFrame, { immediate: true })

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
