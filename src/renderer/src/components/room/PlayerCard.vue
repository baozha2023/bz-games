<template>
  <n-list-item>
    <template #prefix>
      <AvatarWithFrame
        :src="player.avatar"
        :name="player.name"
        :size="48"
        :frame-file-name="frameImageFileName"
      />
    </template>
    <template #suffix>
      <n-space align="center">
        <n-tag :type="player.isReady ? 'success' : 'warning'">
          {{ player.isHost ? t('room.host') : (player.isReady ? t('room.ready') : t('room.notReady')) }}
        </n-tag>
        <n-button
          v-if="showKickButton"
          type="error"
          size="small"
          secondary
          @click="emit('kick')"
        >
          {{ t('room.kickPlayer') }}
        </n-button>
      </n-space>
    </template>
    <n-thing>
      <template #header>
        <NicknameText :name="player.name" :nickname-style="player.nicknameStyle" :effective-theme="settingsStore.effectiveTheme" :size="15" />
      </template>
      <template #description>
        {{ isLocalPlayer ? t('room.you') : '' }}
      </template>
    </n-thing>
  </n-list-item>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NListItem, NTag, NThing, NSpace, NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import AvatarWithFrame from '../AvatarWithFrame.vue'
import NicknameText from '../NicknameText.vue'
import type { PlayerInRoom } from '../../../../shared/types/room.types'
import { getFrameImageFileName } from '../../../../shared/avatar-frames'
import { useSettingsStore } from '../../stores/useSettingsStore'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const props = defineProps<{
  player: PlayerInRoom
  isLocalPlayer: boolean
  showKickButton?: boolean
}>()

const emit = defineEmits<{
  kick: []
}>()

const frameImageFileName = computed(() => {
  if (!props.player.avatarFrame) return undefined
  return getFrameImageFileName(props.player.avatarFrame)
})
</script>
