import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "../shared/ipc-channels";
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
  UpdateState,
  NicknameStyle,
} from "../shared/types";

export const electronAPI = {
  game: {
    load: (sourcePath?: string) => ipcRenderer.invoke(IPC.GAME_LOAD, sourcePath),
    prepareImport: (sourcePath: string) =>
      ipcRenderer.invoke(IPC.GAME_PREPARE_IMPORT, sourcePath),
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
    ) => ipcRenderer.invoke(IPC.GAME_LOAD_WITH_MANIFEST, sourcePath, draft),
    checkIdExists: (id: string) => ipcRenderer.invoke(IPC.GAME_CHECK_ID_EXISTS, id),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    remove: (id: string, versions?: string[]) =>
      ipcRenderer.invoke(IPC.GAME_REMOVE, id, versions),
    launch: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_LAUNCH, id, version),
    getAll: () => ipcRenderer.invoke(IPC.GAME_GET_ALL),
    getAllRecords: () => ipcRenderer.invoke(IPC.GAME_GET_RECORDS),
    getVersions: (id: string) => ipcRenderer.invoke(IPC.GAME_GET_VERSIONS, id),
    getManifest: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_MANIFEST, id, version),
    getCover: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_COVER, id, version),
    getVideo: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_VIDEO, id, version),
    getIcon: (id: string, version?: string) =>
      ipcRenderer.invoke(IPC.GAME_GET_ICON, id, version),
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
    onLaunchFailed: (callback: (id: string, reason: string) => void) => {
      const handler = (_: any, payload: { id: string; reason: string }) =>
        callback(payload.id, payload.reason);
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
    create: (gameId: string, version?: string) =>
      ipcRenderer.invoke(IPC.ROOM_CREATE, gameId, version),
    join: (gameId: string, address: string, version?: string) =>
      ipcRenderer.invoke(IPC.ROOM_JOIN, gameId, address, version),
    leave: () => ipcRenderer.invoke(IPC.ROOM_LEAVE),
    ready: () => ipcRenderer.invoke(IPC.ROOM_READY),
    unready: () => ipcRenderer.invoke(IPC.ROOM_UNREADY),
    start: () => ipcRenderer.invoke(IPC.ROOM_START),
    setAddress: (address: string) =>
      ipcRenderer.invoke(IPC.ROOM_SET_ADDRESS, address),
    getState: () => ipcRenderer.invoke(IPC.ROOM_GET_STATE),
    sendChat: (content: string, type?: "text" | "audio" | "image", images?: string[]) =>
      ipcRenderer.invoke(IPC.ROOM_SEND_CHAT, content, type, images),
    kickPlayer: (playerId: string) =>
      ipcRenderer.invoke(IPC.ROOM_KICK_PLAYER, playerId),
    reconnect: () =>
      ipcRenderer.invoke(IPC.ROOM_RECONNECT),
    popOutChat: (chatHistory: unknown) =>
      ipcRenderer.invoke(IPC.ROOM_POP_OUT_CHAT, chatHistory),
    popInChat: () =>
      ipcRenderer.invoke(IPC.ROOM_POP_IN_CHAT),
    getChatHistory: () =>
      ipcRenderer.invoke(IPC.ROOM_GET_CHAT_HISTORY),
    discoverLan: (): Promise<DiscoveredRoom[]> =>
      ipcRenderer.invoke(IPC.ROOM_DISCOVER_LAN),
    discoverRelay: (): Promise<DiscoveredRoom[]> =>
      ipcRenderer.invoke(IPC.ROOM_DISCOVER_RELAY),
    validateDiscovered: (room: DiscoveredRoom) =>
      ipcRenderer.invoke(IPC.ROOM_VALIDATE_DISCOVERED, room),
    enableRelayHost: () =>
      ipcRenderer.invoke(IPC.ROOM_ENABLE_RELAY_HOST),
    disableRelayHost: () =>
      ipcRenderer.invoke(IPC.ROOM_DISABLE_RELAY_HOST),
    onChatWindowClosed: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC.ROOM_CHAT_WINDOW_CLOSED, handler);
      return () => ipcRenderer.removeListener(IPC.ROOM_CHAT_WINDOW_CLOSED, handler);
    },
    onEvent: (callback: (event: RoomEvent) => void) => {
      const handler = (_: any, event: RoomEvent) => callback(event);
      ipcRenderer.on(IPC.ROOM_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.ROOM_EVENT, handler);
    },
  },
  market: {
    getSources: (forceRefresh?: boolean): Promise<MarketDirectory> =>
      ipcRenderer.invoke(IPC.MARKET_GET_SOURCES, forceRefresh),
    getIndex: (sourceIdx: number, forceRefresh?: boolean): Promise<MarketIndex> =>
      ipcRenderer.invoke(IPC.MARKET_GET_INDEX, sourceIdx, forceRefresh),
    getCachedImage: (url: string): Promise<string> =>
      ipcRenderer.invoke(IPC.MARKET_GET_CACHED_IMAGE, url),
    downloadAndInstall: (gameId: string, version: string, sourceIdx: number): Promise<MarketTaskState> =>
      ipcRenderer.invoke(IPC.MARKET_DOWNLOAD_AND_INSTALL, gameId, version, sourceIdx),
    getTaskState: (taskId: string): Promise<MarketTaskState | null> =>
      ipcRenderer.invoke(IPC.MARKET_GET_TASK_STATE, taskId),
    cancelTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_CANCEL_TASK, taskId),
    pauseTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_PAUSE_TASK, taskId),
    resumeTask: (taskId: string): Promise<MarketTaskState | null> =>
      ipcRenderer.invoke(IPC.MARKET_RESUME_TASK, taskId),
    getPendingTasks: (): Promise<DownloadTaskSnapshot[]> =>
      ipcRenderer.invoke(IPC.MARKET_GET_PENDING_TASKS),
    resolveAssetInfo: (downloadUrl: string): Promise<{ sha256?: string; size?: number }> =>
      ipcRenderer.invoke(IPC.MARKET_RESOLVE_ASSET_INFO, downloadUrl),
    onEvent: (callback: (payload: MarketTaskEvent) => void) => {
      const handler = (_: any, payload: MarketTaskEvent) => callback(payload);
      ipcRenderer.on(IPC.MARKET_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.MARKET_EVENT, handler);
    },
    getAllTaskStates: (): Promise<MarketTaskState[]> =>
      ipcRenderer.invoke(IPC.MARKET_GET_ALL_TASK_STATES),
    onFloatBallEvent: (callback: (progress: FloatBallProgress) => void) => {
      const handler = (_: any, progress: FloatBallProgress) => callback(progress);
      ipcRenderer.on(IPC.MARKET_FLOAT_BALL_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.MARKET_FLOAT_BALL_EVENT, handler);
    },
    onDragState: (callback: (dragging: boolean) => void) => {
      const handler = (_: any, dragging: boolean) => callback(dragging);
      ipcRenderer.on(IPC.FLOAT_BALL_DRAG_STATE, handler);
      return () => ipcRenderer.removeListener(IPC.FLOAT_BALL_DRAG_STATE, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SYSTEM_GET_SETTINGS),
    getAppVersion: () => ipcRenderer.invoke(IPC.SYSTEM_GET_APP_VERSION),
    save: (settings: AppSettings) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_SETTINGS, settings),
    savePartialSettings: (partial: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_PARTIAL_SETTINGS, partial),
    saveNicknameStyle: (style: NicknameStyle): Promise<{ success: boolean; code?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_NICKNAME_STYLE, style),
    ignoreUpdateVersion: (version: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_SET_IGNORED_UPDATE_VERSION, version),
    uploadAvatar: () => ipcRenderer.invoke(IPC.SYSTEM_UPLOAD_AVATAR),
    getAvatarFrameImage: (fileName: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_AVATAR_FRAME_IMAGE, fileName),
    selectGameStoragePath: () =>
      ipcRenderer.invoke(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH),
    selectGameStoragePathRelaxed: () =>
      ipcRenderer.invoke(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH_RELAXED),
    getDefaultGamesMigrationStatus: () =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_DEFAULT_GAMES_MIGRATION_STATUS),
    getGameStoragePaths: () =>
      ipcRenderer.invoke(IPC.SYSTEM_GET_GAME_STORAGE_PATHS),
    addGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_ADD_GAME_STORAGE_PATH, targetPath),
    setDefaultGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_SET_DEFAULT_GAME_STORAGE_PATH, targetPath),
    migrateDefaultGamesLibrary: (payload: { targetPath?: string; ignore?: boolean }) =>
      ipcRenderer.invoke(IPC.SYSTEM_MIGRATE_DEFAULT_GAMES_LIBRARY, payload),
    migrateGameStorageLibrary: (payload: { sourcePath: string; targetPath: string }) =>
      ipcRenderer.invoke(IPC.SYSTEM_MIGRATE_GAME_STORAGE_LIBRARY, payload),
    openPath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_PATH, targetPath),
    openUrl: (url: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_URL, url),
    removeGameStoragePath: (targetPath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_REMOVE_GAME_STORAGE_PATH, targetPath),
    dataHealthCheck: (): Promise<DataHealthReport> =>
      ipcRenderer.invoke(IPC.SYSTEM_DATA_HEALTH_CHECK),
    getUpdateStatus: () => ipcRenderer.invoke(IPC.SYSTEM_GET_UPDATE_STATUS),
    checkUpdate: () => ipcRenderer.invoke(IPC.SYSTEM_CHECK_UPDATE),
    downloadUpdate: () => ipcRenderer.invoke(IPC.SYSTEM_DOWNLOAD_UPDATE),
    installUpdate: () => ipcRenderer.invoke(IPC.SYSTEM_INSTALL_UPDATE),
    uninstall: (payload?: { deleteGames?: boolean }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_UNINSTALL, payload),
    clearCache: (): Promise<{ totalSize: number; clearedSize: number }> =>
      ipcRenderer.invoke(IPC.SYSTEM_CLEAR_CACHE),
    onUpdateEvent: (
      callback: (payload: UpdateState) => void,
    ) => {
      const handler = (_: any, payload: UpdateState) => callback(payload);
      ipcRenderer.on(IPC.SYSTEM_UPDATE_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.SYSTEM_UPDATE_EVENT, handler);
    },
  },
  user: {
    getData: () => ipcRenderer.invoke(IPC.SYSTEM_GET_USER_DATA),
    buyFrame: (frameId: string, coinCost: number) =>
      ipcRenderer.invoke(IPC.SYSTEM_BUY_FRAME, frameId, coinCost),
    equipFrame: (frameId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_EQUIP_FRAME, frameId),
    unequipFrame: (frameId: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_UNEQUIP_FRAME, frameId),
    checkIn: () => ipcRenderer.invoke(IPC.SYSTEM_CHECK_IN),
  },
  stats: {
    getDailyPlayDurations: (days?: number) =>
      ipcRenderer.invoke(IPC.STATS_GET_DAILY_PLAY_DURATIONS, days),
    getRecentSessions: (limit?: number) =>
      ipcRenderer.invoke(IPC.STATS_GET_RECENT_SESSIONS, limit),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI);
} else {
  // @ts-ignore
  window.electronAPI = electronAPI;
}
