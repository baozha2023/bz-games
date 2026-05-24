<template>
  <n-config-provider :theme="naiveTheme">
    <div :class="`theme-${effectiveTheme}`" style="min-height: 100vh;">
      <n-message-provider>
        <n-notification-provider placement="bottom-right">
          <n-dialog-provider>
            <AppContent />
          </n-dialog-provider>
        </n-notification-provider>
      </n-message-provider>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import './assets/theme.css'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { darkTheme } from 'naive-ui'
import { useSettingsStore } from './stores/useSettingsStore'
import AppContent from './AppContent.vue'

const settingsStore = useSettingsStore()
settingsStore.loadSettings()
settingsStore.loadUserData()

const prefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
let mediaQuery: MediaQueryList | null = null

const onSystemThemeChange = (e: MediaQueryListEvent) => {
  prefersDark.value = e.matches
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  prefersDark.value = mediaQuery.matches
  mediaQuery.addEventListener('change', onSystemThemeChange)
})

onUnmounted(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onSystemThemeChange)
  }
})

const isDark = computed(() => {
  const t = settingsStore.settings?.theme
  if (t === 'auto') return prefersDark.value
  return t !== 'light'
})

const naiveTheme = computed(() => isDark.value ? darkTheme : null)
const effectiveTheme = computed(() => isDark.value ? 'dark' : 'light')
</script>

<style>
body { margin: 0; padding: 0; font-family: sans-serif; }
</style>
