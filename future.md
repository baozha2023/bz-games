# BZ-Games 架构全景与执行规划

> **版本**: v1.9.4  
> **生成依据**: 完整阅读 `src/` 下全部 55 个源码文件  
> **用途**: 既是架构文档，也是下一步开发的执行路线图

---

## 第一部分：架构全景图（源码级分析）

### 1. 项目总览

| 维度 | 事实 |
|------|------|
| 技术栈 | Electron 40 + Vue 3.5 + TypeScript 5.5 + Pinia 2.2 + Naive UI 2.40 |
| 构建工具 | electron-vite 5.0 |
| 打包工具 | electron-builder 26.8 (NSIS, x64 only) |
| 包管理 | pnpm |
| 当前版本 | v1.9.4 |
| 进程模型 | 主进程 / Preload (contextBridge) / 渲染进程 |
| IPC 通道 | 32 个（见 `src/shared/ipc-channels.ts`） |
| 本地存储 | electron-store 11 (AES-256-GCM 加密，存储于应用根目录 `config.json`) |
| WebSocket | ws 8.18 (Room Server / Room Client / Game API Server 三套) |

### 2. 核心组件调用关系（源码事实）

```
┌──────────────────────────────────────────────────────────────────┐
│  main/index.ts (入口)                                            │
│  ├── window.ts ─────── BrowserWindow + Tray 管理                 │
│  ├── ipc/index.ts ─── 注册全部 IPC Handler                       │
│  │   ├── game.ipc.ts    ── 游戏导入/删除/启动/媒体读取             │
│  │   ├── room.ipc.ts    ── 房间创建/加入/准备/开始/踢人/聊天       │
│  │   ├── system.ipc.ts  ── 设置/更新/头像/路径管理                │
│  │   └── storage.ipc.ts ── Web 游戏 localStorage 持久化           │
│  └── services/                                                    │
│      ├── StoreService.ts    ── 配置读写/加密/快照恢复/数据CRUD     │
│      ├── GameLoader.ts      ── 导入验证/文件复制/版本管理/磁盘扫描   │
│      ├── GameManager.ts     ── 进程启动/窗口创建/生命周期/API中继    │
│      ├── GameApiServer.ts   ── ws://127.0.0.1 Game API 服务       │
│      ├── GameEnvironment.ts ── 环境变量 + bz-config.js 写入       │
│      ├── RoomServer.ts      ── 房主 WebSocket 服务/消息路由/踢人    │
│      ├── RoomClient.ts      ── 客机连接/重连/消息转发              │
│      ├── UpdateService.ts   ── electron-updater 封装/快照          │
│      └── NotificationService.ts ── 成就通知浮窗                    │
│                                                                   │
│  preload/                                                         │
│  ├── api.ts   ── contextBridge: window.electronAPI                │
│  └── game.ts  ── Web 游戏 localStorage 接管 → gamedata.json       │
│                                                                   │
│  renderer/src/                                                    │
│  ├── AppContent.vue       ── 全局布局/导航/更新提示/签到/成就通知    │
│  ├── stores/                                                     │
│  │   ├── useGameStore.ts    ── 游戏库/运行状态/成就事件             │
│  │   ├── useRoomStore.ts    ── 房间状态/聊天/准备/开始冷却          │
│  │   └── useSettingsStore.ts ── 设置/用户数据/更新状态             │
│  ├── views/                                                      │
│  │   ├── LibraryView.vue       ── 游戏库首页/拖拽导入/补录表单/排序  │
│  │   ├── GameDetailView.vue    ── 详情/版本切换/启动/房间入口/删除   │
│  │   ├── RoomView.vue          ── 房间内玩家列表/聊天/准备/开始      │
│  │   ├── SettingsView.vue      ── 设置表单/路径管理/更新检查        │
│  │   ├── StatisticsView.vue    ── 统计卡片/版本切换/搜索           │
│  │   ├── AchievementsView.vue  ── 成就列表/展开收起/进度/搜索       │
│  │   └── NotificationView.vue  ── 成就通知浮窗内容                 │
│  └── components/                                                 │
│      ├── game/  GameCard/Cover/Icon/AchievementsModal/DeleteModal │
│      └── room/  PlayerCard/PlayerList/RoomChat                   │
│                                                                   │
│  shared/                                                          │
│  ├── ipc-channels.ts   ── 32 个 IPC 频道常量                      │
│  ├── game-manifest.ts  ── Zod Schema + GameManifest 类型          │
│  └── types/            ── game/room/store 类型定义                │
└──────────────────────────────────────────────────────────────────┘
```

### 3. 数据流详解

#### 3.1 本地存储（StoreService）

- **文件**: `Config.json`（应用根目录），AES-256-GCM 加密
- **结构**: `{ games: GameRecord[], settings: AppSettings, userData: UserData, recentPlayed: string[] }`
- **启动流程**: `init()` → 尝试从快照恢复 → 加载 `config.json` → 识别明文旧版 → 自动加密迁移
- **多路径存储**: 默认路径 `{appRoot}/games` + 用户自定义 `gameStoragePath` + 历史路径 `gameStorageHistory`
- **快照恢复**: 启动时若 `config.json` 缺失，自动从 `%userData%/.update-snapshots/` 恢复

#### 3.2 游戏导入流程（GameLoader）

```
导入入口 (LibraryView)
  ├── 拖拽 (webUtils.getPathForFile)
  ├── 按钮 (dialog.showOpenDialog → openDirectory)
  └── 有 game.json？
       ├── YES: validateManifestFile → checkPlatformVersion → checkEntryFile
       │        → ensureVersionNotExists → installGameFiles → updateGameRecord
       └── NO:  prepareImportFromPath → 弹出补录表单 (ManualManifestDraft)
                → loadGameFromPathWithManifest → installGameFiles → write game.json
```

- **版本检查**: `platformVersion` 支持单版本字符串或 `[min, max]` 元组，使用 `semver` 比较
- **入口检测**: 自动探测 `index.html/main.html/game.html/*.exe/*.bat`
- **磁盘同步**: `scanAndSyncGames()` 扫描所有存储根目录，与 `config.json` 中的 records 对账，自动发现新版本、清除失效记录

#### 3.3 游戏启动流程（GameManager）

```
GameManager.launch(id, version)
  ├── prepareGame → getVersionPath + getManifest
  ├── entry === "url"?
  │   └── YES: createGameWindow(manifest.web_url) [不启动 API Server, 不写 bz-config.js]
  ├── startApiServer → GameApiServer (ws://127.0.0.1:{auto})
  ├── GameEnvironment.prepare → 合并 env + BZ_* 环境变量
  ├── GameEnvironment.writeConfig → bz-config.js
  ├── entry === "serve"?
  │   └── createServer + http://localhost:{auto}/index.html
  ├── entry === "*.html"?
  │   └── createGameWindow(file:// 模式, preload=game.js, partition=persist:game_xxx)
  └── else (exe/bat):
      └── spawn(entry, args, env) [detached, shell for .bat]
```

- **窗口配置**: 支持 Manifest `args` 中的 `--width/--height/--fullscreen/--kiosk`
- **Web 游戏隔离**: 使用 `persist:game_<id>_<version>` 分区，`preload/game.ts` 接管 localStorage
- **进程生命周期**: `start` → 记录 startTime → `exit` → recordPlaytime → notifyRoomGameEnd → cleanup

#### 3.4 联机房间流程

```
房主 (Host):
  RoomServer.start(gameId, version)
    ├── 读取 maxPlayers (Manifest multiplayer 配置, 默认 4)
    ├── 创建 roomInfo { id: UUID, hostId, state: "waiting" }
    ├── WebSocketServer(port=38080)
    ├── 自检: net.connect("127.0.0.1", port)
    ├── 心跳: 30s ping/pong
    └── RoomClient.connect("127.0.0.1:38080") [房主自己也连接本地]

客机 (Client):
  RoomClient.connect(address, gameId, version)
    ├── WebSocket(url) → open → send room:join
    ├── 等待 room:join:ack 或 room:join:refused 或 room:state:sync
    ├── 超时 15s
    ├── 重连: 最多 5 次, 递增退避 delay = min(attempt*2s, 10s)
    └── handleGameLifecycle: room:game:start → onGameStart → GameManager.launch
```

- **拒绝原因**: room_full / game_started / game_id_mismatch / version_mismatch / room_closed / kicked
- **踢人**: Host → RoomServer.kickPlayer → 发送 `room:kicked` → 关闭 WS → 广播 `room:player:kicked` → 同房间不允许重新加入
- **解散**: Host 离开 → 广播 `room:disbanded` → Server stop → 等待 120ms 后关闭

#### 3.5 Game API Server 协议

| Action | 方向 | 说明 |
|--------|------|------|
| `auth` | 游戏→平台 | 连接后首个请求, payload: `{ token }`, 30s 超时 |
| `player.getInfo` | 游戏→平台 | 返回 `{ id, name }` |
| `room.getInfo` | 游戏→平台 | 返回当前房间信息 |
| `message.send` | 游戏→平台 | 单播, 需 `to` 或 `targetPlayerId` |
| `message.broadcast` | 游戏→平台 | 广播（不发给发送者自身） |
| `game.ready` | 游戏→平台 | 告知平台游戏就绪 |
| `game.end` | 游戏→平台 | 游戏主动结束 |
| `achievement.list` | 游戏→平台 | 获取成就列表+解锁状态 |
| `achievement.unlock` | 游戏→平台 | 解锁成就, playerId 必须匹配 |
| `stats.report` | 游戏→平台 | 上报统计, 支持 increment/full 模式 |

- **平台推送事件**: `event.message` / `event.playerJoined` / `event.playerLeft` / `event.gameEnd`
- **自动补齐**: 中继层自动补齐 `senderId`, `messageId`, `sentAt`

#### 3.6 统计与成就系统

- **统计**: Manifest `statistics` 字段支持 `string` / `{ key: label }` / `{ key: { label, mode: "increment"|"full" } }`
- **游玩时长**: 自动追踪, `playtime` 字段独立存储（毫秒）, 统计界面 `time` 始终排在第一位
- **经济系统**: 每 10 分钟奖励 10 BZ 币, 进程结束时计算; 签到 7 天循环, 第 7 天 100 币
- **成就通知**: `AchievementNotifier` 队列化, 5.2s 间隔, Web Audio API 合成音效 (C Major 7th 琶音)

#### 3.7 客户端更新

- **更新源**: GitHub Releases (baozha2023/bz-games)
- **流程**: `checkForUpdates` → `downloadUpdate` → `installUpdate` (quitAndInstall)
- **快照**: 下载前/安装前各创建一次快照 (`.update-snapshots/{timestamp}-{stage}/`), 包含 `config.json` + 默认 `games/` 目录
- **状态**: idle → checking → available/up_to_date → downloading → downloaded → error
- **版本忽略**: 设置中可忽略特定版本更新

### 4. 关键文件清单与职责

#### 主进程 `src/main/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | 38 | 应用入口, 顺序: storeService.init → setCustomGamesDir → registerAllIpc → createWindow |
| `window.ts` | 83 | BrowserWindow (1024×768, min 800×600), Tray 图标, 关闭行为 (tray/exit) |
| `ipc/index.ts` | 11 | 统一注册 4 组 IPC Handler |
| `ipc/game.ipc.ts` | 170 | 15 个 Handler: 导入/删除/启动/排序/收藏/媒体读取/Manifest 读取 |
| `ipc/room.ipc.ts` | 102 | 10 个 Handler: room:create/join/leave/ready/start/setAddress/getState/sendChat/kick |
| `ipc/system.ipc.ts` | 116 | 12 个 Handler: 设置/头像/路径/用户数据/签到/更新 |
| `ipc/storage.ipc.ts` | 204 | 4 个 sync Handler: init/save/remove/clear, AES-256-GCM 可选加密 |
| `services/StoreService.ts` | 759 | 配置初始化/加密/快照恢复/CRUD/统计/签到/多路径/删除路径 |
| `services/GameLoader.ts` | 686 | 导入流程/Manifest 验证/文件复制/版本管理/磁盘扫描同步 |
| `services/GameManager.ts` | 383 | 4 种启动模式/spawn/BrowserWindow/serve/url, 进程生命周期, API 中继 |
| `services/GameApiServer.ts` | 443 | WS 服务/认证/10 个 action/事件推送/自动关机 (60s 无客户端) |
| `services/GameEnvironment.ts` | 59 | 环境变量 + bz-config.js (window.BZ_CONFIG) |
| `services/RoomServer.ts` | 495 | WS 服务/join 校验/消息路由/踢人/心跳/解散/中继 |
| `services/RoomClient.ts` | 299 | WS 客户端/连接/重连(5次,递增退避)/消息转发/生命周期 |
| `services/UpdateService.ts` | 229 | electron-updater 封装/快照/状态机 |
| `services/NotificationService.ts` | 109 | 成就通知浮窗, Queue + 5s 自动关闭 |
| `utils/appPath.ts` | 34 | getAppRoot/getGamesDir/setCustomGamesDir |
| `utils/fileUtils.ts` | 24 | copyFolderRecursiveSync (手动递归, 避免 fs.cpSync 编码问题) |
| `utils/portUtils.ts` | 20 | findAvailablePort (递增探测) |
| `utils/pathValidator.ts` | 6 | isSafePath (目录穿越防护) |
| `utils/logger.ts` | 5 | console.log/warn/error 封装 |

#### Preload `src/preload/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | 3 | 仅 import api.ts |
| `api.ts` | 156 | contextBridge 暴露 window.electronAPI: game/room/settings/user 4 个命名空间 |
| `game.ts` | 192 | Web 游戏 localStorage 接管: class GameStorage → Object.defineProperty |

#### 渲染进程 `src/renderer/src/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `main.ts` | 14 | Vue app 创建, Pinia/Router/NaiveUI/i18n 注册 |
| `AppContent.vue` | 224 | 全局布局: 头像/BZ币/导航/更新弹层/签到弹层/成就通知 |
| `stores/useGameStore.ts` | 187 | 游戏列表/运行状态/成就事件/排序优化更新 |
| `stores/useRoomStore.ts` | 194 | 房间状态/聊天/准备/开始冷却(5s)/系统消息 |
| `stores/useSettingsStore.ts` | 141 | 设置/用户数据/更新状态/自动检查更新 |
| `views/LibraryView.vue` | ~300+ | 游戏库/拖拽导入/长按排序/补录表单(完整17字段) |
| `views/GameDetailView.vue` | 363 | 详情/版本切换/4种类型按钮/创建/加入房间/删除/收藏动画 |
| `views/RoomView.vue` | ~210 | 房间内: 玩家列表/聊天/准备/开始/踢人确认 |
| `views/SettingsView.vue` | ~300+ | 设置表单/路径管理/更新检查 |
| `views/StatisticsView.vue` | ~200+ | 统计卡片/版本切换/搜索/时长格式化 |
| `views/AchievementsView.vue` | ~200+ | 成就列表/展开收起/进度条/搜索/金色100%卡片 |
| `components/game/GameCard.vue` | 45 | 卡片: 16:9 封面 + 爱心收藏 |
| `components/game/GameCover.vue` | 48 | 封面/视频自动播放/视频结束后回退封面 |
| `components/game/GameIcon.vue` | 25 | 图标加载/回退首字母 |
| `components/game/GameAchievementsModal.vue` | 50 | 成就弹窗 |
| `components/game/GameDeleteModal.vue` | - | 版本多选删除 |
| `components/room/PlayerCard.vue` | 50 | 玩家卡片: 头像/名称/准备标签/踢人按钮 |
| `components/room/PlayerList.vue` | 35 | 玩家列表容器 |
| `components/room/RoomChat.vue` | ~180+ | 聊天: 文本/语音(Mic 按钮, MediaRecorder, 10s 限制) |
| `components/CheckInModal.vue` | ~100+ | 签到: 7天卡片/BZ币/连击 |

#### 共享代码 `src/shared/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `ipc-channels.ts` | 60 | 32 个 IPC 频道常量 (`as const`) |
| `game-manifest.ts` | 71 | Zod Schema: 17 个字段 + superRefine (url 时 web_url 必填) |
| `types/game.types.ts` | 41 | GameApi 类型: 10 个 action + 4 个 event |
| `types/room.types.ts` | 90 | 房间协议: 17 种 MessageType + 7 个 interface |
| `types/store.types.ts` | 53 | 存储模型: AppStore/GameRecord/GameVersion/AppSettings/UserData |

---

## 第二部分：当前架构的优势与问题

### 优势（已实现的设计）

1. **便携式存储**: `config.json` + `games/` 全部在应用根目录，支持 U 盘携带
2. **加密安全**: config 默认 AES-256-GCM 加密，Web 游戏存储可选加密
3. **磁盘自愈**: 启动时扫描磁盘同步 records，自动发现新版本、清理失效记录
4. **更新快照**: 更新前自动备份数据，启动时自动恢复
5. **多种游戏类型**: exe/bat/html/serve/url 四种启动模式统一管理
6. **完整联机栈**: RoomServer + RoomClient + GameApiServer 三层 WS
7. **消息中继**: 平台负责所有联机通信，游戏零网络代码
8. **重连机制**: RoomClient 5 次递增退避重连
9. **国际化**: zh-CN/en-US/ja-JP 三语完整覆盖

### 当前存在的问题（基于源码分析）

1. **GameApiServer 无优雅退出通知**: 进程 crash 时游戏不知情
2. **RoomServer 无持久化**: 房主崩溃后房间状态完全丢失，客机无法感知
3. **重连无状态指示**: UI 不显示"正在重连中"
4. **统计界面 Manifest 缓存无上限**: 切换版本累积 manifestCache 不过期
5. **游戏库无虚拟滚动**: 游戏数量大时性能下降
6. **更新错误信息不够细化**: 仅显示原始错误消息
7. **无配置健康检查**: 无法自检 `config.json` / `games/` 完整性
8. **RoomClient 连接超时写死 15s**: 网络差场景可能不够
9. **签到使用系统时间**: 可被修改系统时间绕过
10. **房间模板不可配置**: maxPlayers 仅来自 Manifest, 不开放房主自定义

---

## 第三部分：执行路线图

### 执行原则

- 每次只做一个任务编号，做完再做下一个
- 必须同时满足: 代码改动 + 验收通过 + 回滚可行
- 优先级: P0 > P1 > P2
- 版本节奏: v1.9.4 → v1.10.0 → v2.0.0

### v1.10.0: 稳定性与质量 (A 组, 8 个任务)

#### A-01: 数据健康检查入口

- **优先级**: P0
- **目标**: 设置页增加"数据自检"按钮，检查 config.json/games/ 完整性
- **涉及文件**:
  - `src/main/services/StoreService.ts` — 增加 `healthCheck()` 方法
  - `src/main/ipc/system.ipc.ts` — 暴露 `system:dataHealthCheck`
  - `src/shared/ipc-channels.ts` — 新增频道
  - `src/preload/api.ts` — 暴露给渲染进程
  - `src/renderer/src/views/SettingsView.vue` — 增加按钮和结果展示
  - `src/renderer/src/locales/*.ts` — 三语文案
- **检查项**:
  1. `config.json` 是否存在且可解密
  2. `games/` 目录是否存在
  3. 每个 GameRecord 的 version.path 是否存在对应的 `game.json`
  4. `playerId` 是否已生成
  5. 统计各存储根目录的游戏/版本数量
- **验收**: 点击后得到结构化结果（通过/警告/失败），失败项有明确错误原因

#### A-02: RoomClient 重连状态机

- **优先级**: P0
- **目标**: 房间页显示连接状态，重连时有视觉反馈
- **涉及文件**:
  - `src/main/services/RoomClient.ts` — 增加状态枚举和状态变更回调
  - `src/shared/types/room.types.ts` — 增加 `ConnectionStatus` 类型
  - `src/renderer/src/stores/useRoomStore.ts` — 接收连接状态
  - `src/renderer/src/views/RoomView.vue` — UI 显示连接状态
  - `src/renderer/src/locales/*.ts` — 连接状态文案
- **状态**: `connected` / `connecting` / `reconnecting` / `disconnected` / `failed`
- **验收**: 断网后显示"重新连接中 (1/5)...", 恢复后自动回到正常

#### A-03: 更新错误码与诊断

- **优先级**: P1
- **目标**: 更新失败时显示可读的中文/英文/日文错误原因
- **涉及文件**:
  - `src/main/services/UpdateService.ts` — 错误码映射
  - `src/renderer/src/stores/useSettingsStore.ts` — 传递错误码
  - `src/renderer/src/AppContent.vue` — 显示诊断信息
  - `src/renderer/src/locales/*.ts` — 错误码文案
- **错误码**: `NETWORK_ERROR` / `DOWNLOAD_FAILED` / `VERIFY_FAILED` / `NOT_PACKAGED` / `UNKNOWN`
- **验收**: 更新失败不再出现空提示或原始英文错误

#### A-04: 游戏进程异常分级

- **优先级**: P1
- **目标**: 按退出码分类，日志输出统一结构
- **涉及文件**:
  - `src/main/services/GameManager.ts` — `handleProcessExit` 增强
  - `src/main/utils/logger.ts` — 无需改动（已有统一接口）
- **分类**:
  - 正常退出: code === 0 或 null
  - 可重试异常: code === 1
  - 严重异常: code < 0 (信号终止) 或其他
- **日志字段**: `{ gameId, version, exitCode, duration, signal, stage }`
- **验收**: 异常退出日志可直接定位到游戏与阶段

#### A-05: 配置/路径问题可视化提示

- **优先级**: P1
- **目标**: 依赖 A-01 的结果，对高风险项给出可理解的 UI 提示
- **涉及文件**:
  - `src/renderer/src/views/SettingsView.vue` — 健康检查结果展示
  - `src/renderer/src/locales/*.ts` — 提示文案
- **验收**: 用户能在设置页看到明确的问题描述和处理建议

#### A-06: 房间结束后状态一致性

- **优先级**: P1
- **目标**: 统一 `room:game:end` 后清理顺序，防止 UI 状态残留
- **涉及文件**:
  - `src/main/services/GameManager.ts` — `notifyRoomGameEnd` 增强
  - `src/main/services/RoomServer.ts` — 确保 broadcast 在 state 变更后
  - `src/renderer/src/stores/useRoomStore.ts` — 处理 room:game:end 后的状态重置
- **验收**: 多人房间结束后所有端状态一致，Host 的"开始游戏"按钮正确进入 5s 冷却

#### A-07: i18n 键完整性检查

- **优先级**: P2
- **目标**: 确保三语文件无遗漏键
- **涉及文件**:
  - `src/renderer/src/locales/zh-CN.ts`
  - `src/renderer/src/locales/en-US.ts`
  - `src/renderer/src/locales/ja-JP.ts`
- **方案**: 增加构建时检查脚本（`scripts/check-i18n.ts`），对比三语 key 集合
- **验收**: 构建时如果发现缺失键会报 warning

#### A-08: v1.10.0 收口

- **优先级**: P0
- **内容**: 回归测试 + 类型检查 + lint + 发布
- **验收**: 所有核心流程（导入/启动/建房/加房/重连/聊天/签到/更新检查）可稳定通过

---

### v2.0.0: 联机体验增强 (B 组, 7 个任务)

#### B-01: 房间模板参数

- **优先级**: P0
- **目标**: 创建房间时支持自定义参数
- **涉及文件**:
  - `src/shared/types/room.types.ts` — `RoomTemplate` 类型
  - `src/main/services/RoomServer.ts` — 应用模板参数
  - `src/main/ipc/room.ipc.ts` — `room:create` 增加参数
  - `src/preload/api.ts` — 更新类型
  - `src/renderer/src/views/RoomView.vue` — 创建房间配置面板
  - `src/renderer/src/locales/*.ts` — 文案
- **参数**: `maxPlayers` (3-64, 默认 4), `password` (可选), `allowMidJoin` (是否允许中途加入)
- **验收**: 参数在创建时生效，错误提示准确

#### B-02: 消息 ACK 与超时重发

- **优先级**: P1
- **目标**: 关键消息引入 messageId + ACK 回执机制
- **涉及文件**:
  - `src/shared/types/room.types.ts` — ACK 消息类型
  - `src/main/services/RoomClient.ts` — ACK 等待与超时重发
  - `src/main/services/RoomServer.ts` — 发送 ACK 回执
- **验收**: 抖动网络下消息不丢失

#### B-03: 频控与限流

- **优先级**: P1
- **目标**: 对聊天和中继消息进行频率控制
- **涉及文件**:
  - `src/main/services/RoomServer.ts` — 玩家限流器
- **策略**: 每玩家每秒最多 5 条消息，触发后 5s 冷却
- **验收**: 单客户端刷消息不影响全房稳定

#### B-04: 网络质量状态显示

- **优先级**: P2
- **目标**: 房间页显示网络延迟等级
- **涉及文件**:
  - `src/renderer/src/stores/useRoomStore.ts` — 网络质量状态
  - `src/renderer/src/views/RoomView.vue` — UI 指示器
  - `src/renderer/src/locales/*.ts` — 文案
- **指标**: 基于心跳 RTT 显示 良好/一般/较差
- **验收**: 房间页可实时看到网络质量变化

#### B-05: 房间大厅/快速匹配（可选, P2）

- **说明**: 仅当有切实需求时实施，当前为预留

#### B-06: IPC/Preload 收口

- **优先级**: P0
- **目标**: 补全新增能力的所有 IPC 暴露与类型声明
- **涉及文件**: `src/shared/ipc-channels.ts`, `src/preload/api.ts`, `src/renderer/src/types/electron-api.d.ts`
- **验收**: 前后端调用字段一致，TypeScript 无隐式 any

#### B-07: v2.0.0 收口

- **优先级**: P0
- **内容**: 回归: 建房/加房/重连/开始/结束/聊天/中继/踢人/解散

---

### 未来: 开发者生态 (C 组, 5 个任务)

#### C-01: SDK 最小可用能力定义

- **目标**: 确定首批稳定的 Game API action 并写死协议版本
- **涉及文件**: `src/main/services/GameApiServer.ts`, `src/shared/types/game.types.ts`

#### C-02: 协议版本协商

- **目标**: Game API 增加版本字段，服务端可降级处理

#### C-03: Manifest 体检工具

- **目标**: 导入阶段输出结构化体检报告（错误/警告/建议）

#### C-04: 游戏库虚拟滚动

- **优先级**: P1
- **目标**: 大量游戏时保持流畅
- **涉及文件**: `src/renderer/src/views/LibraryView.vue`

#### C-05: 详情页资源分阶段加载

- **目标**: 视频/封面优先加载封面，视频按需加载

---

## 第四部分：每次任务执行模板

```
任务编号: X-01
目标行为: 一句话描述用户可见的结果
改动文件: 列出绝对路径
实现步骤: 3-6 条
验收: 手工步骤 + 必跑命令
风险点: 可能影响的旧流程
回滚方案: 如何快速撤回
```

## 第五部分：必跑校验命令

```bash
pnpm run typecheck    # typecheck:node && typecheck:web
pnpm run lint         # eslint --fix
```

## 第六部分：部署与发布

- 更新源: GitHub Releases (baozha2023/bz-games)
- 发布前: 提升 `package.json` version, 创建对应 Tag
- 构建: `pnpm run build:win` 生成 NSIS 安装包
- 资产: `BZ-Games-Setup-x.x.x.exe` + `latest.yml` + `*.blockmap`
- 更新仅在生产环境 (app.isPackaged) 生效
