<template>
  <div
    class="library-root"
    :class="{ 'library-root-steam': isLibraryReady && layoutMode === 'steam' }"
    style="padding: 24px;"
    @dragenter.prevent="handleExternalDragEnter"
    @dragover.prevent="handleExternalDragOver"
    @dragleave.prevent="handleExternalDragLeave"
    @drop.prevent="handleExternalDrop"
  >
    <template v-if="isLibraryReady">
      <n-space justify="space-between" align="center" style="margin-bottom: 24px;">
        <h1 style="margin: 0;">{{ t('library.title') }}</h1>
        <n-space>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button quaternary @click="cycleLayoutMode">
                <template #icon>
                  <n-icon :size="20">
                    <GridOutline v-if="nextLayoutMode === 'icon'" />
                    <LibraryOutline v-else-if="nextLayoutMode === 'steam'" />
                    <AppsOutline v-else />
                  </n-icon>
                </template>
              </n-button>
            </template>
            {{ nextLayoutLabel }}
          </n-tooltip>
          <n-button v-if="isReorderMode" type="success" @click.stop="isReorderMode = false">
            {{ t('common.save') }}
          </n-button>
          <n-button type="primary" @click="handleAddGame">{{ t('library.addGameButton') }}</n-button>
        </n-space>
      </n-space>

      <n-empty
        v-if="!gameStore.isLoading && gameStore.games.length === 0"
        :description="t('library.emptyState')"
        style="margin-top: 100px;"
      >
        <template #extra>
          <n-button @click="handleAddGame">{{ t('library.addGameShort') }}</n-button>
        </template>
      </n-empty>

      <template v-else-if="layoutMode === 'steam'">
        <div class="steam-layout">
          <aside class="steam-sidebar">
            <div class="steam-sidebar-title">{{ t('library.allGames') }}</div>
            <div class="steam-sidebar-list">
              <template v-if="gameStore.isLoading">
                <n-space vertical :size="10">
                  <n-skeleton height="56px" :repeat="6" />
                </n-space>
              </template>
              <n-empty
                v-else-if="displayedGames.length === 0"
                :description="searchQuery ? t('library.noSearchResults') : t('library.emptyState')"
                size="small"
              />
              <button
                v-for="game in visibleDisplayedGames"
                v-else
                :key="game.id"
                type="button"
                class="steam-list-item"
                :class="{ active: selectedSteamGameId === game.id }"
                @click="handleSteamListClick(game.id)"
                @dblclick="handleSteamListClick(game.id)"
                @contextmenu.prevent="handleContextMenu($event, game.id)"
              >
                <div class="steam-list-thumb">
                  <GameIcon :game-id="game.id" :game-name="game.name" />
                </div>
                <div class="steam-list-text">
                  <div class="steam-list-name">{{ game.name }}</div>
                  <div class="steam-list-meta">
                    <span>{{ game.version }}</span>
                    <span>{{ game.author }}</span>
                  </div>
                </div>
                <div class="steam-list-flags">
                  <n-icon v-if="isFavorite(game.id)" class="steam-flag-heart" :size="16" color="#d03050" :component="Heart" />
                  <span v-if="gameStore.runningGameIds.has(game.id)" class="steam-flag steam-flag-running">RUN</span>
                </div>
              </button>
            </div>
          </aside>

          <section class="steam-main">
            <div class="steam-toolbar">
              <div class="steam-toolbar-info">
                <span class="steam-game-count">{{ gameCountLabel }}</span>
              </div>
              <n-space align="center" :size="12" wrap>
                <div class="steam-sort-wrap">
                  <span class="steam-sort-label">{{ t('library.sortBy') }}</span>
                  <n-select
                    v-model:value="sortMode"
                    :options="sortOptions"
                    size="small"
                    class="steam-sort-select"
                  />
                </div>
                <n-input
                  v-model:value="searchQuery"
                  clearable
                  :placeholder="t('library.searchPlaceholder')"
                  class="steam-search"
                >
                  <template #prefix>
                    <n-icon><SearchOutline /></n-icon>
                  </template>
                </n-input>
              </n-space>
            </div>

            <GameDetailView
              v-if="selectedSteamGameId"
              :game-id="selectedSteamGameId"
              embedded
              class="steam-detail-scroll"
              @back="selectedSteamGameId = ''"
              @deleted="handleSteamDetailDeleted"
            />
            <div v-else-if="gameStore.isLoading" class="steam-cover-grid">
              <n-card v-for="index in 8" :key="index" size="small" embedded class="steam-cover-skeleton">
                <n-skeleton height="180px" />
                <n-skeleton text style="margin-top: 12px;" />
                <n-skeleton text :width="120" />
              </n-card>
            </div>
            <n-empty
              v-else-if="displayedGames.length === 0"
              :description="searchQuery ? t('library.noSearchResults') : t('library.emptyState')"
              style="margin-top: 80px;"
            />
            <div v-else class="steam-cover-grid">
              <div
                v-for="(game, index) in visibleDisplayedGames"
                :key="game.id"
                class="steam-card-shell"
                :class="{ active: selectedSteamGameId === game.id, shake: isReorderMode }"
                :data-steam-cover-id="game.id"
                :draggable="isReorderMode"
                @dragstart="handleDragStart($event, index)"
                @dragover.prevent="handleDragOver($event, index)"
                @drop="handleDrop($event, index)"
                @mousedown="handleMouseDown"
                @mouseup="clearLongPress"
                @mouseleave="clearLongPress"
                @contextmenu.prevent="handleContextMenu($event, game.id)"
              >
                <GameCard :game="game" @click="handleSteamCardClick" />
                <div v-if="isReorderMode" class="reorder-overlay"></div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <template v-else>
        <n-grid
          v-if="!gameStore.isLoading"
          :x-gap="layoutMode === 'icon' ? 12 : 24"
          :y-gap="layoutMode === 'icon' ? 12 : 24"
          :cols="layoutMode === 'icon' ? '4 s:6 m:8 l:10 xl:12' : '2 s:3 m:4 l:5 xl:6'"
          responsive="screen"
        >
          <n-grid-item
            v-for="(game, index) in visibleDisplayedGames"
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
        <n-grid
          v-else
          :x-gap="layoutMode === 'icon' ? 12 : 24"
          :y-gap="layoutMode === 'icon' ? 12 : 24"
          :cols="layoutMode === 'icon' ? '4 s:6 m:8 l:10 xl:12' : '2 s:3 m:4 l:5 xl:6'"
          responsive="screen"
        >
          <n-grid-item v-for="index in 8" :key="index">
            <n-card size="small" embedded>
              <n-skeleton height="180px" />
              <n-skeleton text style="margin-top: 12px;" />
              <n-skeleton text :width="120" />
            </n-card>
          </n-grid-item>
        </n-grid>
      </template>
    </template>

    <n-space v-else vertical size="large">
      <n-skeleton text :width="120" />
      <n-skeleton text :repeat="2" />
      <n-grid :cols="'2 s:3 m:4 l:5 xl:6'" :x-gap="24" :y-gap="24" responsive="screen">
        <n-grid-item v-for="index in 6" :key="index">
          <n-card size="small" embedded>
            <n-skeleton height="180px" />
            <n-skeleton text style="margin-top: 12px;" />
            <n-skeleton text :width="120" />
          </n-card>
        </n-grid-item>
      </n-grid>
    </n-space>

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
import { onMounted, ref, computed, watch, h, nextTick, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMessage, NIcon, NTooltip, NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { GridOutline, AppsOutline, Heart, HeartOutline, ArrowUpOutline, TrashOutline, LibraryOutline, SearchOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { useGameStore } from '../stores/useGameStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import GameCard from '../components/game/GameCard.vue'
import GameIcon from '../components/game/GameIcon.vue'
import GameDeleteModal from '../components/game/GameDeleteModal.vue'
import GameDetailView from './GameDetailView.vue'
import { playShatterEffect } from '../utils/deleteEffect'
import { GameType, type LibraryLayout } from '../../../shared/types'

const { t } = useI18n()
const gameStore = useGameStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const route = useRoute()
const message = useMessage()

type LibrarySortMode = 'custom' | 'name' | 'recent-played' | 'recent-added'

const layoutSequence: LibraryLayout[] = ['card', 'icon', 'steam']

const layoutMode = ref<LibraryLayout>('card')
const isLibraryReady = ref(false)
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
const searchQuery = ref('')
const sortMode = ref<LibrarySortMode>('custom')
const selectedSteamGameId = ref('')
const visibleCount = ref(0)
const isStaggerEnabled = ref(false)
let staggerTimer: ReturnType<typeof setTimeout> | null = null

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
  type: GameType.Singleplayer as GameType,
  minPlayers: 2,
  maxPlayers: 4
})

const draftTypeOptions = computed(() => [
  { label: t('gameDetail.typeSingleplayer'), value: GameType.Singleplayer },
  { label: t('gameDetail.typeMultiplayer'), value: GameType.Multiplayer },
  { label: t('gameDetail.typeSingleMultiple'), value: GameType.SingleMultiple },
  { label: t('gameDetail.typeNetworkGame'), value: GameType.NetworkGame }
])

const sortOptions = computed(() => [
  { label: t('library.sortCustom'), value: 'custom' },
  { label: t('library.sortName'), value: 'name' },
  { label: t('library.sortRecentPlayed'), value: 'recent-played' },
  { label: t('library.sortRecentAdded'), value: 'recent-added' }
])

const nextLayoutMode = computed<LibraryLayout>(() => {
  const currentIndex = layoutSequence.indexOf(layoutMode.value)
  return layoutSequence[(currentIndex + 1) % layoutSequence.length]
})

const nextLayoutLabel = computed(() => {
  if (nextLayoutMode.value === 'icon') return t('library.iconLayout')
  if (nextLayoutMode.value === 'steam') return t('library.steamLayout')
  return t('library.cardLayout')
})

function stopStaggerRendering() {
  if (staggerTimer !== null) {
    clearTimeout(staggerTimer)
    staggerTimer = null
  }
}

function scheduleStaggerRendering(delay = 20) {
  const total = displayedGames.value.length
  if (visibleCount.value >= total) {
    visibleCount.value = total
    return
  }

  const step = () => {
    if (visibleCount.value < total) {
      visibleCount.value += 1
      staggerTimer = setTimeout(step, 20)
    }
  }

  staggerTimer = setTimeout(step, delay)
}

function startStaggerRendering() {
  stopStaggerRendering()
  visibleCount.value = 0
  if (displayedGames.value.length === 0) return

  nextTick(() => {
    scheduleStaggerRendering(16)
  })
}

function continueStaggerRendering() {
  stopStaggerRendering()
  scheduleStaggerRendering(20)
}

function hasSameGameIds(a: Array<{ id: string }>, b: Array<{ id: string }>) {
  if (a.length !== b.length) return false
  const ids = new Set(a.map((game) => game.id))
  return b.every((game) => ids.has(game.id))
}

function isSupersetById(superset: Array<{ id: string }>, subset: Array<{ id: string }>) {
  const ids = new Set(superset.map((game) => game.id))
  return subset.every((game) => ids.has(game.id))
}

function isSubsetById(subset: Array<{ id: string }>, superset: Array<{ id: string }>) {
  const ids = new Set(superset.map((game) => game.id))
  return subset.every((game) => ids.has(game.id))
}

const filteredGames = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) return gameStore.games
  return gameStore.games.filter((game) =>
    [game.name, game.id, game.author].some((field) => field.toLowerCase().includes(keyword))
  )
})

const displayedGames = computed(() => {
  const games = [...filteredGames.value]
  const getRecordTime = (gameId: string, field: 'lastPlayedAt' | 'addedAt') =>
    gameStore.getGameRecord(gameId)?.[field] || 0

  switch (sortMode.value) {
    case 'name':
      return games.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    case 'recent-played':
      return games.sort((a, b) => getRecordTime(b.id, 'lastPlayedAt') - getRecordTime(a.id, 'lastPlayedAt'))
    case 'recent-added':
      return games.sort((a, b) => getRecordTime(b.id, 'addedAt') - getRecordTime(a.id, 'addedAt'))
    default:
      return games
  }
})

const visibleDisplayedGames = computed(() => displayedGames.value.slice(0, visibleCount.value))

const gameCountLabel = computed(() =>
  t('library.gameCount', {
    count: displayedGames.value.length,
    total: gameStore.games.length
  })
)

const canReorderGames = computed(() => sortMode.value === 'custom' && !searchQuery.value.trim())

const isUrlEntry = computed(() => draftForm.value.entry.trim().toLowerCase() === 'url')
const needsMultiplayerConfig = computed(
  () => draftForm.value.type === GameType.Multiplayer || draftForm.value.type === GameType.SingleMultiple
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
      label: t('library.openGameDirectory'),
      key: 'openInstallPath',
      icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
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
  } else if (key === 'openInstallPath') {
    handleOpenInstallPath(gameId)
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

const handleOpenInstallPath = async (gameId: string) => {
  try {
    const installPath = await window.electronAPI.game.getInstallPath(gameId)
    if (!installPath) {
      message.error(t('library.openGameDirectoryError'))
      return
    }
    const opened = await window.electronAPI.settings.openPath(installPath)
    if (!opened) {
      message.error(t('library.openGameDirectoryError'))
    }
  } catch {
    message.error(t('library.openGameDirectoryError'))
  }
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
  await settingsStore.loadSettings()
  layoutMode.value = settingsStore.settings?.libraryLayout || 'card'
  isLibraryReady.value = true
  await gameStore.loadGames()

  const deletedGameId = route.query.deletedGameId as string | undefined
  if (deletedGameId) {
    visibleCount.value = displayedGames.value.length
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
  isStaggerEnabled.value = true
  startStaggerRendering()
  const steamGameId = route.query.steamGameId as string | undefined
  if (steamGameId && gameStore.games.some((game) => game.id === steamGameId)) {
    layoutMode.value = 'steam'
    selectedSteamGameId.value = steamGameId
    router.replace({ name: 'Library' })
  }
})

onUnmounted(() => {
  stopStaggerRendering()
})

watch(layoutMode, async (nextLayout) => {
  if (isStaggerEnabled.value && isLibraryReady.value && !gameStore.isLoading) {
    startStaggerRendering()
  }
  if (!isLibraryReady.value) return
  try {
    await settingsStore.savePartialSettings({ libraryLayout: nextLayout })
  } catch (error) {
    console.error('[LibraryView] Failed to persist library layout:', error)
  }
})

watch(displayedGames, (nextGames, prevGames) => {
  if (!isStaggerEnabled.value || !isLibraryReady.value || gameStore.isLoading) return
  if (hasSameGameIds(nextGames, prevGames)) return
  if (isSupersetById(nextGames, prevGames)) {
    continueStaggerRendering()
    return
  }
  if (isSubsetById(nextGames, prevGames)) {
    visibleCount.value = Math.min(visibleCount.value, nextGames.length)
    return
  }
  startStaggerRendering()
})

watch(
  displayedGames,
  (games) => {
    if (!selectedSteamGameId.value) {
      return
    }
    if (!games.length || !games.some((game) => game.id === selectedSteamGameId.value)) {
      selectedSteamGameId.value = ''
    }
  },
  { immediate: true }
)

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
    if (result.error === 'canceled') return;

    const errorKey = `library.importError.${result.error}`;
    const translated = t(errorKey, result.params || {});
    
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

const cycleLayoutMode = () => {
  layoutMode.value = nextLayoutMode.value
  searchQuery.value = ''
}

const isFavorite = (gameId: string) => {
  return gameStore.getGameRecord(gameId)?.isFavorite || false
}

const handleSteamListClick = (gameId: string) => {
  selectedSteamGameId.value = gameId
}

const handleSteamCardClick = (gameId: string) => {
  if (isReorderMode.value) return
  selectedSteamGameId.value = gameId
}

const handleSteamDetailDeleted = (gameId: string) => {
  selectedSteamGameId.value = ''
  const cardEl = document.querySelector(`[data-steam-cover-id="${gameId}"]`) as HTMLElement | null
  if (cardEl) {
    playShatterEffect(cardEl)
  }
}

const handleMouseDown = () => {
  if (isReorderMode.value || !canReorderGames.value) return;
  clearLongPress()
  longPressTimer = setTimeout(() => {
    isReorderMode.value = true;
  }, 800);
}

const clearLongPress = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

const handleDragStart = (e: DragEvent, index: number) => {
  clearLongPress()
  if (!isReorderMode.value || !canReorderGames.value) {
    e.preventDefault();
    return;
  }
  draggedIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
}

const handleDragOver = (_: DragEvent, index: number) => {
  if (!isReorderMode.value || !canReorderGames.value) return
  if (draggedIndex.value === null || draggedIndex.value === index) return;
}

const handleDrop = async (_: DragEvent, index: number) => {
  if (!isReorderMode.value || !canReorderGames.value) return
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
    type: GameType.Singleplayer,
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

.library-root-steam {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

:global(.n-layout-scroll-container:has(.library-root-steam)) {
  overflow: hidden !important;
}

.steam-layout {
  display: grid;
  grid-template-columns: clamp(140px, 22vw, 280px) minmax(0, 1fr);
  gap: clamp(8px, 1.5vw, 20px);
  flex: 1;
  min-height: 0;
  min-width: 0;
  align-items: stretch;
}

.steam-sidebar,
.steam-main {
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  background: var(--bz-bg-subtle);
  backdrop-filter: blur(10px);
}

.steam-sidebar {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.steam-sidebar-title {
  padding: 16px;
  font-size: 14px;
  font-weight: 700;
  color: var(--bz-text-title);
  border-bottom: 1px solid var(--bz-border-subtle);
}

.steam-sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.steam-list-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.steam-list-item:hover,
.steam-list-item.active {
  background: var(--bz-bg-panel);
}

.steam-list-thumb {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bz-bg-card-placeholder);
}

.steam-list-text {
  min-width: 0;
  flex: 1;
}

.steam-list-name {
  color: var(--bz-text-title);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.steam-list-meta,
.steam-sort-label {
  color: var(--bz-text-tertiary);
  font-size: 12px;
}

.steam-list-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.steam-list-flags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.steam-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.steam-flag-favorite {
  color: #fff;
  background: var(--bz-red);
}

.steam-flag-heart {
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
  flex-shrink: 0;
}

.steam-flag-running {
  color: #fff;
  background: var(--bz-green);
}

.steam-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.steam-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--bz-border-subtle);
}

.steam-toolbar-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}

.steam-game-count {
  color: var(--bz-text-title);
  font-size: 14px;
  font-weight: 700;
}

.steam-sort-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.steam-sort-select {
  width: clamp(130px, 18vw, 170px);
  max-width: 100%;
}

.steam-search {
  width: clamp(180px, 28vw, 260px);
  max-width: 100%;
}

.steam-cover-grid {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 18px;
  align-content: start;
  min-width: 0;
}

.steam-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
}

.steam-card-shell {
  position: relative;
  min-width: 0;
  border-radius: 12px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.steam-card-shell:hover,
.steam-card-shell.active {
  transform: translateY(-3px);
}

.steam-card-shell :deep(.n-card) {
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

.steam-card-shell.active :deep(.n-card) {
  box-shadow: 0 0 0 2px var(--bz-green), 0 14px 28px rgba(0, 0, 0, 0.18);
}

.steam-cover-skeleton {
  overflow: hidden;
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

@media (max-width: 768px) {
  .steam-layout {
    grid-template-columns: clamp(120px, 30vw, 200px) minmax(0, 1fr);
  }

  .steam-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .steam-toolbar-info {
    justify-content: space-between;
  }

  .steam-sort-wrap {
    flex-wrap: wrap;
  }

  .steam-search {
    width: 100%;
  }
}
</style>
