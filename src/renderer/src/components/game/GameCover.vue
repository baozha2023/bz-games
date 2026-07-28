<template>
  <video
    v-if="autoplayVideo && videoUrl && !showCoverAfterVideo"
    :key="videoUrl"
    :src="videoUrl"
    autoplay
    muted
    playsinline
    style="width: 100%; height: 100%; object-fit: contain"
    @ended="handleVideoEnded"
  />
  <img
    v-else-if="coverUrl"
    :src="coverUrl"
    style="width: 100%; height: 100%; object-fit: contain"
  />
  <img
    v-else
    :src="defaultCoverUrl"
    style="width: 100%; height: 100%; object-fit: contain"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useImageCache, gameAssetKey } from "../../composables/useImageCache";
import defaultCoverUrl from "../../../../../resources/default_cover.png";

const props = defineProps<{
  gameId: string;
  version?: string;
  autoplayVideo?: boolean;
}>();
const coverUrl = ref<string | null>(null);
const videoUrl = ref<string | null>(null);
const showCoverAfterVideo = ref(false);

const { load: loadCached } = useImageCache();

const loadCover = async () => {
  showCoverAfterVideo.value = false;
  const [cover, video] = await Promise.all([
    loadCached(
      gameAssetKey(props.gameId, props.version, "cover"),
      () => window.electronAPI.game.getCover(props.gameId, props.version),
      0,
    ),
    props.autoplayVideo
      ? loadCached(
          gameAssetKey(props.gameId, props.version, "video"),
          () => window.electronAPI.game.getVideo(props.gameId, props.version),
          0,
        )
      : Promise.resolve(null),
  ]);
  coverUrl.value = cover;
  videoUrl.value = video;
};

const handleVideoEnded = () => {
  showCoverAfterVideo.value = true;
};

onMounted(loadCover);
watch(() => [props.gameId, props.version, props.autoplayVideo], loadCover);
</script>
