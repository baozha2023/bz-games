import type { Router } from "vue-router";

export interface ForumPageDefinition {
  id: string;
  group: "main" | "career" | "personalization" | "settings";
  labelKey: string;
  descriptionKey: string;
  routeName: string;
  query?: Record<string, string>;
}

export const FORUM_PAGES: readonly ForumPageDefinition[] = [
  {
    id: "market",
    group: "main",
    labelKey: "forumCommands.pages.market",
    descriptionKey: "forumCommands.pages.marketDescription",
    routeName: "MarketList",
  },
  {
    id: "library",
    group: "main",
    labelKey: "forumCommands.pages.library",
    descriptionKey: "forumCommands.pages.libraryDescription",
    routeName: "Library",
  },
  {
    id: "career.statistics",
    group: "career",
    labelKey: "forumCommands.pages.statistics",
    descriptionKey: "forumCommands.pages.statisticsDescription",
    routeName: "Career",
    query: { tab: "statistics" },
  },
  {
    id: "career.achievements",
    group: "career",
    labelKey: "forumCommands.pages.achievements",
    descriptionKey: "forumCommands.pages.achievementsDescription",
    routeName: "Career",
    query: { tab: "achievements" },
  },
  {
    id: "settings",
    group: "settings",
    labelKey: "forumCommands.pages.settings",
    descriptionKey: "forumCommands.pages.settingsDescription",
    routeName: "Settings",
  },
  {
    id: "personalization.avatar-frame",
    group: "personalization",
    labelKey: "forumCommands.pages.avatarFrame",
    descriptionKey: "forumCommands.pages.avatarFrameDescription",
    routeName: "Personalization",
    query: { tab: "avatarFrame" },
  },
  {
    id: "personalization.game-card",
    group: "personalization",
    labelKey: "forumCommands.pages.gameCard",
    descriptionKey: "forumCommands.pages.gameCardDescription",
    routeName: "Personalization",
    query: { tab: "gameCard" },
  },
  {
    id: "personalization.nickname-style",
    group: "personalization",
    labelKey: "forumCommands.pages.nicknameStyle",
    descriptionKey: "forumCommands.pages.nicknameStyleDescription",
    routeName: "Personalization",
    query: { tab: "nicknameStyle" },
  },
  {
    id: "rooms",
    group: "main",
    labelKey: "forumCommands.pages.rooms",
    descriptionKey: "forumCommands.pages.roomsDescription",
    routeName: "RoomDiscovery",
  },
  {
    id: "dialog.check-in",
    group: "main",
    labelKey: "forumCommands.pages.checkIn",
    descriptionKey: "forumCommands.pages.checkInDescription",
    routeName: "Library",
    query: { forumAction: "check-in" },
  },
  {
    id: "dialog.bz-coin-guide",
    group: "main",
    labelKey: "forumCommands.pages.bzCoinGuide",
    descriptionKey: "forumCommands.pages.bzCoinGuideDescription",
    routeName: "Library",
    query: { forumAction: "bz-coin-guide" },
  },
  {
    id: "settings.cloud",
    group: "settings",
    labelKey: "forumCommands.pages.cloud",
    descriptionKey: "forumCommands.pages.cloudDescription",
    routeName: "Settings",
    query: { forumAction: "cloud" },
  },
  {
    id: "settings.feedback",
    group: "settings",
    labelKey: "forumCommands.pages.feedback",
    descriptionKey: "forumCommands.pages.feedbackDescription",
    routeName: "Settings",
    query: { forumAction: "feedback" },
  },
  {
    id: "settings.clear-cache",
    group: "settings",
    labelKey: "forumCommands.pages.clearCache",
    descriptionKey: "forumCommands.pages.clearCacheDescription",
    routeName: "Settings",
    query: { forumAction: "clear-cache" },
  },
  {
    id: "settings.migrate-library",
    group: "settings",
    labelKey: "forumCommands.pages.migrateLibrary",
    descriptionKey: "forumCommands.pages.migrateLibraryDescription",
    routeName: "Settings",
    query: { forumAction: "migrate-library" },
  },
] as const;

export function getForumPage(pageId: string): ForumPageDefinition | undefined {
  return FORUM_PAGES.find((page) => page.id === pageId);
}

export async function openForumPage(
  router: Router,
  page: ForumPageDefinition,
): Promise<void> {
  await router.push({ name: page.routeName, query: page.query });
}
