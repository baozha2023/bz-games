<template>
  <div class="forum-editor-wrapper">
    <div
      ref="editorRef"
      class="forum-post-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :data-placeholder="placeholder"
      :data-empty="serializedBody.length === 0"
      @input="handleInput"
      @keydown="handleKeydown"
      @keyup="updateMentionContext"
      @click="updateMentionContext"
      @focus="updateMentionContext"
      @scroll="updateMentionPopupPosition"
      @blur="handleBlur"
      @paste="handlePaste"
      @drop.prevent="handleDrop"
      @compositionstart="isComposing = true"
      @compositionend="handleCompositionEnd"
    />

    <Teleport to="body">
      <div
        v-if="showSuggestions"
        ref="suggestionsRef"
        class="forum-mention-suggestions"
        :style="mentionPopupStyle"
      >
        <div class="forum-mention-heading">
          <span>{{ t("social.insertGame") }}</span>
          <n-spin v-if="isLoadingCandidates" size="small" />
        </div>
        <div v-if="selectedMarketName" class="forum-mention-filter">
          {{ t("social.selectedMarket", { market: selectedMarketName }) }}
          <n-button text size="tiny" @mousedown.prevent="clearMarketFilter">
            {{ t("social.clearMarket") }}
          </n-button>
        </div>
        <button
          v-for="(candidate, index) in candidates"
          :key="candidate.key"
          type="button"
          class="forum-mention-option"
          :class="{ active: candidateIndex === index }"
          @mousedown.prevent="selectCandidate(candidate)"
        >
          <template v-if="candidate.kind === 'market'">
            <strong>{{ candidate.marketName }}</strong>
            <span>{{ t("social.marketCandidate") }}</span>
          </template>
          <template v-else>
            <strong>{{ candidate.gameName }}</strong>
            <span>{{ candidate.marketName }}</span>
          </template>
        </button>
        <div
          v-if="!isLoadingCandidates && candidates.length === 0"
          class="forum-mention-empty"
        >
          {{ t("social.noGameMatches") }}
        </div>
        <div
          v-if="mentionQuery && !isLoadingCandidates"
          class="forum-mention-hint"
        >
          {{ t("social.gameMentionHint") }}
        </div>
      </div>
    </Teleport>

    <div class="forum-editor-footer">
      <span>{{ serializedLength }}/{{ maxLength }}</span>
      <span v-if="isOverLimit" class="forum-editor-limit">{{
        t("social.bodyTooLong")
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useForumMentionCandidates } from "../../composables/useForumMentionCandidates";
import {
  findAdjacentMention,
  findMentionContext,
  insertTextAtCaret,
  normalizeEmptyEditorCaret,
  placeCaretAfterNode,
  placeCaretInTextNode,
  readEditorDocument,
  renderEditorDocument,
  type EditorDomState,
} from "./forum-editor-dom";
import {
  removeMentionFromDocument,
  replaceMentionInDocument,
  serializeEditorDocument,
  type ForumEditorSegment,
  type ForumMentionContext,
} from "./forum-editor-document";
import type {
  GameCandidate,
  MentionCandidate,
} from "../../composables/useForumMentionCandidates";

interface Props {
  modelValue: string;
  placeholder?: string;
  maxLength?: number;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: "",
  maxLength: 5000,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:valid": [value: boolean];
}>();

const { t } = useI18n();
const editorRef = ref<HTMLDivElement | null>(null);
const segments = ref<ForumEditorSegment[]>([
  { type: "text", value: props.modelValue },
]);
const domState: EditorDomState = { segments: [], nodes: [], spans: [] };
const showSuggestions = ref(false);
const mentionQuery = ref("");
const mentionContext = ref<ForumMentionContext | null>(null);
const candidateIndex = ref(0);
const selectedMarketId = ref("");
const suggestionsRef = ref<HTMLElement | null>(null);
const mentionPopupStyle = ref({ left: "0px", top: "0px" });
let internalValue = props.modelValue;
let isComposing = false;

const mentionCandidates = useForumMentionCandidates(
  window.electronAPI.market,
  mentionQuery,
  selectedMarketId,
);
const {
  candidates,
  isLoadingCandidates,
  selectedMarketName,
  loadForQuery,
  selectMarket,
} = mentionCandidates;

const serializedBody = computed(() => serializeEditorDocument(segments.value));
const serializedLength = computed(
  () => Array.from(serializedBody.value).length,
);
const isOverLimit = computed(() => serializedLength.value > props.maxLength);

function emitValue(): void {
  const value = serializedBody.value;
  internalValue = value;
  emit("update:modelValue", value);
  emit("update:valid", !isOverLimit.value);
}

function renderSegments(): void {
  if (!editorRef.value) return;
  const rendered = renderEditorDocument(editorRef.value, segments.value);
  domState.nodes = rendered.nodes;
  domState.spans = rendered.spans;
  domState.segments = rendered.segments;
}

function syncFromDom(): void {
  if (!editorRef.value) return;
  const read = readEditorDocument(editorRef.value);
  segments.value = read.segments;
  domState.nodes = read.nodes;
  domState.spans = read.spans;
  domState.segments = read.segments;
}

function currentTextContext() {
  if (!editorRef.value) return null;
  return findMentionContext(editorRef.value, domState.nodes, segments.value);
}

function updateMentionPopupPosition(): void {
  if (!showSuggestions.value || !editorRef.value) return;
  const editor = editorRef.value;
  const selection = window.getSelection();
  const range =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const caretRect = range?.getBoundingClientRect() || null;
  const editorRect = editor.getBoundingClientRect();
  const viewportPadding = 12;
  const popupWidth = Math.min(420, window.innerWidth - viewportPadding * 2);
  const left = Math.max(
    viewportPadding,
    Math.min(
      caretRect?.left ?? editorRect.left + 12,
      window.innerWidth - popupWidth - viewportPadding,
    ),
  );
  const popupHeight = suggestionsRef.value?.offsetHeight || 300;
  let top = (caretRect?.bottom || editorRect.top + 32) + 6;
  if (top + popupHeight > window.innerHeight - viewportPadding) {
    const above = (caretRect?.top || editorRect.top) - popupHeight - 6;
    top =
      above >= viewportPadding
        ? above
        : Math.max(
            viewportPadding,
            window.innerHeight - popupHeight - viewportPadding,
          );
  }
  mentionPopupStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
}

function replaceCurrentMention(value: string, candidate?: GameCandidate): void {
  const context = mentionContext.value;
  if (!context) return;
  const result = replaceMentionInDocument(
    segments.value,
    context,
    value,
    candidate
      ? {
          marketId: candidate.marketId,
          gameId: candidate.gameId,
          marketName: candidate.marketName,
          gameName: candidate.gameName,
        }
      : undefined,
  );
  if (!result) return;
  segments.value = result.segments;
  renderSegments();
  emitValue();
  showSuggestions.value = false;
  selectedMarketId.value = "";
  mentionContext.value = null;
  if (candidate) {
    void nextTick(() =>
      placeCaretInTextNode(
        editorRef.value!,
        domState.nodes,
        result.replacementIndex + 1,
        result.caretOffset,
      ),
    );
  } else {
    void nextTick(() =>
      placeCaretAfterNode(
        editorRef.value!,
        domState.nodes,
        result.replacementIndex,
      ),
    );
  }
}

function updateMentionContext(): void {
  const context = currentTextContext();
  if (!context) {
    showSuggestions.value = false;
    mentionContext.value = null;
    selectedMarketId.value = "";
    return;
  }
  mentionContext.value = context;
  mentionQuery.value = context.query.trim();
  showSuggestions.value = true;
  candidateIndex.value = 0;
  void nextTick(updateMentionPopupPosition);
  void loadForQuery(context.query.trim()).catch(() => undefined);
}

async function selectCandidate(candidate: MentionCandidate): Promise<void> {
  if (candidate.kind === "market") {
    selectedMarketId.value = candidate.marketId;
    try {
      await selectMarket(candidate.sourceIdx);
    } catch {
      // The editor remains usable as plain text when market data is unavailable.
    }
    replaceCurrentMention("@");
    selectedMarketId.value = candidate.marketId;
    void nextTick(updateMentionContext);
    return;
  }
  replaceCurrentMention("", candidate);
}

function clearMarketFilter(): void {
  selectedMarketId.value = "";
  updateMentionContext();
}

function handleInput(): void {
  syncFromDom();
  emitValue();
  if (!isComposing) {
    if (serializedBody.value === "" && editorRef.value)
      normalizeEmptyEditorCaret(editorRef.value);
    updateMentionContext();
  }
}

function handleCompositionEnd(): void {
  isComposing = false;
  updateMentionContext();
}

function handleKeydown(event: KeyboardEvent): void {
  if (isComposing) return;
  if (showSuggestions.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      candidateIndex.value = Math.min(
        candidateIndex.value + 1,
        Math.max(0, candidates.value.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      candidateIndex.value = Math.max(candidateIndex.value - 1, 0);
      return;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      candidates.value[candidateIndex.value]
    ) {
      event.preventDefault();
      void selectCandidate(candidates.value[candidateIndex.value]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      showSuggestions.value = false;
      return;
    }
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (editorRef.value) insertTextAtCaret(editorRef.value, "\n");
    handleInput();
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    const target = editorRef.value
      ? findAdjacentMention(
          editorRef.value,
          event.key === "Backspace" ? "backward" : "forward",
        )
      : null;
    if (!target) return;
    const index = domState.spans.indexOf(target);
    const removed = removeMentionFromDocument(segments.value, index);
    if (!removed) return;
    event.preventDefault();
    segments.value = removed.segments;
    renderSegments();
    emitValue();
    void nextTick(() => {
      const nextSegment = segments.value[removed.caretIndex];
      if (nextSegment?.type === "text") {
        placeCaretInTextNode(
          editorRef.value!,
          domState.nodes,
          removed.caretIndex,
          0,
        );
      } else {
        placeCaretAfterNode(
          editorRef.value!,
          domState.nodes,
          Math.max(0, removed.caretIndex - 1),
        );
      }
    });
  }
}

function handlePaste(event: ClipboardEvent): void {
  event.preventDefault();
  const text = (event.clipboardData?.getData("text/plain") || "").replace(
    /\r\n?/g,
    "\n",
  );
  if (text && editorRef.value) insertTextAtCaret(editorRef.value, text);
  if (text) handleInput();
}

function handleDrop(event: DragEvent): void {
  const text = (event.dataTransfer?.getData("text/plain") || "").replace(
    /\r\n?/g,
    "\n",
  );
  if (text && editorRef.value) insertTextAtCaret(editorRef.value, text);
  if (text) handleInput();
}

function handleBlur(): void {
  window.setTimeout(() => {
    showSuggestions.value = false;
  }, 120);
}

function handleViewportChange(): void {
  void nextTick(updateMentionPopupPosition);
}

watch(
  () => [
    showSuggestions.value,
    candidates.value.length,
    isLoadingCandidates.value,
  ],
  () => void nextTick(updateMentionPopupPosition),
);

watch(
  () => props.modelValue,
  (value) => {
    if (value === internalValue) return;
    segments.value = [{ type: "text", value }];
    renderSegments();
    showSuggestions.value = false;
    mentionContext.value = null;
    internalValue = value;
  },
);

onMounted(() => {
  renderSegments();
  emit("update:valid", !isOverLimit.value);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});
</script>

<style scoped>
.forum-editor-wrapper {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
}

.forum-post-editor {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 150px;
  padding: 10px 12px;
  border: 1px solid var(--bz-border-hover, #999);
  border-radius: 4px;
  background: var(--bz-bg, #fff);
  color: var(--bz-text-title);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

.forum-post-editor:focus {
  border-color: var(--bz-green);
  box-shadow: 0 0 0 2px var(--bz-green-soft);
}

.forum-post-editor[data-empty="true"]::before {
  display: inline;
  color: var(--bz-text-muted, #999);
  content: attr(data-placeholder);
  font-size: 16px;
  pointer-events: none;
}

.forum-mention-suggestions {
  position: fixed;
  z-index: 10000;
  width: min(420px, calc(100vw - 24px));
  box-sizing: border-box;
  max-height: min(300px, calc(100vh - 24px));
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--bz-border);
  border-radius: 8px;
  background: var(--bz-bg, #fff);
  opacity: 1;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.forum-mention-heading,
.forum-mention-filter,
.forum-mention-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  color: var(--bz-text-secondary);
  font-size: 12px;
}

.forum-mention-option {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bz-text-title);
  text-align: left;
  cursor: pointer;
}

.forum-mention-option:hover,
.forum-mention-option.active {
  background: #eff8f2;
}

:global(.theme-dark) .forum-mention-suggestions {
  background: #1a1a1a;
}

:global(.theme-dark) .forum-mention-option:hover,
:global(.theme-dark) .forum-mention-option.active {
  background: #244833;
}

.forum-mention-option span {
  color: var(--bz-text-secondary);
  font-size: 12px;
}

.forum-mention-empty {
  padding: 12px 8px;
  color: var(--bz-text-secondary);
  font-size: 13px;
  text-align: center;
}

.forum-editor-footer {
  display: flex;
  justify-content: space-between;
  padding-top: 4px;
  color: var(--bz-text-secondary);
  font-size: 12px;
}

.forum-editor-limit {
  color: var(--bz-delete-warning);
}
</style>
