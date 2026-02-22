<template>
  <n-card hoverable style="cursor: pointer" @click="handleClick" content-style="padding: 0;">
    <template #cover>
      <div style="aspect-ratio: 16/9; width: 100%; background: #333; display:flex; align-items:center; justify-content:center; overflow: hidden; position: relative;">
        <GameCover :game-id="game.id" />
        <n-icon v-if="isFavorite" :size="24" color="#d03050" style="position: absolute; top: 8px; right: 8px; filter: drop-shadow(0 0 2px rgba(0,0,0,0.5));">
            <Heart />
        </n-icon>
      </div>
    </template>
    <div style="padding: 12px;">
      <n-ellipsis style="max-width: 100%; font-weight: bold; font-size: 16px;">
        {{ game.name }}
      </n-ellipsis>
      <n-text depth="3" style="font-size: 12px;">{{ game.author }}</n-text>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NEllipsis, NText, NIcon } from 'naive-ui'
import { Heart } from '@vicons/ionicons5'
import GameCover from './GameCover.vue'
import type { GameManifest } from '../../../../shared/game-manifest'
import { useGameStore } from '../../stores/useGameStore'

const props = defineProps<{
  game: GameManifest
}>()

const gameStore = useGameStore()
const isFavorite = computed(() => {
    const record = gameStore.getGameRecord(props.game.id);
    return record?.isFavorite || false;
})

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const handleClick = () => {
  emit('click', props.game.id)
}
</script>
