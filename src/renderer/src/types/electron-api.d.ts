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
  MigrationExportResult,
  MigrationExportState,
  UserData,
  NicknameStyle,
  GameLaunchFailurePayload,
  RoomConnectResult,
  RoomCreateResult,
  FeedbackHistoryPage,
  FeedbackDetail,
  CloudAuthChangedPayload,
  CloudPresenceStatus,
  CloudSnapshotMetaResult,
  CloudSyncResult,
  LocalCloudStatus,
  ManualUnlockResult,
  GameImportStartResult,
  GameImportTaskEvent,
  GameImportTaskState,
  ForumComment,
  ForumImageSelectionResult,
  ForumMutationResult,
  ForumPostReferenceResult,
  ForumPage,
  ForumPostDetail,
  ForumPostSummary,
} from "../../../shared/types";
import type { GameManifest } from "../../../shared/game-manifest";

declare global {
  interface Window {
    electronAPI: {
      user: {
        getData: () => Promise<UserData>;
        unlockFrame: (frameId: string) => Promise<ManualUnlockResult>;
        equipFrame: (frameId: string) => Promise<boolean>;
        unequipFrame: (frameId: string) => Promise<boolean>;
        unlockGameCardProduct: (
          productId: string,
        ) => Promise<ManualUnlockResult>;
        getGameCardProductProgress: (
          productId: string,
        ) => Promise<ManualUnlockResult>;
        equipGameCardProduct: (productId: string) => Promise<boolean>;
        unequipGameCardProduct: (productId: string) => Promise<boolean>;
        getGameCardProductImage: (
          productId: string,
          ratio: "square" | "wide",
        ) => Promise<string | null>;
        checkIn: () => Promise<{
          success: boolean;
          coins: number;
          days: number;
          message?: string;
          code?: string;
        }>;
      };
      game: {
        selectImportDirectory: () => Promise<string | null>;
        startImport: (
          sourcePath: string,
          draft?: {
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
        ) => Promise<GameImportStartResult>;
        getImportTasks: () => Promise<GameImportTaskState[]>;
        cancelImport: (taskId: string) => Promise<boolean>;
        retryImport: (taskId: string) => Promise<GameImportStartResult>;
        dismissImport: (taskId: string) => Promise<boolean>;
        onImportEvent: (
          callback: (payload: GameImportTaskEvent) => void,
        ) => () => void;
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
        launch: (id: string, version?: string) => Promise<boolean>;
        getRunningIds: () => Promise<string[]>;
        getAll: () => Promise<GameManifest[]>;
        getAllRecords: () => Promise<GameRecord[]>;
        getVersions: (id: string) => Promise<string[]>;
        getInstallPath: (
          id: string,
          version?: string,
        ) => Promise<string | null>;
        getManifest: (
          id: string,
          version?: string,
        ) => Promise<GameManifest | null>;
        getCover: (id: string, version?: string) => Promise<string | null>; // base64 data URL
        getVideo: (id: string, version?: string) => Promise<string | null>;
        getIcon: (id: string, version?: string) => Promise<string | null>; // base64 data URL
        getAchievementIcon: (
          id: string,
          version: string,
          achievementId: string,
        ) => Promise<string | null>;
        toggleFavorite: (id: string) => Promise<boolean>;
        reorder: (gameIds: string[]) => Promise<boolean>;
        onProcessEvent: (
          callback: (type: "start" | "end", id: string) => void,
        ) => () => void;
        onLaunchFailed: (
          callback: (payload: GameLaunchFailurePayload) => void,
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
        create: (gameId: string, version?: string) => Promise<RoomCreateResult>;
        join: (
          gameId: string,
          address: string,
          version?: string,
          password?: string,
        ) => Promise<RoomConnectResult>;
        leave: () => Promise<void>;
        ready: () => Promise<void>;
        unready: () => Promise<void>;
        start: () => Promise<boolean>;
        setAddress: (address: string) => Promise<void>;
        setPassword: (password: string) => Promise<boolean>;
        getState: () => Promise<RoomInfo | null>;
        sendChat: (
          content: string,
          type?: "text" | "audio" | "image",
          images?: string[],
        ) => Promise<void>;
        kickPlayer: (playerId: string) => Promise<boolean>;
        reconnect: () => Promise<boolean>;
        popOutChat: (chatHistory: unknown) => Promise<void>;
        popInChat: () => Promise<void>;
        getChatHistory: () => Promise<unknown[]>;
        discoverLan: () => Promise<DiscoveredRoom[]>;
        discoverVirtualLan: () => Promise<DiscoveredRoom[]>;
        discoverRelay: () => Promise<DiscoveredRoom[]>;
        measureRelayLatency: () => Promise<number | null>;
        validateDiscovered: (
          room: DiscoveredRoom,
        ) => Promise<RoomJoinValidationResult>;
        probePassword: (address: string) => Promise<{
          success: boolean;
          hasPassword: boolean;
          error?: string;
        }>;
        setDirectHostMode: (mode: "lan") => Promise<void>;
        enableRelayHost: () => Promise<{
          success: boolean;
          publicAddress?: string;
          error?: string;
        }>;
        disableRelayHost: () => Promise<void>;
        onChatWindowClosed: (callback: () => void) => () => void;
        onEvent: (callback: (event: RoomEvent) => void) => () => void;
      };
      market: {
        openGameHosting: () => Promise<boolean>;
        getSources: (forceRefresh?: boolean) => Promise<MarketDirectory>;
        getIndex: (
          sourceIdx: number,
          forceRefresh?: boolean,
        ) => Promise<MarketIndex>;
        getCachedImage: (url: string) => Promise<string>;
        downloadAndInstall: (
          gameId: string,
          version: string,
          sourceIdx: number,
        ) => Promise<MarketTaskState>;
        getTaskState: (taskId: string) => Promise<MarketTaskState | null>;
        cancelTask: (taskId: string) => Promise<boolean>;
        dismissTask: (taskId: string) => Promise<boolean>;
        pauseTask: (taskId: string) => Promise<boolean>;
        resumeTask: (taskId: string) => Promise<MarketTaskState | null>;
        getPendingTasks: () => Promise<DownloadTaskSnapshot[]>;
        resolveAssetInfo: (
          downloadUrl: string,
        ) => Promise<{ sha256?: string; size?: number }>;
        onEvent: (callback: (payload: MarketTaskEvent) => void) => () => void;
        getAllTaskStates: () => Promise<MarketTaskState[]>;
        onFloatBallEvent: (
          callback: (progress: FloatBallProgress) => void,
        ) => () => void;
        onDragState: (callback: (dragging: boolean) => void) => () => void;
      };
      settings: {
        get: () => Promise<AppSettings>;
        getAppVersion: () => Promise<string>;
        getSensitiveWords: () => Promise<string[]>;
        getLocalCloudStatus: () => Promise<LocalCloudStatus>;
        getPresenceStatus: () => Promise<CloudPresenceStatus>;
        setPresenceEnabled: (enabled: boolean) => Promise<CloudPresenceStatus>;
        getCloudSnapshotMeta: () => Promise<CloudSnapshotMetaResult>;
        loginWithGitHub: () => Promise<{ success: boolean; error?: string }>;
        uploadCloudData: () => Promise<CloudSyncResult>;
        downloadCloudData: () => Promise<CloudSyncResult>;
        selectFeedbackImages: (selectionId?: string) => Promise<{
          success: boolean;
          canceled?: boolean;
          selectionId?: string;
          images?: Array<{
            id: string;
            fileName: string;
            previewUrl: string;
          }>;
          error?: string;
        }>;
        releaseFeedbackImages: (
          selectionId: string,
          imageId?: string,
        ) => Promise<void>;
        submitFeedback: (payload: {
          content: string;
          selectionId?: string;
        }) => Promise<
          | {
              success: true;
              id: string;
            }
          | {
              success: false;
              error: string;
              resetAt?: string;
              message?: string;
            }
        >;
        getFeedbackHistory: (cursor?: string) => Promise<FeedbackHistoryPage>;
        getFeedbackDetail: (
          feedbackId: string,
        ) => Promise<
          | { success: true; detail: FeedbackDetail }
          | { success: false; error: string; message?: string }
        >;
        save: (settings: AppSettings) => Promise<boolean>;
        savePartialSettings: (partial: Partial<AppSettings>) => Promise<void>;
        saveNicknameStyle: (
          style: NicknameStyle,
        ) => Promise<{ success: boolean; code?: string }>;
        uploadAvatar: () => Promise<string | null>;
        getAvatarFrameImage: (fileName: string) => Promise<string | null>;
        selectGameStoragePath: () => Promise<{
          path: string;
          error?: string;
        } | null>;
        selectGameStoragePathRelaxed: () => Promise<{ path: string } | null>;
        getDefaultGamesMigrationStatus: () => Promise<{
          shouldPrompt: boolean;
          defaultGamesPath: string;
        }>;
        getGameStoragePaths: () => Promise<
          Array<{ path: string; isDefault: boolean }>
        >;
        addGameStoragePath: (targetPath: string) => Promise<AppSettings>;
        setDefaultGameStoragePath: (targetPath: string) => Promise<AppSettings>;
        migrateDefaultGamesLibrary: (payload: {
          targetPath?: string;
          ignore?: boolean;
        }) => Promise<{
          success: boolean;
          ignored?: boolean;
          migratedGames?: number;
          migratedVersions?: number;
          gameStoragePath?: string;
          error?: string;
        }>;
        migrateGameStorageLibrary: (payload: {
          sourcePath: string;
          targetPath: string;
        }) => Promise<{
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
        uninstall: (payload?: { deleteGames?: boolean }) => Promise<{
          success: boolean;
          error?: string;
          paths?: string[];
        }>;
        clearCache: () => Promise<{ totalSize: number; clearedSize: number }>;
        savePng: (
          dataUrl: string,
          defaultName: string,
        ) => Promise<{
          success: boolean;
          canceled?: boolean;
          filePath?: string;
          error?: string;
        }>;
        onCloudSyncEvent: (
          callback: (payload: { stage: string; percentage: number }) => void,
        ) => () => void;
        onCloudAuthChanged: (
          callback: (payload: CloudAuthChangedPayload) => void,
        ) => () => void;
        onPresenceChanged: (
          callback: (payload: CloudPresenceStatus) => void,
        ) => () => void;
      };
      migration: {
        exportData: () => Promise<MigrationExportResult>;
        cancel: () => Promise<boolean>;
        getStatus: () => Promise<MigrationExportState>;
        acknowledgeNotice: (version: string) => Promise<boolean>;
        onEvent: (
          callback: (payload: MigrationExportState) => void,
        ) => () => void;
      };
      forum: {
        selectImages: (
          selectionId?: string,
        ) => Promise<ForumImageSelectionResult>;
        releaseImages: (selectionId: string, imageId?: string) => Promise<void>;
        getSearchAvailability: () => Promise<boolean>;
        listPosts: (
          query?: string,
          cursor?: string,
        ) => Promise<ForumPage<ForumPostSummary>>;
        getPost: (postId: string) => Promise<ForumPostDetail>;
        resolvePostReferences: (
          ids: string[],
        ) => Promise<ForumPostReferenceResult>;
        getComments: (
          postId: string,
          cursor?: string,
        ) => Promise<ForumPage<ForumComment>>;
        createPost: (payload: {
          title: string;
          body: string;
          selectionId?: string;
        }) => Promise<ForumMutationResult>;
        createComment: (
          postId: string,
          content: string,
        ) => Promise<ForumMutationResult>;
        deletePost: (postId: string) => Promise<ForumMutationResult>;
        deleteComment: (commentId: string) => Promise<ForumMutationResult>;
        likePost: (postId: string) => Promise<ForumMutationResult>;
        unlikePost: (postId: string) => Promise<ForumMutationResult>;
        likeComment: (commentId: string) => Promise<ForumMutationResult>;
        unlikeComment: (commentId: string) => Promise<ForumMutationResult>;
      };
      stats: {
        getDailyPlayDurations: (
          days?: number,
        ) => Promise<{ date: string; total_duration_ms: number }[]>;
        getRecentSessions: (limit?: number) => Promise<
          {
            id: string;
            game_id: string;
            game_name: string;
            version: string;
            start_time: number;
            end_time: number | null;
            duration_ms: number | null;
          }[]
        >;
        getSessionsByDate: (date: string) => Promise<
          {
            id: string;
            game_id: string;
            game_name: string;
            version: string;
            start_time: number;
            end_time: number | null;
            duration_ms: number | null;
          }[]
        >;
      };
    };
  }
}
