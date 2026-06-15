import { computed, nextTick, onUnmounted, ref, watch, type ComputedRef } from 'vue'
import type { GameManifest } from '../../../shared/game-manifest'

interface SearchableItem {
  id: string
  name: string
}

export function useGameListView<T extends SearchableItem>(items: ComputedRef<T[]>) {
  const searchKeyword = ref('')
  const isSearchExpanded = ref(false)
  const selectedVersions = ref<Record<string, string>>({})
  const manifestCache = ref<Record<string, GameManifest>>({})
  const visibleCount = ref(0)
  const isStaggerReady = ref(false)
  let staggerTimer: ReturnType<typeof setTimeout> | null = null

  const filteredItems = computed(() => {
    const keyword = searchKeyword.value.trim().toLowerCase()
    if (!keyword) return items.value
    return items.value.filter((item) => item.name.toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword))
  })

  function toggleSearch() {
    isSearchExpanded.value = true
  }

  function handleSearchBlur() {
    if (!searchKeyword.value.trim()) {
      isSearchExpanded.value = false
    }
  }

  function stopStaggerRendering() {
    if (staggerTimer !== null) {
      clearTimeout(staggerTimer)
      staggerTimer = null
    }
  }

  function startStaggerRendering() {
    stopStaggerRendering()
    visibleCount.value = 0
    const total = filteredItems.value.length
    if (total === 0) return
    const step = () => {
      if (visibleCount.value < total) {
        visibleCount.value++
        staggerTimer = setTimeout(step, 32)
      }
    }
    nextTick(() => {
      staggerTimer = setTimeout(step, 16)
    })
  }

  function activateStaggerRendering() {
    isStaggerReady.value = true
    startStaggerRendering()
  }

  function initializeManifestCache(manifests: GameManifest[], initializeExpanded?: (gameId: string) => void) {
    for (const manifest of manifests) {
      if (!selectedVersions.value[manifest.id]) {
        selectedVersions.value[manifest.id] = manifest.version
      }
      manifestCache.value[`${manifest.id}@${manifest.version}`] = manifest
      initializeExpanded?.(manifest.id)
    }
  }

  async function handleVersionChange(gameId: string, version: string) {
    selectedVersions.value[gameId] = version
    const key = `${gameId}@${version}`
    if (manifestCache.value[key]) return
    try {
      const manifest = await window.electronAPI.game.getManifest(gameId, version)
      if (manifest) {
        manifestCache.value[key] = manifest
      }
    } catch (e) {
      console.error(e)
    }
  }

  function getManifest(gameId: string, version = selectedVersions.value[gameId]): GameManifest | undefined {
    if (!version) return undefined
    return manifestCache.value[`${gameId}@${version}`]
  }

  watch(filteredItems, () => {
    if (isStaggerReady.value) {
      startStaggerRendering()
    }
  })

  onUnmounted(() => {
    stopStaggerRendering()
  })

  return {
    searchKeyword,
    isSearchExpanded,
    selectedVersions,
    manifestCache,
    visibleCount,
    filteredItems,
    toggleSearch,
    handleSearchBlur,
    activateStaggerRendering,
    initializeManifestCache,
    handleVersionChange,
    getManifest,
  }
}
