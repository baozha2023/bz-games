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
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              quaternary
              @click="layoutMode = layoutMode === 'card' ? 'icon' : 'card'"
            >
              <template #icon>
                <n-icon :size="20">
                  <GridOutline v-if="layoutMode === 'card'" />
                  <AppsOutline v-else />
                </n-icon>
              </template>
            </n-button>
          </template>
          {{ layoutMode === 'card' ? t('library.iconLayout') : t('library.cardLayout') }}
        </n-tooltip>
        <n-button v-if="isReorderMode" type="success" @click.stop="isReorderMode = false">
          {{ t('common.save') }}
        </n-button>
        <n-button type="primary" @click="handleAddGame">{{ t('library.addGameButton') }}</n-button>
      </n-space>
    </n-space>

    <n-grid
      :x-gap="layoutMode === 'icon' ? 12 : 24"
      :y-gap="layoutMode === 'icon' ? 12 : 24"
      :cols="layoutMode === 'icon' ? '4 s:6 m:8 l:10 xl:12' : '2 s:3 m:4 l:5 xl:6'"
      responsive="screen"
    >
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
        @contextmenu.prevent="handleContextMenu($event, game.id)"
      >
        <div class="game-card-wrapper" :class="{ 'shake': isReorderMode, 'icon-mode': layoutMode === 'icon' }" :data-game-id="game.id">
          <GameCard :game="game" :compact="layoutMode === 'icon'" @click="goToDetail" />
          <div v-if="isReorderMode" class="reorder-overlay"></div>
        </div>
      </n-grid-item>
    </n-grid>

    <n-empty v-if="gameStore.games.length === 0" :description="t('library.emptyState')" style="margin-top: 100px;">
      <template #extra>
        <n-button @click="handleAddGame">{{ t('library.addGameShort') }}</n-button>
      </template>
    </n-empty>

    <div
      v-if="isDragActive && !isReorderMode"
      class="drop-overlay"
      @dragover.stop.prevent="handleExternalDragOver"
      @drop.stop.prevent="handleExternalDrop"
    >
      <div class="drop-panel">{{ t('library.dropHint') }}</div>
    </div>

    <n-dropdown
      trigger="manual"
      :show="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      @select="handleContextMenuSelect"
      @clickoutside="contextMenuVisible = false"
    />

    <n-modal
      v-model:show="showImportDraftModal"
      preset="card"
      :title="t('library.importDraftTitle')"
      style="width: 760px;"
    >
      <n-space vertical size="large">
        <n-form :model="draftForm" label-placement="top" class="import-draft-form">
          <n-grid :cols="2" :x-gap="16" :y-gap="4">
            <n-form-item-gi :label="t('library.importDraftFields.id')" path="id" required>
              <n-space vertical size="small" style="width: 100%;">
                <n-input
                  v-model:value="draftForm.id"
                  :placeholder="t('library.importDraftPlaceholders.id')"
                />
                <n-space align="center" size="small">
                  <n-tag
                    v-if="idCheckState !== 'idle'"
                    size="small"
                    :type="idCheckState === 'exists' ? 'error' : idCheckState === 'available' ? 'success' : 'warning'"
                    :bordered="false"
                  >
                    {{
                      idCheckState === 'checking'
                        ? t('library.importDraftIdCheckLoading')
                        : idCheckState === 'exists'
                          ? t('library.importDraftIdExists')
                          : t('library.importDraftIdAvailable')
                    }}
                  </n-tag>
                  <n-text depth="3">{{ t('library.importDraftIdFormatHint') }}</n-text>
                </n-space>
              </n-space>
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.name')" path="name" required>
              <n-input
                v-model:value="draftForm.name"
                :placeholder="t('library.importDraftPlaceholders.name')"
              />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.version')" path="version" required>
              <n-input
                v-model:value="draftForm.version"
                :placeholder="t('library.importDraftPlaceholders.version')"
              />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.author')" path="author" required>
              <n-input
                v-model:value="draftForm.author"
                :placeholder="t('library.importDraftPlaceholders.author')"
              />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.platformVersion')" required>
              <n-input :value="draftForm.platformVersion" disabled />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.type')" required>
              <n-select v-model:value="draftForm.type" :options="draftTypeOptions" />
            </n-form-item-gi>
            <n-form-item-gi
              :span="2"
              :label="t('library.importDraftFields.entry')"
              path="entry"
              required
            >
              <n-space vertical size="small" style="width: 100%;">
                <n-input
                  v-model:value="draftForm.entry"
                  :placeholder="t('library.importDraftPlaceholders.entry')"
                />
                <n-text depth="3">{{ t('library.importDraftEntryHint') }}</n-text>
              </n-space>
            </n-form-item-gi>
            <n-form-item-gi
              v-if="isUrlEntry"
              :span="2"
              :label="t('library.importDraftFields.web_url')"
              path="web_url"
              required
            >
              <n-space vertical size="small" style="width: 100%;">
                <n-input
                  v-model:value="draftForm.web_url"
                  :placeholder="t('library.importDraftPlaceholders.web_url')"
                />
                <n-text depth="3">{{ t('library.importDraftWebUrlHint') }}</n-text>
              </n-space>
            </n-form-item-gi>
            <n-form-item-gi :span="2" :label="t('library.importDraftFields.description')">
              <n-input
                v-model:value="draftForm.description"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 5 }"
                :placeholder="t('library.importDraftPlaceholders.description')"
              />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.icon')">
              <n-input
                v-model:value="draftForm.icon"
                :placeholder="t('library.importDraftPlaceholders.icon')"
              />
            </n-form-item-gi>
            <n-form-item-gi :label="t('library.importDraftFields.cover')">
              <n-input
                v-model:value="draftForm.cover"
                :placeholder="t('library.importDraftPlaceholders.cover')"
              />
            </n-form-item-gi>
            <n-form-item-gi
              v-if="needsMultiplayerConfig"
              :label="t('library.importDraftFields.minPlayers')"
              required
            >
              <n-input-number v-model:value="draftForm.minPlayers" :min="2" :max="64" style="width: 100%;" />
            </n-form-item-gi>
            <n-form-item-gi
              v-if="needsMultiplayerConfig"
              :label="t('library.importDraftFields.maxPlayers')"
              required
            >
              <n-input-number v-model:value="draftForm.maxPlayers" :min="2" :max="64" style="width: 100%;" />
            </n-form-item-gi>
          </n-grid>
        </n-form>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showImportDraftModal = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="isDraftSubmitting" @click="handleConfirmDraftImport">
            {{ t('library.importDraftSubmit') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <GameDeleteModal
      v-model:show="showDeleteModal"
      :versions="deleteVersions"
      :initial-selected="deleteVersions"
      :loading="isDeleting"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch, h, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMessage, NIcon, NTooltip, NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { GridOutline, AppsOutline, Heart, HeartOutline, ArrowUpOutline, TrashOutline } from '@vicons/ionicons5'
import { useGameStore } from '../stores/useGameStore'
import GameCard from '../components/game/GameCard.vue'
import GameDeleteModal from '../components/game/GameDeleteModal.vue'
import { playShatterEffect } from '../utils/deleteEffect'

const { t } = useI18n()
const gameStore = useGameStore()
const router = useRouter()
const route = useRoute()
const message = useMessage()

const layoutMode = ref<'card' | 'icon'>('card')
const isReorderMode = ref(false)
const draggedIndex = ref<number | null>(null)
const isDragActive = ref(false)
let externalDragDepth = 0
let longPressTimer: NodeJS.Timeout | null = null
let idCheckTimer: number | null = null
const showImportDraftModal = ref(false)
const isDraftSubmitting = ref(false)
const pendingImportSourcePath = ref('')
const idCheckState = ref<'idle' | 'checking' | 'exists' | 'available'>('idle')

const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuVisible = ref(false)
const rightClickedGameId = ref<string | null>(null)

const showDeleteModal = ref(false)
const deleteVersions = ref<string[]>([])
const isDeleting = ref(false)
const deleteGameId = ref<string | null>(null)

const draftForm = ref({
  id: '',
  name: '',
  version: '1.0.0',
  description: '',
  author: '',
  platformVersion: '',
  entry: '',
  web_url: '',
  icon: '',
  cover: '',
  type: 'singleplayer' as 'singleplayer' | 'multiplayer' | 'singlemultiple' | 'networkgame',
  minPlayers: 2,
  maxPlayers: 4
})

const draftTypeOptions = computed(() => [
  { label: t('gameDetail.typeSingleplayer'), value: 'singleplayer' },
  { label: t('gameDetail.typeMultiplayer'), value: 'multiplayer' },
  { label: t('gameDetail.typeSingleMultiple'), value: 'singlemultiple' },
  { label: t('gameDetail.typeNetworkGame'), value: 'networkgame' }
])

const isUrlEntry = computed(() => draftForm.value.entry.trim().toLowerCase() === 'url')
const needsMultiplayerConfig = computed(
  () => draftForm.value.type === 'multiplayer' || draftForm.value.type === 'singlemultiple'
)

const isRightClickedFavorite = computed(() => {
  if (!rightClickedGameId.value) return false
  const record = gameStore.getGameRecord(rightClickedGameId.value)
  return record?.isFavorite || false
})

const contextMenuOptions = computed(() => {
  const favLabel = isRightClickedFavorite.value ? 'library.unfavorite' : 'library.favorite'
  const favIcon = isRightClickedFavorite.value ? HeartOutline : Heart
  return [
    {
      label: t(favLabel),
      key: 'favorite',
      icon: () => h(NIcon, null, { default: () => h(favIcon) }),
    },
    {
      label: t('library.moveToFront'),
      key: 'moveToFront',
      icon: () => h(NIcon, null, { default: () => h(ArrowUpOutline) }),
    },
    {
      label: t('library.deleteGameTitle'),
      key: 'delete',
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
    },
  ]
})

const handleContextMenu = (e: MouseEvent, gameId: string) => {
  if (isReorderMode.value) return
  contextMenuX.value = e.clientX + 60
  contextMenuY.value = e.clientY + 4
  rightClickedGameId.value = gameId
  contextMenuVisible.value = true
}

const handleContextMenuSelect = (key: string) => {
  contextMenuVisible.value = false
  const gameId = rightClickedGameId.value
  if (!gameId) return
  if (key === 'favorite') {
    handleToggleFavorite(gameId)
  } else if (key === 'moveToFront') {
    handleMoveToFront(gameId)
  } else if (key === 'delete') {
    handleDelete(gameId)
  }
}

const handleToggleFavorite = async (gameId: string) => {
  try {
    await gameStore.toggleFavorite(gameId)
  } catch {
    message.error(t('common.error'))
  }
}

const handleMoveToFront = async (gameId: string) => {
  const newOrder = [gameId, ...gameStore.games.filter(g => g.id !== gameId).map(g => g.id)]
  await gameStore.reorderGames(newOrder)
}

const handleDelete = async (gameId: string) => {
  try {
    const v = await window.electronAPI.game.getVersions(gameId)
    deleteGameId.value = gameId
    deleteVersions.value = v || []
    showDeleteModal.value = true
  } catch {
    message.error(t('common.error'))
  }
}

const confirmDelete = async (versionsToDelete: string[]) => {
  if (isDeleting.value || !deleteGameId.value) return
  isDeleting.value = true
  showDeleteModal.value = false
  const gameId = deleteGameId.value
  try {
    const cardEl = document.querySelector(`[data-game-id="${gameId}"]`) as HTMLElement | null
    if (cardEl) {
      playShatterEffect(cardEl)
    }
    await gameStore.removeGame(gameId, [...versionsToDelete])
    message.success(t('gameDetail.deleteSuccess'))
  } catch {
    message.error(t('common.error'))
  } finally {
    isDeleting.value = false
  }
}

onMounted(async () => {
  const deletedGameId = route.query.deletedGameId as string | undefined
  if (deletedGameId) {
    await nextTick()
    await new Promise((r) => requestAnimationFrame(r))
    const deletedVersions = ((route.query.deletedVersions as string) || '').split(',').filter(Boolean)
    const cardEl = document.querySelector(`[data-game-id="${deletedGameId}"]`) as HTMLElement | null
    if (cardEl) {
      playShatterEffect(cardEl)
    }
    await gameStore.removeGame(deletedGameId, deletedVersions)
    message.success(t('gameDetail.deleteSuccess'))
    router.replace({ name: 'Library' })
    return
  }
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
  if (result.error === 'noManifest' && result.params?.sourcePath) {
    message.info(t('library.importError.noManifest'))
    await openImportDraftModal(result.params.sourcePath as string)
    return
  }
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
  if (!isReorderMode.value) return
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
  if (result.error === 'noManifest' && result.params?.sourcePath) {
    message.info(t('library.importError.noManifest'))
    await openImportDraftModal(result.params.sourcePath as string)
    return
  }
  showAddGameResult(result)
}

const openImportDraftModal = async (sourcePath: string) => {
  const prep = await window.electronAPI.game.prepareImport(sourcePath)
  if (!prep) {
    message.error(t('library.importError.notDirectory'))
    return
  }
  pendingImportSourcePath.value = prep.sourcePath
  draftForm.value = {
    id: prep.suggestedId,
    name: prep.suggestedName,
    version: '1.0.0',
    description: '',
    author: '',
    platformVersion: prep.currentPlatformVersion,
    entry: prep.suggestedEntry,
    web_url: '',
    icon: '',
    cover: '',
    type: 'singleplayer',
    minPlayers: 2,
    maxPlayers: 4
  }
  showImportDraftModal.value = true
}

watch(
  () => draftForm.value.id,
  (next) => {
    if (idCheckTimer) {
      window.clearTimeout(idCheckTimer)
    }
    const normalized = next.trim()
    if (!normalized) {
      idCheckState.value = 'idle'
      return
    }
    idCheckState.value = 'checking'
    idCheckTimer = window.setTimeout(async () => {
      const exists = await window.electronAPI.game.checkIdExists(normalized)
      idCheckState.value = exists ? 'exists' : 'available'
      idCheckTimer = null
    }, 250)
  }
)

const handleConfirmDraftImport = async () => {
  const id = draftForm.value.id.trim()
  const name = draftForm.value.name.trim()
  const version = draftForm.value.version.trim()
  const author = draftForm.value.author.trim()
  const entry = draftForm.value.entry.trim()
  const webUrl = draftForm.value.web_url.trim()
  if (!id || !name || !version || !author || !entry) {
    message.error(t('library.importDraftRequired'))
    return
  }
  if (entry.toLowerCase() === 'url') {
    try {
      const parsed = new URL(webUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('invalid protocol')
      }
    } catch {
      message.error(t('library.importError.webUrlInvalid'))
      return
    }
  }
  if (!/^[a-z0-9]+(\.[a-z0-9\-]+)+$/.test(id)) {
    message.error(t('library.importDraftIdFormatHint'))
    return
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    message.error(t('library.importError.versionInvalid'))
    return
  }
  if (idCheckState.value === 'exists') {
    message.error(t('library.importError.idExists'))
    return
  }
  if (needsMultiplayerConfig.value && draftForm.value.minPlayers > draftForm.value.maxPlayers) {
    message.error(t('library.importError.playersInvalid'))
    return
  }

  isDraftSubmitting.value = true
  try {
    const result = await gameStore.addGameWithManifest(pendingImportSourcePath.value, {
      id,
      name,
      version,
      description: draftForm.value.description.trim(),
      author,
      entry,
      web_url: entry.toLowerCase() === 'url' ? webUrl : undefined,
      platformVersion: draftForm.value.platformVersion,
      icon: draftForm.value.icon.trim(),
      cover: draftForm.value.cover.trim(),
      type: draftForm.value.type,
      minPlayers: needsMultiplayerConfig.value ? draftForm.value.minPlayers : undefined,
      maxPlayers: needsMultiplayerConfig.value ? draftForm.value.maxPlayers : undefined
    })
    if (result.success) {
      showImportDraftModal.value = false
    }
    showAddGameResult(result)
  } finally {
    isDraftSubmitting.value = false
  }
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
  border: 2px dashed var(--bz-green);
  border-radius: 8px;
  background: var(--bz-green-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 100;
}
.drop-panel {
  background: var(--bz-green);
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
  background: var(--bz-bg-overlay);
  z-index: 10;
  cursor: move;
  border-radius: 4px;
  border: 2px dashed var(--bz-info-blue);
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

.game-card-wrapper.icon-mode {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.game-card-wrapper.icon-mode:hover {
  transform: translateY(-6px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
}

.import-draft-form :deep(.n-form-item-label__text) {
  font-weight: 600;
}
</style>
