# CLAUDE.md — BZ-Games 游戏平台开发文档

> 本文档为 AI 辅助开发的上下文文件，描述项目的完整架构、规范与约定。
> 所有开发工作应严格遵循本文档中定义的结构与规范。

***

## 一、项目概述

### 平台简介

**BZ-Games** 是一个**无服务器本地游戏平台**，类似于 Steam / Epic Games Store，
基于 **Vue 3 + TypeScript + Electron** 构建，**仅支持 Windows 10/11（x64）**。

### 核心设计原则

| 原则             | 说明                                                |
| -------------- | ------------------------------------------------- |
| **无服务器**       | 所有数据存储于本地，无需后端服务器，无需用户注册账号                        |
| **便携式存储**      | 配置默认存储在应用根目录，游戏可存放在默认目录或用户维护的多路径目录中               |
| **开放式游戏管理**    | 用户可将符合平台规范的游戏载入平台，平台会自动复制并管理游戏文件                  |
| **统一联机基础设施**   | 平台提供完整的联机房间管理与消息通讯能力，游戏开发者无需自行实现网络层               |
| **内网穿透工具无关**   | 联机依赖用户自行安装的内网穿透工具（如 SakuraFrp），平台通过标准端口对接，不绑定特定工具 |
| **仅限 Windows** | 不考虑 macOS / Linux 兼容性                             |

### 平台核心功能

- 游戏库管理（导入、删除、排序、收藏、封面/图标展示）
- 游戏启动与进程生命周期管理（主进程统一托管）
- 联机房间系统（创建、加入、准备、开始、离开、聊天、踢人、解散同步）
- 国际化（`zh-CN / en-US / ja-JP`）
- 成就系统（列表、解锁、系统通知、红点提示）
- 统计系统（支持增量/全量统计模式，游玩时长自动累计）
- 经济系统（签到、BZ 币、累计游玩时长）
- Game API Server（本地 `ws://127.0.0.1`，向游戏进程提供平台能力）
- 系统设置（玩家信息、主题、端口、语言、更新、游戏保存路径）

***

## 二、技术栈

| 分类           | 技术 / 库                      | 备注                         |
| ------------ | --------------------------- | -------------------------- |
| 桌面框架         | Electron                    | <br />                     |
| 前端框架         | Vue 3                       | <br />                     |
| 开发语言         | TypeScript（严格模式）            | <br />                     |
| UI 组件库       | Naive UI                    | <br />                     |
| 状态管理         | Pinia                       | <br />                     |
| 构建工具         | electron-vite               | <br />                     |
| 打包工具         | electron-builder            | <br />                     |
| 包管理器         | pnpm                        | <br />                     |
| 进程间通信        | Electron IPC（contextBridge） | <br />                     |
| 本地数据存储       | electron-store              | v10+ (ESM)，需在构建中配置 include |
| 客户端更新        | electron-updater            | GitHub Releases 作为更新源      |
| WebSocket 服务 | ws                          | <br />                     |
| 版本比较         | semver                      | 用于平台版本与游戏版本兼容性检查           |
| 目标平台         | Windows 10/11 x64           | <br />                     |

***

## 三、项目目录结构

```
bz-games/
├── CLAUDE.md                             # AI 开发上下文与项目规范文档
├── README.md                             # 项目简介与基础使用说明
├── DEVELOPER_GUIDE.md                    # 面向游戏接入方的开发接入指南
├── package.json                          # 依赖、脚本与打包发布配置
├── pnpm-lock.yaml                        # pnpm 依赖锁定文件
├── tsconfig.json                         # TypeScript 根配置
├── tsconfig.node.json                    # 主进程/预加载/共享代码 TS 配置
├── tsconfig.web.json                     # 渲染进程 TS 配置
├── electron.vite.config.ts               # Electron-Vite 构建配置
├── config.json                           # 本地持久化配置（运行生成）
├── games/                                # 默认游戏目录（运行生成）
│   └── <id>/
│       └── <version>/
│
├── src/
│   ├── main/                              # Electron 主进程
│   │   ├── index.ts                       # 主进程入口与应用生命周期初始化
│   │   ├── window.ts                      # 主窗口创建与管理
│   │   ├── ipc/
│   │   │   ├── index.ts                   # IPC 统一注册入口
│   │   │   ├── game.ipc.ts                # 游戏相关 IPC 处理器
│   │   │   ├── room.ipc.ts                # 房间相关 IPC 处理器
│   │   │   ├── system.ipc.ts              # 设置/系统/更新 IPC 处理器
│   │   │   └── storage.ipc.ts             # Web 游戏本地存储 IPC 处理器
│   │   ├── services/
│   │   │   ├── GameApiServer.ts           # 游戏进程本地 WebSocket API 服务
│   │   │   ├── GameEnvironment.ts         # 游戏启动环境变量与 bz-config.js 生成
│   │   │   ├── GameLoader.ts              # 游戏导入、校验、扫描与记录同步
│   │   │   ├── GameManager.ts             # 游戏进程启动/停止与生命周期管理
│   │   │   ├── NotificationService.ts     # 系统通知窗口服务
│   │   │   ├── RoomClient.ts              # 客机房间连接与重连管理
│   │   │   ├── RoomServer.ts              # 房主房间服务与消息中继
│   │   │   ├── StoreService.ts            # 本地数据读写与业务数据维护
│   │   │   └── UpdateService.ts           # 客户端更新检查/下载/安装服务
│   │   └── utils/
│   │       ├── appPath.ts                 # 应用根路径与游戏目录路径工具
│   │       ├── fileUtils.ts               # 文件复制等通用文件工具
│   │       ├── logger.ts                  # 日志输出封装
│   │       ├── pathValidator.ts           # 路径安全校验工具
│   │       └── portUtils.ts               # 可用端口探测工具
│   │
│   ├── preload/
│   │   ├── api.ts                         # 暴露给渲染进程的安全 API
│   │   ├── game.ts                        # Web 游戏 localStorage 接管
│   │   └── index.ts                       # Preload 入口
│   │
│   ├── renderer/
│   │   ├── index.html                     # 渲染进程 HTML 入口
│   │   └── src/
│   │       ├── App.vue                    # 根组件外壳
│   │       ├── AppContent.vue             # 主界面布局与全局行为
│   │       ├── i18n.ts                    # 国际化初始化与语言切换
│   │       ├── main.ts                    # 渲染进程启动入口
│   │       ├── router/
│   │       │   └── index.ts               # 路由配置
│   │       ├── stores/
│   │       │   ├── useGameStore.ts        # 游戏库状态管理
│   │       │   ├── useRoomStore.ts        # 房间状态管理
│   │       │   └── useSettingsStore.ts    # 设置与更新状态管理
│   │       ├── views/
│   │       │   ├── AchievementsView.vue   # 成就页面
│   │       │   ├── GameDetailView.vue     # 游戏详情页面
│   │       │   ├── LibraryView.vue        # 游戏库首页
│   │       │   ├── NotificationView.vue   # 通知窗口页面
│   │       │   ├── RoomView.vue           # 房间页面
│   │       │   ├── SettingsView.vue       # 设置页面
│   │       │   └── StatisticsView.vue     # 统计页面
│   │       ├── components/
│   │       │   ├── game/
│   │       │   │   ├── GameAchievementsModal.vue # 游戏成就弹窗组件
│   │       │   │   ├── GameCard.vue        # 游戏卡片组件
│   │       │   │   ├── GameCover.vue       # 游戏封面组件
│   │       │   │   ├── GameDeleteModal.vue # 游戏删除弹窗组件
│   │       │   │   └── GameIcon.vue        # 游戏图标组件
│   │       │   └── room/
│   │       │       ├── PlayerCard.vue      # 房间玩家卡片组件
│   │       │       ├── PlayerList.vue      # 房间玩家列表组件
│   │       │       └── RoomChat.vue        # 房间聊天组件
│   │       ├── locales/
│   │       │   ├── en-US.ts                # 英文文案
│   │       │   ├── ja-JP.ts                # 日文文案
│   │       │   └── zh-CN.ts                # 中文文案
│   │       ├── types/
│   │       │   └── electron-api.d.ts       # window.electronAPI 类型声明
│   │       └── utils/
│   │           ├── achievementNotifier.ts  # 成就通知辅助逻辑
│   │           └── sound.ts                # 音效播放工具
│   │
│   └── shared/
│       ├── game-manifest.ts                # Game Manifest Schema 与类型
│       ├── ipc-channels.ts                 # IPC 频道常量定义
│       └── types/
│           ├── game.types.ts               # Game API 消息类型
│           ├── index.ts                    # 共享类型聚合导出
│           ├── room.types.ts               # 房间协议与房间模型类型
│           └── store.types.ts              # 本地存储模型类型
│
├── resources/
│   └── icon.png                            # 应用图标资源
```

***

## 四、核心概念与术语

| 术语                       | 说明                                                                             |
| ------------------------ | ------------------------------------------------------------------------------ |
| **游戏清单 (Game Manifest)** | `game.json` 文件，描述游戏元信息与平台集成配置                                                  |
| **游戏库 (Library)**        | 用户已载入平台的所有游戏集合，来源于本地默认目录与已记录的多游戏路径                                |
| **房间 (Room)**            | 一次联机会话，包含房主与所有玩家的状态                                                            |
| **房主 (Host)**            | 创建房间的玩家，其平台负责运行 Room Server                                                    |
| **玩家 (Player)**          | 加入房间的用户（含房主自身）                                                                 |
| **Room Server**          | 房主平台运行的 WebSocket 服务器，经内网穿透工具对外暴露                                              |
| **Room Client**          | 非房主玩家的平台连接 Room Server 的 WebSocket 客户端                                         |
| **Game API Server**      | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力                               |
| **bz-config.js**         | 平台在游戏启动前生成的配置文件（包含端口、Token、玩家信息、房间 ID、`isHost` 与 `isMultiple`），解决进程环境变量传递不可靠问题 |
| **内网穿透**                 | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                                   |
| **平台 SDK**               | 未来提供的 npm 包（`bz-launcher-sdk`），封装 Game API Server 调用，供游戏开发者使用                  |

### 4.1 Game Manifest 规范

- **统计信息国际化**：`statistics` 字段支持键值对格式（`[{ "key": "Display Name" }]`），用于在平台统计界面显示本地化的统计项名称。
- **时间追踪优化**：平台会自动追踪并记录所有游戏的游玩时长（`time`），无需在 `statistics` 字段中显式定义。若定义了 `time`，平台也会正常处理。
- **详情媒体扩展**：`video` 字段为可选项，指向游戏目录内预览视频（`mp4/webm/ogv/mov/m4v`），仅用于详情页展示。
- **本地存储加密开关**：`encryptLocalStorage` 为可选布尔字段，仅作用于 Web 游戏 `localStorage` 对应的 `gamedata.json` 持久化。
- **游戏类型扩展**：`type` 支持 `singleplayer`、`multiplayer`、`singlemultiple`，其中 `singlemultiple` 代表同时支持单人与联机。

***

## 五、架构设计

### 5.1 整体架构图

```
╔══════════════════════════════════════════════════════════════════╗
║                         HOST 主机                                ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │                    Electron 平台进程                        │ ║
║  │                                                            │  ║
║  │  ┌─────────────┐    IPC     ┌─────────────────────────┐   │  ║
║  │  │  渲染进程    │◄─────────►│       主进程             │   │  ║
║  │  │  (Vue UI)   │            │                         │   │  ║
║  │  │  - 游戏库   │            │  ┌─────────────────────┐│   │  ║
║  │  │  - 房间管理 │            │  │    GameManager      ││   │  ║
║  │  │  - 设置     │            │  │    (进程管理)        ││   │  ║
║  │  └─────────────┘            │  ├─────────────────────┤│   │  ║
║  │                             │  │    RoomServer       ││   │  ║
║  │                             │  │ ws://0.0.0.0:38080  │├───┼──╫──► SakuraFrp
║  │                             │  ├─────────────────────┤│   │  ║    公网暴露
║  │                             │  │   GameApiServer     ││   │  ║
║  │                             │  │ ws://127.0.0.1:*    ││   │  ║
║  │                             │  └──────────┬──────────┘│   │  ║
║  │                             └─────────────┼───────────┘   │  ║
║  └─────────────────────────────────────────── ┼ ─────────────┘  ║
║                                               │ localhost        ║
║  ┌────────────────────────────────────────────┴──────────────┐   ║
║  │                   游戏进程 (game.exe)                      │  ║
║  │   ws://127.0.0.1:{BZ_API_PORT}                            │   ║
║  │   通过 Game API Server 进行所有联机通信                     │  ║
║  └───────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
                              ▲
                    SakuraFrp 公网地址
                    60.26.220.79:39337
                              ▼
╔══════════════════════════════════════════════════════════════════╗
║                      CLIENT 客机（可多个）                        ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │                    Electron 平台进程                       │   ║
║  │                                                           │   ║
║  │  ┌─────────────┐    IPC     ┌─────────────────────────┐   │   ║
║  │  │  渲染进程    │◄─────────►│       主进程             │   │   ║
║  │  │  - 房间页    │            │  ┌─────────────────────┐│   │  ║
║  │  │  - 设置页    │            │  │    RoomClient       ││   │  ║
║  │  │  - 游戏详情  │            │  │   连接至房主公网地址 ││   │   ║
║  │  └─────────────┘            │  ├─────────────────────┤│   │   ║
║  │                             │  │   GameApiServer     ││   │   ║
║  │                             │  │   (状态同步缓存)     ││   │   ║
║  │                             │  └──────────┬──────────┘│   │   ║
║  │                             └─────────────┼───────────┘   │   ║
║  └────────────────────────────────────────── ┼ ─────────────┘   ║
║                                              │ localhost        ║
║  ┌───────────────────────────────────────────┴──────────────┐   ║
║  │                   游戏进程 (game.exe)                      │  ║
║  └────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 5.2 Electron 进程职责

#### 主进程 (Main Process)

- BrowserWindow 生命周期管理
- 读写本地存储（electron-store），**配置与数据均存储于应用根目录**
- 调用系统 API（文件对话框、环境变量、子进程）
- 游戏进程启动 / 管理 / 终止（`child_process.spawn`，支持 Windows 隐藏窗口）
- 运行 Room Server（Host 时）/ Room Client（Client 时）
- 运行 Game API Server（每次有游戏运行时）
- 注册并处理所有 IPC Handler
- 广播游戏进程生命周期事件（start/end）
- 更新检查、下载、安装由 `UpdateService` 统一处理

#### 渲染进程 (Renderer Process)

- Vue 3 + TypeScript UI，仅负责界面展示与交互
- 通过 `window.electronAPI` 调用主进程功能（严禁直接使用 Node.js API，所有文件操作与系统调用必须通过 IPC）
- 使用 Pinia 管理前端状态（GameStore, RoomStore）
- 监听并响应房间事件和游戏进程事件

#### 预加载脚本 (Preload)

- 通过 `contextBridge.exposeInMainWorld` 安全暴露有限 API 给渲染进程
- 所有渲染进程 → 主进程的通信必须经过此层

### 5.3 本地数据存储结构

使用 `electron-store`，数据存储于应用根目录下的`config.json`（便携模式）：

- **配置加密存储**：`config.json` 以加密格式持久化，启动时识别旧版明文配置并自动迁移为加密格式。

```typescript
// src/shared/types/store.types.ts
interface UserData {
  bzCoins: number;
  cumulativePlayTime: number;
  checkIn: {
    lastCheckInDate: string;
    consecutiveDays: number;
  };
}

interface AppStore {
  games: GameRecord[];
  settings: AppSettings;
  userData: UserData;
  recentPlayed: string[];
}

interface UnlockedAchievement {
  id: string;
  unlockedAt: number;
}

interface GameVersion {
  version: string;
  path: string;
  addedAt: number;
  stats: Record<string, number>;
  unlockedAchievements: UnlockedAchievement[];
  playtime: number;
}

interface GameRecord {
  id: string;
  versions: GameVersion[];
  latestVersion: string;
  addedAt: number;
  lastPlayedAt?: number;
  isFavorite?: boolean;
}

interface AppSettings {
  playerName: string;
  playerId: string;
  avatar?: string;
  lastJoinRoomAddress?: string;
  language: "zh-CN" | "en-US" | "ja-JP";
  theme: "dark" | "light";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  ignoredUpdateVersion?: string;
  gameStoragePath?: string;
  gameStorageHistory?: string[];
}
```

### 5.4 Web 游戏运行与存储隔离

- **Web 游戏隔离**：Web 游戏启动时使用 `persist:game_<id>_<version>` 分区，实现版本间的数据隔离（Cookie/LocalStorage）。
- **Web 游戏存储接管**：通过 Preload 脚本接管 `localStorage`，将数据重定向存储至 `games/<id>/<version>/gamedata.json`，实现跨启动模式（File/Serve）的数据互通与版本隔离。
- **Web 存储可选加密**：支持通过 Manifest 字段 `encryptLocalStorage` 控制 `gamedata.json` 是否加密存储（默认关闭）。
- **Web 联机模式标记**：平台生成的 `bz-config.js` 提供 `isMultiple` 字段，便于 `singlemultiple` 游戏在运行时区分单人模式与联机模式。

### 5.5 代码组织与内聚性

- **模块化**：复杂逻辑（如 `GameLoader.loadGameFromDialog`）拆分为独立函数（`validateManifestFile`, `checkPlatformVersion`, `checkEntryFile` 等），提升可读性与可维护性。
- **环境配置抽离**：游戏环境变量准备与 `bz-config.js` 生成逻辑由 `GameEnvironment` 统一处理，提高 `GameManager` 的内聚性。

***

## 六、开发规范与约束

### 6.1 游戏导入规范

- **任意文件夹导入**：`GameLoader` 支持任意目录导入。若目录缺少 `game.json`，前端需弹出补录表单，由用户填写核心字段后生成 Manifest 并继续导入。
- **文件选择策略**：Windows 下文件选择对话框使用 `openDirectory` 模式。
- **版本检查**：导入时会检查 `game.json` 中的 `platformVersion` 字段，若当前平台版本不满足要求（使用 `semver` 比较），将拒绝导入并提示用户。
- **拖拽路径解析统一**：游戏库拖拽导入路径统一使用 `webUtils.getPathForFile(file)` 获取。
- **表单约束**：
  - `id` 需实时检测重复并校验反向域名格式。
  - `platformVersion` 固定为当前平台版本，不允许修改。
  - `type` 使用下拉框；仅当 `type !== singleplayer` 时展示 `minPlayers/maxPlayers`。
  - `version` 必须通过语义化版本校验（`x.y.z`）。
  - `entry` 会自动探测并允许用户手动修改；提交时要求为相对路径、不得为绝对路径、不得包含 `..`。
  - `icon/cover` 若填写则必须是游戏目录内存在的相对路径。

### 6.2 IPC 接口清单

- `game:load`：导入游戏（支持弹窗选目录或传入目录路径）。
- `game:prepareImport`：导入前预检查目录并返回建议草稿信息。
- `game:loadWithManifest`：使用补录表单生成 Manifest 并导入。
- `game:checkIdExists`：校验游戏 ID 是否已存在。
- `game:getAll`：获取用于展示的完整游戏列表数据。
- `game:getRecords`：获取原始游戏记录（版本路径等）。
- `game:getManifest`：读取指定游戏版本的 `game.json`。
- `game:getVideo`：读取指定版本视频并返回 Data URL。
- `game:getCover`：读取指定版本封面并返回 Data URL。
- `game:getIcon`：读取指定版本图标并返回 Data URL。
- `game:getVersions`：获取指定游戏的版本列表。
- `game:reorder`：保存游戏库排序结果。
- `game:toggleFavorite`：切换游戏收藏状态。
- `game:remove`：删除指定游戏或指定版本。
- `game:launch`：启动指定游戏版本。
- `room:create`：创建房间并在本地启动房间服务。
- `room:join`：加入指定房主地址的房间。
- `room:leave`：离开房间（房主离开会解散房间）。
- `room:ready`：标记当前玩家为已准备。
- `room:unready`：取消当前玩家准备状态。
- `room:start`：由房主触发房间开始游戏。
- `room:setAddress`：设置并广播房主公网地址。
- `room:getState`：获取当前房间状态快照。
- `room:sendChat`：发送文本或语音聊天消息。
- `room:kickPlayer`：房主踢出指定玩家。
- `system:getSettings`：读取当前应用设置。
- `system:saveSettings`：保存应用设置并应用相关系统行为。
- `system:uploadAvatar`：选择并处理玩家头像。
- `system:selectGameStoragePath`：弹窗选择默认游戏保存路径。
- `system:openPath`：在系统文件管理器中打开路径。
- `system:removeGameStoragePath`：删除保存路径及其内部已导入游戏数据。
- `system:getUserData`：读取用户经济与签到数据。
- `system:checkIn`：执行每日签到并返回奖励结果。
- `system:getUpdateStatus`：获取当前更新状态。
- `system:checkUpdate`：检查是否有可用更新。
- `system:downloadUpdate`：下载可用更新包。
- `system:installUpdate`：安装更新并重启。
- `room:event`：主进程推送房间事件给渲染层。
- `game:process:started`：推送游戏进程启动事件。
- `game:process:ended`：推送游戏进程结束事件。
- `game:launch:failed`：推送游戏启动失败事件。
- `system:update:event`：推送更新状态变化事件。
- `game:unlockAchievement`：推送成就解锁事件到渲染层。
- `game:storage:init`：初始化 Web 游戏本地存储数据。
- `game:storage:save`：保存单个 localStorage 键值。
- `game:storage:remove`：删除单个 localStorage 键。
- `game:storage:clear`：清空当前游戏版本 localStorage 数据。

### 6.3 UI 交互规范

- **返回导航**：所有二级页面（设置、统计、成就等）的 `n-page-header` 必须包含返回按钮，统一导航回 `Library` 页面。
- **成就展示**：成就列表支持按游戏版本筛选，支持展开/收起，默认收起。若当前版本无成就，显示空列表。
- **动态元数据**：游戏详情页切换版本时，应优先展示当前选中版本的元数据（如简介、成就），若为空则直接展示为空，不应回退到最新版本数据。
- **游戏库展示**：
  - 游戏封面展示区域统一使用 **16:9** 比例，图片模式为 `contain`（完整显示）或 `cover`（填满）。
  - 支持 **长按** 游戏封面进入编辑模式，此时可拖动调整游戏排序。
  - 支持将任意游戏文件夹直接拖拽到游戏库窗口导入；缺少 `game.json` 时弹出补录表单。
  - 排序结果需持久化存储。
  - 聊天消息：当前用户发送的消息，名字显示为绿色（#18a058）。
  - 收藏游戏：特别喜欢的游戏在封面右上角展示爱心图标。
- **游戏详情页**：
  - 删除游戏功能升级为模态框，支持多选版本进行删除，默认选中当前版本。
  - 若 Manifest 配置了 `video` 字段，详情页进入后自动播放预览视频；视频结束后自动回退显示封面。
- **加入房间地址**：加入房间输入框需要回填最近一次成功地址（持久化于设置），减少重复输入。
- **统计/成就搜索**：右上角默认展示搜索图标，点击后展开输入框并支持按游戏名或游戏 ID 模糊搜索。
- **房间开始按钮冷却**：房间内收到 `room:game:end` 后，Host 的「开始游戏」按钮需禁用 5 秒。
- **统计界面**：卡片右上角需展示该游戏的所有版本号，使用自动换行布局。
- **设置页更新入口**：设置页需提供「检查更新」按钮，点击后弹出更新状态弹层，显示下载进度与安装按钮。
- **设置页游戏目录管理**：
  - 支持维护多游戏保存路径（路径池）。
  - 当前选择路径仅影响后续新导入游戏，不改动已导入游戏所在目录。
  - 支持展示“当前 + 历史”路径列表、打开路径、删除路径。
  - 删除路径时会删除该路径目录及其已导入游戏数据，并更新本地记录。
- **房间管理增强**：
  - Host 可在玩家列表中踢人，被踢玩家收到弹窗并自动离开房间。
  - 被踢玩家在同一房间生命周期内禁止重新加入。
  - 房主解散房间后，所有客户端需稳定收到 `room:disbanded` 并退出房间页。
- **成就弹窗版本一致性**：成就弹窗读取 Manifest 时必须使用当前运行版本，避免出现“有音效但无弹窗”。
- **经济系统前端同步**：游戏结束事件后需刷新用户数据，确保每 10 分钟时长奖励的 BZ 币能即时反映在 UI。

### 6.4 客户端更新发布规范

- **更新源**：使用 GitHub Releases（仓库：`baozha2023/bz-games`）作为 `electron-updater` 的发布源。
- **发布资产**：每个版本 Release 必须单独上传 `BZ-Games Setup x.x.x.exe`、`latest.yml`、`*.blockmap`，不可打包成 ZIP。
- **版本策略**：发布前需先提升 `package.json` 版本号，并使用对应 Tag 创建 Release。
- **生效条件**：自动更新仅在打包后的生产环境可用；开发模式（`pnpm dev`）下应提示不支持。
- **本地数据保护**：
  - 在下载更新与安装更新前，`UpdateService` 必须创建数据快照目录（`.update-snapshots/<timestamp-stage>`）。
  - 快照至少包含 `config.json` 备份文件与所有游戏保存根目录副本（支持多路径）。
  - 快照写入失败时需要记录日志，且不得删除现有 `config.json` 与任何游戏目录。

***

## 七、联机系统详解

### 7.1 设计原则

1. **平台是联机中间件**：房间管理、消息中继、玩家状态全部由平台负责，游戏本身零网络代码。
2. **房主即服务端**：Room Server 运行在房主机器上，其他玩家的平台作为 Room Client 连接。
3. **内网穿透工具无关**：平台只使用固定本地端口（可配置），用户选用任何内网穿透工具均可。
4. **两层 WebSocket 服务**：
   - **Room Server/Client**：平台之间互联，处理房间状态与游戏消息中继。
   - **Game API Server**：平台与本机游戏进程互联，提供平台能力给游戏。

### 7.2 联机完整流程

#### 房主（Host）操作流程

1. **创建房间**：
   - 用户在游戏详情页点击「创建房间」。
   - 主进程 `RoomServer` 启动，监听 `settings.defaultRoomPort` (默认 38080)。
   - 房主平台内部 `RoomClient` 连接本地 `RoomServer`。
2. **内网穿透与地址分享**：
   - 房主使用内网穿透工具将本地端口映射到公网。
   - 房主获取公网地址（如 `60.26.220.79:39337`）发送给好友。
3. **玩家加入**：
   - 房主等待玩家连接。
   - 玩家列表实时更新（通过 `room:player:joined` / `room:state:sync`）。
4. **开始游戏**：
   - 当所有玩家准备就绪（Host 无需准备），房主点击「开始游戏」。
   - `RoomServer` 广播 `room:game:start`。
   - 房主平台启动本地游戏进程，注入 `BZ_IS_HOST=1` 和 `BZ_ROOM_ID`。

#### 玩家（Client）操作流程

1. **加入房间**：
   - 用户点击「加入房间」，输入房主提供的公网地址。
   - 平台 `RoomClient` 尝试建立 WebSocket 连接。
   - 连接成功后发送 `room:join` 握手消息，携带 `gameId` 和 `gameVersion`。
2. **握手与同步**：
   - `RoomServer` 校验游戏 ID 和版本。
   - 收到 `room:join:ack` 表示加入成功，同步房间状态。
   - 若收到 `room:join:refused` 则提示错误原因（如“房间已满”或“版本不匹配”）。
   - `RoomClient` 在异常断线后会自动重连并重新发送 `room:join`（最多 5 次，递增退避），减少临时网络抖动造成的掉房。
3. **准备与等待**：
   - 在房间内点击「准备」 (`room:ready`)。
   - 等待房主开始游戏。
4. **游戏启动**：
   - 收到 `room:game:start` 信号。
   - 平台自动启动本地游戏进程，注入 `BZ_IS_HOST=0` 和 `BZ_ROOM_ID`。

### 7.3 Room Server / Room Client 消息协议

Room Server 与 Room Client 之间使用 **WebSocket + JSON** 通信。

#### 消息类型 (RoomMessageType)

| 类型                     | 方向                  | 说明                 |
| :--------------------- | :------------------ | :----------------- |
| `room:join`            | Client → Server     | 请求加入房间，携带玩家信息与游戏版本 |
| `room:join:ack`        | Server → Client     | 加入成功，返回房间信息        |
| `room:join:refused`    | Server → Client     | 拒绝加入（房间满、版本不匹配等）   |
| `room:player:joined`   | Server → All        | 通知有新玩家加入           |
| `room:player:left`     | Server → All        | 通知玩家离开             |
| `room:player:ready`    | Client → Server     | 玩家标记为已准备           |
| `room:player:unready`  | Client → Server     | 玩家取消准备             |
| `room:state:sync`      | Server → All        | 房间状态全量同步           |
| `room:game:start`      | Server → All        | 游戏开始信号             |
| `room:game:end`        | Client/Server → All | 游戏结束信号             |
| `room:disbanded`       | Server → All        | 房间已解散              |
| `room:kicked`          | Server → Target     | 被踢通知（仅目标玩家）        |
| `room:player:kicked`   | Server → All        | 广播玩家被踢事件            |
| `room:chat`            | Bidirectional       | 聊天消息               |
| `game:message:relay`   | Bidirectional       | 游戏内单播消息中继          |
| `game:broadcast:relay` | Bidirectional       | 游戏内广播消息中继          |

#### 消息中继约束

- `message.broadcast` 默认仅转发给其他玩家，不会回环给发送者。
- `message.send` 必须提供目标玩家（`to` 或 `targetPlayerId`），否则返回错误。
- 中继层会自动补齐 `senderId`、`messageId`、`sentAt` 字段，便于游戏侧幂等处理与时序判断。
- 房间已满时允许同一 `playerId` 重连加入（Rejoin），不会被误判为 `room_full`。

***

## 八、平台 API 规范（面向游戏开发者）

> 游戏进程通过连接 `ws://127.0.0.1:{BZ_API_PORT}` 使用平台能力。
> 连接后必须**立刻发送** **`auth`** **请求**，否则 **30 秒**后连接将被服务端主动断开。

### 8.1 连接与认证

```javascript
// 示例：Node.js 游戏连接平台（游戏侧代码）
const WebSocket = require('ws');

const port = process.env.BZ_API_PORT;
const token = process.env.BZ_API_TOKEN;

if (!port || !token) {
    console.error('[Game] 未检测到平台环境，请通过 BZ-Games 启动');
    process.exit(1);
}

const ws = new WebSocket(`ws://127.0.0.1:${port}`);

ws.on('open', () => {
    // Step 1：认证 (必须在连接后立即发送)
    send({
        id: crypto.randomUUID(),
        type: 'request',
        action: 'auth',
        payload: { token }
    });
});

function send(msg) {
    ws.send(JSON.stringify(msg));
}
```

### 8.2 API 列表

**请求格式**：`{ id, type: 'request', action, payload }`
**响应格式**：`{ id, type: 'response', action, payload, error? }`

| Action               | Payload (Request)                               | Returns (Response Payload)                           | Description                                   |
| :------------------- | :---------------------------------------------- | :--------------------------------------------------- | :-------------------------------------------- |
| `auth`               | `{ token: string }`                             | `{ success: boolean, player: { id, name, isHost } }` | **必须**。连接后首个请求，用于鉴权。                          |
| `player.getInfo`     | -                                               | `{ id, name }`                                       | 获取当前玩家信息。                                     |
| `room.getInfo`       | -                                               | `{ id, hostId, players, ... }`                       | 获取当前房间信息（若在房间中）。                              |
| `game.ready`         | -                                               | `{ acknowledged: true }`                             | 告知平台游戏已准备就绪（平台会广播给其他玩家）。                      |
| `game.end`           | -                                               | `{ success: true }`                                  | 告知平台游戏结束（通常由 Host 调用）。                        |
| `message.send`       | `{ to?: string, targetPlayerId?: string, ... }` | `{ success: true }`                                  | 发送单播消息给指定玩家（必须包含 `to` 或 `targetPlayerId` 之一）。 |
| `message.broadcast`  | `{ ... }`                                       | `{ success: true }`                                  | 广播消息给所有玩家（平台中继）。                              |
| `achievement.list`   | -                                               | `[{ id, title, description, unlocked, unlockedAt }]` | 获取当前游戏版本的成就列表及解锁状态。                           |
| `achievement.unlock` | `{ achievementId, playerId }`                   | `{ success: true, new: boolean }`                    | 解锁成就。`playerId` 必须为当前玩家 ID。                   |
| `stats.report`       | `Record<string, number>`                        | `{ success: true }`                                  | 上报统计数据；平台根据 Manifest 配置按增量/全量写入。            |

### 8.3 事件列表 (Event)

平台会主动推送以下事件给游戏进程：

- `event.message`: 收到其他玩家的消息（Payload 至少包含 `{ senderId, messageId, sentAt, ... }`）
- `event.playerJoined`: 有新玩家加入房间
- `event.playerLeft`: 有玩家离开房间
- `event.gameEnd`: 游戏被强制结束（如房间解散）
