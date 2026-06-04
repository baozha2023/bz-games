import type {
  AppSettings,
  DataHealthReport,
  DownloadTaskSnapshot,
  FloatBallProgress,
  DiscoveredRoom,
  RoomJoinValidationResult,
  RoomInfo,
  RoomEvent,
  GameRecord,
  MarketDirectory,
  GameType,
  MarketIndex,
  MarketTaskEvent,
  MarketTaskState,
  UpdateState,
  UserData,
} from "../../../shared/types";
import type { GameManifest } from "../../../shared/game-manifest";

declare global {
  interface Window {
    electronAPI: {
      user: {
        getData: () => Promise<UserData>;
        buyFrame: (frameId: string, coinCost: number) => Promise<{ success: boolean; code?: string }>;
        equipFrame: (frameId: string) => Promise<boolean>;
        unequipFrame: (frameId: string) => Promise<boolean>;
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
            web_url?: string;
            platformVersion?: string;
            icon?: string;
            cover?: string;
            type: GameType;
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
        sendChat: (content: string, type?: "text" | "audio" | "image", images?: string[]) => Promise<void>;
        kickPlayer: (playerId: string) => Promise<boolean>;
        reconnect: () => Promise<void>;
        popOutChat: (chatHistory: unknown) => Promise<void>;
        popInChat: () => Promise<void>;
        getChatHistory: () => Promise<unknown[]>;
        discoverLan: () => Promise<DiscoveredRoom[]>;
        discoverRelay: () => Promise<DiscoveredRoom[]>;
        validateDiscovered: (room: DiscoveredRoom) => Promise<RoomJoinValidationResult>;
        enableRelayHost: () => Promise<{ success: boolean; publicAddress?: string; error?: string }>;
        disableRelayHost: () => Promise<void>;
        onChatWindowClosed: (callback: () => void) => () => void;
        onEvent: (callback: (event: RoomEvent) => void) => () => void;
      };
      market: {
        getSources: (forceRefresh?: boolean) => Promise<MarketDirectory>;
        getIndex: (sourceIdx: number, forceRefresh?: boolean) => Promise<MarketIndex>;
        getCachedImage: (url: string) => Promise<string>;
        downloadAndInstall: (
          gameId: string,
          version: string,
          sourceIdx: number,
        ) => Promise<MarketTaskState>;
        getTaskState: (taskId: string) => Promise<MarketTaskState | null>;
        cancelTask: (taskId: string) => Promise<boolean>;
        pauseTask: (taskId: string) => Promise<boolean>;
        resumeTask: (taskId: string) => Promise<MarketTaskState | null>;
        getPendingTasks: () => Promise<DownloadTaskSnapshot[]>;
        resolveAssetInfo: (downloadUrl: string) => Promise<{ sha256?: string; size?: number }>;
        onEvent: (callback: (payload: MarketTaskEvent) => void) => () => void;
        getAllTaskStates: () => Promise<MarketTaskState[]>;
        onFloatBallEvent: (callback: (progress: FloatBallProgress) => void) => () => void;
        onDragState: (callback: (dragging: boolean) => void) => () => void;
      };
      settings: {
        get: () => Promise<AppSettings>;
        getAppVersion: () => Promise<string>;
        save: (settings: AppSettings) => Promise<boolean>;
        savePartialSettings: (partial: Partial<AppSettings>) => Promise<void>;
        ignoreUpdateVersion: (version: string) => Promise<boolean>;
        uploadAvatar: () => Promise<string | null>;
        getAvatarFrameImage: (fileName: string) => Promise<string | null>;
        selectGameStoragePath: () => Promise<{ path: string; error?: string } | null>;
        selectGameStoragePathRelaxed: () => Promise<{ path: string } | null>;
        getDefaultGamesMigrationStatus: () => Promise<{
          shouldPrompt: boolean;
          defaultGamesPath: string;
        }>;
        getGameStoragePaths: () => Promise<Array<{ path: string; isDefault: boolean }>>;
        addGameStoragePath: (targetPath: string) => Promise<AppSettings>;
        setDefaultGameStoragePath: (targetPath: string) => Promise<AppSettings>;
        migrateDefaultGamesLibrary: (payload: { targetPath?: string; ignore?: boolean }) => Promise<{
          success: boolean;
          ignored?: boolean;
          migratedGames?: number;
          migratedVersions?: number;
          gameStoragePath?: string;
          error?: string;
        }>;
        migrateGameStorageLibrary: (payload: { sourcePath: string; targetPath: string }) => Promise<{
          success: boolean;
          migratedGames?: number;
          migratedVersions?: number;
          gameStoragePath?: string;
          error?: string;
        }>;
        openPath: (targetPath: string) => Promise<boolean>;
        openUrl: (url: string) => Promise<boolean>;
        removeGameStoragePath: (targetPath: string) => Promise<{
          success: boolean;
          removedGames: number;
          removedVersions: number;
          nextStoragePath: string;
          error?: string;
        }>;
        dataHealthCheck: () => Promise<DataHealthReport>;
        getUpdateStatus: () => Promise<UpdateState>;
        checkUpdate: () => Promise<UpdateState>;
        downloadUpdate: () => Promise<UpdateState>;
        installUpdate: () => Promise<boolean>;
        uninstall: (payload?: { deleteGames?: boolean }) => Promise<{ success: boolean; error?: string }>;
        clearCache: () => Promise<{ totalSize: number; clearedSize: number }>;
        onUpdateEvent: (callback: (payload: UpdateState) => void) => () => void;
      };
      stats: {
        getDailyPlayDurations: (days?: number) => Promise<{ date: string; total_duration_ms: number }[]>;
        getRecentSessions: (limit?: number) => Promise<{
          id: string;
          game_id: string;
          game_name: string;
          version: string;
          start_time: number;
          end_time: number | null;
          duration_ms: number | null;
        }[]>;
      };
    };
  }
}
