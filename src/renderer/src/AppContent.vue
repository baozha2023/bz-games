<template>
  <template v-if="isNotificationWindow">
    <router-view />
  </template>
  <n-layout v-else position="absolute">
    <n-layout-header bordered style="height: 64px; padding: 16px;">
      <n-space justify="space-between" align="center">
        <h2 style="margin: 0; display: flex; align-items: center;">
          <n-avatar 
            round 
            size="small" 
            :src="settingsStore.settings?.avatar" 
            :key="settingsStore.settings?.avatar"
            style="margin-right: 8px; vertical-align: middle;" 
          >
            <template v-if="!settingsStore.settings?.avatar">
              {{ settingsStore.settings?.playerName?.charAt(0)?.toUpperCase() || '?' }}
            </template>
          </n-avatar>
          {{ settingsStore.settings?.playerName || 'BZ-Games' }}

          <div 
             style="margin-left: 16px; display: flex; align-items: center; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 16px; cursor: pointer; transition: all 0.3s;" 
             @click="showCheckIn = true"
          >
             <img :src="bzCoinIcon" style="width: 18px; height: 18px; margin-right: 4px;" />
             <span style="color: #FFD700; font-weight: bold; margin-right: 8px; font-size: 14px;">{{ settingsStore.userData?.bzCoins || 0 }}</span>
             <n-icon :component="Calendar" :color="calendarIconColor" size="16" />
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
          <n-button @click="router.push('/library')">{{ t('nav.myGames') }}</n-button>
          <n-button @click="router.push('/statistics')">{{ t('statistics.title') }}</n-button>
          <n-badge :dot="gameStore.newAchievements.size > 0">
            <n-button @click="router.push('/achievements')">{{ t('achievement.title') }}</n-button>
          </n-badge>
          <n-button @click="router.push('/settings')">{{ t('nav.settings') }}</n-button>
        </n-space>
      </n-space>
    </n-layout-header>
    <n-layout position="absolute" style="top: 64px; bottom: 0;">
      <router-view />
    </n-layout>
    <CheckInModal v-model:show="showCheckIn" />
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NAvatar, NSpace, NBadge, NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/useSettingsStore'
import { useRoomStore } from './stores/useRoomStore'
import { useGameStore } from './stores/useGameStore'
import { Calendar } from '@vicons/ionicons5'
import CheckInModal from './components/CheckInModal.vue'
import { ref } from 'vue'
import { AchievementNotifier } from './utils/achievementNotifier'
import bzCoinIcon from './assets/images/bz-coin.png'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const settingsStore = useSettingsStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()
const showCheckIn = ref(false)
const calendarIconColor = computed(() => {
  return settingsStore.settings?.theme === 'light' ? '#1f2937' : '#fff'
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
const achievementNotifier = new AchievementNotifier({
  delayMs: 5200,
  onProcess: async () => {
    await gameStore.loadGames()
  }
})

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
})

onUnmounted(() => {
  if (cleanup) cleanup()
  if (cleanupAchievements) cleanupAchievements()
  achievementNotifier.dispose()
})
</script>
