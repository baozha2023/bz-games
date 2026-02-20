<template>
  <div style="padding: 24px;">
    <n-space justify="space-between" align="center" style="margin-bottom: 24px;">
      <h1 style="margin: 0;">{{ t('library.title') }}</h1>
      <n-button type="primary" @click="handleAddGame">{{ t('library.addGameButton') }}</n-button>
    </n-space>

    <n-grid x-gap="24" y-gap="24" cols="2 s:3 m:4 l:5 xl:6" responsive="screen">
      <n-grid-item v-for="game in gameStore.games" :key="game.id">
        <GameCard :game="game" @click="goToDetail" />
      </n-grid-item>
    </n-grid>

    <n-empty v-if="gameStore.games.length === 0" :description="t('library.emptyState')" style="margin-top: 100px;">
      <template #extra>
        <n-button @click="handleAddGame">{{ t('library.addGameShort') }}</n-button>
      </template>
    </n-empty>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGameStore } from '../stores/useGameStore'
import GameCard from '../components/game/GameCard.vue'

const { t } = useI18n()
const gameStore = useGameStore()
const router = useRouter()
const message = useMessage()

onMounted(() => {
  gameStore.loadGames()
})

const handleAddGame = async () => {
  const result = await gameStore.addGame()
  if (result.success) {
    message.success(t('library.addSuccess'))
  } else if (result.error !== 'User canceled') {
    message.error(result.error || t('library.addError'))
  }
}

const goToDetail = (id: string) => {
  router.push({ name: 'GameDetail', params: { id } })
}
</script>
