import {
  serializeForumEditorSegments,
  type ForumEditorGameSegment as BaseForumEditorGameSegment,
  type ForumEditorSegment as BaseForumEditorSegment,
} from "../../../../shared/forum-game-mentions";

export type ForumEditorGameSegment = BaseForumEditorGameSegment & {
  /** Internal editor metadata; it is never serialized to the server. */
  autoSeparator?: boolean;
};

export type ForumEditorSegment =
  | Extract<BaseForumEditorSegment, { type: "text" }>
  | ForumEditorGameSegment;

export interface ForumMentionContext {
  segmentIndex: number;
  start: number;
  end: number;
}

export interface ForumMentionReplacement {
  segments: ForumEditorSegment[];
  replacementIndex: number;
  caretOffset: number;
}

export function serializeEditorDocument(
  segments: ForumEditorSegment[],
): string {
  return serializeForumEditorSegments(segments);
}

export function replaceMentionInDocument(
  segments: ForumEditorSegment[],
  context: ForumMentionContext,
  value: string,
  game?: Omit<ForumEditorGameSegment, "type">,
): ForumMentionReplacement | null {
  const segment = segments[context.segmentIndex];
  if (!segment || segment.type !== "text") return null;

  const replacement: ForumEditorSegment = game
    ? { type: "game", ...game, autoSeparator: true }
    : { type: "text", value };
  const nextText = segment.value.slice(0, context.start);
  const tailText = segment.value.slice(context.end);
  const prefixSegments = segments.slice(0, context.segmentIndex);
  const needsPrefixSeparator = Boolean(
    game &&
    ((nextText.length > 0 && !/\s$/u.test(nextText)) ||
      (nextText.length === 0 && prefixSegments.at(-1)?.type === "game")),
  );
  const renderedNextText = needsPrefixSeparator ? `${nextText} ` : nextText;
  const renderedTailText = game
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
    caretOffset: game ? renderedTailText.match(/^\s*/u)?.[0].length || 0 : 0,
  };
}

export function removeMentionFromDocument(
  segments: ForumEditorSegment[],
  index: number,
): { segments: ForumEditorSegment[]; caretIndex: number } | null {
  const mention = segments[index];
  if (!mention || mention.type !== "game") return null;

  const next = segments.map((segment) => ({
    ...segment,
  })) as ForumEditorSegment[];
  const following = next[index + 1];
  const removeAutomaticSeparator = Boolean(
    mention.autoSeparator &&
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
