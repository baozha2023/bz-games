<template>
  <n-list-item>
    <template #prefix>
      <n-avatar round :size="48" :src="player.avatar" :key="player.avatar">
        <template v-if="!player.avatar">
          {{ player.name.charAt(0) }}
        </template>
      </n-avatar>
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
    <n-thing :title="player.name">
      <template #description>
        {{ isLocalPlayer ? t('room.you') : '' }}
      </template>
    </n-thing>
  </n-list-item>
</template>

<script setup lang="ts">
import { NListItem, NAvatar, NTag, NThing, NSpace, NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { PlayerInRoom } from '../../../../shared/types/room.types'

const { t } = useI18n()

defineProps<{
  player: PlayerInRoom
  isLocalPlayer: boolean
  showKickButton?: boolean
}>()

const emit = defineEmits<{
  kick: []
}>()
</script>
