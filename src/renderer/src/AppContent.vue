<template>
  <template v-if="isNotificationWindow">
    <router-view />
  </template>
  <n-layout v-else position="absolute">
    <n-layout-header bordered style="height: 64px; padding: 16px;">
      <n-space justify="space-between" align="center">
        <h2 style="margin: 0;">
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
          <n-button @click="router.push('/achievements')">{{ t('achievement.title') }}</n-button>
          <n-button @click="router.push('/settings')">{{ t('nav.settings') }}</n-button>
        </n-space>
      </n-space>
    </n-layout-header>
    <n-layout position="absolute" style="top: 64px; bottom: 0;">
      <router-view />
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NAvatar, NSpace } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/useSettingsStore'
import { useRoomStore } from './stores/useRoomStore'
import { useGameStore } from './stores/useGameStore'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const settingsStore = useSettingsStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()

const isNotificationWindow = computed(() => {
  return route.name === 'Notification' || route.path.startsWith('/notification');
})

// Settings are loaded in App.vue, but accessing them here is fine as store is reactive

const handleBackToRoom = () => {
  if (roomStore.room && roomStore.room.gameId) {
    router.push(`/room/${roomStore.room.gameId}`)
  }
}

let cleanup: (() => void) | undefined
let cleanupAchievements: (() => void) | undefined

onMounted(() => {
  if (window.electronAPI?.room?.onEvent) {
    cleanup = window.electronAPI.room.onEvent((event) => {
      roomStore.handleRoomEvent(event)
    })
  }
  
  // Handle achievement notifications
  if (window.electronAPI?.game?.onAchievementUnlocked) {
    cleanupAchievements = window.electronAPI.game.onAchievementUnlocked(async () => {
        // Reload games to update achievement status
        await gameStore.loadGames();
    });
  }
})

onUnmounted(() => {
  if (cleanup) cleanup()
  if (cleanupAchievements) cleanupAchievements()
})
</script>
