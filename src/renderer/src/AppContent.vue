<template>
  <template v-if="isNotificationWindow">
    <router-view />
  </template>
  <n-layout v-else position="absolute">
    <n-layout-header bordered style="height: 64px; padding: 16px;">
      <n-space justify="space-between" align="center">
        <h2 style="margin: 0; display: flex; align-items: center;">
          <AvatarWithFrame
            :src="settingsStore.settings?.avatar"
            :name="settingsStore.settings?.playerName || ''"
            :size="28"
            :frame-file-name="topBarFrameFileName"
          />
          <span style="margin-left: 8px;">{{ settingsStore.settings?.playerName || 'BZ-Games' }}</span>

          <div 
             style="margin-left: 16px; display: flex; align-items: center; background: var(--bz-bg-panel); padding: 4px 12px; border-radius: 16px; cursor: pointer; transition: all 0.3s;" 
             @click="showCheckIn = true"
          >
             <img :src="bzCoinIcon" style="width: 18px; height: 18px; margin-right: 4px;" />
             <span style="color: #FFD700; font-weight: bold; margin-right: 8px; font-size: 14px;">{{ settingsStore.userData?.bzCoins || 0 }}</span>
             <n-icon :component="Calendar" :color="'var(--bz-text-title)'" size="16" />
          </div>
        </h2>
        <n-space>
          <n-button 
            v-if="roomStore.room" 
            secondary 
            type="primary"
            @click="handleBackToRoom"
          >
            {{ t('nav.backToRoom') }}
          </n-button>
          <n-button @click="router.push('/markets')">{{ t('nav.market') }}</n-button>
          <n-button @click="router.push('/library')">{{ t('nav.myGames') }}</n-button>
          <n-button @click="router.push('/statistics')">{{ t('statistics.title') }}</n-button>
          <div class="badge-wrapper">
            <span v-if="gameStore.newAchievements.size > 0" class="red-dot"></span>
            <n-button @click="router.push('/achievements')">{{ t('achievement.title') }}</n-button>
          </div>
          <n-button @click="router.push('/personalization')">{{ t('nav.personalization') }}</n-button>
          <n-button @click="router.push('/settings')">{{ t('nav.settings') }}</n-button>
        </n-space>
      </n-space>
    </n-layout-header>
    <n-layout position="absolute" style="top: 64px; bottom: 0;">
      <router-view />
    </n-layout>
    <CheckInModal v-model:show="showCheckIn" />
    <n-modal v-model:show="showUpdateModal" preset="card" :title="t('settings.updateTitle')" style="width: 520px;">
      <n-space vertical>
        <n-text>{{ updateStatusText }}</n-text>
        <n-progress
          v-if="showProgress"
          type="line"
          :percentage="progressPercent"
          :indicator-placement="'inside'"
        />
        <n-text v-if="updateState.message" depth="3">{{ updateState.message }}</n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="hideUpdateModal">{{ t('common.cancel') }}</n-button>
          <n-button
            v-if="updateState.status === 'downloaded'"
            type="primary"
            @click="handleInstallUpdate"
          >
            {{ t('settings.installNow') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NSpace, NIcon, NModal, NText, NProgress, NButton, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/useSettingsStore'
import { useRoomStore } from './stores/useRoomStore'
import { useGameStore } from './stores/useGameStore'
import { Calendar } from '@vicons/ionicons5'
import CheckInModal from './components/CheckInModal.vue'
import AvatarWithFrame from './components/AvatarWithFrame.vue'
import { ref } from 'vue'
import { AchievementNotifier } from './utils/achievementNotifier'
import bzCoinIcon from './assets/images/bz-coin.png'
import semver from 'semver'
import { invalidateGameAssetCache } from './composables/useImageCache'
import type { MarketTaskState } from '../../shared/types'
import { getFrameImageFileName } from '../../shared/avatar-frames'

const marketNotifiedTaskIds = new Set<string>()

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const settingsStore = useSettingsStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()
const dialog = useDialog()
const message = useMessage()
const showCheckIn = ref(false)

const topBarFrameFileName = computed(() => {
  const frameId = settingsStore.userData?.equippedFrame
  if (!frameId) return undefined
  return getFrameImageFileName(frameId)
})

const isNotificationWindow = computed(() => {
  return route.name === 'Notification' || route.path.startsWith('/notification');
})

const handleBackToRoom = () => {
  if (roomStore.room && roomStore.room.gameId) {
    router.push(`/room/${roomStore.room.gameId}`)
  }
}

let cleanup: (() => void) | undefined
let cleanupAchievements: (() => void) | undefined
let cleanupMarketEvent: (() => void) | undefined
const achievementNotifier = new AchievementNotifier({
  delayMs: 5200,
  onProcess: async () => {
    await gameStore.loadGames()
  }
})

const updateState = computed(() => settingsStore.updateState)
const showUpdateModal = computed({
  get: () => settingsStore.showUpdateModal,
  set: (val) => {
    if (!val) settingsStore.hideUpdateModal()
  }
})

const progressPercent = computed(() => {
  return Math.max(0, Math.min(100, Math.round(updateState.value.progress || 0)))
})

const showProgress = computed(() => {
  return ['downloading', 'downloaded', 'up_to_date'].includes(updateState.value.status)
})

const updateStatusText = computed(() => {
  const errorTextByCode: Record<string, string> = {
    network_error: t('settings.updateErrors.network_error'),
    feed_invalid: t('settings.updateErrors.feed_invalid'),
    download_failed: t('settings.updateErrors.download_failed'),
    verify_failed: t('settings.updateErrors.verify_failed'),
    permission_denied: t('settings.updateErrors.permission_denied'),
    unsupported_dev_mode: t('settings.updateErrors.unsupported_dev_mode'),
    unknown: t('settings.updateErrors.unknown')
  }
  const map: Record<string, string> = {
    idle: t('settings.updateIdle'),
    checking: t('settings.updateChecking'),
    available: t('settings.updateAvailable', { version: updateState.value.latestVersion || '' }),
    up_to_date: t('settings.updateLatest'),
    downloading: t('settings.updateDownloading', { progress: progressPercent.value }),
    downloaded: t('settings.updateDownloaded'),
    error: t('settings.updateError', {
      message:
        errorTextByCode[updateState.value.errorCode || 'unknown'] ||
        updateState.value.message ||
        ''
    }),
    unsupported: t('settings.updateUnsupported')
  }
  return map[updateState.value.status] || t('settings.updateIdle')
})

const shouldPromptUpdate = (latestVersion?: string) => {
  if (!latestVersion) return false
  const ignored = settingsStore.settings?.ignoredUpdateVersion
  if (!ignored) return true
  if (ignored === latestVersion) return false
  if (semver.valid(ignored) && semver.valid(latestVersion)) {
    return semver.gt(latestVersion, ignored)
  }
  return latestVersion !== ignored
}

const handleAutoUpdateCheck = async () => {
  if (isNotificationWindow.value) return
  await settingsStore.loadSettings()
  settingsStore.initUpdateEvents()
  const state = await settingsStore.checkUpdateOnly()
  if (state.status !== 'available') return
  if (!shouldPromptUpdate(state.latestVersion)) return
  dialog.warning({
    title: t('settings.updatePromptTitle'),
    content: t('settings.updatePromptMessage', { version: state.latestVersion || '' }),
    positiveText: t('settings.updateNow'),
    negativeText: t('settings.updateLater'),
    onPositiveClick: async () => {
      await settingsStore.checkUpdate()
    },
    onNegativeClick: () => {
      if (!state.latestVersion) return
      void settingsStore.ignoreUpdateVersion(state.latestVersion).catch((error: any) => {
        message.error(`${t('settings.saveFail')}: ${error?.message || error}`)
      })
    }
  })
}

const handleInstallUpdate = async () => {
  await settingsStore.installUpdate()
}

const hideUpdateModal = () => {
  settingsStore.hideUpdateModal()
}

const MARKET_ERROR_KEYS: Record<string, string> = {
  download: "market.downloadError",
  verify: "market.verifyError",
  extract: "market.extractError",
  install: "market.installError",
}

function marketErrorMessage(task: MarketTaskState): string {
  if (task.errorCode && MARKET_ERROR_KEYS[task.errorCode]) {
    return t(MARKET_ERROR_KEYS[task.errorCode])
  }
  return task.message || ""
}

onMounted(() => {
  if (window.electronAPI?.room?.onEvent) {
    cleanup = window.electronAPI.room.onEvent((event) => {
      roomStore.handleRoomEvent(event)
    })
  }
  
  if (window.electronAPI?.game?.onAchievementUnlocked) {
    cleanupAchievements = window.electronAPI.game.onAchievementUnlocked(
      (gameId, version, achievementId) => {
        achievementNotifier.enqueue({ gameId, version, achievementId })
      }
    )
  }

  if (window.electronAPI?.market?.onEvent) {
    cleanupMarketEvent = window.electronAPI.market.onEvent(async ({ task }) => {
      if (task.status === "idle") {
        marketNotifiedTaskIds.delete(task.taskId)
        return
      }

      if (!marketNotifiedTaskIds.has(task.taskId)) {
        if (task.status === "completed") {
          marketNotifiedTaskIds.add(task.taskId)
          invalidateGameAssetCache(task.gameId)
          await gameStore.loadGames()
          const game = gameStore.games.find((g) => g.id === task.gameId)
          const gameName = game?.name || task.gameId
          message.success(t("market.installSuccess", { name: gameName, version: task.version }))
        } else if (task.status === "error") {
          marketNotifiedTaskIds.add(task.taskId)
          const errMsg = marketErrorMessage(task)
          message.error(errMsg || t("market.downloadFailed"))
        } else if (task.status === "canceled") {
          marketNotifiedTaskIds.add(task.taskId)
          message.info(t("market.canceled"))
        }
      }
    })
  }

  handleAutoUpdateCheck()
})

onUnmounted(() => {
  if (cleanup) cleanup()
  if (cleanupAchievements) cleanupAchievements()
  if (cleanupMarketEvent) cleanupMarketEvent()
  achievementNotifier.dispose()
})
</script>

<style scoped>
.badge-wrapper {
  position: relative;
  display: inline-block;
}

.red-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background-color: var(--bz-red);
  border-radius: 50%;
  z-index: 1;
}
</style>
