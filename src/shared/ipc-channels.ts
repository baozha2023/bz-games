export const IPC = {
  // ── 游戏管理 ──
  GAME_LOAD: "game:load",
  GAME_REMOVE: "game:remove",
  GAME_LAUNCH: "game:launch",
  GAME_GET_ALL: "game:getAll",
  GAME_GET_RECORDS: "game:getRecords",
  GAME_GET_COVER: "game:getCover",
  GAME_GET_VIDEO: "game:getVideo",
  GAME_GET_ICON: "game:getIcon",
  GAME_GET_VERSIONS: "game:getVersions",
  GAME_GET_MANIFEST: "game:getManifest",
  GAME_UNLOCK_ACHIEVEMENT: "game:unlockAchievement",
  GAME_TOGGLE_FAVORITE: "game:toggleFavorite",
  GAME_REORDER: "game:reorder",
  GAME_PREPARE_IMPORT: "game:prepareImport",
  GAME_LOAD_WITH_MANIFEST: "game:loadWithManifest",
  GAME_CHECK_ID_EXISTS: "game:checkIdExists",

  // ── 房间管理 ──
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_READY: "room:ready",
  ROOM_UNREADY: "room:unready",
  ROOM_START: "room:start",
  ROOM_SET_ADDRESS: "room:setAddress",
  ROOM_GET_STATE: "room:getState",
  ROOM_SEND_CHAT: "room:sendChat",
  ROOM_KICK_PLAYER: "room:kickPlayer",

  // ── 房间事件推送（主→渲染，使用 ipcRenderer.on）──
  ROOM_EVENT: "room:event",

  // ── 游戏进程事件（主→渲染）──
  GAME_PROCESS_STARTED: "game:process:started",
  GAME_PROCESS_ENDED: "game:process:ended",
  GAME_LAUNCH_FAILED: "game:launch:failed",

  // ── 系统 ──
  SYSTEM_GET_SETTINGS: "system:getSettings",
  SYSTEM_SAVE_SETTINGS: "system:saveSettings",
  SYSTEM_UPLOAD_AVATAR: "system:uploadAvatar",
  SYSTEM_SELECT_GAME_STORAGE_PATH: "system:selectGameStoragePath",
  SYSTEM_OPEN_PATH: "system:openPath",
  SYSTEM_REMOVE_GAME_STORAGE_PATH: "system:removeGameStoragePath",
  SYSTEM_GET_USER_DATA: "system:getUserData",
  SYSTEM_CHECK_IN: "system:checkIn",
  SYSTEM_CHECK_UPDATE: "system:checkUpdate",
  SYSTEM_DOWNLOAD_UPDATE: "system:downloadUpdate",
  SYSTEM_INSTALL_UPDATE: "system:installUpdate",
  SYSTEM_GET_UPDATE_STATUS: "system:getUpdateStatus",
  SYSTEM_UPDATE_EVENT: "system:update:event",

  // ── 游戏数据存储 (Preload → Main) ──
  GAME_STORAGE_INIT: "game:storage:init",
  GAME_STORAGE_SAVE: "game:storage:save",
  GAME_STORAGE_REMOVE: "game:storage:remove",
  GAME_STORAGE_CLEAR: "game:storage:clear",
} as const;
