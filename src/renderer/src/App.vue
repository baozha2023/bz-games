<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <n-notification-provider placement="bottom-right">
        <n-dialog-provider>
          <AppContent />
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { darkTheme } from 'naive-ui'
import { useSettingsStore } from './stores/useSettingsStore'
import AppContent from './AppContent.vue'

const settingsStore = useSettingsStore()
settingsStore.loadSettings()

const theme = computed(() => {
  return settingsStore.settings?.theme === 'dark' ? darkTheme : null
})
</script>

<style>
body { margin: 0; padding: 0; font-family: sans-serif; }
</style>
