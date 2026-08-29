import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "../shared/ipc-channels";
import { installErrorForwarding } from "./error-forwarding";
import type {
  AppSettings,
  DataHealthReport,
  DownloadTaskSnapshot,
  FloatBallProgress,
  MarketDirectory,
  MarketIndex,
  MarketTaskEvent,
  MarketTaskState,
  GameType,
  DiscoveredRoom,
  RoomEvent,
  BackupImportSelectionResult,
  BackupResult,
  BackupState,
  NicknameStyle,
  GameLaunchFailurePayload,
  RoomConnectResult,
  RoomCreateResult,
  AccountAuthChangedPayload,
  AccountPresenceStatus,
  LocalAccountStatus,
  ManualUnlockResult,
  GameImportStartResult,
  GameImportTaskEvent,
  GameImportTaskState,
  ForumComment,
  ForumImageSelectionResult,
  ForumMutationResult,
  ForumPage,
  ForumPostDetail,
  ForumPostSummary,
  ForumPostReferenceResult,
  UpdateState,
  UninstallStartResult,
} from "../shared/types";

installErrorForwarding("main-window");

export const electronAPI = {
  game: {
    selectImportDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_SELECT_IMPORT_DIRECTORY),
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
    ): Promise<GameImportStartResult> =>
      ipcRenderer.invoke(IPC.GAME_START_IMPORT, sourcePath, draft),
    getImportTasks: (): Promise<GameImportTaskState[]> =>
      ipcRenderer.invoke(IPC.GAME_GET_IMPORT_TASKS),
    cancelImport: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.GAME_CANCEL_IMPORT, taskId),
    retryImport: (taskId: string): Promise<GameImportStartResult> =>
      ipcRenderer.invoke(IPC.GAME_RETRY_IMPORT, taskId),
    dismissImport: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.GAME_DISMISS_IMPORT, taskId),
    onImportEvent: (callback: (payload: GameImportTaskEvent) => void) => {
      const handler = (_: any, payload: GameImportTaskEvent) =>
        callback(payload);
      ipcRenderer.on(IPC.GAME_IMPORT_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.GAME_IMPORT_EVENT, handler);
    },
    prepareImport: (sourcePath: string) =>
      ipcRenderer.invoke(IPC.GAME_PREPARE_IMPORT, sourcePath),
    checkIdExists: (id: string) =>
      ipcRenderer.invoke(IPC.GAME_CHECK_ID_EXISTS, id),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    remove: (id: string, versions?: string[]) =>
      ipcRenderer.invoke(IPC.GAME_REMOVE, id, versions),
    launch: (id: string, version?: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.GAME_LAUNCH, id, version),
    getRunningIds: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.GAME_GET_RUNNING_IDS),
    getAll: () => ipcRenderer.invoke(IPC.GAME_GET_ALL),
    getAllRecords: () => ipcRenderer.invoke(IPC.GAME_GET_RECORDS),
    getVersions: (id: string) => ipcRenderer.invoke(IPC.GAME_GET_VERSIONS, id),
    getInstallPath: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_INSTALL_PATH, id, version),
    getManifest: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_MANIFEST, id, version),
    getCover: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_COVER, id, version),
    getVideo: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_VIDEO, id, version),
    getIcon: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_ICON, id, version),
    getAchievementIcon: (id: string, version: string, achievementId: string) =>
      ipcRenderer.invoke(
        IPC.GAME_GET_ACHIEVEMENT_ICON,
        id,
        version,
        achievementId,
      ),
    toggleFavorite: (id: string) =>
      ipcRenderer.invoke(IPC.GAME_TOGGLE_FAVORITE, id),
    reorder: (gameIds: string[]) =>
      ipcRenderer.invoke(IPC.GAME_REORDER, gameIds),
    onProcessEvent: (callback: (type: "start" | "end", id: string) => void) => {
      const startHandler = (_: any, id: string) => callback("start", id);
      const endHandler = (_: any, id: string) => callback("end", id);
      ipcRenderer.on(IPC.GAME_PROCESS_STARTED, startHandler);
      ipcRenderer.on(IPC.GAME_PROCESS_ENDED, endHandler);
      return () => {
        ipcRenderer.removeListener(IPC.GAME_PROCESS_STARTED, startHandler);
        ipcRenderer.removeListener(IPC.GAME_PROCESS_ENDED, endHandler);
      };
    },
    onLaunchFailed: (callback: (payload: GameLaunchFailurePayload) => void) => {
      const handler = (_: any, payload: GameLaunchFailurePayload) =>
        callback(payload);
      ipcRenderer.on(IPC.GAME_LAUNCH_FAILED, handler);
      return () => ipcRenderer.removeListener(IPC.GAME_LAUNCH_FAILED, handler);
    },
    onAchievementUnlocked: (
      callback: (
        gameId: string,
        version: string,
        achievementId: string,
      ) => void,
    ) => {
      const handler = (
        _: any,
        payload: { gameId: string; version: string; achievementId: string },
      ) => callback(payload.gameId, payload.version, payload.achievementId);
      ipcRenderer.on(IPC.GAME_UNLOCK_ACHIEVEMENT, handler);
      return () =>
        ipcRenderer.removeListener(IPC.GAME_UNLOCK_ACHIEVEMENT, handler);
    },
  },
  room: {
    create: (gameId: string, version?: string): Promise<RoomCreateResult> =>
      ipcRenderer.invoke(IPC.ROOM_CREATE, gameId, version),
    join: (
      gameId: string,
      address: string,
      version?: string,
      password?: string,
    ): Promise<RoomConnectResult> =>
      ipcRenderer.invoke(IPC.ROOM_JOIN, gameId, address, version, password),
    leave: () => ipcRenderer.invoke(IPC.ROOM_LEAVE),
    ready: () => ipcRenderer.invoke(IPC.ROOM_READY),
    unready: () => ipcRenderer.invoke(IPC.ROOM_UNREADY),
    start: (): Promise<boolean> => ipcRenderer.invoke(IPC.ROOM_START),
    setAddress: (address: string) =>
      ipcRenderer.invoke(IPC.ROOM_SET_ADDRESS, address),
    setPassword: (password: string) =>
      ipcRenderer.invoke(IPC.ROOM_SET_PASSWORD, password),
    getState: () => ipcRenderer.invoke(IPC.ROOM_GET_STATE),
    sendChat: (
      content: string,
      type?: "text" | "audio" | "image",
      images?: string[],
    ) => ipcRenderer.invoke(IPC.ROOM_SEND_CHAT, content, type, images),
    kickPlayer: (playerId: string) =>
      ipcRenderer.invoke(IPC.ROOM_KICK_PLAYER, playerId),
    reconnect: (): Promise<boolean> => ipcRenderer.invoke(IPC.ROOM_RECONNECT),
    popOutChat: (chatHistory: unknown) =>
      ipcRenderer.invoke(IPC.ROOM_POP_OUT_CHAT, chatHistory),
    popInChat: () => ipcRenderer.invoke(IPC.ROOM_POP_IN_CHAT),
    getChatHistory: () => ipcRenderer.invoke(IPC.ROOM_GET_CHAT_HISTORY),
    discoverLan: (): Promise<DiscoveredRoom[]> =>
      ipcRenderer.invoke(IPC.ROOM_DISCOVER_LAN),
    discoverVirtualLan: (): Promise<DiscoveredRoom[]> =>
      ipcRenderer.invoke(IPC.ROOM_DISCOVER_VIRTUAL_LAN),
    discoverRelay: (): Promise<DiscoveredRoom[]> =>
      ipcRenderer.invoke(IPC.ROOM_DISCOVER_RELAY),
    measureRelayLatency: (): Promise<number | null> =>
      ipcRenderer.invoke(IPC.ROOM_MEASURE_RELAY_LATENCY),
    validateDiscovered: (room: DiscoveredRoom) =>
      ipcRenderer.invoke(IPC.ROOM_VALIDATE_DISCOVERED, room),
    probePassword: (
      address: string,
    ): Promise<{ success: boolean; hasPassword: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.ROOM_PROBE_PASSWORD, address),
    setDirectHostMode: (mode: "lan") =>
      ipcRenderer.invoke(IPC.ROOM_SET_DIRECT_HOST_MODE, mode),
    enableRelayHost: () => ipcRenderer.invoke(IPC.ROOM_ENABLE_RELAY_HOST),
    disableRelayHost: () => ipcRenderer.invoke(IPC.ROOM_DISABLE_RELAY_HOST),
    onChatWindowClosed: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC.ROOM_CHAT_WINDOW_CLOSED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.ROOM_CHAT_WINDOW_CLOSED, handler);
    },
    onEvent: (callback: (event: RoomEvent) => void) => {
      const handler = (_: any, event: RoomEvent) => callback(event);
      ipcRenderer.on(IPC.ROOM_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.ROOM_EVENT, handler);
    },
  },
  market: {
    openGameHosting: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_OPEN_GAME_HOSTING),
    getSources: (forceRefresh?: boolean): Promise<MarketDirectory> =>
      ipcRenderer.invoke(IPC.MARKET_GET_SOURCES, forceRefresh),
    getIndex: (
      marketId: string,
      forceRefresh?: boolean,
    ): Promise<MarketIndex> =>
      ipcRenderer.invoke(IPC.MARKET_GET_INDEX, marketId, forceRefresh),
    getCachedImage: (url: string): Promise<string> =>
      ipcRenderer.invoke(IPC.MARKET_GET_CACHED_IMAGE, url),
    downloadAndInstall: (
      gameId: string,
      version: string,
      marketId: string,
    ): Promise<MarketTaskState> =>
      ipcRenderer.invoke(
        IPC.MARKET_DOWNLOAD_AND_INSTALL,
        gameId,
        version,
        marketId,
      ),
    getTaskState: (taskId: string): Promise<MarketTaskState | null> =>
      ipcRenderer.invoke(IPC.MARKET_GET_TASK_STATE, taskId),
    cancelTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_CANCEL_TASK, taskId),
    dismissTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_DISMISS_TASK, taskId),
    pauseTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_PAUSE_TASK, taskId),
    resumeTask: (taskId: string): Promise<MarketTaskState | null> =>
      ipcRenderer.invoke(IPC.MARKET_RESUME_TASK, taskId),
    getPendingTasks: (): Promise<DownloadTaskSnapshot[]> =>
      ipcRenderer.invoke(IPC.MARKET_GET_PENDING_TASKS),
    resolveAssetInfo: (
      downloadUrl: string,
    ): Promise<{ sha256?: string; size?: number }> =>
      ipcRenderer.invoke(IPC.MARKET_RESOLVE_ASSET_INFO, downloadUrl),
    onEvent: (callback: (payload: MarketTaskEvent) => void) => {
      const handler = (_: any, payload: MarketTaskEvent) => callback(payload);
      ipcRenderer.on(IPC.MARKET_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.MARKET_EVENT, handler);
    },
    getAllTaskStates: (): Promise<MarketTaskState[]> =>
      ipcRenderer.invoke(IPC.MARKET_GET_ALL_TASK_STATES),
    onFloatBallEvent: (callback: (progress: FloatBallProgress) => void) => {
      const handler = (_: any, progress: FloatBallProgress) =>
        callback(progress);
      ipcRenderer.on(IPC.MARKET_FLOAT_BALL_EVENT, handler);
      return () =>
        ipcRenderer.removeListener(IPC.MARKET_FLOAT_BALL_EVENT, handler);
    },
    onDragState: (callback: (dragging: boolean) => void) => {
      const handler = (_: any, dragging: boolean) => callback(dragging);
      ipcRenderer.on(IPC.FLOAT_BALL_DRAG_STATE, handler);
      return () =>
        ipcRenderer.removeListener(IPC.FLOAT_BALL_DRAG_STATE, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SYSTEM_GET_SETTINGS),
    getAppVersion: () => ipcRenderer.invoke(IPC.SYSTEM_GET_APP_VERSION),
    getSensitiveWords: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_SENSITIVE_WORDS),
    getLocalAccountStatus: (): Promise<LocalAccountStatus> =>
      ipcRenderer.invoke(IPC.SYSTEM_ACCOUNT_GET_LOCAL_STATUS),
    getPresenceStatus: () =>
      ipcRenderer.invoke(IPC.SYSTEM_ACCOUNT_GET_PRESENCE_STATUS),
    setPresenceEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.SYSTEM_ACCOUNT_SET_PRESENCE, enabled),
    loginWithGitHub: () => ipcRenderer.invoke(IPC.SYSTEM_ACCOUNT_LOGIN_GITHUB),
    logoutAccount: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_ACCOUNT_LOGOUT),
    selectFeedbackImages: (selectionId?: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_FEEDBACK_SELECT_IMAGES, selectionId),
    releaseFeedbackImages: (selectionId: string, imageId?: string) =>
      ipcRenderer.invoke(
        IPC.SYSTEM_FEEDBACK_RELEASE_IMAGES,
        selectionId,
        imageId,
      ),
    submitFeedback: (payload: { content: string; selectionId?: string }) =>
      ipcRenderer.invoke(IPC.SYSTEM_FEEDBACK_SUBMIT, payload),
    getFeedbackHistory: (cursor?: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_FEEDBACK_GET_HISTORY, cursor),
    getFeedbackDetail: (feedbackId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_FEEDBACK_GET_DETAIL, feedbackId),
    save: (settings: AppSettings) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_SETTINGS, settings),
    savePartialSettings: (partial: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_PARTIAL_SETTINGS, partial),
    saveNicknameStyle: (
      style: NicknameStyle,
    ): Promise<{ success: boolean; code?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_NICKNAME_STYLE, style),
    uploadAvatar: () => ipcRenderer.invoke(IPC.SYSTEM_UPLOAD_AVATAR),
    getAvatarFrameImage: (fileName: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_AVATAR_FRAME_IMAGE, fileName),
    selectGameStoragePath: () =>
      ipcRenderer.invoke(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH),
    getGameStoragePaths: () =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_GAME_STORAGE_PATHS),
    addGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_ADD_GAME_STORAGE_PATH, targetPath),
    setDefaultGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_SET_DEFAULT_GAME_STORAGE_PATH, targetPath),
    migrateGameStorageLibrary: (payload: {
      sourcePath: string;
      targetPath: string;
    }) => ipcRenderer.invoke(IPC.SYSTEM_MIGRATE_GAME_STORAGE_LIBRARY, payload),
    openPath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_PATH, targetPath),
    openUrl: (url: string) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_URL, url),
    removeGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_REMOVE_GAME_STORAGE_PATH, targetPath),
    dataHealthCheck: (): Promise<DataHealthReport> =>
      ipcRenderer.invoke(IPC.SYSTEM_DATA_HEALTH_CHECK),
    uninstall: (payload?: {
      deleteGames?: boolean;
      deleteUserData?: boolean;
    }): Promise<UninstallStartResult> =>
      ipcRenderer.invoke(IPC.SYSTEM_UNINSTALL, payload),
    clearCache: (): Promise<{ totalSize: number; clearedSize: number }> =>
      ipcRenderer.invoke(IPC.SYSTEM_CLEAR_CACHE),
    savePng: (
      dataUrl: string,
      defaultName: string,
    ): Promise<{
      success: boolean;
      canceled?: boolean;
      filePath?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC.SYSTEM_SAVE_PNG, dataUrl, defaultName),
    onAccountAuthChanged: (
      callback: (payload: AccountAuthChangedPayload) => void,
    ) => {
      const handler = (_: any, payload: Parameters<typeof callback>[0]) =>
        callback(payload);
      ipcRenderer.on(IPC.SYSTEM_ACCOUNT_AUTH_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.SYSTEM_ACCOUNT_AUTH_CHANGED, handler);
    },
    onPresenceChanged: (callback: (payload: AccountPresenceStatus) => void) => {
      const handler = (_: any, payload: AccountPresenceStatus) =>
        callback(payload);
      ipcRenderer.on(IPC.SYSTEM_ACCOUNT_PRESENCE_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC.SYSTEM_ACCOUNT_PRESENCE_CHANGED,
          handler,
        );
    },
  },
  backup: {
    exportData: (): Promise<BackupResult> =>
      ipcRenderer.invoke(IPC.BACKUP_EXPORT),
    selectImport: (): Promise<BackupImportSelectionResult> =>
      ipcRenderer.invoke(IPC.BACKUP_IMPORT),
    confirmImport: (token: string): Promise<BackupResult> =>
      ipcRenderer.invoke(IPC.BACKUP_IMPORT_CONFIRM, token),
    cancel: (): Promise<boolean> => ipcRenderer.invoke(IPC.BACKUP_CANCEL),
    getStatus: (): Promise<BackupState> =>
      ipcRenderer.invoke(IPC.BACKUP_GET_STATUS),
    onEvent: (callback: (payload: BackupState) => void) => {
      const handler = (_: unknown, payload: BackupState) => callback(payload);
      ipcRenderer.on(IPC.BACKUP_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.BACKUP_EVENT, handler);
    },
  },
  update: {
    rendererHealthy: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SYSTEM_RENDERER_HEALTHY),
    getStatus: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_GET_STATUS),
    check: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_CHECK),
    download: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_DOWNLOAD),
    cancel: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_CANCEL),
    apply: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_APPLY),
    suppressForCurrentVersion: (): Promise<UpdateState> =>
      ipcRenderer.invoke(IPC.SYSTEM_UPDATE_SUPPRESS),
    onEvent: (callback: (payload: UpdateState) => void) => {
      const handler = (_: unknown, payload: UpdateState) => callback(payload);
      ipcRenderer.on(IPC.SYSTEM_UPDATE_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.SYSTEM_UPDATE_EVENT, handler);
    },
  },
  forum: {
    selectImages: (selectionId?: string): Promise<ForumImageSelectionResult> =>
      ipcRenderer.invoke(IPC.FORUM_SELECT_IMAGES, selectionId),
    releaseImages: (selectionId: string, imageId?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FORUM_RELEASE_IMAGES, selectionId, imageId),
    getSearchAvailability: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.FORUM_GET_SEARCH_AVAILABILITY),
    listPosts: (
      query?: string,
      cursor?: string,
    ): Promise<ForumPage<ForumPostSummary>> =>
      ipcRenderer.invoke(IPC.FORUM_LIST_POSTS, query, cursor),
    getPost: (postId: string): Promise<ForumPostDetail> =>
      ipcRenderer.invoke(IPC.FORUM_GET_POST, postId),
    resolvePostReferences: (ids: string[]): Promise<ForumPostReferenceResult> =>
      ipcRenderer.invoke(IPC.FORUM_RESOLVE_POST_REFERENCES, ids),
    getComments: (
      postId: string,
      cursor?: string,
    ): Promise<ForumPage<ForumComment>> =>
      ipcRenderer.invoke(IPC.FORUM_GET_COMMENTS, postId, cursor),
    createPost: (payload: {
      title: string;
      body: string;
      selectionId?: string;
    }): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_CREATE_POST, payload),
    createComment: (
      postId: string,
      content: string,
    ): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_CREATE_COMMENT, postId, content),
    deletePost: (postId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_DELETE_POST, postId),
    deleteComment: (commentId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_DELETE_COMMENT, commentId),
    likePost: (postId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_LIKE_POST, postId),
    unlikePost: (postId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_UNLIKE_POST, postId),
    likeComment: (commentId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_LIKE_COMMENT, commentId),
    unlikeComment: (commentId: string): Promise<ForumMutationResult> =>
      ipcRenderer.invoke(IPC.FORUM_UNLIKE_COMMENT, commentId),
  },
  user: {
    getData: () => ipcRenderer.invoke(IPC.SYSTEM_GET_USER_DATA),
    unlockFrame: (frameId: string): Promise<ManualUnlockResult> =>
      ipcRenderer.invoke(IPC.SYSTEM_UNLOCK_FRAME, frameId),
    equipFrame: (frameId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_EQUIP_FRAME, frameId),
    unequipFrame: (frameId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_UNEQUIP_FRAME, frameId),
    unlockGameCardProduct: (productId: string): Promise<ManualUnlockResult> =>
      ipcRenderer.invoke(IPC.SYSTEM_UNLOCK_GAME_CARD_PRODUCT, productId),
    getGameCardProductProgress: (
      productId: string,
    ): Promise<ManualUnlockResult> =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_GAME_CARD_PRODUCT_PROGRESS, productId),
    equipGameCardProduct: (productId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_EQUIP_GAME_CARD_PRODUCT, productId),
    unequipGameCardProduct: (productId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_UNEQUIP_GAME_CARD_PRODUCT, productId),
    getGameCardProductImage: (
      productId: string,
      ratio: "square" | "wide",
    ): Promise<string | null> =>
      ipcRenderer.invoke(
        IPC.SYSTEM_GET_GAME_CARD_PRODUCT_IMAGE,
        productId,
        ratio,
      ),
    checkIn: () => ipcRenderer.invoke(IPC.SYSTEM_CHECK_IN),
  },
  stats: {
    getDailyPlayDurations: (days?: number) =>
      ipcRenderer.invoke(IPC.STATS_GET_DAILY_PLAY_DURATIONS, days),
    getRecentSessions: (limit?: number) =>
      ipcRenderer.invoke(IPC.STATS_GET_RECENT_SESSIONS, limit),
    getSessionsByDate: (date: string) =>
      ipcRenderer.invoke(IPC.STATS_GET_SESSIONS_BY_DATE, date),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI);
} else {
  // @ts-ignore -- contextIsolation=false fallback exposes the typed preload API directly.
  window.electronAPI = electronAPI;
}
