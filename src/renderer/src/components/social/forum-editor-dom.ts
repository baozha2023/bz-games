import type {
  ForumEditorReferenceSegment,
  ForumEditorSegment,
} from "./forum-editor-document";
import {
  FORUM_COMMAND_NAMES,
  getForumCommandProtocol,
  parseForumCommandDraftArguments,
  type ForumCommandName,
} from "../../../../shared/forum-references";
import {
  forumReferenceKey,
  type ForumReferenceViewModel,
} from "../../services/forum-reference-view-model";

export interface EditorDomState {
  segments: ForumEditorSegment[];
  nodes: Node[];
  spans: Array<HTMLElement | null>;
}

export interface SlashCommandDraft {
  kind: "query" | "draft";
  raw: string;
  query: string;
  command?: ForumCommandName;
  args: string[];
}

export interface SlashCommandContext extends SlashCommandDraft {
  segmentIndex: number;
  start: number;
  end: number;
}

const commandDraftPattern = new RegExp(
  `^/(${FORUM_COMMAND_NAMES.join("|")})<([^<>\\r\\n]*)>$`,
  "i",
);

export function parseSlashCommandDraft(raw: string): SlashCommandDraft | null {
  const queryMatch = /^\/([A-Za-z]*)$/u.exec(raw);
  if (queryMatch) {
    const query = queryMatch[1];
    const normalized = query.toLowerCase();
    const protocol = getForumCommandProtocol(normalized);
    if (!protocol) return { kind: "query", raw, query, args: [] };
    return {
      kind: "draft",
      raw,
      query: "",
      command: protocol.name,
      args: [],
    };
  }
  const draftMatch = commandDraftPattern.exec(raw);
  if (!draftMatch) return null;
  const command = getForumCommandProtocol(draftMatch[1])?.name;
  const args = parseForumCommandDraftArguments(draftMatch[1], draftMatch[2]);
  if (!command || !args) return null;
  return {
    kind: "draft",
    raw,
    query: "",
    command,
    args,
  };
}

function referenceText(
  segment: ForumEditorReferenceSegment,
  viewModel: ForumReferenceViewModel | undefined,
  loadingLabel: string,
): string {
  const label = viewModel?.label || loadingLabel;
  switch (segment.reference.type) {
    case "game":
      return `@${label}`;
    case "version":
      return label;
    case "market":
      return label;
    case "post":
      return viewModel?.type === "post" && viewModel.excerpt
        ? `${label}\n${viewModel.excerpt}`
        : label;
    case "page":
      return label;
  }
}

function createReferenceSpan(
  segment: ForumEditorReferenceSegment,
  viewModel: ForumReferenceViewModel | undefined,
  loadingLabel: string,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `forum-reference forum-reference--${segment.reference.type}`;
  if (segment.reference.type === "game") {
    span.classList.add("forum-game-mention", "forum-game-mention--resolved");
  }
  const status = viewModel?.status || "loading";
  if (status !== "resolved") {
    span.classList.add(`forum-reference--${status}`);
  }
  span.contentEditable = "false";
  span.dataset.forumReference = "true";
  span.dataset.segment = JSON.stringify(segment);
  const text = referenceText(segment, viewModel, loadingLabel);
  span.title = text;
  span.setAttribute("aria-label", text);
  if (segment.autoSeparator) span.dataset.autoSeparator = "true";
  span.textContent = text;
  return span;
}

export function renderEditorDocument(
  editor: HTMLElement,
  segments: ForumEditorSegment[],
  viewModels: ReadonlyMap<string, ForumReferenceViewModel>,
  loadingLabel: string,
): EditorDomState {
  editor.replaceChildren();
  const nodes: Node[] = [];
  const spans: Array<HTMLElement | null> = [];

  for (const segment of segments) {
    if (segment.type === "text") {
      if (!segment.value) continue;
      const node = document.createTextNode(segment.value);
      editor.appendChild(node);
      nodes.push(node);
      spans.push(null);
      continue;
    }

    const span = createReferenceSpan(
      segment,
      viewModels.get(forumReferenceKey(segment.reference)),
      loadingLabel,
    );
    editor.appendChild(span);
    nodes.push(span);
    spans.push(span);
  }

  return { segments, nodes, spans };
}

function readReferenceSpan(
  element: HTMLElement,
): ForumEditorReferenceSegment | null {
  if (element.dataset.forumReference !== "true" || !element.dataset.segment) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      element.dataset.segment,
    ) as ForumEditorReferenceSegment;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...parsed,
      autoSeparator: element.dataset.autoSeparator === "true",
    };
  } catch {
    return null;
  }
}

export function readEditorDocument(editor: HTMLElement): EditorDomState {
  if (
    editor.childNodes.length === 1 &&
    editor.firstChild instanceof HTMLElement &&
    editor.firstChild.tagName === "BR"
  ) {
    editor.replaceChildren();
  }

  const segments: ForumEditorSegment[] = [];
  const nodes: Node[] = [];
  const spans: Array<HTMLElement | null> = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      if (!value) return;
      segments.push({ type: "text", value });
      nodes.push(node);
      spans.push(null);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const reference = readReferenceSpan(element);
    if (reference) {
      segments.push(reference);
      nodes.push(element);
      spans.push(element);
      return;
    }
    if (element.tagName === "BR") {
      const lineBreak = document.createTextNode("\n");
      element.replaceWith(lineBreak);
      segments.push({ type: "text", value: "\n" });
      nodes.push(lineBreak);
      spans.push(null);
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };

  for (const child of Array.from(editor.childNodes)) visit(child);
  if (segments.length === 0) segments.push({ type: "text", value: "" });
  return { segments, nodes, spans };
}

function currentTextCaret(
  nodes: Node[],
  segments: ForumEditorSegment[],
): { segmentIndex: number; text: string; offset: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed)
    return null;
  const node = selection.anchorNode;
  const segmentIndex = nodes.indexOf(node as Node);
  if (segmentIndex < 0 || segments[segmentIndex]?.type !== "text") return null;
  const text = node?.textContent || "";
  return {
    segmentIndex,
    text,
    offset: Math.min(selection.anchorOffset, text.length),
  };
}

export function findMentionContext(
  editor: HTMLElement,
  nodes: Node[],
  segments: ForumEditorSegment[],
): { segmentIndex: number; start: number; end: number; query: string } | null {
  void editor;
  const caret = currentTextCaret(nodes, segments);
  if (!caret) return null;
  const beforeCaret = caret.text.slice(0, caret.offset);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0 || beforeCaret.slice(atIndex + 1).includes("\n")) return null;
  if (atIndex > 0 && /[A-Za-z0-9_]/.test(beforeCaret[atIndex - 1] || ""))
    return null;
  return {
    segmentIndex: caret.segmentIndex,
    start: atIndex,
    end: caret.offset,
    query: beforeCaret.slice(atIndex + 1),
  };
}

export function findSlashCommandContext(
  editor: HTMLElement,
  nodes: Node[],
  segments: ForumEditorSegment[],
): SlashCommandContext | null {
  void editor;
  const caret = currentTextCaret(nodes, segments);
  if (!caret) return null;
  const beforeCaret = caret.text.slice(0, caret.offset);
  const slashIndex = beforeCaret.lastIndexOf("/");
  if (slashIndex < 0) return null;
  const draft = parseSlashCommandDraft(beforeCaret.slice(slashIndex));
  if (!draft) return null;
  return {
    ...draft,
    segmentIndex: caret.segmentIndex,
    start: slashIndex,
    end: caret.offset,
  };
}

export function findAdjacentMention(
  editor: HTMLElement,
  direction: "backward" | "forward",
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed)
    return null;

  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  let target: Node | null = null;
  if (container.nodeType === Node.TEXT_NODE) {
    const textValue = container.textContent || "";
    if (
      direction === "backward" &&
      (range.startOffset === 0 ||
        (range.startOffset === 1 && textValue.startsWith(" ")))
    ) {
      target = container.previousSibling;
    }
    if (direction === "forward" && range.startOffset === textValue.length) {
      target = container.nextSibling;
    }
  } else if (container === editor) {
    target =
      editor.childNodes[
        direction === "backward" ? range.startOffset - 1 : range.startOffset
      ] || null;
  }

  if (!(target instanceof HTMLElement)) return null;
  return target.dataset.forumReference === "true" ? target : null;
}

export function placeCaretAfterNode(
  editor: HTMLElement,
  nodes: Node[],
  index: number,
): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const node = nodes[index];
  if (node) {
    range.selectNodeContents(node);
    range.collapse(false);
  } else {
    range.selectNodeContents(editor);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

export function placeCaretInTextNode(
  editor: HTMLElement,
  nodes: Node[],
  index: number,
  offset: number,
): void {
  const node = nodes[index];
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    placeCaretAfterNode(editor, nodes, Math.max(0, index - 1));
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.textContent?.length || 0));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

export function insertTextAtCaret(editor: HTMLElement, value: string): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(value);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.normalize();
  return true;
}

export function normalizeEmptyEditorCaret(editor: HTMLElement): void {
  if (editor.textContent || editor.querySelector("[data-forum-reference]"))
    return;
  editor.replaceChildren();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
