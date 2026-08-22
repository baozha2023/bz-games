import { computed, ref, watch, type Ref } from "vue";
import { getGameCardProductAsset } from "../../../shared/game-card-products";
import type { FrameContentInset } from "../../../shared/types";
import { useImageCache } from "./useImageCache";
import { useSettingsStore } from "../stores/useSettingsStore";

export type GameCardFrameRatio = "square" | "wide";

export function useGameCardFrameAsset(
  productId: Ref<string | undefined>,
  ratio: GameCardFrameRatio,
) {
  const settingsStore = useSettingsStore();
  const { load: loadCached } = useImageCache();
  const frameUrl = ref<string | null>(null);
  let loadVersion = 0;

  const activeProductId = computed(
    () => productId.value ?? settingsStore.userData?.equippedGameCardProduct,
  );
  const asset = computed(() =>
    activeProductId.value
      ? getGameCardProductAsset(activeProductId.value, ratio)
      : undefined,
  );
  const contentInsetPercent = computed<FrameContentInset | undefined>(
    () => asset.value?.contentInsetPercent,
  );

  async function loadFrame(): Promise<void> {
    const requestVersion = ++loadVersion;
    const currentProductId = activeProductId.value;
    if (!currentProductId || !asset.value) {
      frameUrl.value = null;
      return;
    }

    const nextFrameUrl = await loadCached(
      `game-card-product@${currentProductId}@${ratio}`,
      () =>
        window.electronAPI.user.getGameCardProductImage(
          currentProductId,
          ratio,
        ),
      0,
    );
    if (requestVersion === loadVersion) {
      frameUrl.value = nextFrameUrl;
    }
  }

  watch(activeProductId, loadFrame, { immediate: true });

  return {
    frameUrl,
    contentInsetPercent,
    activeProductId,
  };
}
