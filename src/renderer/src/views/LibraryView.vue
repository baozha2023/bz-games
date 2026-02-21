<template>
  <div style="padding: 24px;" @click="handleBackgroundClick">
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
let longPressTimer: NodeJS.Timeout | null = null

onMounted(() => {
  gameStore.loadGames()
})

const handleAddGame = async () => {
  const result = await gameStore.addGame()
  if (result.success) {
    message.success(t('library.addSuccess'))
  } else if (result.error !== 'User canceled') {
    message.error(result.error || t('library.addError'))
  }
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
</script>

<style scoped>
.game-card-wrapper {
  position: relative;
  transition: transform 0.2s;
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
