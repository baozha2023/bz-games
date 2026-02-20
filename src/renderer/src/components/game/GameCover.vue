<template>
  <img v-if="coverUrl" :src="coverUrl" style="width: 100%; height: 100%; object-fit: contain;" />
  <div v-else style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background-color: #555; color: #fff;">
    暂无封面
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps<{ 
  gameId: string
  version?: string 
}>()
const coverUrl = ref<string | null>(null)

const loadCover = async () => {
  coverUrl.value = await window.electronAPI.game.getCover(props.gameId, props.version)
}

onMounted(loadCover)
watch(() => [props.gameId, props.version], loadCover)
</script>
