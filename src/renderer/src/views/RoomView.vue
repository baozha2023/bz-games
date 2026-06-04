<template>
  <div style="padding: 24px; display: flex; flex-direction: column; height: calc(100vh - 64px); box-sizing: border-box; overflow: hidden;" v-if="roomStore.room">
    <n-page-header :title="t('room.titlePrefix') + roomStore.room.gameId" @back="handleBack" style="flex-shrink: 0;">
    <template #extra>
      <n-space align="center">
        <n-select
          v-if="roomStore.isHost"
          v-model:value="connectionMode"
          :options="connectionModeOptions"
          size="small"
          style="width: 150px;"
          @update:value="handleConnectionModeChange"
        />
        <n-button type="error" @click="handleLeaveRoom">
          {{ roomStore.isHost ? t('room.disbandRoom') : t('room.leaveRoom') }}
        </n-button>
      </n-space>
    </template>
  </n-page-header>

    <n-alert
      v-if="showConnectionAlert"
      :type="connectionAlertType"
      style="margin-top: 16px; flex-shrink: 0;"
    >
      {{ connectionStatusText }}
    </n-alert>

    <n-alert
      v-if="relayPublicAddress"
      type="success"
      style="margin-top: 16px; flex-shrink: 0;"
    >
      <n-space align="center">
        <span>{{ t('room.relayPublicAddress') }}{{ relayPublicAddress }}</span>
        <n-button size="tiny" @click="copyRelayAddress">{{ t('common.copy') }}</n-button>
      </n-space>
    </n-alert>

    <n-grid x-gap="24" :cols="1" md="2" style="margin-top: 24px; flex: 1; min-height: 0;">
      <n-grid-item span="2" style="display: flex; flex-direction: column; min-height: 0;">
        <PlayerList 
          :players="roomStore.room.players" 
          :max-players="roomStore.room.maxPlayers"
          :local-player-id="settingsStore.settings?.playerId || ''"
          :is-host="roomStore.isHost"
          @kick="handleKickPlayer"
          style="flex-shrink: 0;"
        />
        <n-divider />
        <div style="flex: 1; min-height: 0;">
        <template v-if="isChatPoppedOut">
          <n-alert type="info" style="margin-top: 8px;">
            <template #header>
              {{ t('chat.poppedOutTitle') }}
            </template>
            <n-button size="small" type="primary" @click="handlePopInChat">
              {{ t('chat.popIn') }}
            </n-button>
          </n-alert>
        </template>
        <RoomChat v-else @pop-out="handlePopOutChat" />
        </div>
      </n-grid-item>
    </n-grid>

    <div style="margin-top: 32px; text-align: center; flex-shrink: 0;">
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
          <span v-else-if="roomStore.isStartCooldown">
            {{ t('room.startCooldown') }}
          </span>
        </n-tooltip>
      </template>
      <template v-else>
        <n-button v-if="roomStore.isReconnectMode" type="primary" size="large" @click="handleReconnect">
          {{ t('room.reconnect') }}
        </n-button>
        <n-button v-else size="large" :type="roomStore.localPlayer?.isReady ? 'warning' : 'primary'" @click="toggleReady">
          {{ roomStore.localPlayer?.isReady ? t('room.cancelReady') : t('room.doReady') }}
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
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
let cleanupChatWindowClosed: (() => void) | undefined

const isChatPoppedOut = ref(false)
const connectionMode = ref<'frp' | 'relay'>('frp')
const previousConnectionMode = ref<'frp' | 'relay'>('frp')
const relayPublicAddress = ref('')

const connectionModeOptions = computed(() => [
  { label: t('room.connectionModeFrp'), value: 'frp' },
  { label: t('room.connectionModeRelay'), value: 'relay' },
])

const syncConnectionModeFromRoom = () => {
  const publicAddress = roomStore.room?.hostPublicAddress || ''
  relayPublicAddress.value = publicAddress
  connectionMode.value = publicAddress ? 'relay' : 'frp'
  previousConnectionMode.value = connectionMode.value
}

watch(
  () => roomStore.room?.hostPublicAddress,
  () => syncConnectionModeFromRoom(),
)

const handleConnectionModeChange = (value: 'frp' | 'relay') => {
  if (value === previousConnectionMode.value) return
  dialog.warning({
    title: t('room.connectionModeChangeTitle'),
    content: t('room.connectionModeChangeContent'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      if (value === 'relay') {
        const result = await window.electronAPI.room.enableRelayHost()
        if (!result.success || !result.publicAddress) {
          connectionMode.value = previousConnectionMode.value
          message.error(t('room.connectionModeRelayFailed', { reason: result.error || t('room.joinError.unknown') }))
          return
        }
        relayPublicAddress.value = result.publicAddress
        previousConnectionMode.value = value
        message.success(t('room.connectionModeRelayReady', { address: result.publicAddress }))
        return
      }
      await window.electronAPI.room.disableRelayHost()
      relayPublicAddress.value = ''
      previousConnectionMode.value = value
      message.info(t('room.connectionModeFrpSelected'))
    },
    onNegativeClick: () => {
      connectionMode.value = previousConnectionMode.value
    }
  })
}

const copyRelayAddress = async () => {
  if (!relayPublicAddress.value) return
  await navigator.clipboard.writeText(relayPublicAddress.value)
  message.success(t('common.copied'))
}

const handlePopOutChat = async () => {
  try {
    const history = JSON.parse(JSON.stringify(roomStore.chatMessages))
    await window.electronAPI.room.popOutChat(history)
    isChatPoppedOut.value = true
  } catch (e) {
    message.error(String((e as Error)?.message || e))
  }
}

const handlePopInChat = async () => {
  try {
    await window.electronAPI.room.popInChat()
    isChatPoppedOut.value = false
  } catch (e) {
    message.error(String((e as Error)?.message || e))
  }
}

const minPlayers = computed(() => {
  if (!roomStore.room) return 1
  const game = gameStore.games.find(g => g.id === roomStore.room?.gameId)
  return game?.multiplayer?.minPlayers ?? 1
})

const canStart = computed(() => {
  if (!roomStore.room) return false
  const playerCount = roomStore.room.players.length
  return roomStore.allReady && playerCount >= minPlayers.value && !roomStore.isStartCooldown
})

const showConnectionAlert = computed(() => {
  return ['connecting', 'reconnecting', 'failed', 'disconnected'].includes(
    roomStore.connectionStatus
  )
})

const connectionAlertType = computed(() => {
  if (roomStore.connectionStatus === 'failed') return 'error'
  if (roomStore.connectionStatus === 'disconnected') return 'warning'
  return 'info'
})

const connectionStatusText = computed(() => {
  if (roomStore.connectionStatus === 'connecting') {
    return t('room.connectionStatus.connecting')
  }
  if (roomStore.connectionStatus === 'reconnecting') {
    return t('room.connectionStatus.reconnecting', {
      current: roomStore.reconnectAttempts,
      max: 5,
      seconds: roomStore.reconnectCountdownSec
    })
  }
  if (roomStore.connectionStatus === 'failed') {
    return t('room.connectionStatus.failed', {
      reason: roomStore.connectionReason || t('room.joinError.unknown')
    })
  }
  if (roomStore.connectionStatus === 'disconnected') {
    return t('room.connectionStatus.disconnected')
  }
  return ''
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

  syncConnectionModeFromRoom()

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
      } else if (event.type === 'room:kicked') {
        dialog.error({
          title: t('common.error'),
          content: t('room.youWereKicked'),
          positiveText: t('common.confirm'),
          onPositiveClick: () => {
            router.replace('/library')
          }
        })
      }
    });
  }

  if (window.electronAPI?.room?.onChatWindowClosed) {
    cleanupChatWindowClosed = window.electronAPI.room.onChatWindowClosed(() => {
      isChatPoppedOut.value = false
    })
  }
})

onUnmounted(() => {
  if (cleanupLaunch) cleanupLaunch()
  if (cleanupRoomEvent) cleanupRoomEvent()
  if (cleanupChatWindowClosed) cleanupChatWindowClosed()
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
    if ((e as Error).message === 'START_COOLDOWN') {
      message.warning(t('room.startCooldown'))
      return
    }
    message.error(t('room.startFailed'));
  }
}

const handleReconnect = async () => {
  try {
    await roomStore.reconnectGame();
    message.success(t('room.gameStarted'));
  } catch (e) {
    message.error(t('room.launchFailed', { reason: String(e) }));
  }
}

const handleKickPlayer = async (playerId: string) => {
  const target = roomStore.room?.players.find(p => p.id === playerId)
  if (!target) return
  dialog.warning({
    title: t('room.kickPlayer'),
    content: t('room.confirmKick', { name: target.name }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const ok = await roomStore.kickPlayer(playerId)
      if (!ok) {
        message.error(t('common.error'))
      }
    }
  })
}
</script>
