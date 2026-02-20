export interface AppStore {
  games: GameRecord[];
  settings: AppSettings;
  recentPlayed: string[];
}

export interface GameVersion {
  version: string;
  path: string;
  addedAt: number;
}

export interface GameRecord {
  id: string;
  versions: GameVersion[];
  latestVersion: string;
  addedAt: number;
  lastPlayedAt?: number;
  playtime: number;
}

export interface AppSettings {
  playerName: string;
  playerId: string;
  avatar?: string; // 玩家头像路径
  language: 'zh-CN' | 'en-US';
  theme: 'dark' | 'light';
  defaultRoomPort: number;
}
