import type {
  ForumPostReference,
  ForumPostReferenceResult,
} from "../../../shared/types";

export interface ForumPostReferenceApi {
  resolvePostReferences(ids: string[]): Promise<ForumPostReferenceResult>;
}

export type ForumPostReferenceResolution =
  | ForumPostReference
  | { id: string; status: "unavailable" };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<
  string,
  { value: ForumPostReference; expiresAt: number }
>();
const pending = new Map<string, Promise<ForumPostReferenceResolution>>();

export async function resolveForumPostReferences(
  ids: string[],
  api: ForumPostReferenceApi,
): Promise<Map<string, ForumPostReferenceResolution>> {
  const uniqueIds = [...new Set(ids)];
  const result = new Map<string, ForumPostReferenceResolution>();
  const missing = uniqueIds.filter((id) => {
    const cached = cache.get(id);
    if (cached && cached.expiresAt > Date.now()) result.set(id, cached.value);
    else if (cached) cache.delete(id);
    return !result.has(id);
  });

  for (let offset = 0; offset < missing.length; offset += 20) {
    const batch = missing.slice(offset, offset + 20);
    const newIds = batch.filter((id) => !pending.has(id));
    if (newIds.length) {
      const batchPromise = api.resolvePostReferences(newIds);
      for (const id of newIds) {
        pending.set(
          id,
          batchPromise
            .then(
              (response): ForumPostReferenceResolution =>
                response.items.find((item) => item.id === id) || {
                  id,
                  status: "missing",
                },
            )
            .catch(
              (): ForumPostReferenceResolution => ({
                id,
                status: "unavailable",
              }),
            )
            .finally(() => pending.delete(id)),
        );
      }
    }
    const resolved = await Promise.all(
      batch.map(
        (id) => pending.get(id) || Promise.resolve(cache.get(id)!.value),
      ),
    );
    for (const item of resolved) {
      if (item.status !== "unavailable")
        cache.set(item.id, {
          value: item,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      result.set(item.id, item);
    }
  }
  return result;
}

export function clearForumPostReferenceCache(): void {
  cache.clear();
  pending.clear();
}
