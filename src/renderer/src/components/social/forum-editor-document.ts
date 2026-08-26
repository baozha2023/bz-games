import {
  serializeForumReference,
  type ForumReferenceInput,
} from "../../../../shared/forum-references";

export interface ForumEditorTextSegment {
  type: "text";
  value: string;
}

export interface ForumEditorReferenceSegment {
  type: "reference";
  reference: ForumReferenceInput;
  /** Editor-only marker used to remove an automatically inserted separator. */
  autoSeparator?: boolean;
}

export type ForumEditorSegment =
  | ForumEditorTextSegment
  | ForumEditorReferenceSegment;

export interface ForumReferenceContext {
  segmentIndex: number;
  start: number;
  end: number;
}

export interface ForumReferenceReplacement {
  segments: ForumEditorSegment[];
  replacementIndex: number;
  caretOffset: number;
}

export function serializeEditorDocument(
  segments: ForumEditorSegment[],
): string {
  return segments
    .map((segment) =>
      segment.type === "text"
        ? segment.value
        : serializeForumReference(segment.reference),
    )
    .join("");
}

export function replaceReferenceInDocument(
  segments: ForumEditorSegment[],
  context: ForumReferenceContext,
  value: string,
  reference?: ForumReferenceInput,
): ForumReferenceReplacement | null {
  const segment = segments[context.segmentIndex];
  if (!segment || segment.type !== "text") return null;

  const replacement: ForumEditorSegment = reference
    ? { type: "reference", reference, autoSeparator: true }
    : { type: "text", value };
  const nextText = segment.value.slice(0, context.start);
  const tailText = segment.value.slice(context.end);
  const prefixSegments = segments.slice(0, context.segmentIndex);
  const needsPrefixSeparator = Boolean(
    reference &&
    ((nextText.length > 0 && !/\s$/u.test(nextText)) ||
      (nextText.length === 0 &&
        prefixSegments.length > 0 &&
        prefixSegments.at(-1)?.type === "reference")),
  );
  const renderedNextText = needsPrefixSeparator ? `${nextText} ` : nextText;
  const renderedTailText = reference
    ? `${/^\s/u.test(tailText) ? "" : " "}${tailText}` || " "
    : tailText;
  const next: ForumEditorSegment[] = [
    ...prefixSegments,
    ...(renderedNextText
      ? [{ type: "text" as const, value: renderedNextText }]
      : []),
    replacement,
    ...(renderedTailText
      ? [{ type: "text" as const, value: renderedTailText }]
      : []),
    ...segments.slice(context.segmentIndex + 1),
  ];
  const replacementIndex = prefixSegments.length + (renderedNextText ? 1 : 0);
  return {
    segments: next,
    replacementIndex,
    caretOffset: reference
      ? renderedTailText.match(/^\s*/u)?.[0].length || 0
      : 0,
  };
}

export function removeReferenceFromDocument(
  segments: ForumEditorSegment[],
  index: number,
): { segments: ForumEditorSegment[]; caretIndex: number } | null {
  const reference = segments[index];
  if (!reference || reference.type !== "reference") return null;

  const next = segments.map((segment) => ({ ...segment }));
  const following = next[index + 1];
  const removeAutomaticSeparator = Boolean(
    reference.autoSeparator &&
    following?.type === "text" &&
    following.value.startsWith(" "),
  );

  next.splice(index, 1);
  if (removeAutomaticSeparator && following?.type === "text") {
    const remainingText = following.value.slice(1);
    if (remainingText) next[index] = { type: "text", value: remainingText };
    else next.splice(index, 1);
  }

  return { segments: next, caretIndex: index };
}
