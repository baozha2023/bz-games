<template>
  <img v-if="iconUrl" :src="iconUrl" style="width: 100%; height: 100%; object-fit: contain;" />
  <div v-else style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background-color: #555; color: #fff; font-size: 12px; font-weight: bold;">
    {{ gameName?.charAt(0) || '?' }}
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps<{ 
  gameId: string
  gameName?: string
  version?: string 
}>()
const iconUrl = ref<string | null>(null)

const loadIcon = async () => {
  if (!props.gameId) return;
  iconUrl.value = await window.electronAPI.game.getIcon(props.gameId, props.version)
}

onMounted(loadIcon)
watch(() => [props.gameId, props.version], loadIcon)
</script>