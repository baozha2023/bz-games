export const IPC = {
  // ── 游戏管理 ──
  GAME_LOAD:          'game:load',
  GAME_REMOVE:        'game:remove',
  GAME_LAUNCH:        'game:launch',
  GAME_GET_ALL:       'game:getAll',
  GAME_GET_RECORDS:   'game:getRecords',
  GAME_GET_COVER:     'game:getCover',
  GAME_GET_ICON:      'game:getIcon',
  GAME_GET_VERSIONS:  'game:getVersions',
  GAME_GET_MANIFEST:  'game:getManifest',
  GAME_UNLOCK_ACHIEVEMENT: 'game:unlockAchievement',

  // ── 房间管理 ──
  ROOM_CREATE:        'room:create',
  ROOM_JOIN:          'room:join',
  ROOM_LEAVE:         'room:leave',
  ROOM_READY:         'room:ready',
  ROOM_UNREADY:       'room:unready',
  ROOM_START:         'room:start',
  ROOM_SET_ADDRESS:   'room:setAddress',
  ROOM_GET_STATE:     'room:getState',
  ROOM_SEND_CHAT:     'room:sendChat',

  // ── 房间事件推送（主→渲染，使用 ipcRenderer.on）──
  ROOM_EVENT:         'room:event',

  // ── 游戏进程事件（主→渲染）──
  GAME_PROCESS_STARTED: 'game:process:started',
  GAME_PROCESS_ENDED:   'game:process:ended',
  GAME_LAUNCH_FAILED:   'game:launch:failed',

  // ── 系统 ──
  SYSTEM_GET_SETTINGS:  'system:getSettings',
  SYSTEM_SAVE_SETTINGS: 'system:saveSettings',
  SYSTEM_UPLOAD_AVATAR: 'system:uploadAvatar',
} as const;
