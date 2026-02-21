<template>
  <div style="padding: 24px;" v-if="roomStore.room">
    <n-page-header :title="t('room.titlePrefix') + roomStore.room.gameId" @back="handleBack">
    <template #extra>
      <n-button type="error" @click="handleLeaveRoom">
        {{ roomStore.isHost ? t('room.disbandRoom') : t('room.leaveRoom') }}
      </n-button>
    </template>
  </n-page-header>

    <n-grid x-gap="24" :cols="1" md="2" style="margin-top: 24px;">
      <n-grid-item span="2">
        <PlayerList 
          :players="roomStore.room.players" 
          :max-players="roomStore.room.maxPlayers"
          :local-player-id="settingsStore.settings?.playerId || ''"
        />
        <n-divider />
        <RoomChat />
      </n-grid-item>
    </n-grid>

    <div style="margin-top: 32px; text-align: center;">
      <template v-if="roomStore.isHost">
        <n-tooltip trigger="hover" :disabled="canStart">
          <template #trigger>
            <div style="display: inline-block;">
              <n-button type="primary" size="large" :disabled="!canStart" @click="handleStartGame">
                {{ t('room.startGame') }}
              </n-button>
            </div>
          </template>
          <span v-if="roomStore.room && roomStore.room.players.length < minPlayers">
            {{ t('room.waitingForPlayers', { min: minPlayers, current: roomStore.room.players.length }) }}
          </span>
          <span v-else-if="!roomStore.allReady">
            {{ t('room.waitingForReady') }}
          </span>
        </n-tooltip>
      </template>
      <template v-else>
        <n-button size="large" :type="roomStore.localPlayer?.isReady ? 'warning' : 'primary'" @click="toggleReady">
          {{ roomStore.localPlayer?.isReady ? t('room.cancelReady') : t('room.doReady') }}
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRoomStore } from '../stores/useRoomStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useGameStore } from '../stores/useGameStore'
import PlayerList from '../components/room/PlayerList.vue'
import RoomChat from '../components/room/RoomChat.vue'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const roomStore = useRoomStore()
const settingsStore = useSettingsStore()
const gameStore = useGameStore()

let cleanupLaunch: (() => void) | undefined
let cleanupRoomEvent: (() => void) | undefined

const minPlayers = computed(() => {
  if (!roomStore.room) return 1
  const game = gameStore.games.find(g => g.id === roomStore.room?.gameId)
  return game?.multiplayer?.minPlayers ?? 1
})

const canStart = computed(() => {
  if (!roomStore.room) return false
  const playerCount = roomStore.room.players.length
  return roomStore.allReady && playerCount >= minPlayers.value
})

onMounted(async () => {
  if (gameStore.games.length === 0) {
    await gameStore.loadGames()
  }
  
  // 如果当前没有房间信息，尝试从后台同步一次
  if (!roomStore.room) {
    try {
      const state = await window.electronAPI.room.getState();
      if (state) {
        roomStore.room = state;
      }
    } catch (e) {
      // Ignore sync error
    }
  }

  if (!roomStore.room) {
    message.warning(t('room.notInRoom'));
    router.replace('/library');
    return;
  }

  if (window.electronAPI?.game?.onLaunchFailed) {
    cleanupLaunch = window.electronAPI.game.onLaunchFailed((_id, reason) => {
      message.error(t('room.launchFailed', { reason }));
    });
  }

  // Listen for room disbanded event
  if (window.electronAPI?.room?.onEvent) {
    cleanupRoomEvent = window.electronAPI.room.onEvent((event) => {
      if (event.type === 'room:disbanded') {
        message.warning(t('room.roomDisbanded'));
        // Clear room state logic is handled in store, but we need to navigate
        router.replace('/library');
      }
    });
  }
})

onUnmounted(() => {
  if (cleanupLaunch) cleanupLaunch()
  if (cleanupRoomEvent) cleanupRoomEvent()
})

const handleBack = () => {
  // Just navigate back, do not leave room
  const gameId = roomStore.room?.gameId
  if (gameId) {
    router.push(`/library/${gameId}`)
  } else {
    router.push('/library')
  }
}

const handleLeaveRoom = async () => {
  const isHost = roomStore.isHost
  dialog.warning({
    title: isHost ? t('room.disbandRoom') : t('room.leaveRoom'),
    content: isHost ? t('room.confirmDisband') : t('room.confirmLeave'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const gameId = roomStore.room?.gameId
      await roomStore.leaveRoom()
      if (gameId) {
        router.replace(`/library/${gameId}`)
      } else {
        router.replace('/library')
      }
    }
  })
}

const toggleReady = async () => {
  if (roomStore.localPlayer?.isReady) {
    await roomStore.setReady(false);
  } else {
    await roomStore.setReady(true);
  }
}

const handleStartGame = async () => {
  try {
    await roomStore.startGame();
    message.success(t('room.gameStarted'));
  } catch (e) {
    message.error(t('room.startFailed'));
  }
}
</script>
