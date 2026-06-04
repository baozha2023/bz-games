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
            <n-empty v-if="lanRooms.length === 0" :description="t('roomDiscovery.emptyLan')" />
            <div v-else class="room-list">
            <n-card v-for="room in lanRooms" :key="room.id" class="room-card">
              <template #header>
                <n-space align="center">
                  <span>{{ room.name }}</span>
                  <n-tag size="small">{{ room.gameVersion }}</n-tag>
                </n-space>
              </template>
              <template #header-extra>
                <n-button size="small" type="primary" :disabled="isJoinButtonDisabled(room)" @click="joinDiscoveredRoom(room)">
                  {{ room.canJoin ? t('common.join') : joinBlockText(room) }}
                </n-button>
              </template>
              <n-descriptions :column="2" size="small">
                <n-descriptions-item :label="t('roomDiscovery.gameId')">{{ room.gameId }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.gameName')">{{ roomGameName(room) }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.players')">{{ room.playerCount }}/{{ room.maxPlayers }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.address')">{{ room.address }}</n-descriptions-item>
              </n-descriptions>
            </n-card>
            </div>
          </div>
        </n-spin>
      </n-tab-pane>

      <n-tab-pane name="relay" :tab="t('roomDiscovery.relayTab')">
        <n-spin :show="loading && activeTab === 'relay'" content-class="room-spin-content">
          <div class="room-tab-content">
            <n-alert type="info" style="margin-bottom: 16px;">
              {{ t('roomDiscovery.relayDesc') }}
            </n-alert>
            <n-empty v-if="relayRooms.length === 0" :description="t('roomDiscovery.emptyRelay')" />
            <div v-else class="room-list">
            <n-card v-for="room in relayRooms" :key="room.id" class="room-card">
              <template #header>
                <n-space align="center">
                  <span>{{ room.name }}</span>
                  <n-tag size="small">{{ room.gameVersion }}</n-tag>
                </n-space>
              </template>
              <template #header-extra>
                <n-button size="small" type="primary" :disabled="isJoinButtonDisabled(room)" @click="joinDiscoveredRoom(room)">
                  {{ room.canJoin ? t('common.join') : joinBlockText(room) }}
                </n-button>
              </template>
              <n-descriptions :column="2" size="small">
                <n-descriptions-item :label="t('roomDiscovery.gameId')">{{ room.gameId }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.gameName')">{{ roomGameName(room) }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.players')">{{ room.playerCount }}/{{ room.maxPlayers }}</n-descriptions-item>
                <n-descriptions-item :label="t('roomDiscovery.address')">{{ relayRoomAddress(room) }}</n-descriptions-item>
              </n-descriptions>
            </n-card>
            </div>
          </div>
        </n-spin>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { DiscoveredRoom } from '../../../shared/types'
import { useRoomStore } from '../stores/useRoomStore'
import { useGameStore } from '../stores/useGameStore'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const roomStore = useRoomStore()
const gameStore = useGameStore()

const activeTab = ref<'lan' | 'relay'>('lan')
const loading = ref(false)
const lanRooms = ref<DiscoveredRoom[]>([])
const relayRooms = ref<DiscoveredRoom[]>([])

onMounted(() => {
  if (gameStore.games.length === 0) {
    gameStore.loadGames()
  }
  refreshCurrentTab()
})

const handleTabChange = () => {
  refreshCurrentTab()
}

const refreshCurrentTab = async () => {
  loading.value = true
  try {
    if (activeTab.value === 'lan') {
      lanRooms.value = await window.electronAPI.room.discoverLan()
    } else {
      relayRooms.value = await window.electronAPI.room.discoverRelay()
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

const isJoinButtonDisabled = (room: DiscoveredRoom) => !room.canJoin && room.joinBlockReason !== 'own_room'

const roomGameName = (room: DiscoveredRoom) => gameStore.games.find(game => game.id === room.gameId)?.name || room.gameName || room.gameId

const relayRoomAddress = (room: DiscoveredRoom) => room.address || t('roomDiscovery.relayAddressPending')

const joinDiscoveredRoom = async (room: DiscoveredRoom) => {
  const validation = await window.electronAPI.room.validateDiscovered(room)
  if (!validation.canJoin) {
    message.error(joinBlockText({ ...room, joinBlockReason: validation.reason }))
    return
  }
  const res = await roomStore.joinRoom(room.gameId, room.address, room.gameVersion)
  if (!res.success) {
    message.error(res.error === 'own_room' ? t('room.joinError.ownRoom') : res.error || t('gameDetail.joinFail'))
    return
  }
  await router.push(`/room/${room.gameId}`)
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
</style>
