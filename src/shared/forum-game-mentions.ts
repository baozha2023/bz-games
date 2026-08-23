export interface ForumGameMentionToken {
  type: "game";
  raw: string;
  marketId: string;
  gameId: string;
}

export interface ForumTextPart {
  type: "text";
  value: string;
}

export type ForumBodyPart = ForumTextPart | ForumGameMentionToken;

export interface ForumEditorTextSegment {
  type: "text";
  value: string;
}

export interface ForumEditorGameSegment {
  type: "game";
  marketId: string;
  gameId: string;
  marketName: string;
  gameName: string;
}

export type ForumEditorSegment =
  | ForumEditorTextSegment
  | ForumEditorGameSegment;

const MARKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GAME_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const GAME_MENTION_PATTERN =
  /@([A-Za-z0-9][A-Za-z0-9._-]*)\/([a-z0-9]+(?:\.[a-z0-9-]+)+)/g;

function isTokenBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  return !/[A-Za-z0-9_]/.test(value[index - 1] || "");
}

export function isValidForumGameMention(
  marketId: string,
  gameId: string,
): boolean {
  return MARKET_ID_PATTERN.test(marketId) && GAME_ID_PATTERN.test(gameId);
}

export function parseForumGameMentions(value: string): ForumBodyPart[] {
  if (!value) return [{ type: "text", value: "" }];

  const parts: ForumBodyPart[] = [];
  let cursor = 0;
  GAME_MENTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GAME_MENTION_PATTERN.exec(value))) {
    const [raw, marketId, gameId] = match;
    if (!isTokenBoundary(value, match.index)) continue;
    const after = value[match.index + raw.length] || "";
    if (/[A-Za-z0-9._-]/.test(after)) continue;
    if (match.index > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    parts.push({ type: "game", raw, marketId, gameId });
    cursor = match.index + raw.length;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }
  return parts.length ? parts : [{ type: "text", value }];
}

export function serializeForumEditorSegments(
  segments: ForumEditorSegment[],
): string {
  return segments
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      return `@${segment.marketId}/${segment.gameId}`;
    })
    .join("");
}
