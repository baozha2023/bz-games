interface CacheEntry {
  dataUrl: string
  at: number
}

const dataUrlCache = new Map<string, CacheEntry>()
const pendingLoads = new Map<string, Promise<string | null>>()

const MAX_ENTRIES = 500

function evictLRU(): void {
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [key, entry] of dataUrlCache) {
    if (entry.at < oldestAt) {
      oldestAt = entry.at
      oldestKey = key
    }
  }
  if (oldestKey) {
    dataUrlCache.delete(oldestKey)
  }
}

export function useImageCache() {
  async function load(
    key: string,
    loader: () => Promise<string | null>,
    ttlMs: number,
  ): Promise<string | null> {
    const cached = dataUrlCache.get(key)
    if (cached) {
      if (ttlMs <= 0 || Date.now() - cached.at < ttlMs) {
        cached.at = Date.now()
        return cached.dataUrl
      }
      dataUrlCache.delete(key)
    }

    const inflight = pendingLoads.get(key)
    if (inflight) return inflight

    const promise = loader()
      .then((result) => {
        if (result) {
          if (dataUrlCache.size >= MAX_ENTRIES) {
            evictLRU()
          }
          dataUrlCache.set(key, { dataUrl: result, at: Date.now() })
        }
        return result
      })
      .finally(() => {
        pendingLoads.delete(key)
      })

    pendingLoads.set(key, promise)
    return promise
  }

  function has(key: string): boolean {
    return dataUrlCache.has(key)
  }

  function get(key: string): string | undefined {
    return dataUrlCache.get(key)?.dataUrl
  }

  function set(key: string, value: string): void {
    if (dataUrlCache.size >= MAX_ENTRIES) {
      evictLRU()
    }
    dataUrlCache.set(key, {
      dataUrl: value,
      at: Date.now(),
    })
  }

  function invalidatePrefix(prefix: string): void {
    for (const key of dataUrlCache.keys()) {
      if (key.startsWith(prefix)) dataUrlCache.delete(key)
    }
  }

  function clear(): void {
    dataUrlCache.clear()
    pendingLoads.clear()
  }

  return { load, has, get, set, invalidatePrefix, clear }
}

export function invalidateGameAssetCache(gameId: string): void {
  const prefix = `${gameId}@`
  for (const key of dataUrlCache.keys()) {
    if (key.startsWith(prefix)) dataUrlCache.delete(key)
  }
}

export function gameAssetKey(
  gameId: string,
  version: string | undefined,
  field: string,
): string {
  return `${gameId}@${version || 'latest'}@${field}`
}

export function gameAssetPrefix(gameId: string, version?: string): string {
  return `${gameId}@${version || 'latest'}@`
}
