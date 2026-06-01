<template>
  <div class="float-ball-wrapper" :class="{ dragging: isDragging }">
    <div class="float-ball-ring" :style="ringStyle" />
    <div class="float-ball-content">
      <div class="progress-text">{{ progress.totalProgress }}%</div>
      <div class="task-text" v-if="progress.activeTaskCount > 0">
        {{ progress.activeTaskCount }}/{{ progress.totalTaskCount }}
      </div>
      <div class="task-text done" v-else-if="progress.totalTaskCount > 0">
        ✓
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { FloatBallProgress, MarketTaskState } from '../../../shared/types'

const progress = ref<FloatBallProgress>({
  totalProgress: 0,
  activeTaskCount: 0,
  completedTaskCount: 0,
  totalTaskCount: 0,
})

const isDragging = ref(false)

const skinColors = ref({
  low: '#2080f0',
  mid: '#f0a020',
  high: '#18a058',
})

const progressStrokeColor = computed(() => {
  if (progress.value.activeTaskCount === 0 && progress.value.completedTaskCount > 0) {
    return skinColors.value.high
  }
  if (progress.value.totalProgress < 30) return skinColors.value.low
  if (progress.value.totalProgress < 70) return skinColors.value.mid
  return skinColors.value.high
})

const ringStyle = computed(() => {
  const progressDeg = Math.max(0, Math.min(100, progress.value.totalProgress)) * 3.6
  return {
    '--fb-ring-active-color': progressStrokeColor.value,
    background: `conic-gradient(from -90deg, var(--fb-ring-active-color) 0deg ${progressDeg}deg, var(--fb-ring-bg) ${progressDeg}deg 360deg)`,
  }
})

let cleanupFloatBallEvent: (() => void) | undefined
let cleanupDragState: (() => void) | undefined

onMounted(async () => {
  const states = await window.electronAPI.market.getAllTaskStates()
  updateProgressFromStates(states)

  cleanupFloatBallEvent = window.electronAPI.market.onFloatBallEvent((p) => {
    progress.value = p
  })

  cleanupDragState = window.electronAPI.market.onDragState((dragging) => {
    isDragging.value = dragging
  })
})

onUnmounted(() => {
  if (cleanupFloatBallEvent) cleanupFloatBallEvent()
  if (cleanupDragState) cleanupDragState()
})

function updateProgressFromStates(states: MarketTaskState[]) {
  let weightedProgressSum = 0
  let totalWeight = 0
  let activeCount = 0
  let completedCount = 0
  const terminalStatuses = ['completed', 'error', 'canceled']

  for (const s of states) {
    if (terminalStatuses.includes(s.status)) {
      if (s.status === 'completed') completedCount++
      continue
    }
    activeCount++
    const weight = s.totalBytes || 0
    if (weight > 0) {
      weightedProgressSum += Math.max(0, Math.min(100, s.progress)) * weight
      totalWeight += weight
    }
  }

  progress.value = {
    totalProgress: totalWeight === 0 ? 0 : Math.min(100, Math.round(weightedProgressSum / totalWeight)),
    activeTaskCount: activeCount,
    completedTaskCount: completedCount,
    totalTaskCount: states.length,
  }
}
</script>

<style scoped>
:global(html:has(.float-ball-wrapper)),
:global(body:has(.float-ball-wrapper)),
:global(#app:has(.float-ball-wrapper)),
:global(#app:has(.float-ball-wrapper) > div) {
  width: 100%;
  height: 100%;
  min-height: 0 !important;
  overflow: hidden;
}

:global(body:has(.float-ball-wrapper)) {
  display: flex;
  align-items: center;
  justify-content: center;
}

:global(#app:has(.float-ball-wrapper)) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.float-ball-wrapper {
  --fb-size: 72px;
  --fb-border-radius: 50%;
  --fb-ring-width: 6px;
  --fb-ring-border-radius: 50%;
  --fb-ring-bg: #e8e8e8;
  --fb-ring-color-low: #2080f0;
  --fb-ring-color-mid: #f0a020;
  --fb-ring-color-high: #18a058;
  --fb-content-bg: #ffffff;
  --fb-content-border-radius: 50%;
  --fb-text-color: #333333;
  --fb-text-secondary: #808080;
  --fb-done-color: #18a058;
  --fb-active-scale: 0.88;
  --fb-drag-scale: 0.92;
  --fb-drag-opacity: 0.85;
  --fb-drag-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);

  width: var(--fb-size);
  height: var(--fb-size);
  flex: 0 0 var(--fb-size);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: drag;
  user-select: none;
  position: relative;
  border-radius: var(--fb-border-radius);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
  will-change: transform, opacity;
}

.float-ball-wrapper:active {
  transform: scale(var(--fb-active-scale));
  transition: transform 0.1s ease-out;
}

.float-ball-wrapper.dragging {
  transform: scale(var(--fb-drag-scale));
  opacity: var(--fb-drag-opacity);
}

.float-ball-ring {
  position: absolute;
  width: var(--fb-size);
  height: var(--fb-size);
  z-index: 1;
  border-radius: var(--fb-ring-border-radius);
  background: var(--fb-ring-bg);
  transition: background 0.4s ease, box-shadow 0.2s ease;
}

.float-ball-wrapper:active .float-ball-ring,
.float-ball-wrapper.dragging .float-ball-ring {
  box-shadow: var(--fb-drag-shadow);
}

.float-ball-ring::after {
  content: '';
  position: absolute;
  inset: var(--fb-ring-width);
  border-radius: var(--fb-content-border-radius);
  background: var(--fb-content-bg);
}

.float-ball-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: calc(var(--fb-size) - var(--fb-ring-width) * 2);
  height: calc(var(--fb-size) - var(--fb-ring-width) * 2);
  border-radius: var(--fb-content-border-radius);
  background: var(--fb-content-bg);
}

.progress-text {
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  color: var(--fb-text-color);
}

.task-text {
  font-size: 9px;
  color: var(--fb-text-secondary);
  margin-top: 2px;
}

.task-text.done {
  color: var(--fb-done-color);
  font-size: 12px;
}
</style>
