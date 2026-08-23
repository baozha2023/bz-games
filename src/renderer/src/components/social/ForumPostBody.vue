<template>
  <div class="forum-post-body">
    <template v-for="(part, index) in parts" :key="`${part.type}-${index}`">
      <span v-if="part.type === 'text'">{{ part.value }}</span>
      <button
        v-else-if="displayResolvedMentions[mentionKey(part)]"
        type="button"
        class="forum-game-mention forum-game-mention--resolved"
        :title="`${displayResolvedMentions[mentionKey(part)]?.marketName} / ${displayResolvedMentions[mentionKey(part)]?.gameName}`"
        @click="openGame(displayResolvedMentions[mentionKey(part)]!)"
      >
        <span class="forum-game-mention-prefix">@</span>
        {{ displayResolvedMentions[mentionKey(part)]?.marketName }} /
        {{ displayResolvedMentions[mentionKey(part)]?.gameName }}
      </button>
      <span
        v-else
        class="forum-game-mention forum-game-mention--unknown"
        :title="part.raw"
      >
        {{
          isResolvingDisplay
            ? t("social.gameMentionLoading")
            : t("social.unknownGame")
        }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  parseForumGameMentions,
  type ForumGameMentionToken,
} from "../../../../shared/forum-game-mentions";
import type { ResolvedForumGameMention } from "../../services/forum-game-mention-service";
import { resolveForumGameMentions } from "../../services/forum-game-mention-service";

const props = defineProps<{
  body: string;
  resolvedMentions?: Record<string, ResolvedForumGameMention>;
  isResolving?: boolean;
}>();

const { t } = useI18n();
const router = useRouter();
const parts = ref(parseForumGameMentions(props.body));
const localResolvedMentions = ref<Record<string, ResolvedForumGameMention>>({});
const isResolvingLocal = ref(false);
let resolveGeneration = 0;

const displayResolvedMentions = computed(
  () => props.resolvedMentions ?? localResolvedMentions.value,
);
const isResolvingDisplay = computed(
  () => props.isResolving ?? isResolvingLocal.value,
);

const mentionTokens = computed(() =>
  parts.value.filter(
    (part): part is ForumGameMentionToken => part.type === "game",
  ),
);

function mentionKey(token: ForumGameMentionToken): string {
  return `${token.marketId}/${token.gameId}`;
}

async function resolveMentions(body: string): Promise<void> {
  const generation = ++resolveGeneration;
  parts.value = parseForumGameMentions(body);
  const tokens = mentionTokens.value;
  localResolvedMentions.value = {};
  if (tokens.length === 0) {
    isResolvingLocal.value = false;
    return;
  }

  isResolvingLocal.value = true;
  try {
    const resolved = await resolveForumGameMentions(
      tokens,
      window.electronAPI.market,
    );
    if (generation !== resolveGeneration) return;
    localResolvedMentions.value = Object.fromEntries(resolved.entries());
  } catch {
    if (generation === resolveGeneration) localResolvedMentions.value = {};
  } finally {
    if (generation === resolveGeneration) isResolvingLocal.value = false;
  }
}

function openGame(target: ResolvedForumGameMention): void {
  router.push({
    name: "Market",
    params: { sourceIdx: String(target.sourceIdx) },
    query: { gameId: target.gameId },
  });
}

watch(
  () => props.body,
  (body) => {
    if (props.resolvedMentions === undefined) void resolveMentions(body);
    else parts.value = parseForumGameMentions(body);
  },
  { immediate: true },
);
</script>

<style scoped>
.forum-post-body {
  min-height: 80px;
  color: var(--bz-text-title);
  white-space: pre-wrap;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.forum-game-mention--resolved {
  cursor: pointer;
}
</style>
