<template>
  <img
    v-if="iconUrl"
    :src="iconUrl"
    style="width: 100%; height: 100%; object-fit: contain"
  />
  <img
    v-else
    :src="defaultIconUrl"
    style="width: 100%; height: 100%; object-fit: contain"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useImageCache, gameAssetKey } from "../../composables/useImageCache";
import defaultIconUrl from "../../../../../resources/default_icon.png";

const props = defineProps<{
  gameId: string;
  version?: string;
}>();
const iconUrl = ref<string | null>(null);

const { load: loadCached } = useImageCache();

const loadIcon = async () => {
  if (!props.gameId) return;
  iconUrl.value = await loadCached(
    gameAssetKey(props.gameId, props.version, "icon"),
    () => window.electronAPI.game.getIcon(props.gameId, props.version),
    0,
  );
};

onMounted(loadIcon);
watch(() => [props.gameId, props.version], loadIcon);
</script>
