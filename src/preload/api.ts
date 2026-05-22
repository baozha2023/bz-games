import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "../shared/ipc-channels";
import type {
  AppSettings,
  DataHealthReport,
  MarketDirectory,
  MarketIndex,
  MarketTaskEvent,
  MarketTaskState,
  RoomEvent,
  UpdateState,
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
        type:
          | "singleplayer"
          | "multiplayer"
          | "singlemultiple"
          | "networkgame";
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
    sendChat: (content: string, type?: "text" | "audio") =>
      ipcRenderer.invoke(IPC.ROOM_SEND_CHAT, content, type),
    kickPlayer: (playerId: string) =>
      ipcRenderer.invoke(IPC.ROOM_KICK_PLAYER, playerId),
    reconnect: () =>
      ipcRenderer.invoke(IPC.ROOM_RECONNECT),
    onEvent: (callback: (event: RoomEvent) => void) => {
      const handler = (_: any, event: RoomEvent) => callback(event);
      ipcRenderer.on(IPC.ROOM_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.ROOM_EVENT, handler);
    },
  },
  market: {
    getSources: (): Promise<MarketDirectory> =>
      ipcRenderer.invoke(IPC.MARKET_GET_SOURCES),
    getIndex: (sourceIdx: number, forceRefresh?: boolean): Promise<MarketIndex> =>
      ipcRenderer.invoke(IPC.MARKET_GET_INDEX, sourceIdx, forceRefresh),
    downloadAndInstall: (gameId: string, version: string, sourceIdx: number): Promise<MarketTaskState> =>
      ipcRenderer.invoke(IPC.MARKET_DOWNLOAD_AND_INSTALL, gameId, version, sourceIdx),
    getTaskState: (taskId: string): Promise<MarketTaskState | null> =>
      ipcRenderer.invoke(IPC.MARKET_GET_TASK_STATE, taskId),
    cancelTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.MARKET_CANCEL_TASK, taskId),
    onEvent: (callback: (payload: MarketTaskEvent) => void) => {
      const handler = (_: any, payload: MarketTaskEvent) => callback(payload);
      ipcRenderer.on(IPC.MARKET_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.MARKET_EVENT, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SYSTEM_GET_SETTINGS),
    getAppVersion: () => ipcRenderer.invoke(IPC.SYSTEM_GET_APP_VERSION),
    save: (settings: AppSettings) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_SETTINGS, settings),
    uploadAvatar: () => ipcRenderer.invoke(IPC.SYSTEM_UPLOAD_AVATAR),
    selectGameStoragePath: () =>
      ipcRenderer.invoke(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH),
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
    checkIn: () => ipcRenderer.invoke(IPC.SYSTEM_CHECK_IN),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI);
} else {
  // @ts-ignore
  window.electronAPI = electronAPI;
}
