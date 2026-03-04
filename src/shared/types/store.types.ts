export interface UserData {
  bzCoins: number;
  cumulativePlayTime: number; // in milliseconds
  checkIn: {
    lastCheckInDate: string; // YYYY-MM-DD
    consecutiveDays: number;
  };
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
  language: "zh-CN" | "en-US" | "ja-JP";
  theme: "dark" | "light";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
}
