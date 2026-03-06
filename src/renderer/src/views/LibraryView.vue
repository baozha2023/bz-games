<template>
  <div
    class="library-root"
    style="padding: 24px;"
    @click="handleBackgroundClick"
    @dragenter.prevent="handleExternalDragEnter"
    @dragover.prevent="handleExternalDragOver"
    @dragleave.prevent="handleExternalDragLeave"
    @drop.prevent="handleExternalDrop"
  >
    <n-space justify="space-between" align="center" style="margin-bottom: 24px;">
      <h1 style="margin: 0;">{{ t('library.title') }}</h1>
      <n-space>
        <n-button v-if="isReorderMode" type="success" @click.stop="isReorderMode = false">
          {{ t('common.save') }}
        </n-button>
        <n-button type="primary" @click="handleAddGame">{{ t('library.addGameButton') }}</n-button>
      </n-space>
    </n-space>

    <n-grid x-gap="24" y-gap="24" cols="2 s:3 m:4 l:5 xl:6" responsive="screen">
      <n-grid-item 
        v-for="(game, index) in gameStore.games" 
        :key="game.id"
        :draggable="isReorderMode"
        @dragstart="handleDragStart($event, index)"
        @dragover.prevent="handleDragOver($event, index)"
        @drop="handleDrop($event, index)"
        @mousedown="handleMouseDown"
        @mouseup="clearLongPress"
        @mouseleave="clearLongPress"
        @contextmenu.prevent
      >
        <div class="game-card-wrapper" :class="{ 'shake': isReorderMode }">
          <GameCard :game="game" @click="goToDetail" />
          <div v-if="isReorderMode" class="reorder-overlay"></div>
        </div>
      </n-grid-item>
    </n-grid>

    <n-empty v-if="gameStore.games.length === 0" :description="t('library.emptyState')" style="margin-top: 100px;">
      <template #extra>
        <n-button @click="handleAddGame">{{ t('library.addGameShort') }}</n-button>
      </template>
    </n-empty>

    <div v-if="isDragActive && !isReorderMode" class="drop-overlay">
      <div class="drop-panel">{{ t('library.dropHint') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'
import GameCard from '../components/game/GameCard.vue'

const { t } = useI18n()
const gameStore = useGameStore()
const router = useRouter()
const message = useMessage()

const isReorderMode = ref(false)
const draggedIndex = ref<number | null>(null)
const isDragActive = ref(false)
let externalDragDepth = 0
let longPressTimer: NodeJS.Timeout | null = null

onMounted(() => {
  gameStore.loadGames()
})

const showAddGameResult = (result: Awaited<ReturnType<typeof gameStore.addGame>>) => {
  if (result.success) {
    if (result.manifest?.name && result.manifest?.version) {
      message.success(
        t('library.addSuccessWithVersion', {
          name: result.manifest.name,
          version: result.manifest.version
        })
      )
    } else {
      message.success(t('library.addSuccess'))
    }
  } else {
    // Ignore specific cancellations or known non-errors if any
    if (result.error === 'canceled') return;

    const errorKey = `library.importError.${result.error}`;
    const translated = t(errorKey, result.params || {});
    
    // Fallback if translation missing
    if (translated === errorKey) {
        message.error(result.error || t('library.addError'));
    } else {
        message.error(translated);
    }
  }
}

const handleAddGame = async () => {
  const result = await gameStore.addGame()
  showAddGameResult(result)
}

const goToDetail = (id: string) => {
  if (isReorderMode.value) return;
  router.push({ name: 'GameDetail', params: { id } })
}

// Long Press Logic
const handleMouseDown = () => {
  if (isReorderMode.value) return;
  longPressTimer = setTimeout(() => {
    isReorderMode.value = true;
  }, 800); // 长按 800ms触发
}

const clearLongPress = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

const handleBackgroundClick = () => {
  if (isReorderMode.value) {
    // If clicked on background (not on a game card which stops propagation), exit reorder mode
    // We rely on the button or specific action to exit usually, but clicking empty space is nice
    // However, n-grid-item might bubble up. 
    // Let's rely on the "Save" button or re-clicking empty space.
    // For now, let's keep it simple: Button to exit.
  }
}

// Drag and Drop Logic
const handleDragStart = (e: DragEvent, index: number) => {
  if (!isReorderMode.value) {
    e.preventDefault();
    return;
  }
  draggedIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // 默认拖拽样式
  }
}

const handleDragOver = (_: DragEvent, index: number) => {
  if (draggedIndex.value === null || draggedIndex.value === index) return;
  // 可在此添加视觉反馈
}

const handleDrop = async (_: DragEvent, index: number) => {
  if (draggedIndex.value === null || draggedIndex.value === index) return;
  
  const games = [...gameStore.games];
  const item = games.splice(draggedIndex.value, 1)[0];
  games.splice(index, 0, item);
  
  const newOrderIds = games.map(g => g.id);
  await gameStore.reorderGames(newOrderIds);
  
  draggedIndex.value = null;
}

const handleExternalDragOver = (e: DragEvent) => {
  if (isReorderMode.value) return
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

const handleExternalDragEnter = (e: DragEvent) => {
  if (isReorderMode.value) return
  const hasFile = Array.from(e.dataTransfer?.items || []).some((item) => item.kind === 'file')
  if (!hasFile) return
  externalDragDepth += 1
  isDragActive.value = true
}

const handleExternalDragLeave = (e: DragEvent) => {
  if (isReorderMode.value) return
  const hasFile = Array.from(e.dataTransfer?.items || []).some((item) => item.kind === 'file')
  if (!hasFile) return
  externalDragDepth = Math.max(0, externalDragDepth - 1)
  if (externalDragDepth === 0) {
    isDragActive.value = false
  }
}

const getDroppedFilePath = (file: File | null): string => {
  if (!file) return ''
  const bridgedPath = window.electronAPI.game.getPathForFile(file)
  if (bridgedPath) return bridgedPath
  return (file as unknown as { path?: string }).path || ''
}

const handleExternalDrop = async (e: DragEvent) => {
  externalDragDepth = 0
  isDragActive.value = false
  if (isReorderMode.value) return
  const files = Array.from(e.dataTransfer?.files || [])
  const droppedPath = files
    .map(file => getDroppedFilePath(file))
    .find(path => Boolean(path?.trim())) || ''

  if (!droppedPath) {
    message.error(t('library.importError.notDirectory'))
    return
  }

  const result = await gameStore.addGame(droppedPath)
  showAddGameResult(result)
}
</script>

<style scoped>
.library-root {
  position: relative;
}
.game-card-wrapper {
  position: relative;
  transition: transform 0.2s;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  border: 2px dashed #18a058;
  border-radius: 8px;
  background: rgba(24, 160, 88, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 100;
}
.drop-panel {
  background: rgba(24, 160, 88, 0.95);
  color: #fff;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
}
.reorder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.1);
  z-index: 10;
  cursor: move;
  border-radius: 4px;
  border: 2px dashed #2080f0;
}

@keyframes shake {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(1deg); }
  50% { transform: rotate(0deg); }
  75% { transform: rotate(-1deg); }
  100% { transform: rotate(0deg); }
}

.shake {
  animation: shake 0.3s infinite;
}
</style>
