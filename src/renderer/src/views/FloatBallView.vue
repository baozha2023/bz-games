<template>
  <div class="float-ball-wrapper" :class="{ dragging: isDragging }">
    <svg class="float-ball-ring" viewBox="0 0 72 72" aria-hidden="true">
      <circle
        class="float-ball-track"
        cx="36"
        cy="36"
        r="33"
        pathLength="100"
      />
      <circle
        class="float-ball-progress"
        cx="36"
        cy="36"
        r="33"
        pathLength="100"
        :stroke="progressStrokeColor"
        :stroke-dashoffset="100 - displayedProgress"
      />
    </svg>
    <div class="float-ball-content">
      <div class="progress-text">{{ Math.round(displayedProgress) }}%</div>
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
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { FloatBallProgress, MarketTaskState } from "../../../shared/types";

const progress = ref<FloatBallProgress>({
  totalProgress: 0,
  activeTaskCount: 0,
  completedTaskCount: 0,
  totalTaskCount: 0,
});

const isDragging = ref(false);
const displayedProgress = ref(0);

const skinColors = ref({
  low: "#2080f0",
  mid: "#f0a020",
  high: "#18a058",
});

const progressStrokeColor = computed(() => {
  if (
    progress.value.activeTaskCount === 0 &&
    progress.value.completedTaskCount > 0
  ) {
    return skinColors.value.high;
  }
  if (progress.value.totalProgress < 30) return skinColors.value.low;
  if (progress.value.totalProgress < 70) return skinColors.value.mid;
  return skinColors.value.high;
});

let cleanupFloatBallEvent: (() => void) | undefined;
let cleanupDragState: (() => void) | undefined;
let animationFrameId: number | undefined;
let animationTarget = 0;
let lastAnimationTime = 0;
let floatBallEventRevision = 0;
let mounted = false;

function stopProgressAnimation() {
  if (animationFrameId !== undefined) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }
  lastAnimationTime = 0;
}

function animateProgress(timestamp: number) {
  const elapsed =
    lastAnimationTime === 0 ? 16 : Math.min(64, timestamp - lastAnimationTime);
  lastAnimationTime = timestamp;
  const distance = animationTarget - displayedProgress.value;

  if (Math.abs(distance) < 0.05) {
    displayedProgress.value = animationTarget;
    animationFrameId = undefined;
    lastAnimationTime = 0;
    return;
  }

  const smoothing = 1 - Math.exp(-elapsed / 120);
  displayedProgress.value += distance * smoothing;
  animationFrameId = requestAnimationFrame(animateProgress);
}

function applyProgress(next: FloatBallProgress) {
  const previousActiveCount = progress.value.activeTaskCount;
  progress.value = next;
  animationTarget = Math.max(0, Math.min(100, next.totalProgress));

  // A newly shown task starts from its real value. Never animate backwards
  // from the previous task's retained progress.
  if (previousActiveCount === 0 || animationTarget < displayedProgress.value) {
    stopProgressAnimation();
    displayedProgress.value = animationTarget;
    return;
  }

  if (animationFrameId === undefined) {
    animationFrameId = requestAnimationFrame(animateProgress);
  }
}

onMounted(async () => {
  mounted = true;

  cleanupFloatBallEvent = window.electronAPI.market.onFloatBallEvent((p) => {
    floatBallEventRevision++;
    applyProgress(p);
  });

  cleanupDragState = window.electronAPI.market.onDragState((dragging) => {
    isDragging.value = dragging;
  });

  // Subscribe before requesting the snapshot so a very fast task cannot
  // complete in the gap between the initial read and event registration.
  const revisionAtRequest = floatBallEventRevision;
  const states = await window.electronAPI.market.getAllTaskStates();
  if (mounted && revisionAtRequest === floatBallEventRevision) {
    applyProgress(progressFromStates(states));
  }
});

onUnmounted(() => {
  mounted = false;
  stopProgressAnimation();
  if (cleanupFloatBallEvent) cleanupFloatBallEvent();
  if (cleanupDragState) cleanupDragState();
});

function progressFromStates(states: MarketTaskState[]): FloatBallProgress {
  let weightedProgressSum = 0;
  let totalWeight = 0;
  let activeCount = 0;
  let completedCount = 0;
  const terminalStatuses = ["completed", "error", "canceled"];

  for (const s of states) {
    if (terminalStatuses.includes(s.status)) {
      if (s.status === "completed") completedCount++;
      continue;
    }
    activeCount++;
    const weight = s.totalBytes || 0;
    if (weight > 0) {
      weightedProgressSum += Math.max(0, Math.min(100, s.progress)) * weight;
      totalWeight += weight;
    }
  }

  return {
    totalProgress:
      totalWeight === 0
        ? 0
        : Math.min(100, Math.round(weightedProgressSum / totalWeight)),
    activeTaskCount: activeCount,
    completedTaskCount: completedCount,
    totalTaskCount: states.length,
  };
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
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.2s ease;
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
  overflow: visible;
  transform: rotate(-90deg);
  transition: filter 0.2s ease;
}

.float-ball-wrapper:active .float-ball-ring,
.float-ball-wrapper.dragging .float-ball-ring {
  filter: drop-shadow(var(--fb-drag-shadow));
}

.float-ball-track,
.float-ball-progress {
  fill: var(--fb-content-bg);
  stroke-width: var(--fb-ring-width);
}

.float-ball-track {
  stroke: var(--fb-ring-bg);
}

.float-ball-progress {
  fill: transparent;
  stroke-dasharray: 100;
  stroke-linecap: round;
  transition: stroke 0.25s ease;
  will-change: stroke-dashoffset;
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
