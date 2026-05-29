export type AvatarFrameUnlockMethod = "playtime" | "consecutive_checkin" | "total_checkin" | "bzcoin";

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

export interface AppSettings {
  playerName: string;
  playerId: string;
  avatar?: string; // 玩家头像路径
  lastJoinRoomAddress?: string;
  language: "zh-CN" | "en-US" | "ja-JP";
  theme: "dark" | "light" | "auto";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  ignoredUpdateVersion?: string;
  gameStoragePath?: string;
  gameStorageHistory?: string[];
  githubToken?: string;
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
