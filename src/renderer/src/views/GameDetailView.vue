<template>
  <div style="padding: 24px;" v-if="game">
    <n-page-header :title="game.name" @back="$router.back()">
      <template #extra>
        <n-space>
          <n-button @click="showAchievements = true">{{ t('achievement.title') }}</n-button>
          <n-button type="error" @click="handleRemove" :disabled="roomStore.room !== null || isRunning">{{ t('gameDetail.deleteGame') }}</n-button>
        </n-space>
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
             <n-select v-if="versions.length > 0" v-model:value="selectedVersion" :options="versionOptions" size="small" style="width: 120px; display: inline-block; vertical-align: middle;" @update:value="handleVersionChange" />
             <span v-else>{{ game.version }}</span>
          </n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.author')">{{ (currentManifest?.author) || (isLatestVersion ? game.author : '') }}</n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.type')">{{ ((currentManifest?.type) || (isLatestVersion ? game.type : '')) === 'multiplayer' ? t('gameDetail.typeMultiplayer') : t('gameDetail.typeSingleplayer') }}</n-descriptions-item>
          <n-descriptions-item :label="t('gameDetail.description')" v-if="(currentManifest?.description) || (isLatestVersion ? game.description : '')">{{ (currentManifest?.description) || (isLatestVersion ? game.description : '') }}</n-descriptions-item>
        </n-descriptions>
        
        <div style="margin-top: 24px;">
          <template v-if="((currentManifest?.type) || (isLatestVersion ? game.type : '')) === 'singleplayer'">
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

    <n-modal v-model:show="showAchievements" preset="card" :title="t('achievement.title')" style="width: 600px;">
        <n-empty v-if="gameAchievements.length === 0" :description="t('achievement.noAchievements')" />
        <n-list v-else>
            <n-list-item v-for="ach in gameAchievements" :key="ach.id">
                <n-thing>
                    <template #avatar>
                        <n-icon size="24" :color="ach.unlocked ? '#f0a020' : '#ccc'">
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M20.2 2H3.8C2.8 2 2 2.8 2 3.8v4.4c0 1 .8 1.8 1.8 1.8h.4c.5 2.8 3 4.9 6 5v.5c0 .8.7 1.5 1.5 1.5h.6v2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h7.4c1.1 0 2-.9 2-2s-.9-2-2-2h-2v-2h.6c.8 0 1.5-.7 1.5-1.5v-.5c3-.1 5.5-2.2 6-5h.4c1 0 1.8-.8 1.8-1.8V3.8C22 2.8 21.2 2 20.2 2M5.8 8h-2V4h2zm14.4 0h-2V4h2z"/></svg>
                        </n-icon>
                    </template>
                    <template #header>{{ ach.title }}</template>
                    <template #description>{{ ach.description }}</template>
                    <template #header-extra>
                        <n-tag type="success" v-if="ach.unlocked">{{ t('achievement.unlocked') }}</n-tag>
                        <n-tag type="default" v-else>{{ t('achievement.locked') }}</n-tag>
                    </template>
                </n-thing>
            </n-list-item>
        </n-list>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'
import { useRoomStore } from '../stores/useRoomStore'
import GameCover from '../components/game/GameCover.vue'
import type { GameManifest } from '../../../shared/game-manifest'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const gameStore = useGameStore()
const roomStore = useRoomStore()

const gameId = route.params.id as string
const game = computed(() => gameStore.games.find(g => g.id === gameId))
const isRunning = computed(() => gameStore.runningGameIds.has(gameId))

const versions = ref<string[]>([])
const selectedVersion = ref('')
const currentManifest = ref<GameManifest | null>(null)
const versionOptions = computed(() => versions.value.map(v => ({ label: v, value: v })))
const isLatestVersion = computed(() => !game.value || selectedVersion.value === game.value.version)

const showJoinModal = ref(false)
const joinAddress = ref('')
const showAchievements = ref(false)

const gameAchievements = computed(() => {
    // If currentManifest is loaded, use it exclusively (even if empty)
    // If not loaded, fallback to game.value ONLY if it is the latest version
    let achievements;
    if (currentManifest.value) {
        achievements = currentManifest.value.achievements;
    } else if (isLatestVersion.value) {
        achievements = game.value?.achievements;
    } else {
        achievements = [];
    }
    
    if (!achievements || achievements.length === 0) return [];

    const unlocked = gameStore.getUnlockedAchievements(gameId);
    return achievements.map(a => {
        const u = unlocked.find(ua => ua.id === a.id);
        return {
            ...a,
            unlocked: !!u,
            unlockedAt: u?.unlockedAt
        }
    }).sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0));
});

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
      
      // Load manifest for selected version
      await handleVersionChange(selectedVersion.value);

    } catch (e) {
      // Ignore
    }
  }
})

const handleVersionChange = async (version: string) => {
    selectedVersion.value = version;
    currentManifest.value = null;
    try {
        const manifest = await window.electronAPI.game.getManifest(gameId, version);
        if (manifest) {
            currentManifest.value = manifest;
        }
    } catch (e) {
        console.error('Failed to load manifest for version', version, e);
    }
}

const handleLaunch = () => {
  gameStore.launchGame(gameId, selectedVersion.value)
  message.success(t('gameDetail.launchSuccess'))
}

const handleRemove = async () => {
  dialog.warning({
    title: t('gameDetail.deleteGame'),
    content: t('common.confirmDelete') || 'Are you sure you want to delete this game?',
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      await gameStore.removeGame(gameId)
      router.push('/library')
      message.success(t('gameDetail.deleteSuccess'))
    }
  })
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
