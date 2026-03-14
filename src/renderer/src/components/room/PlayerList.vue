<template>
  <div class="player-list">
    <h2 style="margin: 0 0 16px;">{{ t('room.playerList') }} ({{ players.length }}/{{ maxPlayers }})</h2>
    <n-list bordered>
      <PlayerCard 
        v-for="player in players" 
        :key="player.id" 
        :player="player"
        :is-local-player="player.id === localPlayerId"
        :show-kick-button="isHost && player.id !== localPlayerId"
        @kick="emit('kick', player.id)"
      />
    </n-list>
  </div>
</template>

<script setup lang="ts">
import { NList } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import PlayerCard from './PlayerCard.vue'
import type { PlayerInRoom } from '../../../../shared/types/room.types'

const { t } = useI18n()

defineProps<{
  players: PlayerInRoom[]
  maxPlayers: number
  localPlayerId: string
  isHost: boolean
}>()

const emit = defineEmits<{
  kick: [playerId: string]
}>()
</script>
