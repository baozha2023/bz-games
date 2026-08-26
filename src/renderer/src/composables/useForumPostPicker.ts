import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { ForumPage, ForumPostSummary } from "../../../shared/types";

export interface ForumPostPickerApi {
  getSearchAvailability(): Promise<boolean>;
  listPosts(
    query?: string,
    cursor?: string,
  ): Promise<ForumPage<ForumPostSummary>>;
}

interface ForumPostPickerOptions {
  active: Readonly<Ref<boolean>>;
  query: Ref<string>;
  onSearchUnavailable(): void;
}

const AVAILABILITY_TTL_MS = 5_000;
const POST_OPTION_LIMIT = 10;
const POST_SEARCH_MAX_CHARACTERS = 100;
const POST_SEARCH_DEBOUNCE_MS = 250;

export const FORUM_POST_SEARCH_MAX_CODE_UNITS = POST_SEARCH_MAX_CHARACTERS * 2;

export function useForumPostPicker(
  api: ForumPostPickerApi,
  options: ForumPostPickerOptions,
) {
  const available = ref(false);
  const items = ref<ForumPostSummary[]>([]);
  const loading = ref(false);
  let availabilityCheckedAt = 0;
  let availabilityRequest: Promise<boolean> | null = null;
  let loadGeneration = 0;
  let searchTimer: number | null = null;

  async function refreshAvailability(force = false): Promise<boolean> {
    if (!force && Date.now() - availabilityCheckedAt < AVAILABILITY_TTL_MS)
      return available.value;
    if (availabilityRequest) return availabilityRequest;
    availabilityRequest = api
      .getSearchAvailability()
      .then((value) => {
        available.value = value;
        availabilityCheckedAt = Date.now();
        return value;
      })
      .catch(() => {
        available.value = false;
        availabilityCheckedAt = Date.now();
        return false;
      })
      .finally(() => {
        availabilityRequest = null;
      });
    return availabilityRequest;
  }

  function invalidatePendingLoad(): void {
    loadGeneration += 1;
    loading.value = false;
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function cancel(): void {
    invalidatePendingLoad();
    items.value = [];
  }

  function markUnavailable(): void {
    available.value = false;
    availabilityCheckedAt = Date.now();
  }

  async function loadNow(): Promise<void> {
    invalidatePendingLoad();
    const generation = ++loadGeneration;
    loading.value = true;
    try {
      const page = await api.listPosts(options.query.value.trim());
      if (generation === loadGeneration)
        items.value = page.items.slice(0, POST_OPTION_LIMIT);
    } catch (error) {
      if (generation === loadGeneration) items.value = [];
      if (error instanceof Error && error.message === "search_unavailable") {
        markUnavailable();
        options.onSearchUnavailable();
      }
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  function scheduleLoad(): void {
    invalidatePendingLoad();
    searchTimer = window.setTimeout(
      () => void loadNow(),
      POST_SEARCH_DEBOUNCE_MS,
    );
  }

  watch(options.query, () => {
    if (!options.active.value) return;
    const normalized = Array.from(options.query.value)
      .slice(0, POST_SEARCH_MAX_CHARACTERS)
      .join("");
    if (normalized !== options.query.value) {
      options.query.value = normalized;
      return;
    }
    scheduleLoad();
  });

  onScopeDispose(cancel);

  return {
    available,
    cancel,
    items,
    loading,
    loadNow,
    refreshAvailability,
  };
}
