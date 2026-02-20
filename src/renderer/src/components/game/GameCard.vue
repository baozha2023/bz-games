<template>
  <n-card hoverable style="cursor: pointer" @click="handleClick">
    <template #cover>
      <div style="height: 140px; background: #333; display:flex; align-items:center; justify-content:center;">
        <GameCover :game-id="game.id" />
      </div>
    </template>
    <n-ellipsis style="max-width: 100%; font-weight: bold; font-size: 16px;">
      {{ game.name }}
    </n-ellipsis>
    <n-text depth="3" style="font-size: 12px;">{{ game.author }}</n-text>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NEllipsis, NText } from 'naive-ui'
import GameCover from './GameCover.vue'
import type { GameManifest } from '../../../../shared/game-manifest'

const props = defineProps<{
  game: GameManifest
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const handleClick = () => {
  emit('click', props.game.id)
}
</script>
