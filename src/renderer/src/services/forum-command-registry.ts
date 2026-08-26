import {
  FORUM_COMMAND_NAMES,
  type ForumCommandName,
} from "../../../shared/forum-references";

export type { ForumCommandName } from "../../../shared/forum-references";

export type ForumCommandStage =
  | "market"
  | "game"
  | "version"
  | "post"
  | "pageGroup"
  | "page";

export interface ForumCommandDefinition {
  name: ForumCommandName;
  descriptionKey: string;
  requiresSearch?: boolean;
  flow: readonly ForumCommandStage[];
}

const commandUiConfig: Record<
  ForumCommandName,
  Omit<ForumCommandDefinition, "name">
> = {
  game: {
    descriptionKey: "forumCommands.game.description",
    flow: ["market", "game"],
  },
  version: {
    descriptionKey: "forumCommands.version.description",
    flow: ["market", "game", "version"],
  },
  market: {
    descriptionKey: "forumCommands.market.description",
    flow: ["market"],
  },
  post: {
    descriptionKey: "forumCommands.post.description",
    requiresSearch: true,
    flow: ["post"],
  },
  page: {
    descriptionKey: "forumCommands.page.description",
    flow: ["pageGroup", "page"],
  },
};

export const FORUM_COMMANDS: readonly ForumCommandDefinition[] =
  FORUM_COMMAND_NAMES.map((name) => ({ name, ...commandUiConfig[name] }));

const commandByName = new Map(
  FORUM_COMMANDS.map((command) => [command.name, command]),
);

export function getForumCommand(
  name: ForumCommandName,
): ForumCommandDefinition {
  const command = commandByName.get(name);
  if (!command) throw new Error("unknown_forum_command");
  return command;
}

export function availableForumCommands(
  searchAvailable: boolean,
): ForumCommandDefinition[] {
  return FORUM_COMMANDS.filter(
    (command) => !command.requiresSearch || searchAvailable,
  );
}
