export type AvatarFrameUnlockMethod =
  | "playtime"
  | "consecutive_checkin"
  | "total_checkin"
  | "bzcoin";

export interface AvatarFrameDef {
  id: string;
  name: string;
  description: string;
  imageFileName: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  unlockMethod: AvatarFrameUnlockMethod;
  unlockValue: number;
}

export interface UserData {
  bzCoins: number;
  cumulativePlayTime: number; // in milliseconds
  checkIn: {
    lastCheckInDate: string; // YYYY-MM-DD
    consecutiveDays: number;
    totalDays: number;
  };
  ownedFrames: string[];
  equippedFrame?: string;
}

export interface AppStore {
  games: GameRecord[];
  settings: AppSettings;
  userData: UserData;
  recentPlayed: string[];
}

export interface UnlockedAchievement {
  id: string;
  unlockedAt: number;
}

export interface GameVersion {
  version: string;
  path: string;
  addedAt: number;
  stats: Record<string, number>;
  unlockedAchievements: UnlockedAchievement[];
  playtime: number;
}

export interface GameRecord {
  id: string;
  versions: GameVersion[];
  latestVersion: string;
  addedAt: number;
  lastPlayedAt?: number;
  isFavorite?: boolean;
}

export type NicknameFont = "system" | "rounded" | "serif" | "mono" | "fantasy";

export type NicknameEffect =
  | "none"
  | "glow"
  | "sparkle"
  | "flame"
  | "neon"
  | "rainbow"
  | "aurora"
  | "stardust"
  | "crystal"
  | "comet"
  | "heartbeat";

export interface NicknameStyle {
  color: string;
  gradientStart?: string;
  gradientEnd?: string;
  font: NicknameFont;
  effect: NicknameEffect;
  weight: "normal" | "semibold" | "bold";
}

export type LibraryLayout = "card" | "icon" | "steam";

export const DEFAULT_NICKNAME_STYLE: NicknameStyle = {
  color: "#000000",
  gradientStart: "#5eead4",
  gradientEnd: "#a78bfa",
  font: "system",
  effect: "none",
  weight: "normal",
};

export interface FeedbackHistoryItem {
  id: string;
  submittedAt: number;
}

export interface AppSettings {
  playerName: string;
  playerId: string;
  avatar?: string;
  cloudSessionToken?: string;
  cloudSessionExpiresAt?: string;
  cloudUserLogin?: string;
  cloudUserName?: string;
  cloudUserProfileUrl?: string;
  cloudLastUploadedAt?: string;
  feedbackHistory?: FeedbackHistoryItem[];
  nicknameStyle?: NicknameStyle;
  libraryLayout?: LibraryLayout;
  lastJoinRoomAddress?: string;
  language: "zh-CN" | "en-US" | "ja-JP" | "zh-TW" | "lzh" | "de-DE";
  theme: "dark" | "light" | "auto";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  ignoredUpdateVersion?: string;
  gameStoragePath?: string;
  gameStorageHistory?: string[];
  lastOpenedAt?: number;
  githubToken?: string;
  chatWindowBounds?: { x: number; y: number; width: number; height: number };
  chatInputHeight?: number;
  downloadFloatBall?: boolean;
  sensitiveWordFilter?: boolean;
  floatBallPosition?: { x: number; y: number };
  ignoreDefaultGamesMigrationPrompt?: boolean;
}

export interface DefaultGamesMigrationStatus {
  shouldPrompt: boolean;
  defaultGamesPath: string;
}

export type UpdateErrorCode =
  | "network_error"
  | "feed_invalid"
  | "download_failed"
  | "verify_failed"
  | "permission_denied"
  | "unsupported_dev_mode"
  | "unknown";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  message?: string;
  errorCode?: UpdateErrorCode;
}

export interface DataHealthIssue {
  level: "warning" | "error";
  code: string;
  message: string;
  params?: Record<string, string | number>;
  target?: string;
}

export interface DataHealthReport {
  ok: boolean;
  checkedAt: number;
  summary: {
    errors: number;
    warnings: number;
    gameCount: number;
    versionCount: number;
    storagePathCount: number;
  };
  issues: DataHealthIssue[];
}
