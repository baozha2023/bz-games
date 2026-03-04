<template>
  <video
    v-if="autoplayVideo && videoUrl && !showCoverAfterVideo"
    :key="videoUrl"
    :src="videoUrl"
    autoplay
    muted
    playsinline
    style="width: 100%; height: 100%; object-fit: contain;"
    @ended="handleVideoEnded"
  />
  <img v-else-if="coverUrl" :src="coverUrl" style="width: 100%; height: 100%; object-fit: contain;" />
  <div v-else style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background-color: #555; color: #fff;">
    暂无封面
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps<{ 
  gameId: string
  version?: string 
  autoplayVideo?: boolean
}>()
const coverUrl = ref<string | null>(null)
const videoUrl = ref<string | null>(null)
const showCoverAfterVideo = ref(false)

const loadCover = async () => {
  showCoverAfterVideo.value = false
  const [cover, video] = await Promise.all([
    window.electronAPI.game.getCover(props.gameId, props.version),
    props.autoplayVideo
      ? window.electronAPI.game.getVideo(props.gameId, props.version)
      : Promise.resolve(null),
  ])
  coverUrl.value = cover
  videoUrl.value = video
}

const handleVideoEnded = () => {
  showCoverAfterVideo.value = true
}

onMounted(loadCover)
watch(() => [props.gameId, props.version, props.autoplayVideo], loadCover)
</script>
