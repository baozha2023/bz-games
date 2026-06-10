<template>
  <div class="room-discovery-page">
    <n-tabs v-model:value="activeTab" class="room-discovery-tabs" type="line" animated @update:value="handleTabChange">
      <template #suffix>
        <n-button type="primary" :loading="loading" @click="refreshCurrentTab">
          {{ t('roomDiscovery.refresh') }}
        </n-button>
      </template>
      <n-tab-pane name="physical_lan" :tab="t('roomDiscovery.physicalLanTab')">
        <n-spin :show="loading && activeTab === 'physical_lan'" content-class="room-spin-content">
          <div class="room-tab-content">
            <n-alert type="info" style="margin-bottom: 16px;">
              {{ t('roomDiscovery.physicalLanDesc') }}
            </n-alert>
            <RoomList />
          </div>
        </n-spin>
      </n-tab-pane>

      <n-tab-pane name="virtual_lan" :tab="t('roomDiscovery.virtualLanTab')">
        <n-spin :show="loading && activeTab === 'virtual_lan'" content-class="room-spin-content">
          <div class="room-tab-content">
            <n-alert type="info" style="margin-bottom: 16px;">
              {{ t('roomDiscovery.virtualLanDesc') }}
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

    <n-modal
      v-model:show="showJoinPasswordModal"
      preset="dialog"
      :title="t('room.joinPasswordModalTitle')"
      :positive-text="t('common.join')"
      :negative-text="t('common.cancel')"
      @positive-click="handleJoinPasswordConfirm"
    >
      <n-input
        v-model:value="joinPassword"
        type="password"
        show-password-on="click"
        :maxlength="64"
        :placeholder="t('room.joinPasswordInputPlaceholder')"
      />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
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

const activeTab = ref<'physical_lan' | 'virtual_lan' | 'relay'>('physical_lan')
const loading = ref(false)
const joiningRoomId = ref('')
const physicalLanRooms = ref<DiscoveredRoom[]>([])
const virtualLanRooms = ref<DiscoveredRoom[]>([])
const relayRooms = ref<DiscoveredRoom[]>([])
const relayLatencyMs = ref<number | null>(null)
const showJoinPasswordModal = ref(false)
const passwordRequiredRoom = ref<DiscoveredRoom | null>(null)
const joinPassword = ref('')
let relayLatencyTimer: number | null = null

const displayedRooms = computed(() => {
  if (activeTab.value === 'physical_lan') return physicalLanRooms.value
  if (activeTab.value === 'virtual_lan') return virtualLanRooms.value
  return relayRooms.value
})

const currentEmptyText = computed(() => {
  if (activeTab.value === 'physical_lan') return t('roomDiscovery.emptyPhysicalLan')
  if (activeTab.value === 'virtual_lan') return t('roomDiscovery.emptyVirtualLan')
  return t('roomDiscovery.emptyRelay')
})

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
    if (activeTab.value === 'physical_lan') {
      physicalLanRooms.value = await window.electronAPI.room.discoverLan()
    } else if (activeTab.value === 'virtual_lan') {
      virtualLanRooms.value = await window.electronAPI.room.discoverVirtualLan()
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
  probeAndJoinDiscoveredRoom(room)
}

watch(showJoinPasswordModal, (show) => {
  if (show) return
  passwordRequiredRoom.value = null
  joinPassword.value = ''
})

const performDiscoveredRoomJoin = async (room: DiscoveredRoom, password?: string) => {
  const address = room.address
  if (!address) {
    message.error(t('roomDiscovery.relayAddressPending'))
    return false
  }
  const result = await joinRoomByAddress({
    gameId: room.gameId,
    address,
    version: room.gameVersion,
    password,
    router,
    message,
  })
  return result.success
}

const probeAndJoinDiscoveredRoom = async (room: DiscoveredRoom) => {
  if (joiningRoomId.value) return
  joiningRoomId.value = roomKey(room)
  try {
    const probe = await window.electronAPI.room.probePassword(room.address)
    if (!probe.success) {
      message.error(t('room.joinError.probeFailed'))
      return
    }
    if (!probe.hasPassword) {
      await performDiscoveredRoomJoin(room)
      return
    }
    passwordRequiredRoom.value = room
    joinPassword.value = ''
    showJoinPasswordModal.value = true
  } catch (error: any) {
    message.error(error?.message || t('room.joinError.probeFailed'))
  } finally {
    joiningRoomId.value = ''
  }
}

const handleJoinPasswordConfirm = async () => {
  const room = passwordRequiredRoom.value
  if (!room) return false
  joiningRoomId.value = roomKey(room)
  try {
    const success = await performDiscoveredRoomJoin(room, joinPassword.value)
    if (success) {
      showJoinPasswordModal.value = false
    }
    return success
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
