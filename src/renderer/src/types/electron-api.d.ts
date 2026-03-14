import type {
  AppSettings,
  RoomInfo,
  RoomEvent,
  GameRecord,
  UserData,
} from "../../../shared/types";
import type { GameManifest } from "../../../shared/game-manifest";

type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "up_to_date"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  message?: string;
};

declare global {
  interface Window {
    electronAPI: {
      user: {
        getData: () => Promise<UserData>;
        checkIn: () => Promise<{
          success: boolean;
          coins: number;
          days: number;
          message?: string;
          code?: string;
        }>;
      };
      game: {
        load: (sourcePath?: string) => Promise<{
          success: boolean;
          manifest?: GameManifest;
          error?: string;
          params?: Record<string, any>;
        }>;
        prepareImport: (sourcePath: string) => Promise<{
          sourcePath: string;
          hasManifest: boolean;
          currentPlatformVersion: string;
          suggestedId: string;
          suggestedName: string;
          suggestedEntry: string;
        } | null>;
        loadWithManifest: (
          sourcePath: string,
          draft: {
            id: string;
            name: string;
            version: string;
            description?: string;
            author: string;
            entry?: string;
            platformVersion?: string;
            icon?: string;
            cover?: string;
            type: "singleplayer" | "multiplayer" | "singlemultiple";
            minPlayers?: number;
            maxPlayers?: number;
          },
        ) => Promise<{
          success: boolean;
          manifest?: GameManifest;
          error?: string;
          params?: Record<string, any>;
        }>;
        checkIdExists: (id: string) => Promise<boolean>;
        getPathForFile: (file: File) => string;
        remove: (id: string, versions?: string[]) => Promise<void>;
        launch: (id: string, version?: string) => Promise<void>;
        getAll: () => Promise<GameManifest[]>;
        getAllRecords: () => Promise<GameRecord[]>;
        getVersions: (id: string) => Promise<string[]>;
        getManifest: (
          id: string,
          version?: string,
        ) => Promise<GameManifest | null>;
        getCover: (id: string, version?: string) => Promise<string | null>; // base64 data URL
        getVideo: (id: string, version?: string) => Promise<string | null>;
        getIcon: (id: string, version?: string) => Promise<string | null>; // base64 data URL
        toggleFavorite: (id: string) => Promise<boolean>;
        reorder: (gameIds: string[]) => Promise<boolean>;
        onProcessEvent: (
          callback: (type: "start" | "end", id: string) => void,
        ) => () => void;
        onLaunchFailed: (
          callback: (id: string, reason: string) => void,
        ) => () => void;
        onAchievementUnlocked: (
          callback: (
            gameId: string,
            version: string,
            achievementId: string,
          ) => void,
        ) => () => void;
      };
      room: {
        create: (gameId: string, version?: string) => Promise<{ port: number }>;
        join: (
          gameId: string,
          address: string,
          version?: string,
        ) => Promise<{ success: boolean; error?: string }>;
        leave: () => Promise<void>;
        ready: () => Promise<void>;
        unready: () => Promise<void>;
        start: () => Promise<void>;
        setAddress: (address: string) => Promise<void>;
        getState: () => Promise<RoomInfo | null>;
        sendChat: (content: string, type?: "text" | "audio") => Promise<void>;
        kickPlayer: (playerId: string) => Promise<boolean>;
        onEvent: (callback: (event: RoomEvent) => void) => () => void;
      };
      settings: {
        get: () => Promise<AppSettings>;
        save: (settings: AppSettings) => Promise<void>;
        uploadAvatar: () => Promise<string | null>;
        selectGameStoragePath: () => Promise<string | null>;
        openPath: (targetPath: string) => Promise<boolean>;
        removeGameStoragePath: (targetPath: string) => Promise<{
          removedGames: number;
          removedVersions: number;
          nextStoragePath: string;
        }>;
        getUpdateStatus: () => Promise<UpdateState>;
        checkUpdate: () => Promise<UpdateState>;
        downloadUpdate: () => Promise<UpdateState>;
        installUpdate: () => Promise<boolean>;
        onUpdateEvent: (callback: (payload: UpdateState) => void) => () => void;
      };
    };
  }
}
