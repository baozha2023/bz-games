<template>
  <div class="forum-post-body">
    <template
      v-for="(part, index) in parts"
      :key="`${part.type}-${index}-${part.type === 'text' ? part.value : part.raw}`"
    >
      <span v-if="part.type === 'text'">{{ part.value }}</span>
      <template v-else-if="part.type === 'game'">
        <button
          v-if="isResolved(part)"
          type="button"
          class="forum-game-mention forum-game-mention--resolved"
          @click="openReference(part)"
        >
          <span class="forum-game-mention-prefix">@</span>{{ labelFor(part) }}
        </button>
        <span
          v-else
          class="forum-game-mention forum-reference--disabled"
          :title="labelFor(part)"
          >{{ labelFor(part) }}</span
        >
      </template>
      <template v-else-if="part.type === 'version'">
        <button
          v-if="isResolved(part)"
          type="button"
          class="forum-reference forum-reference--version"
          @click="openReference(part)"
        >
          {{ labelFor(part) }}
        </button>
        <span
          v-else
          class="forum-reference forum-reference--disabled"
          :title="labelFor(part)"
          >{{ labelFor(part) }}</span
        >
      </template>
      <template v-else-if="part.type === 'market'">
        <button
          v-if="isResolved(part)"
          type="button"
          class="forum-reference forum-reference--market"
          @click="openReference(part)"
        >
          {{ labelFor(part) }}
        </button>
        <span
          v-else
          class="forum-reference forum-reference--disabled"
          :title="labelFor(part)"
          >{{ labelFor(part) }}</span
        >
      </template>
      <template v-else-if="part.type === 'post'">
        <button
          v-if="isResolved(part)"
          type="button"
          class="forum-post-reference"
          @click="openReference(part)"
        >
          <strong>{{ labelFor(part) }}</strong
          ><span>{{ excerptFor(part) }}</span>
        </button>
        <span
          v-else
          class="forum-post-reference forum-post-reference--disabled"
          :title="labelFor(part)"
          >{{ labelFor(part) }}</span
        >
      </template>
      <template v-else-if="part.type === 'page'">
        <button
          v-if="isResolved(part)"
          type="button"
          class="forum-reference forum-reference--page"
          @click="openReference(part)"
        >
          {{ labelFor(part) }}
        </button>
        <span
          v-else
          class="forum-reference forum-reference--disabled"
          :title="labelFor(part)"
          >{{ labelFor(part) }}</span
        >
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  parseForumReferences,
  type ForumReferenceToken,
} from "../../../../shared/forum-references";
import {
  forumReferenceKey,
  resolveForumReferenceViewModels,
  type ForumReferenceViewModel,
} from "../../services/forum-reference-view-model";
import { openForumPage } from "../../services/forum-page-registry";

const props = defineProps<{ body: string }>();
const { t } = useI18n();
const router = useRouter();
const parts = ref(parseForumReferences(props.body));
const references = ref(new Map<string, ForumReferenceViewModel>());
let generation = 0;

function referenceFor(
  part: ForumReferenceToken,
): ForumReferenceViewModel | undefined {
  return references.value.get(forumReferenceKey(part));
}
function isResolved(part: ForumReferenceToken): boolean {
  return referenceFor(part)?.status === "resolved";
}
function labelFor(part: ForumReferenceToken): string {
  return referenceFor(part)?.label || t("forumCommands.loading");
}
function excerptFor(part: ForumReferenceToken): string {
  const value = referenceFor(part);
  return value?.type === "post" ? value.excerpt : "";
}
function openReference(part: ForumReferenceToken): void {
  const value = referenceFor(part);
  if (!value || value.status !== "resolved") return;
  if (value.type === "game")
    void router.push({
      name: "Market",
      params: { marketId: value.marketId },
      query: { gameId: value.gameId },
    });
  else if (value.type === "version")
    void router.push({
      name: "Market",
      params: { marketId: value.marketId },
      query: { gameId: value.gameId, version: value.version },
    });
  else if (value.type === "market")
    void router.push({
      name: "Market",
      params: { marketId: value.marketId },
    });
  else if (value.type === "post")
    void router.push({ name: "SocialPost", params: { postId: value.postId } });
  else if (value.type === "page" && value.page)
    void openForumPage(router, value.page);
}

async function resolveBody(body: string): Promise<void> {
  const current = ++generation;
  parts.value = parseForumReferences(body);
  references.value = new Map();
  const tokens = parts.value.filter(
    (part): part is ForumReferenceToken => part.type !== "text",
  );
  const result = await resolveForumReferenceViewModels(tokens, {
    marketApi: window.electronAPI.market,
    postApi: window.electronAPI.forum,
    translate: t,
  });
  if (current === generation) references.value = result;
}

watch(
  () => props.body,
  (body) => void resolveBody(body),
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
.forum-reference,
.forum-post-reference {
  margin: 0 2px;
  border: 1px solid #b7e2c7;
  border-radius: 999px;
  background: #eff8f2;
  color: var(--bz-green);
  font: inherit;
  cursor: pointer;
}
.forum-reference {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
}
.forum-reference--version {
  border-color: #c9c0ef;
  background: #f4f1ff;
  color: #6552a8;
}
.forum-reference--page {
  border-color: #b9d9ee;
  background: #eef8ff;
  color: #2875a8;
}
.forum-reference--disabled {
  display: inline-flex;
  padding: 0 8px;
  border-color: var(--bz-border);
  background: var(--bz-bg-soft);
  color: var(--bz-text-secondary);
  cursor: default;
}
.forum-post-reference {
  display: inline-flex;
  max-width: min(520px, 100%);
  box-sizing: border-box;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 8px;
  text-align: left;
  vertical-align: middle;
}
.forum-post-reference span {
  max-width: 100%;
  color: var(--bz-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-post-reference--disabled {
  color: var(--bz-text-secondary);
  cursor: default;
}
</style>
