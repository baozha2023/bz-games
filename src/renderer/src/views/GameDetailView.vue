<template>
  <div style="padding: 24px;" v-if="game">
    <n-page-header :title="game.name" @back="$router.back()">
      <template #extra>
        <n-button type="error" @click="handleRemove" :disabled="roomStore.room !== null || isRunning">{{ t('gameDetail.deleteGame') }}</n-button>
      </template>
    </n-page-header>
    
    <n-grid x-gap="24" :cols="1" md="2" style="margin-top: 24px;">
      <n-grid-item>
        <div style="width: 100%; display: flex; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden;">
          <GameCover :game-id="game.id" :version="selectedVersion" style="width: 100%; height: auto; max-height: 400px; object-fit: contain;" />
        </div>
      </n-grid-item>
      
      <n-grid-item>
        <n-descriptions bordered column="1">
          <n-descriptions-item :label="t('gameDetail.version')">
             <n-select v-if="versions.length > 0" v-model:value="selectedVersion" :options="versionOptions" size="small" style="width: 120px; display: inline-block; vertical-align: middle;" />
             <span v-else>{{ game.version }}</span>
          </n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.author')">{{ game.author }}</n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.type')">{{ game.type === 'multiplayer' ? t('gameDetail.typeMultiplayer') : t('gameDetail.typeSingleplayer') }}</n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.description')" v-if="game.description">{{ game.description }}</n-descriptions-item>
        </n-descriptions>
        
        <div style="margin-top: 24px;">
          <template v-if="game.type === 'singleplayer'">
            <n-button type="primary" size="large" @click="handleLaunch" :disabled="isRunning">
              {{ isRunning ? t('gameDetail.gameRunning') : t('gameDetail.launchGame') }}
            </n-button>
          </template>
          <template v-else>
            <n-space>
              <n-button type="primary" size="large" @click="createRoom">{{ t('gameDetail.createRoom') }}</n-button>
              <n-button size="large" @click="showJoinModal = true">{{ t('gameDetail.joinRoom') }}</n-button>
            </n-space>
          </template>
        </div>
      </n-grid-item>
    </n-grid>

    <n-modal v-model:show="showJoinModal" preset="dialog" :title="t('gameDetail.joinRoom')" :positive-text="t('common.join')" :negative-text="t('common.cancel')" @positive-click="handleJoin" :loading="roomStore.isConnecting">
      <n-input v-model:value="joinAddress" :placeholder="t('gameDetail.joinAddressPlaceholder')" />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'
import { useRoomStore } from '../stores/useRoomStore'
import GameCover from '../components/game/GameCover.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const gameStore = useGameStore()
const roomStore = useRoomStore()

const gameId = route.params.id as string
const game = computed(() => gameStore.games.find(g => g.id === gameId))
const isRunning = computed(() => gameStore.runningGameIds.has(gameId))

const versions = ref<string[]>([])
const selectedVersion = ref('')
const versionOptions = computed(() => versions.value.map(v => ({ label: v, value: v })))

const showJoinModal = ref(false)
const joinAddress = ref('')

onMounted(async () => {
  if (game.value) {
    selectedVersion.value = game.value.version
    // Fetch available versions
    try {
      const v = await window.electronAPI.game.getVersions(gameId);
      if (v && v.length > 0) {
        versions.value = v;
        // If current version is not in list (maybe new import?), default to it or first available
        if (!selectedVersion.value || !versions.value.includes(selectedVersion.value)) {
            // Sort versions descending semver-ish (simple string sort for now, better to be consistent with backend)
             versions.value.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
             selectedVersion.value = versions.value[0];
        }
      }
    } catch (e) {
      console.error('Failed to fetch versions', e);
    }
  }
})

const handleLaunch = () => {
  gameStore.launchGame(gameId, selectedVersion.value)
  message.success(t('gameDetail.launchSuccess'))
}

const handleRemove = async () => {
  await gameStore.removeGame(gameId)
  router.push('/library')
  message.success(t('gameDetail.deleteSuccess'))
}

const createRoom = async () => {
  try {
    // Create room with selected version. 
    // Host will start the game using this version, and clients must match it.
    await roomStore.createRoom(gameId, selectedVersion.value)
    router.push(`/room/${gameId}`)
  } catch (e: any) {
    if (e.message === 'ALREADY_IN_ROOM') {
      message.error(t('room.alreadyInRoom'))
    } else {
      message.error(e.message || t('room.createFailed'))
    }
  }
}

const handleJoin = async () => {
  if (!joinAddress.value) { message.error(t('gameDetail.addressEmpty')); return false; }
  
  // Auto-append wss:// if no protocol is specified
  let address = joinAddress.value.trim();
  if (!/^(ws|wss):\/\//.test(address)) {
    address = 'wss://' + address;
  }
  
  const res = await roomStore.joinRoom(gameId, address, selectedVersion.value)
  if (res.success) {
    showJoinModal.value = false;
    router.push(`/room/${gameId}`)
    return true;
  } else {
    // Translate error code
    let errorMsg = res.error;
    if (res.error === 'version_mismatch') {
        errorMsg = t('room.joinError.versionMismatch');
    } else if (res.error === 'room_full') {
        errorMsg = t('room.joinError.roomFull');
    } else if (res.error === 'game_started') {
        errorMsg = t('room.joinError.gameStarted');
    } else if (res.error === 'game_id_mismatch') {
        errorMsg = t('room.joinError.gameIdMismatch');
    }
    
    message.error(errorMsg || t('gameDetail.joinFail'));
    return false;
  }
}
</script>
