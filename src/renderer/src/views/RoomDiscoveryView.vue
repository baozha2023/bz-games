<template>
  <div class="room-discovery-page">
    <n-tabs v-model:value="activeTab" class="room-discovery-tabs" type="line" animated @update:value="handleTabChange">
      <template #suffix>
        <n-button type="primary" :loading="loading" @click="refreshCurrentTab">
          {{ t('roomDiscovery.refresh') }}
        </n-button>
      </template>
      <n-tab-pane name="lan" :tab="t('roomDiscovery.lanTab')">
        <n-spin :show="loading && activeTab === 'lan'" content-class="room-spin-content">
          <div class="room-tab-content">
            <n-alert type="info" style="margin-bottom: 16px;">
              {{ t('roomDiscovery.lanDesc') }}
            </n-alert>
            <RoomList />
          </div>
        </n-spin>
      </n-tab-pane>

      <n-tab-pane name="relay" :tab="t('roomDiscovery.relayTab')">
        <n-spin :show="loading && activeTab === 'relay'" content-class="room-spin-content">
          <div class="room-tab-content">
            <n-alert type="info" class="room-discovery-desc">
              <div class="room-discovery-desc-content">
                <span>{{ t('roomDiscovery.relayDesc') }}</span>
                <span class="relay-latency">{{ relayLatencyText }}</span>
              </div>
            </n-alert>
            <RoomList />
          </div>
        </n-spin>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NDescriptions, NDescriptionsItem, NEmpty, NSpace, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { DiscoveredRoom } from '../../../shared/types'
import { RoomConstants } from '../../../shared/RoomConstants'
import { useGameStore } from '../stores/useGameStore'
import { useRoomJoin } from '../composables/useRoomJoin'
import NicknameText from '../components/NicknameText.vue'
import { useSettingsStore } from '../stores/useSettingsStore'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const gameStore = useGameStore()
const settingsStore = useSettingsStore()
const { joinRoomByAddress } = useRoomJoin()

const activeTab = ref<'lan' | 'relay'>('lan')
const loading = ref(false)
const joiningRoomId = ref('')
const lanRooms = ref<DiscoveredRoom[]>([])
const relayRooms = ref<DiscoveredRoom[]>([])
const relayLatencyMs = ref<number | null>(null)
let relayLatencyTimer: number | null = null

const displayedRooms = computed(() => activeTab.value === 'lan' ? lanRooms.value : relayRooms.value)

const currentEmptyText = computed(() => activeTab.value === 'lan' ? t('roomDiscovery.emptyLan') : t('roomDiscovery.emptyRelay'))

const relayLatencyText = computed(() => `${t('roomDiscovery.latency')}: ${relayLatencyMs.value === null ? '-- ms' : `${Math.round(relayLatencyMs.value)} ms`}`)

onMounted(() => {
  if (gameStore.games.length === 0) {
    gameStore.loadGames()
  }
  refreshCurrentTab()
})

onUnmounted(() => {
  stopRelayLatencyRefresh()
})

const handleTabChange = () => {
  refreshCurrentTab()
  if (activeTab.value === 'relay') {
    startRelayLatencyRefresh()
  } else {
    stopRelayLatencyRefresh()
  }
}

const refreshCurrentTab = async () => {
  loading.value = true
  try {
    if (activeTab.value === 'lan') {
      lanRooms.value = await window.electronAPI.room.discoverLan()
    } else {
      relayRooms.value = await window.electronAPI.room.discoverRelay()
      await refreshRelayLatency()
    }
  } catch (error: any) {
    message.error(error?.message || t('roomDiscovery.refreshFailed'))
  } finally {
    loading.value = false
  }
}

const joinBlockText = (room: DiscoveredRoom) => {
  if (room.joinBlockReason === 'game_missing') return t('roomDiscovery.gameMissing')
  if (room.joinBlockReason === 'version_mismatch') return t('roomDiscovery.versionMismatch')
  if (room.joinBlockReason === 'room_full') return t('roomDiscovery.roomFull')
  if (room.joinBlockReason === 'game_started') return t('roomDiscovery.gameStarted')
  if (room.joinBlockReason === 'own_room') return t('roomDiscovery.ownRoom')
  return t('roomDiscovery.unavailable')
}

const roomGameName = (room: DiscoveredRoom) => gameStore.games.find(game => game.id === room.gameId)?.name || room.gameName || room.gameId

const relayRoomAddress = (room: DiscoveredRoom) => room.address || t('roomDiscovery.relayAddressPending')

const roomKey = (room: DiscoveredRoom) => `${room.source}:${room.id}:${room.address}`

const isJoiningRoom = (room: DiscoveredRoom) => joiningRoomId.value === roomKey(room)

const isJoinButtonDisabled = (room: DiscoveredRoom) => {
  if (isJoiningRoom(room)) return true
  return !room.canJoin && room.joinBlockReason !== 'own_room'
}

const joinButtonType = (room: DiscoveredRoom) => room.canJoin || room.joinBlockReason === 'own_room' ? 'primary' : 'default'

const handleDiscoveredRoomClick = (room: DiscoveredRoom) => {
  if (!room.canJoin && room.joinBlockReason) {
    message.error(joinBlockText(room))
    return
  }
  joinDiscoveredRoom(room)
}

const joinDiscoveredRoom = async (room: DiscoveredRoom) => {
  if (joiningRoomId.value) return
  const address = room.address
  if (!address) {
    message.error(t('roomDiscovery.relayAddressPending'))
    return
  }
  joiningRoomId.value = roomKey(room)
  try {
    await joinRoomByAddress({
      gameId: room.gameId,
      address,
      version: room.gameVersion,
      router,
      message,
    })
  } catch (error: any) {
    message.error(error?.message || t('gameDetail.joinFail'))
  } finally {
    joiningRoomId.value = ''
  }
}

const refreshRelayLatency = async () => {
  relayLatencyMs.value = await window.electronAPI.room.measureRelayLatency()
}

const startRelayLatencyRefresh = () => {
  if (relayLatencyTimer) return
  refreshRelayLatency()
  relayLatencyTimer = window.setInterval(refreshRelayLatency, RoomConstants.RELAY_LATENCY_REFRESH_INTERVAL_MS)
}

const stopRelayLatencyRefresh = () => {
  if (relayLatencyTimer) {
    window.clearInterval(relayLatencyTimer)
    relayLatencyTimer = null
  }
}

const RoomList = () => {
  if (displayedRooms.value.length === 0) {
    return h(NEmpty, { description: currentEmptyText.value })
  }
  return h('div', { class: 'room-list' }, displayedRooms.value.map((room) => h(NCard, { key: roomKey(room), class: 'room-card' }, {
    header: () => h(NSpace, { align: 'center' }, {
      default: () => h('span', { class: 'room-card-title' }, [
        h(NicknameText, {
          name: room.name,
          nicknameStyle: room.hostStyle,
          effectiveTheme: settingsStore.effectiveTheme,
          size: 16,
        }),
      ]),
    }),
    'header-extra': () => h(NButton, {
      size: 'small',
      type: joinButtonType(room),
      loading: isJoiningRoom(room),
      disabled: isJoinButtonDisabled(room),
      onClick: () => handleDiscoveredRoomClick(room),
    }, { default: () => room.canJoin ? t('common.join') : joinBlockText(room) }),
    default: () => h(NDescriptions, { column: 2, size: 'small' }, {
      default: () => [
        h(NDescriptionsItem, { label: t('roomDiscovery.gameId') }, { default: () => room.gameId }),
        h(NDescriptionsItem, { label: t('roomDiscovery.gameName') }, { default: () => roomGameName(room) }),
        h(NDescriptionsItem, { label: t('roomDiscovery.gameVersion') }, { default: () => room.gameVersion }),
        h(NDescriptionsItem, { label: t('roomDiscovery.players') }, { default: () => `${room.playerCount}/${room.maxPlayers}` }),
        h(NDescriptionsItem, { label: t('roomDiscovery.address') }, { default: () => room.source === 'relay' ? relayRoomAddress(room) : room.address }),
      ],
    }),
  })))
}
</script>

<style scoped>
.room-discovery-page {
  padding: 24px;
}

.room-discovery-tabs {
  margin-top: 0;
}

.room-tab-content {
  min-height: 220px;
  padding-top: 12px;
}

.room-discovery-desc {
  margin-bottom: 16px;
}

.room-discovery-desc-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.relay-latency {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--n-text-color-2);
  white-space: nowrap;
}

:deep(.room-spin-content) {
  min-height: 220px;
}

.room-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.room-card {
  min-height: 148px;
}

.room-card-title {
  display: inline-flex;
  min-width: 0;
  max-width: 260px;
}
</style>
