import semver from "semver";

export const FORUM_COMMAND_NAMES = [
  "game",
  "version",
  "market",
  "post",
  "page",
] as const;

export type ForumCommandName = (typeof FORUM_COMMAND_NAMES)[number];

export interface ForumTextPart {
  type: "text";
  value: string;
}

interface ForumReferenceBase {
  raw: string;
}

export interface ForumGameReferenceToken extends ForumReferenceBase {
  type: "game";
  marketId: string;
  gameId: string;
  syntax: "mention" | "command";
}

export interface ForumVersionToken extends ForumReferenceBase {
  type: "version";
  marketId: string;
  gameId: string;
  version: string;
}

export interface ForumMarketToken extends ForumReferenceBase {
  type: "market";
  marketId: string;
}

export interface ForumPostToken extends ForumReferenceBase {
  type: "post";
  postId: string;
}

export interface ForumPageToken extends ForumReferenceBase {
  type: "page";
  pageId: string;
}

export type ForumReferenceToken =
  | ForumGameReferenceToken
  | ForumVersionToken
  | ForumMarketToken
  | ForumPostToken
  | ForumPageToken;

export type ForumBodyPart = ForumTextPart | ForumReferenceToken;

type WithoutRaw<T> = T extends unknown ? Omit<T, "raw"> : never;
export type ForumReferenceInput = WithoutRaw<ForumReferenceToken>;
export type ForumReferenceLike = ForumReferenceToken | ForumReferenceInput;

const MARKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GAME_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_ID_PATTERN = /^[a-z][a-z0-9.-]{0,127}$/;

export interface ForumCommandProtocolDefinition {
  name: ForumCommandName;
  argumentCount: number;
  parse: (raw: string, args: string[]) => ForumReferenceToken | null;
  serialize: (reference: ForumReferenceLike) => string | null;
}

export function isValidForumGameReference(
  marketId: string,
  gameId: string,
): boolean {
  return MARKET_ID_PATTERN.test(marketId) && GAME_ID_PATTERN.test(gameId);
}

export const FORUM_COMMAND_PROTOCOLS: readonly ForumCommandProtocolDefinition[] =
  [
    {
      name: "game",
      argumentCount: 2,
      parse(raw, [marketId, gameId]) {
        return isValidForumGameReference(marketId, gameId)
          ? { type: "game", raw, marketId, gameId, syntax: "command" }
          : null;
      },
      serialize(reference) {
        return reference.type === "game" && reference.syntax === "command"
          ? `/game<${reference.marketId},${reference.gameId}>`
          : null;
      },
    },
    {
      name: "version",
      argumentCount: 3,
      parse(raw, [marketId, gameId, version]) {
        return isValidForumGameReference(marketId, gameId) &&
          semver.valid(version)
          ? { type: "version", raw, marketId, gameId, version }
          : null;
      },
      serialize(reference) {
        return reference.type === "version"
          ? `/version<${reference.marketId},${reference.gameId},${reference.version}>`
          : null;
      },
    },
    {
      name: "market",
      argumentCount: 1,
      parse(raw, [marketId]) {
        return MARKET_ID_PATTERN.test(marketId)
          ? { type: "market", raw, marketId }
          : null;
      },
      serialize(reference) {
        return reference.type === "market"
          ? `/market<${reference.marketId}>`
          : null;
      },
    },
    {
      name: "post",
      argumentCount: 1,
      parse(raw, [postId]) {
        return UUID_PATTERN.test(postId)
          ? { type: "post", raw, postId: postId.toLowerCase() }
          : null;
      },
      serialize(reference) {
        return reference.type === "post" ? `/post<${reference.postId}>` : null;
      },
    },
    {
      name: "page",
      argumentCount: 1,
      parse(raw, [pageId]) {
        return PAGE_ID_PATTERN.test(pageId)
          ? { type: "page", raw, pageId }
          : null;
      },
      serialize(reference) {
        return reference.type === "page" ? `/page<${reference.pageId}>` : null;
      },
    },
  ];

const protocolByName = new Map(
  FORUM_COMMAND_PROTOCOLS.map((definition) => [definition.name, definition]),
);
const commandNamesPattern = FORUM_COMMAND_NAMES.join("|");
const TOKEN_PATTERN = new RegExp(
  `/(?:(${commandNamesPattern})<([^<>\\r\\n]*)>)|@([A-Za-z0-9][A-Za-z0-9._-]*)/([a-z0-9]+(?:\\.[a-z0-9-]+)+)`,
  "g",
);

export function getForumCommandProtocol(
  name: string,
): ForumCommandProtocolDefinition | undefined {
  return protocolByName.get(name.toLowerCase() as ForumCommandName);
}

export function parseForumCommandDraftArguments(
  name: string,
  rawArguments: string,
): string[] | null {
  const protocol = getForumCommandProtocol(name);
  if (!protocol) return null;
  const args = rawArguments.split(",").map((value) => value.trim());
  return args.length <= protocol.argumentCount ? args : null;
}

function isMentionBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  return !/[A-Za-z0-9_]/.test(value[index - 1] || "");
}

function commandToken(
  raw: string,
  command: string,
  rawArguments: string,
): ForumReferenceToken | null {
  const protocol = getForumCommandProtocol(command);
  if (!protocol) return null;
  const args = rawArguments.split(",").map((value) => value.trim());
  return args.length === protocol.argumentCount
    ? protocol.parse(raw, args)
    : null;
}

export function parseForumReferences(value: string): ForumBodyPart[] {
  if (!value) return [{ type: "text", value: "" }];

  const parts: ForumBodyPart[] = [];
  let cursor = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(value))) {
    const [raw, command, rawArguments, mentionMarketId, mentionGameId] = match;
    let token: ForumReferenceToken | null = null;
    if (command) {
      token = commandToken(raw, command, rawArguments);
    } else if (
      isMentionBoundary(value, match.index) &&
      isValidForumGameReference(mentionMarketId, mentionGameId)
    ) {
      const after = value[match.index + raw.length] || "";
      if (!/[A-Za-z0-9._-]/.test(after)) {
        token = {
          type: "game",
          raw,
          marketId: mentionMarketId,
          gameId: mentionGameId,
          syntax: "mention",
        };
      }
    }
    if (!token) continue;
    if (match.index > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    parts.push(token);
    cursor = match.index + raw.length;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }
  return parts.length ? parts : [{ type: "text", value }];
}

export function serializeForumReference(reference: ForumReferenceLike): string {
  if (reference.type === "game" && reference.syntax === "mention") {
    return `@${reference.marketId}/${reference.gameId}`;
  }
  const protocol = FORUM_COMMAND_PROTOCOLS.find(
    (definition) => definition.name === reference.type,
  );
  const serialized = protocol?.serialize(reference);
  if (!serialized) throw new Error("unsupported_forum_reference");
  return serialized;
}
