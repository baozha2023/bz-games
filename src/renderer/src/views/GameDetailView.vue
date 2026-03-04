<template>
  <div style="padding: 24px;" v-if="game">
    <n-page-header :title="game.name" @back="$router.back()">
      <template #extra>
        <n-space>
          <n-button @click="handleToggleFavorite">
             <template #icon>
                <n-icon :color="isFavorite ? '#d03050' : undefined">
                    <Heart v-if="isFavorite" />
                    <HeartOutline v-else />
                </n-icon>
             </template>
             {{ t('gameDetail.favorite') }}
          </n-button>
          <n-button @click="showAchievements = true">{{ t('achievement.title') }}</n-button>
          <n-button type="error" @click="handleRemove" :disabled="roomStore.room !== null || isRunning">{{ t('gameDetail.deleteGame') }}</n-button>
        </n-space>
      </template>
    </n-page-header>
    
    <n-grid x-gap="24" :cols="1" md="2" style="margin-top: 24px;">
      <n-grid-item>
        <div style="width: 100%; display: flex; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden;">
          <GameCover :game-id="game.id" :version="selectedVersion" :autoplay-video="true" style="width: 100%; height: auto; max-height: 400px; object-fit: contain;" />
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

    <GameDeleteModal 
        v-model:show="showDeleteModal" 
        :versions="versions" 
        :initial-selected="[selectedVersion]" 
        :loading="isDeleting"
        @confirm="confirmDelete" 
    />

    <GameAchievementsModal 
        v-model:show="showAchievements" 
        :achievements="gameAchievements" 
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { Heart, HeartOutline } from '@vicons/ionicons5'
import { useGameStore } from '../stores/useGameStore'
import { useRoomStore } from '../stores/useRoomStore'
import GameCover from '../components/game/GameCover.vue'
import GameAchievementsModal from '../components/game/GameAchievementsModal.vue'
import GameDeleteModal from '../components/game/GameDeleteModal.vue'
import type { GameManifest } from '../../../shared/game-manifest'

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
const currentManifest = ref<GameManifest | null>(null)
const versionOptions = computed(() => versions.value.map(v => ({ label: v, value: v })))
const isLatestVersion = computed(() => !game.value || selectedVersion.value === game.value.version)

const showJoinModal = ref(false)
const joinAddress = ref('')
const showAchievements = ref(false)

const gameAchievements = computed(() => {
    let achievements;
    if (currentManifest.value) {
        achievements = currentManifest.value.achievements;
    } else if (isLatestVersion.value) {
        achievements = game.value?.achievements;
    } else {
        achievements = [];
    }
    
    if (!achievements || achievements.length === 0) return [];

    const unlocked = gameStore.getUnlockedAchievements(gameId, selectedVersion.value);
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
    try {
      const v = await window.electronAPI.game.getVersions(gameId);
      if (v && v.length > 0) {
        versions.value = v;
        if (!selectedVersion.value || !versions.value.includes(selectedVersion.value)) {
             versions.value.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
             selectedVersion.value = versions.value[0];
        }
      }
      await handleVersionChange(selectedVersion.value);
    } catch {}
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

const showDeleteModal = ref(false)
const isDeleting = ref(false)

const isFavorite = computed(() => {
    const record = gameStore.getGameRecord(gameId);
    return record?.isFavorite || false;
})

const handleToggleFavorite = async (e: MouseEvent) => {
    try {
        const newState = await gameStore.toggleFavorite(gameId);
        if (newState) {
            spawnHeartParticles(e.clientX, e.clientY);
        }
    } catch (e) {
        message.error(t('common.error'));
    }
}

const handleRemove = () => {
  showDeleteModal.value = true;
}

const confirmDelete = async (versionsToDelete: string[]) => {
  if (isDeleting.value) return;
  isDeleting.value = true;
  try {
    await gameStore.removeGame(gameId, [...versionsToDelete])
    message.success(t('gameDetail.deleteSuccess'))
    
    if (!game.value) {
      router.push({ name: 'Library' })
    } else {
      const v = await window.electronAPI.game.getVersions(gameId)
      if (v) {
        versions.value = v
        versions.value.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))

        if (!versions.value.includes(selectedVersion.value)) {
          if (versions.value.length > 0) {
            selectedVersion.value = versions.value[0]
            await handleVersionChange(selectedVersion.value)
          } else {
            // Should not happen if game.value exists, but safety check
            router.push({ name: 'Library' })
          }
        }
      }
    }
  } catch (e) {
    message.error(t('common.error'))
  } finally {
    isDeleting.value = false;
    showDeleteModal.value = false;
  }
}

function spawnHeartParticles(x: number, y: number) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    document.body.appendChild(container);

    const count = 10;
    for (let i = 0; i < count; i++) {
        const heart = document.createElement('div');
        heart.innerHTML = '❤️';
        heart.style.position = 'absolute';
        heart.style.left = `${x}px`;
        heart.style.top = `${y}px`;
        heart.style.fontSize = `${20 + Math.random() * 20}px`;
        heart.style.userSelect = 'none';
        
        // Random velocity
        const vx = (Math.random() - 0.5) * 100;
        const vy = -100 - Math.random() * 100;
        
        heart.animate([
            { transform: `translate(0, 0) scale(1)`, opacity: 1 },
            { transform: `translate(${vx}px, ${vy}px) scale(0)`, opacity: 0 }
        ], {
            duration: 800 + Math.random() * 400,
            easing: 'ease-out'
        }).onfinish = () => {
            heart.remove();
            if (container.childNodes.length === 0) {
                container.remove();
            }
        };
        
        container.appendChild(heart);
    }
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
