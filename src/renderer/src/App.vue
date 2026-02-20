<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <n-dialog-provider>
        <n-layout position="absolute">
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
                <n-button @click="router.push('/settings')">{{ t('nav.settings') }}</n-button>
              </n-space>
            </n-space>
          </n-layout-header>
          <n-layout position="absolute" style="top: 64px; bottom: 0;">
            <router-view />
          </n-layout>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { darkTheme } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/useSettingsStore'
import { useRoomStore } from './stores/useRoomStore'

const { t } = useI18n()
const router = useRouter()
const settingsStore = useSettingsStore()
const roomStore = useRoomStore()

settingsStore.loadSettings()

const theme = computed(() => {
  return settingsStore.settings?.theme === 'dark' ? darkTheme : null
})

const handleBackToRoom = () => {
  if (roomStore.room && roomStore.room.gameId) {
    router.push(`/room/${roomStore.room.gameId}`)
  }
}

let cleanup: (() => void) | undefined

onMounted(() => {
  if (window.electronAPI?.room?.onEvent) {
    cleanup = window.electronAPI.room.onEvent((event) => {
      roomStore.handleRoomEvent(event)
    })
  }
})

onUnmounted(() => {
  if (cleanup) cleanup()
})
</script>

<style>
body { margin: 0; padding: 0; font-family: sans-serif; }
</style>
