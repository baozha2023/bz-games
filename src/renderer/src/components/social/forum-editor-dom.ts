import type {
  ForumEditorGameSegment,
  ForumEditorSegment,
} from "./forum-editor-document";

export interface EditorDomState {
  segments: ForumEditorSegment[];
  nodes: Node[];
  spans: Array<HTMLElement | null>;
}

function createMentionSpan(segment: ForumEditorGameSegment): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "forum-game-mention forum-game-mention--resolved";
  span.contentEditable = "false";
  span.dataset.marketId = segment.marketId;
  span.dataset.gameId = segment.gameId;
  span.dataset.marketName = segment.marketName;
  span.dataset.gameName = segment.gameName;
  if (segment.autoSeparator) span.dataset.autoSeparator = "true";
  span.textContent = `@${segment.marketName} / ${segment.gameName}`;
  return span;
}

export function renderEditorDocument(
  editor: HTMLElement,
  segments: ForumEditorSegment[],
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

    const span = createMentionSpan(segment);
    editor.appendChild(span);
    nodes.push(span);
    spans.push(span);
  }

  return { segments, nodes, spans };
}

function readMentionSpan(element: HTMLElement): ForumEditorGameSegment | null {
  const { marketId, gameId } = element.dataset;
  if (!marketId || !gameId) return null;
  return {
    type: "game",
    marketId,
    gameId,
    marketName: element.dataset.marketName || marketId,
    gameName: element.dataset.gameName || gameId,
    autoSeparator: element.dataset.autoSeparator === "true",
  };
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
    const mention = readMentionSpan(element);
    if (mention) {
      segments.push(mention);
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

export function findMentionContext(
  editor: HTMLElement,
  nodes: Node[],
  segments: ForumEditorSegment[],
): { segmentIndex: number; start: number; end: number; query: string } | null {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !selection.isCollapsed ||
    !editor
  )
    return null;

  const node = selection.anchorNode;
  const segmentIndex = nodes.indexOf(node as Node);
  if (segmentIndex < 0 || segments[segmentIndex]?.type !== "text") return null;

  const text = node?.textContent || "";
  const offset = Math.min(selection.anchorOffset, text.length);
  const beforeCaret = text.slice(0, offset);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0 || beforeCaret.slice(atIndex + 1).includes("\n")) return null;
  if (atIndex > 0 && /[A-Za-z0-9_]/.test(beforeCaret[atIndex - 1] || "")) return null;
  return {
    segmentIndex,
    start: atIndex,
    end: offset,
    query: beforeCaret.slice(atIndex + 1),
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
  return target.dataset.marketId && target.dataset.gameId ? target : null;
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
  if (editor.textContent || editor.querySelector("[data-market-id]")) return;
  editor.replaceChildren();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
