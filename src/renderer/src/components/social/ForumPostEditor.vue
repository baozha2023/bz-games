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
      @mousedown="handleEditorMouseDown"
      @input="handleInput"
      @keydown="handleKeydown"
      @keyup="updateContext"
      @click="updateContext"
      @focus="handleEditorFocus"
      @blur="handleBlur"
      @scroll="updatePopupPosition"
      @paste="handlePaste"
      @drop.prevent="handleDrop"
      @compositionstart="isComposing = true"
      @compositionend="handleCompositionEnd"
    />

    <Teleport to="body">
      <div
        v-if="showPopup"
        ref="popupRef"
        class="forum-command-popup"
        :style="popupStyle"
        @mousedown.stop
      >
        <div class="forum-command-heading">
          <button
            v-if="stage !== 'commands' && stage !== 'mention'"
            type="button"
            @mousedown.prevent="goBack"
          >
            ← {{ t("forumCommands.back") }}
          </button>
          <strong>{{ stageTitle }}</strong
          ><n-spin v-if="loading" size="small" />
        </div>
        <input
          v-if="stage === 'post'"
          ref="postSearchRef"
          v-model="pickerQuery"
          class="forum-command-post-search"
          :placeholder="t('forumCommands.postSearchPlaceholder')"
          :maxlength="FORUM_POST_SEARCH_MAX_CODE_UNITS"
          @keydown.stop="handlePostSearchKeydown"
        />
        <template v-if="stage === 'commands'">
          <button
            v-for="(command, index) in commandOptions"
            :key="command.name"
            type="button"
            class="forum-command-option forum-command-option--command"
            :class="{ active: optionIndex === index }"
            @mousedown.prevent="selectCommand(command)"
          >
            <strong>/{{ command.name }}</strong>
            <small>{{ t(command.descriptionKey) }}</small>
          </button>
        </template>
        <template v-else-if="stage === 'mention'">
          <button
            v-for="(candidate, index) in mentionOptions"
            :key="candidate.key"
            type="button"
            class="forum-command-option"
            :class="{ active: optionIndex === index }"
            @mousedown.prevent="selectMentionCandidate(candidate)"
          >
            <span
              ><strong>{{
                candidate.kind === "market"
                  ? candidate.marketName
                  : candidate.gameName
              }}</strong
              ><small>{{
                candidate.kind === "market"
                  ? t("social.marketCandidate")
                  : candidate.marketName
              }}</small></span
            >
          </button>
        </template>
        <template v-else>
          <button
            v-for="(option, index) in pickerOptions"
            :key="option.key"
            type="button"
            class="forum-command-option"
            :class="{ active: optionIndex === index }"
            @mousedown.prevent="selectPickerOption(option)"
          >
            <span
              ><strong>{{ option.label }}</strong
              ><small v-if="option.description">{{
                option.description
              }}</small></span
            >
          </button>
        </template>
        <div
          v-if="!loading && activeOptionCount === 0"
          class="forum-command-empty"
        >
          {{ t("forumCommands.empty") }}
        </div>
      </div>
    </Teleport>

    <div class="forum-editor-footer">
      <span>{{ serializedLength }}/{{ maxLength }}</span
      ><span v-if="isOverLimit" class="forum-editor-limit">{{
        t("social.bodyTooLong")
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  parseForumReferences,
  type ForumReferenceInput,
  type ForumReferenceToken,
} from "../../../../shared/forum-references";
import type { ForumPostSummary } from "../../../../shared/types";
import {
  useForumReferenceCandidates,
  type GameCandidate,
  type MentionCandidate,
} from "../../composables/useForumReferenceCandidates";
import { useForumCommandController } from "../../composables/useForumCommandController";
import {
  FORUM_POST_SEARCH_MAX_CODE_UNITS,
  useForumPostPicker,
} from "../../composables/useForumPostPicker";
import {
  availableForumCommands,
  getForumCommand,
  type ForumCommandDefinition,
} from "../../services/forum-command-registry";
import { FORUM_PAGES } from "../../services/forum-page-registry";
import {
  createResolvedForumReferenceViewModel,
  forumReferenceKey,
  resolveForumReferenceViewModels,
  type ForumResolvedReferenceSeed,
  type ForumReferenceViewModel,
} from "../../services/forum-reference-view-model";
import {
  findAdjacentMention,
  findMentionContext,
  findSlashCommandContext,
  insertTextAtCaret,
  normalizeEmptyEditorCaret,
  parseSlashCommandDraft,
  placeCaretAfterNode,
  placeCaretInTextNode,
  readEditorDocument,
  renderEditorDocument,
  type EditorDomState,
  type SlashCommandContext,
} from "./forum-editor-dom";
import {
  removeReferenceFromDocument,
  replaceReferenceInDocument,
  serializeEditorDocument,
  type ForumEditorReferenceSegment,
  type ForumEditorSegment,
  type ForumReferenceContext,
} from "./forum-editor-document";

interface Props {
  modelValue: string;
  placeholder?: string;
  maxLength?: number;
}
type PickerOption = {
  key: string;
  label: string;
  description?: string;
  value: unknown;
};
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
const popupRef = ref<HTMLElement | null>(null);
const postSearchRef = ref<HTMLInputElement | null>(null);
const segments = ref<ForumEditorSegment[]>(
  textToEditorSegments(props.modelValue),
);
const referenceViews = ref(new Map<string, ForumReferenceViewModel>());
const domState: EditorDomState = { segments: [], nodes: [], spans: [] };
const showPopup = ref(false);
const commandController = useForumCommandController();
const { selectedCommand, stage } = commandController;
const triggerContext = ref<ForumReferenceContext | null>(null);
const optionIndex = ref(0);
const pickerQuery = ref("");
const selectedMarket = ref<{
  marketId: string;
  marketName: string;
  sourceIdx: number;
} | null>(null);
const selectedGame = ref<GameCandidate | null>(null);
const selectedPageGroup = ref<string | null>(null);
const popupStyle = ref({ left: "0px", top: "0px" });
const mentionQuery = ref("");
const selectedMentionMarketId = ref("");
const activeSlashContext = ref<SlashCommandContext | null>(null);
let dismissedSlash: { signature: string; kind: "query" | "draft" } | null =
  null;
let popupAnchor: { left: number; top: number; bottom: number } | null = null;
let internalValue = props.modelValue;
let isComposing = false;
let hydrateGeneration = 0;
let restoreGeneration = 0;

const mentions = useForumReferenceCandidates(
  window.electronAPI.market,
  mentionQuery,
  selectedMentionMarketId,
);
const postPicker = useForumPostPicker(window.electronAPI.forum, {
  active: computed(() => stage.value === "post"),
  query: pickerQuery,
  onSearchUnavailable: () => closePopup(),
});
const postOptions = postPicker.items;
const postLoading = postPicker.loading;
const searchAvailable = postPicker.available;
const mentionOptions = computed(() => mentions.candidates.value);
const commandOptions = computed(() =>
  availableForumCommands(searchAvailable.value).filter((item) =>
    item.name.toLowerCase().startsWith(mentionQuery.value.toLowerCase()),
  ),
);
const loading = computed(
  () =>
    mentions.isLoadingCandidates.value ||
    (stage.value === "post" && postLoading.value),
);
const serializedBody = computed(() => serializeEditorDocument(segments.value));
const serializedLength = computed(
  () => Array.from(serializedBody.value).length,
);
const isOverLimit = computed(() => serializedLength.value > props.maxLength);

const pickerOptions = computed<PickerOption[]>(() => {
  const query = pickerQuery.value.trim().toLocaleLowerCase();
  let values: PickerOption[] = [];
  if (stage.value === "market")
    values = mentions.directorySources.value.map((item, sourceIdx) => ({
      key: item.marketId,
      label: item.marketName,
      description: item.marketId,
      value: { ...item, sourceIdx },
    }));
  if (stage.value === "game")
    values = mentions.loadedIndexes.value
      .filter((item) => item.source.marketId === selectedMarket.value?.marketId)
      .flatMap((item) =>
        item.index.games.map((game) => ({
          key: game.id,
          label: game.name,
          description: game.id,
          value: {
            kind: "game",
            key: game.id,
            marketId: item.index.marketId,
            marketName: item.index.marketName,
            sourceIdx: item.sourceIdx,
            gameId: game.id,
            gameName: game.name,
          } satisfies GameCandidate,
        })),
      );
  if (stage.value === "version") {
    const entry = mentions.loadedIndexes.value.find(
      (item) => item.source.marketId === selectedMarket.value?.marketId,
    );
    const game = entry?.index.games.find(
      (item) => item.id === selectedGame.value?.gameId,
    );
    values = (game?.versions || []).map((item) => ({
      key: item.version,
      label: item.version,
      description: item.description,
      value: item.version,
    }));
  }
  if (stage.value === "post")
    values = postOptions.value.map((post) => ({
      key: post.id,
      label: post.title,
      description: post.authorNickname,
      value: post,
    }));
  if (stage.value === "pageGroup")
    values = [...new Set(FORUM_PAGES.map((page) => page.group))].map(
      (group) => ({
        key: group,
        label: t(`forumCommands.groups.${group}`),
        value: group,
      }),
    );
  if (stage.value === "page")
    values = FORUM_PAGES.filter(
      (page) => page.group === selectedPageGroup.value,
    ).map((page) => ({
      key: page.id,
      label: t(page.labelKey),
      description: t(page.descriptionKey),
      value: page,
    }));
  return query
    ? values.filter((item) =>
        `${item.label} ${item.description || ""} ${item.key}`
          .toLocaleLowerCase()
          .includes(query),
      )
    : values;
});
const activeOptionCount = computed(() =>
  stage.value === "commands"
    ? commandOptions.value.length
    : stage.value === "mention"
      ? mentionOptions.value.length
      : pickerOptions.value.length,
);
const stageTitle = computed(() =>
  stage.value === "commands"
    ? t("forumCommands.menuTitle")
    : stage.value === "mention"
      ? t("social.insertGame")
      : t(
          `forumCommands.select${stage.value[0].toUpperCase()}${stage.value.slice(1)}`,
        ),
);

function tokenToSegment(
  token: ForumReferenceToken,
): ForumEditorReferenceSegment {
  const { raw: _raw, ...reference } = token;
  return {
    type: "reference",
    reference,
  };
}

function segmentToToken(
  segment: ForumEditorReferenceSegment,
): ForumReferenceToken {
  return { ...segment.reference, raw: "" } as ForumReferenceToken;
}

function textToEditorSegments(value: string): ForumEditorSegment[] {
  return parseForumReferences(value).map((part) =>
    part.type === "text" ? part : tokenToSegment(part),
  );
}

function renderSegments(): void {
  if (!editorRef.value) return;
  const state = renderEditorDocument(
    editorRef.value,
    segments.value,
    referenceViews.value,
    t("forumCommands.loading"),
  );
  Object.assign(domState, state);
}
function syncFromDom(): void {
  if (!editorRef.value) return;
  const state = readEditorDocument(editorRef.value);
  segments.value = state.segments;
  Object.assign(domState, state);
}
function emitValue(): void {
  const value = serializedBody.value;
  internalValue = value;
  emit("update:modelValue", value);
  emit("update:valid", !isOverLimit.value);
}

function replaceCompleteReferences(): number | null {
  const next: ForumEditorSegment[] = [];
  let lastReference: number | null = null;
  for (const segment of segments.value) {
    if (segment.type !== "text") {
      next.push(segment);
      continue;
    }
    for (const part of parseForumReferences(segment.value)) {
      if (part.type === "text") next.push(part);
      else {
        next.push(tokenToSegment(part));
        lastReference = next.length - 1;
      }
    }
  }
  if (lastReference !== null) segments.value = next;
  return lastReference;
}

async function hydrateReferences(restoreAfterIndex?: number): Promise<void> {
  const current = ++hydrateGeneration;
  const tokens = segments.value
    .filter(
      (segment): segment is ForumEditorReferenceSegment =>
        segment.type === "reference",
    )
    .map(segmentToToken);
  const viewModels = await resolveForumReferenceViewModels(tokens, {
    marketApi: window.electronAPI.market,
    postApi: window.electronAPI.forum,
    translate: t,
  });
  if (current !== hydrateGeneration) return;
  referenceViews.value = viewModels;
  renderSegments();
  if (restoreAfterIndex !== undefined)
    void nextTick(() => {
      const editor = editorRef.value;
      if (!editor) return;
      const following = segments.value[restoreAfterIndex + 1];
      if (following?.type === "text")
        placeCaretInTextNode(
          editor,
          domState.nodes,
          restoreAfterIndex + 1,
          following.value.startsWith(" ") ? 1 : 0,
        );
      else placeCaretAfterNode(editor, domState.nodes, restoreAfterIndex);
    });
}

function updatePopupPosition(): void {
  if (!showPopup.value || !editorRef.value) return;
  const selection = window.getSelection();
  const range = selection?.rangeCount
    ? selection.getRangeAt(0).cloneRange()
    : null;
  const selectionIsInEditor = Boolean(
    range && editorRef.value.contains(range.startContainer),
  );
  const caret = selectionIsInEditor ? range?.getBoundingClientRect() : null;
  if (caret)
    popupAnchor = {
      left: caret.left,
      top: caret.top,
      bottom: caret.bottom,
    };
  const editor = editorRef.value.getBoundingClientRect();
  const anchor = popupAnchor || {
    left: editor.left + 12,
    top: editor.top,
    bottom: editor.top + 32,
  };
  const width = Math.min(430, window.innerWidth - 24);
  const left = Math.max(
    12,
    Math.min(anchor.left, window.innerWidth - width - 12),
  );
  const height = popupRef.value?.offsetHeight || 320;
  let top = anchor.bottom + 6;
  if (top + height > window.innerHeight - 12)
    top = Math.max(12, anchor.top - height - 6);
  popupStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
}

function slashSignature(context: SlashCommandContext): string {
  return context.kind === "query"
    ? `${context.segmentIndex}:${context.start}`
    : `${context.segmentIndex}:${context.start}:${context.raw}`;
}

function isSlashDismissed(context: SlashCommandContext): boolean {
  return Boolean(
    dismissedSlash &&
    dismissedSlash.kind === context.kind &&
    dismissedSlash.signature === slashSignature(context),
  );
}

async function restoreSlashDraft(context: SlashCommandContext): Promise<void> {
  const generation = ++restoreGeneration;
  const command = context.command;
  if (!command) {
    showPopup.value = false;
    return;
  }
  const definition = getForumCommand(command);
  if (definition.requiresSearch && !(await postPicker.refreshAvailability())) {
    showPopup.value = false;
    return;
  }
  if (generation !== restoreGeneration) return;
  commandController.restore(command);
  selectedMarket.value = null;
  selectedGame.value = null;
  selectedPageGroup.value = null;
  pickerQuery.value = "";
  optionIndex.value = 0;

  if (definition.flow[0] === "post") {
    commandController.restore(command, definition.flow[0]);
    pickerQuery.value = context.args[0] || "";
    await nextTick();
    postSearchRef.value?.focus();
    await postPicker.loadNow();
    return;
  }
  if (definition.flow[0] === "pageGroup") {
    const groupMarker = context.args[0] || "";
    if (groupMarker.endsWith(":")) {
      const group = groupMarker.slice(0, -1);
      if (FORUM_PAGES.some((page) => page.group === group)) {
        selectedPageGroup.value = group;
        commandController.restore(command, definition.flow[1]);
        return;
      }
    }
    commandController.restore(command, definition.flow[0]);
    return;
  }

  commandController.restore(command, definition.flow[0]);
  try {
    await mentions.loadForQuery("");
  } catch {
    return;
  }
  if (generation !== restoreGeneration || context.args.length === 0) return;
  const marketId = context.args[0];
  const sourceIdx = mentions.directorySources.value.findIndex(
    (source) => source.marketId === marketId,
  );
  const source = mentions.directorySources.value[sourceIdx];
  if (!source || sourceIdx < 0) {
    pickerQuery.value = marketId;
    return;
  }
  selectedMarket.value = {
    marketId: source.marketId,
    marketName: source.marketName,
    sourceIdx,
  };
  if (definition.flow.length === 1) return;
  await mentions.selectMarket(sourceIdx).catch(() => undefined);
  if (generation !== restoreGeneration) return;
  commandController.restore(command, definition.flow[1]);
  if (context.args.length < 2) return;
  const entry = mentions.loadedIndexes.value.find(
    (item) => item.source.marketId === marketId,
  );
  const game = entry?.index.games.find((item) => item.id === context.args[1]);
  if (!entry || !game) {
    pickerQuery.value = context.args[1];
    return;
  }
  selectedGame.value = {
    kind: "game",
    key: `game:${marketId}/${game.id}`,
    marketId,
    marketName: entry.index.marketName,
    sourceIdx: entry.sourceIdx,
    gameId: game.id,
    gameName: game.name,
  };
  if (definition.flow[2])
    commandController.restore(command, definition.flow[2]);
}

function updateContext(): void {
  if (isComposing || !editorRef.value) return;
  const slash = findSlashCommandContext(
    editorRef.value,
    domState.nodes,
    segments.value,
  );
  if (slash) {
    if (slash.kind === "query") void postPicker.refreshAvailability();
    const previousSlash = activeSlashContext.value;
    const sameSlash = Boolean(
      previousSlash &&
      previousSlash.segmentIndex === slash.segmentIndex &&
      previousSlash.start === slash.start &&
      previousSlash.end === slash.end &&
      previousSlash.raw === slash.raw,
    );
    triggerContext.value = slash;
    activeSlashContext.value = slash;
    mentionQuery.value = slash.query;
    const isDismissed = isSlashDismissed(slash);
    if (!isDismissed) {
      dismissedSlash = null;
      showPopup.value = true;
      if (!sameSlash) {
        optionIndex.value = 0;
        if (slash.kind === "query") commandController.showCommands();
        else void restoreSlashDraft(slash);
      }
    }
    void nextTick(updatePopupPosition);
    return;
  }
  dismissedSlash = null;
  activeSlashContext.value = null;
  const mention = findMentionContext(
    editorRef.value,
    domState.nodes,
    segments.value,
  );
  if (mention) {
    triggerContext.value = mention;
    mentionQuery.value = mention.query.trim();
    commandController.showMention();
    showPopup.value = true;
    optionIndex.value = 0;
    void mentions.loadForQuery(mention.query.trim()).catch(() => undefined);
    void nextTick(updatePopupPosition);
    return;
  }
  showPopup.value = false;
  triggerContext.value = null;
  selectedMentionMarketId.value = "";
}

function replaceTriggerWithDraft(value: string): void {
  const context = triggerContext.value;
  if (!context) return;
  const result = replaceReferenceInDocument(segments.value, context, value);
  if (!result) return;
  segments.value = result.segments;
  renderSegments();
  emitValue();
  dismissedSlash = null;
  triggerContext.value = {
    segmentIndex: result.replacementIndex,
    start: 0,
    end: value.length,
  };
  const draft = parseSlashCommandDraft(value);
  activeSlashContext.value = draft
    ? {
        ...draft,
        segmentIndex: result.replacementIndex,
        start: 0,
        end: value.length,
      }
    : null;
  void nextTick(() => {
    const editor = editorRef.value;
    if (!editor) return;
    placeCaretInTextNode(
      editor,
      domState.nodes,
      result.replacementIndex,
      value.length,
    );
    updateContext();
  });
}

function insertReference(
  reference: ForumReferenceInput,
  viewModel: ForumReferenceViewModel,
): void {
  const context = triggerContext.value;
  if (!context) return;
  const result = replaceReferenceInDocument(
    segments.value,
    context,
    "",
    reference,
  );
  if (!result) return;
  segments.value = result.segments;
  referenceViews.value = new Map(referenceViews.value).set(
    forumReferenceKey(reference),
    viewModel,
  );
  renderSegments();
  emitValue();
  closePopup();
  void nextTick(() => {
    const editor = editorRef.value;
    if (!editor) return;
    placeCaretInTextNode(
      editor,
      domState.nodes,
      result.replacementIndex + 1,
      result.caretOffset,
    );
  });
  void hydrateReferences(result.replacementIndex);
}

function insertResolvedReference(seed: ForumResolvedReferenceSeed): void {
  insertReference(
    seed.reference,
    createResolvedForumReferenceViewModel(seed, t),
  );
}
function closePopup(dismiss = false): void {
  if (dismiss && activeSlashContext.value)
    dismissedSlash = {
      signature: slashSignature(activeSlashContext.value),
      kind: activeSlashContext.value.kind,
    };
  showPopup.value = false;
  commandController.reset();
  pickerQuery.value = "";
  selectedMarket.value = null;
  selectedGame.value = null;
  selectedPageGroup.value = null;
  activeSlashContext.value = null;
  popupAnchor = null;
  postPicker.cancel();
}

async function selectCommand(command: ForumCommandDefinition): Promise<void> {
  if (command.requiresSearch && !(await postPicker.refreshAvailability(true))) {
    commandController.showCommands();
    return;
  }
  commandController.start(command);
  replaceTriggerWithDraft(`/${command.name}`);
  pickerQuery.value = "";
  optionIndex.value = 0;
  if (stage.value === "post") {
    await nextTick();
    postSearchRef.value?.focus();
    await postPicker.loadNow();
    return;
  }
  if (stage.value !== "market") return;
  try {
    await mentions.loadForQuery("");
  } catch {
    /* menu remains usable */
  }
}
async function selectMentionCandidate(
  candidate: MentionCandidate,
): Promise<void> {
  if (candidate.kind === "market") {
    selectedMentionMarketId.value = candidate.marketId;
    mentionQuery.value = "";
    await mentions.selectMarket(candidate.sourceIdx).catch(() => undefined);
    optionIndex.value = 0;
    return;
  }
  insertResolvedReference({
    reference: {
      type: "game",
      syntax: "mention",
      marketId: candidate.marketId,
      gameId: candidate.gameId,
    },
    marketName: candidate.marketName,
    gameName: candidate.gameName,
    sourceIdx: candidate.sourceIdx,
  });
}
async function selectPickerOption(option: PickerOption): Promise<void> {
  if (stage.value === "market") {
    const market = option.value as {
      marketId: string;
      marketName: string;
      sourceIdx: number;
    };
    selectedMarket.value = market;
    const nextStage = commandController.advance();
    if (!nextStage) {
      insertResolvedReference({
        reference: { type: "market", marketId: market.marketId },
        marketName: market.marketName,
        sourceIdx: market.sourceIdx,
      });
      return;
    }
    replaceTriggerWithDraft(`/${selectedCommand.value}<${market.marketId}>`);
    await mentions.selectMarket(market.sourceIdx).catch(() => undefined);
    pickerQuery.value = "";
    optionIndex.value = 0;
    return;
  }
  if (stage.value === "game") {
    const game = option.value as GameCandidate;
    selectedGame.value = game;
    const nextStage = commandController.advance();
    if (!nextStage) {
      insertResolvedReference({
        reference: {
          type: "game",
          syntax: "command",
          marketId: game.marketId,
          gameId: game.gameId,
        },
        marketName: game.marketName,
        gameName: game.gameName,
        sourceIdx: game.sourceIdx,
      });
      return;
    }
    replaceTriggerWithDraft(`/version<${game.marketId},${game.gameId}>`);
    pickerQuery.value = "";
    optionIndex.value = 0;
    return;
  }
  if (stage.value === "version" && selectedGame.value) {
    insertResolvedReference({
      reference: {
        type: "version",
        marketId: selectedGame.value.marketId,
        gameId: selectedGame.value.gameId,
        version: String(option.value),
      },
      marketName: selectedGame.value.marketName,
      gameName: selectedGame.value.gameName,
      sourceIdx: selectedGame.value.sourceIdx,
    });
    return;
  }
  if (stage.value === "post") {
    const post = option.value as ForumPostSummary;
    insertResolvedReference({
      reference: { type: "post", postId: post.id },
      title: post.title,
    });
    return;
  }
  if (stage.value === "pageGroup") {
    selectedPageGroup.value = String(option.value);
    replaceTriggerWithDraft(`/page<${selectedPageGroup.value}:>`);
    commandController.advance();
    pickerQuery.value = "";
    optionIndex.value = 0;
    return;
  }
  if (stage.value === "page") {
    const page = option.value as (typeof FORUM_PAGES)[number];
    insertResolvedReference({ reference: { type: "page", pageId: page.id } });
  }
}
function goBack(): void {
  const command = commandController.definition.value;
  const previousStage = commandController.retreat();
  if (!command || !previousStage) {
    if (selectedCommand.value)
      replaceTriggerWithDraft(`/${selectedCommand.value.slice(0, 1)}`);
  } else {
    if (previousStage === "game" && selectedMarket.value)
      replaceTriggerWithDraft(
        `/${command.name}<${selectedMarket.value.marketId}>`,
      );
    else replaceTriggerWithDraft(`/${command.name}`);
  }
  pickerQuery.value = "";
  optionIndex.value = 0;
}
function activeOptions(): unknown[] {
  return stage.value === "commands"
    ? commandOptions.value
    : stage.value === "mention"
      ? mentionOptions.value
      : pickerOptions.value;
}
function chooseActive(): void {
  const option = activeOptions()[optionIndex.value];
  if (!option) return;
  if (stage.value === "commands")
    void selectCommand(option as ForumCommandDefinition);
  else if (stage.value === "mention")
    void selectMentionCandidate(option as MentionCandidate);
  else void selectPickerOption(option as PickerOption);
}
function menuKey(event: KeyboardEvent): boolean {
  if (!showPopup.value) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    optionIndex.value = Math.min(
      optionIndex.value + 1,
      Math.max(0, activeOptionCount.value - 1),
    );
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    optionIndex.value = Math.max(0, optionIndex.value - 1);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    if (activeOptionCount.value) {
      event.preventDefault();
      chooseActive();
      return true;
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closePopup(true);
    return true;
  }
  return false;
}
function handlePostSearchKeydown(event: KeyboardEvent): void {
  menuKey(event);
}
function handleKeydown(event: KeyboardEvent): void {
  if (isComposing || menuKey(event)) return;
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
    const removed = removeReferenceFromDocument(segments.value, index);
    if (!removed) return;
    event.preventDefault();
    segments.value = removed.segments;
    renderSegments();
    emitValue();
    void nextTick(() => {
      const editor = editorRef.value;
      if (!editor) return;
      placeCaretInTextNode(editor, domState.nodes, removed.caretIndex, 0);
    });
  }
}
function handleInput(): void {
  syncFromDom();
  const inserted = replaceCompleteReferences();
  if (inserted !== null) {
    renderSegments();
    void nextTick(() => {
      const editor = editorRef.value;
      if (editor) placeCaretAfterNode(editor, domState.nodes, inserted);
    });
    void hydrateReferences(inserted);
  }
  emitValue();
  if (serializedBody.value === "" && editorRef.value)
    normalizeEmptyEditorCaret(editorRef.value);
  if (!isComposing) updateContext();
}
function handleCompositionEnd(): void {
  isComposing = false;
  handleInput();
}
function insertPlainText(text: string): void {
  if (text && editorRef.value) {
    insertTextAtCaret(editorRef.value, text.replace(/\r\n?/g, "\n"));
    handleInput();
  }
}
function handlePaste(event: ClipboardEvent): void {
  event.preventDefault();
  insertPlainText(event.clipboardData?.getData("text/plain") || "");
}
function handleDrop(event: DragEvent): void {
  insertPlainText(event.dataTransfer?.getData("text/plain") || "");
}
function handleEditorMouseDown(): void {
  if (showPopup.value) closePopup(true);
  else if (dismissedSlash?.kind === "draft") dismissedSlash = null;
}
function handleEditorFocus(): void {
  if (!showPopup.value && dismissedSlash?.kind === "draft")
    dismissedSlash = null;
  updateContext();
}
function handleBlur(): void {
  window.setTimeout(() => {
    if (!popupRef.value?.contains(document.activeElement)) closePopup(true);
  }, 120);
}
function handleOutside(event: MouseEvent): void {
  if (
    !showPopup.value ||
    popupRef.value?.contains(event.target as Node) ||
    editorRef.value?.contains(event.target as Node)
  )
    return;
  closePopup(true);
}

watch(pickerQuery, () => {
  optionIndex.value = 0;
});
watch(
  () => props.modelValue,
  (value) => {
    if (value === internalValue) return;
    segments.value = textToEditorSegments(value);
    internalValue = value;
    renderSegments();
    closePopup();
    void hydrateReferences();
  },
);
watch(
  [showPopup, activeOptionCount, loading],
  () => void nextTick(updatePopupPosition),
);
onMounted(() => {
  renderSegments();
  emit("update:valid", !isOverLimit.value);
  void postPicker.refreshAvailability(true);
  void hydrateReferences();
  document.addEventListener("mousedown", handleOutside, true);
  window.addEventListener("resize", updatePopupPosition);
  window.addEventListener("scroll", updatePopupPosition, true);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutside, true);
  window.removeEventListener("resize", updatePopupPosition);
  window.removeEventListener("scroll", updatePopupPosition, true);
});
</script>

<style scoped>
.forum-editor-wrapper {
  position: relative;
  width: 100%;
  min-width: 0;
}
.forum-post-editor {
  display: block;
  width: 100%;
  min-height: 150px;
  box-sizing: border-box;
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
  color: var(--bz-text-muted, #999);
  content: attr(data-placeholder);
  pointer-events: none;
}
.forum-command-popup {
  position: fixed;
  z-index: 10000;
  width: min(430px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  box-sizing: border-box;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--bz-border);
  border-radius: 8px;
  background: var(--bz-bg, #fff);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}
.forum-command-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: var(--bz-text-secondary);
}
.forum-command-heading strong {
  flex: 1;
}
.forum-command-heading button {
  border: 0;
  background: transparent;
  color: var(--bz-green);
  cursor: pointer;
}
.forum-command-post-search {
  width: calc(100% - 16px);
  box-sizing: border-box;
  margin: 2px 8px 6px;
  padding: 7px 9px;
  border: 1px solid var(--bz-border);
  border-radius: 5px;
  background: var(--bz-bg);
  color: var(--bz-text-title);
}
.forum-command-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bz-text-title);
  text-align: left;
  cursor: pointer;
}
.forum-command-option:hover,
.forum-command-option.active {
  background: #eff8f2;
}
.forum-command-option > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.forum-command-option small {
  color: var(--bz-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-command-option--command {
  gap: 12px;
  white-space: nowrap;
}
.forum-command-option--command strong {
  flex: 0 0 auto;
}
.forum-command-option--command small {
  min-width: 0;
}
.forum-command-empty {
  padding: 14px 8px;
  color: var(--bz-text-secondary);
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
:global(.forum-reference) {
  display: inline-flex;
  align-items: center;
  margin: 0 2px;
  padding: 0 8px;
  border: 1px solid #b7e2c7;
  border-radius: 999px;
  background: #eff8f2;
  color: var(--bz-green);
}
:global(.forum-reference--post) {
  max-width: 90%;
  border-radius: 7px;
  white-space: pre-line;
}
:global(.forum-reference--loading),
:global(.forum-reference--missing),
:global(.forum-reference--unavailable) {
  border-color: var(--bz-border);
  background: var(--bz-bg-soft);
  color: var(--bz-text-secondary);
}
:global(.theme-dark) .forum-command-popup {
  background: #1a1a1a;
}
:global(.theme-dark) .forum-command-option:hover,
:global(.theme-dark) .forum-command-option.active {
  background: #244833;
}
</style>
