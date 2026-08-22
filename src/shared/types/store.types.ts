export type ManualUnlockCondition =
  | { type: "bzcoin"; amount: number }
  | { type: "playtime"; durationMs: number }
  | { type: "total_checkin"; days: number }
  | { type: "consecutive_checkin"; days: number }
  | { type: "date_playtime"; date: string; durationMs: number };

export type AvatarFrameUnlockCondition = Exclude<
  ManualUnlockCondition,
  { type: "date_playtime" }
>;

export interface ManualUnlockResult {
  success: boolean;
  code?:
    | "invalid_item"
    | "already_owned"
    | "insufficient_coins"
    | "condition_not_met";
  current?: number;
  required?: number;
  targetDate?: string;
}

export interface AvatarFrameDef {
  id: string;
  name: string;
  description: string;
  imageFileName: string;
  contentInsetPx: FrameContentInset;
  rarity: "common" | "rare" | "epic" | "legendary";
  unlock: AvatarFrameUnlockCondition;
}

export interface FrameContentInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GameCardFrameAssetDef {
  fileName: string;
  contentInsetPercent: FrameContentInset;
}

export interface GameCardProductDef {
  id: string;
  name: string;
  description: string;
  assets: {
    square: GameCardFrameAssetDef;
    wide: GameCardFrameAssetDef;
  };
  unlock: ManualUnlockCondition;
}

export interface UserData {
  bzCoins: number;
  checkIn: {
    lastCheckInDate: string; // YYYY-MM-DD
    consecutiveDays: number;
    maxConsecutiveDays: number;
    totalDays: number;
  };
  ownedFrames: string[];
  equippedFrame?: string;
  ownedGameCardProducts: string[];
  equippedGameCardProduct?: string;
}

export interface AppStore {
  settings: AppSettings;
  userData: UserData;
}

export interface UnlockedAchievement {
  id: string;
  unlockedAt: number;
}

export type GameInstallSource = "manual" | "market";

export interface GameInstallProvenance {
  installSource: GameInstallSource;
  marketId: string | null;
}

export interface GameVersion {
  version: string;
  path: string;
  addedAt: number;
  installSource: GameInstallSource;
  marketId: string | null;
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

export const NICKNAME_EFFECTS = [
  "none",
  "glow",
  "flame",
  "neon",
  "aurora",
  "crystal",
  "comet",
  "heartbeat",
  "hologram",
  "inkflow",
  "eclipse",
] as const;

export type NicknameEffect = (typeof NICKNAME_EFFECTS)[number];

export function normalizeNicknameEffect(value: unknown): NicknameEffect {
  return NICKNAME_EFFECTS.includes(value as NicknameEffect)
    ? (value as NicknameEffect)
    : "none";
}

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

export type FeedbackStatus =
  | "new"
  | "reviewing"
  | "planned"
  | "resolved"
  | "closed";

export interface FeedbackDetailImage {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  previewUrl: string;
}

export interface FeedbackDetail {
  id: string;
  content: string;
  status: FeedbackStatus;
  reply: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
  images: FeedbackDetailImage[];
}

export interface PlatformCloudSnapshotMeta {
  version: number;
  size: number;
  sha256: string;
  contentType: string;
  updatedAt: string;
}

export interface LocalCloudStatus {
  configured: boolean;
  authenticated: boolean;
  userLogin: string;
  userName: string;
  userProfileUrl: string;
  lastUploadedAt: string;
}

export interface CloudPresenceStatus {
  enabled: boolean;
}

export type CloudAuthChangedReason =
  | "login"
  | "session_expired"
  | "session_invalid";

export interface CloudAuthChangedPayload {
  reason: CloudAuthChangedReason;
  status: LocalCloudStatus;
}

export interface CloudSyncResult {
  success: boolean;
  lastUploadedAt?: string;
  error?: string;
  message?: string;
}

export interface CloudSnapshotMetaResult {
  success: boolean;
  snapshot: PlatformCloudSnapshotMeta | null;
  error?: string;
  message?: string;
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
  nicknameStyle?: NicknameStyle;
  libraryLayout?: LibraryLayout;
  lastJoinRoomAddress?: string;
  language: "zh-CN" | "en-US" | "ja-JP" | "zh-TW" | "lzh" | "de-DE";
  theme: "dark" | "light" | "auto";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  ignoredUpdateVersion?: string;
  skipStartupUpdateCheck?: boolean;
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
