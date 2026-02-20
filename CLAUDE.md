# CLAUDE.md — BZ-Games 游戏平台开发文档

> 本文档为 AI 辅助开发的上下文文件，描述项目的完整架构、规范与约定。
> 所有开发工作应严格遵循本文档中定义的结构与规范。

---

## 一、项目概述

### 平台简介

**BZ-Games** 是一个**无服务器本地游戏平台**，类似于 Steam / Epic Games Store，
基于 **Vue 3 + TypeScript + Electron** 构建，**仅支持 Windows 10/11（x64）**。

### 核心设计原则

| 原则             | 说明                                                |
|----------------|---------------------------------------------------|
| **无服务器**       | 所有数据存储于本地，无需后端服务器，无需用户注册账号                        |
| **便携式存储**      | 数据与游戏文件存储在应用根目录下，支持便携式运行（Portable Mode）           |
| **开放式游戏管理**    | 用户可将符合平台规范的游戏载入平台，平台会自动复制并管理游戏文件                  |
| **统一联机基础设施**   | 平台提供完整的联机房间管理与消息通讯能力，游戏开发者无需自行实现网络层               |
| **内网穿透工具无关**   | 联机依赖用户自行安装的内网穿透工具（如 SakuraFrp），平台通过标准端口对接，不绑定特定工具 |
| **仅限 Windows** | 不考虑 macOS / Linux 兼容性                             |

### 平台核心功能

- 游戏库管理（载入、删除、分类、封面展示）
- 游戏启动与进程生命周期管理
- 联机房间系统（创建、加入、准备、开始、离开、聊天）
- Game API Server（向游戏进程提供联机与通讯能力的本地 WebSocket 服务）
- 系统设置（玩家昵称、主题、默认端口等）

---

## 二、技术栈

| 分类           | 技术 / 库                      | 备注                         |
|--------------|-----------------------------|----------------------------|
| 桌面框架         | Electron                    |                            |
| 前端框架         | Vue 3                       |                            |
| 开发语言         | TypeScript（严格模式）            |                            |
| UI 组件库       | Naive UI                    |                            |
| 状态管理         | Pinia                       |                            |
| 构建工具         | electron-vite               |                            |
| 打包工具         | electron-builder            |                            |
| 包管理器         | pnpm                        |                            |
| 进程间通信        | Electron IPC（contextBridge） |                            |
| 本地数据存储       | electron-store              | v10+ (ESM)，需在构建中配置 include |
| WebSocket 服务 | ws                          |                            |
| 目标平台         | Windows 10/11 x64           |                            |

---

## 三、项目目录结构

```
bz-launcher/
├── CLAUDE.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── electron.vite.config.ts
├── config.json                        #  持久化配置文件（生成）
├── games/                             #  游戏文件存储目录（生成）
│   └── <id>/                      #  游戏 ID 目录
│       └── <version>/             #  特定版本目录
│
├── src/
│   │
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # 主进程入口
│   │   ├── window.ts                  # BrowserWindow 管理
│   │   │
│   │   ├── ipc/                       # IPC 处理器（按模块拆分）
│   │   │   ├── index.ts               # 统一注册所有 IPC Handler
│   │   │   ├── game.ipc.ts            # 游戏管理相关 IPC
│   │   │   ├── room.ipc.ts            # 房间管理相关 IPC
│   │   │   └── system.ipc.ts          # 系统/设置相关 IPC
│   │   │
│   │   ├── services/                  # 主进程核心服务
│   │   │   ├── GameLoader.ts          # 游戏载入、校验与文件复制
│   │   │   ├── GameManager.ts         # 游戏进程启动/管理/终止
│   │   │   ├── RoomServer.ts          # 联机 Room Server（Host 端 WebSocket 服务）
│   │   │   ├── RoomClient.ts          # 联机 Room Client（Client 端 WebSocket 客户端）
│   │   │   ├── GameApiServer.ts       # Game API Server（本地 WebSocket 服务，供游戏进程使用）
│   │   │   └── StoreService.ts        # electron-store 封装
│   │   │
│   │   └── utils/
│   │       ├── logger.ts              # 日志工具
│   │       ├── portUtils.ts           # 动态端口分配工具
│   │       ├── pathValidator.ts       # 路径安全校验工具
│   │       └── appPath.ts             #  应用路径工具（处理开发/生产环境路径差异）
│   │
│   ├── preload/                       # 预加载脚本
│   │   ├── index.ts                   # contextBridge 暴露入口
│   │   └── api.ts                     # window.electronAPI 类型定义与实现
│   │
│   ├── renderer/                      # 渲染进程（Vue 应用）
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.ts
│   │       ├── App.vue
│   │       │
│   │       ├── router/
│   │       │   └── index.ts
│   │       │
│   │       ├── stores/                # Pinia Stores
│   │       │   ├── useGameStore.ts
│   │       │   ├── useRoomStore.ts
│   │       │   └── useSettingsStore.ts
│   │       │
│   │       ├── views/                 # 页面级组件
│   │       │   ├── LibraryView.vue    # 游戏库（首页）
│   │       │   ├── GameDetailView.vue # 游戏详情页
│   │       │   ├── RoomView.vue       # 联机房间页
│   │       │   └── SettingsView.vue   # 设置页
│   │       │
│   │       ├── components/            # 可复用组件
│   │       │   ├── game/
│   │       │   │   ├── GameCard.vue
│   │       │   │   └── GameCover.vue
│   │       │   └── room/
│   │       │       ├── PlayerList.vue
│   │       │       ├── PlayerCard.vue
│   │       │       └── RoomChat.vue
│   │       │
│   │       └── types/                 # 渲染进程专用类型
│   │           └── electron-api.d.ts  # window.electronAPI 类型声明
│   │
│   └── shared/                        # 主进程与渲染进程共享代码
│       ├── ipc-channels.ts            # 所有 IPC 频道名常量
│       ├── game-manifest.ts           # GameManifest 接口定义（game.json 类型）
│       └── types/
│           ├── game.types.ts          # 游戏相关共享类型
│           ├── room.types.ts          # 房间相关共享类型
│           └── store.types.ts         # 本地存储相关类型
│
├── resources/
│   ├── icon.png                       # 平台图标
│
└── build/                             # electron-builder 配置相关资源
```

---

## 四、核心概念与术语

| 术语                       | 说明                                                            |
|--------------------------|---------------------------------------------------------------|
| **游戏清单 (Game Manifest)** | `game.json` 文件，描述游戏元信息与平台集成配置                                 |
| **游戏库 (Library)**        | 用户已载入平台的所有游戏集合，存于本地 `games/` 目录                               |
| **房间 (Room)**            | 一次联机会话，包含房主与所有玩家的状态                                           |
| **房主 (Host)**            | 创建房间的玩家，其平台负责运行 Room Server                                   |
| **玩家 (Player)**          | 加入房间的用户（含房主自身）                                                |
| **Room Server**          | 房主平台运行的 WebSocket 服务器，经内网穿透工具对外暴露                             |
| **Room Client**          | 非房主玩家的平台连接 Room Server 的 WebSocket 客户端                        |
| **Game API Server**      | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力              |
| **bz-config.js**         | 平台在游戏启动前生成的配置文件（包含端口与Token），解决进程环境变量传递不可靠问题                   |
| **内网穿透**                 | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                  |
| **平台 SDK**               | 未来提供的 npm 包（`bz-launcher-sdk`），封装 Game API Server 调用，供游戏开发者使用 |

---

## 五、架构设计

### 5.1 整体架构图

```
╔══════════════════════════════════════════════════════════════════╗
║                         HOST 主机                                ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │                    Electron 平台进程                        │  ║
║  │                                                            │  ║
║  │  ┌─────────────┐    IPC     ┌─────────────────────────┐   │  ║
║  │  │  渲染进程   │◄──────────►│       主进程             │   │  ║
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
║                                               │ localhost         ║
║  ┌────────────────────────────────────────────┴──────────────┐  ║
║  │                   游戏进程 (game.exe)                      │  ║
║  │   ws://127.0.0.1:{BZ_API_PORT}                         │  ║
║  │   通过 Game API Server 进行所有联机通信                    │  ║
║  └────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
                              ▲
                    SakuraFrp 公网地址
                    60.26.220.79:39337
                              ▼
╔══════════════════════════════════════════════════════════════════╗
║                      CLIENT 客机（可多个）                        ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │                    Electron 平台进程                        │  ║
║  │                                                            │  ║
║  │  ┌─────────────┐    IPC     ┌─────────────────────────┐   │  ║
║  │  │  渲染进程   │◄──────────►│       主进程             │   │  ║
║  │  │  (Vue UI)   │            │  ┌─────────────────────┐│   │  ║
║  │  └─────────────┘            │  │    RoomClient       ││   │  ║
║  │                             │  │    连接至房主公网地址 ││   │  ║
║  │                             │  ├─────────────────────┤│   │  ║
║  │                             │  │   GameApiServer     ││   │  ║
║  │                             │  │   (状态同步缓存)     ││   │  ║
║  │                             │  └──────────┬──────────┘│   │  ║
║  │                             └─────────────┼───────────┘   │  ║
║  └─────────────────────────────────────────── ┼ ─────────────┘  ║
║                                               │ localhost         ║
║  ┌────────────────────────────────────────────┴──────────────┐  ║
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

#### 渲染进程 (Renderer Process)

- Vue 3 + TypeScript UI，仅负责界面展示与交互
- 通过 `window.electronAPI` 调用主进程功能（严禁直接使用 Node.js API）
- 使用 Pinia 管理前端状态（GameStore, RoomStore）
- 监听并响应房间事件和游戏进程事件

#### 预加载脚本 (Preload)

- 通过 `contextBridge.exposeInMainWorld` 安全暴露有限 API 给渲染进程
- 所有渲染进程 → 主进程的通信必须经过此层

### 5.3 本地数据存储结构

使用 `electron-store`，数据存储于应用根目录下的 `config.json`（便携模式）：

```typescript
// src/shared/types/store.types.ts

interface AppStore {
    games: GameRecord[];
    settings: AppSettings;
    recentPlayed: string[];         // 游戏 ID 列表，最多保留 20 条
}

interface GameRecord {
    id: string;                     // 与 game.json 中的 id 一致
    versions: GameVersion[];        // 游戏版本列表
    latestVersion: string;          // 当前最新版本号
    addedAt: number;                // 首次添加时间（ms）
    playtime: number;               // 累计游玩时间（秒）
    lastPlayedAt?: number;
}

interface GameVersion {
    version: string;                // 版本号
    path: string;                   // 游戏在 games/<id>/<version>/ 下的绝对路径
    addedAt: number;                // 该版本添加时间
}

interface AppSettings {
    playerName: string;             // 玩家昵称，默认 "玩家"
    playerId: string;               // 本机唯一玩家 ID（UUID，首次启动生成，持久化）
    avatar?: string;                // 玩家头像（Base64 字符串）
    language: 'zh-CN' | 'en-US';
    theme: 'dark' | 'light';
    defaultRoomPort: number;        // Room Server 监听端口，默认 38080
}
```

---

## 六、游戏管理系统

### 6.1 游戏载入流程

```
用户点击「添加游戏」
        │
        ▼
主进程弹出文件夹选择对话框
        │
        ▼
读取所选目录下的 game.json 或 game.js
        │
  ┌─────┴──────────┐
  │ 文件不存在     │──► 返回错误：「未找到 game.json 或 game.js」
  └─────┬──────────┘
        │ 文件存在
        ▼
若为 game.json 则校验格式；若为 game.js 则生成默认 manifest
        │
  ┌─────┴────────┐
  │ 格式不合法   │──► 返回错误，附上具体字段错误信息
  └─────┬────────┘
        │ 格式合法
        ▼
检查 entry 指定的文件是否存在
        │
        ▼
检查 id 是否与已有游戏重复
        │
  ┌─────┴────┐
  │ id 重复  │──► 返回错误：「游戏 ID 已存在」
  └─────┬────┘
        │
        ▼
检查/创建应用根目录下的 games/ 文件夹
        │
        ▼
将用户选择的游戏目录**完整复制**到 games/<id>/<version>/ 目录下
（使用递归复制，避免 fs.cpSync 兼容性问题）
        │
        ▼
写入 electron-store，更新 GameRecord（包含 version 信息）
        │
        ▼
通知渲染进程刷新游戏库
```

### 6.2 游戏清单规范（game.json）

游戏目录**根目录**必须包含 `game.json`，这是游戏与平台集成的唯一契约文件。

**完整 game.json 示例：**

```json
{
  "$schema": "https://bz-launcher/schemas/game-manifest.v1.json",
  "id": "com.example.my-awesome-game",
  "name": "我的游戏",
  "version": "1.0.0",
  "description": "一款有趣的多人游戏（可选字段）",
  "author": "开发者昵称 / 工作室名称",
  "website": "https://example.com",
  "platformVersion": ">=1.0.0",
  "entry": "./my-game.exe",
  "icon": "./icon.png",
  "cover": "./cover.png",
  "type": "multiplayer",
  "multiplayer": {
    "minPlayers": 2,
    "maxPlayers": 4
  },
  "args": [],
  "env": {}
}
```

**字段说明：**

| 字段                       | 类型                       |  必须  | 说明                                                       |
|--------------------------|--------------------------|:----:|----------------------------------------------------------|
| `id`                     | `string`                 |  ✅   | 全局唯一标识，**反向域名格式**，如 `com.dev.mygame`，一经发布不可更改            |
| `name`                   | `string`                 |  ✅   | 游戏显示名称                                                   |
| `version`                | `string`                 |  ✅   | 遵循 SemVer（如 `1.0.0`）                                     |
| `description`            | `string`                 |  ❌   | 游戏简介                                                     |
| `author`                 | `string`                 |  ✅   | 开发者名称                                                    |
| `website`                | `string`                 |  ❌   | 官网或发布页 URL                                               |
| `platformVersion`        | `string`                 |  ✅   | 所需平台版本范围（semver range，如 `>=1.0.0`）                       |
| `entry`                  | `string`                 |  ✅   | 相对于游戏目录的入口可执行文件路径（支持 .exe, .bat, .cmd, .js, .py, .vbs 等） |
| `icon`                   | `string`                 |  ❌   | 游戏图标，相对路径（`.ico` 或 `.png`）                               |
| `cover`                  | `string`                 |  ❌   | 封面图片，相对路径（推荐尺寸 460×215px）                                |
| `type`                   | `string`                 |  ✅   | `"singleplayer"` 或 `"multiplayer"`                       |
| `multiplayer.minPlayers` | `number`                 | 联机必须 | 最少玩家数（含房主）                                               |
| `multiplayer.maxPlayers` | `number`                 | 联机必须 | 最多玩家数（含房主）                                               |
| `args`                   | `string[]`               |  ❌   | 启动时追加的命令行参数                                              |
| `env`                    | `Record<string, string>` |  ❌   | 启动时追加的环境变量                                               |

**TypeScript 接口定义（`src/shared/game-manifest.ts`）：**

```typescript
import {z} from 'zod';

export const GameManifestSchema = z.object({
    $schema: z.string().optional(),
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/, {
        message: 'id 必须为反向域名格式，如 com.dev.mygame'
    }),
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+/),
    description: z.string().max(500).optional(),
    author: z.string().min(1).max(100),
    website: z.string().url().optional(),
    platformVersion: z.string(),
    entry: z.string(),
    icon: z.string().optional(),
    cover: z.string().optional(),
    type: z.enum(['singleplayer', 'multiplayer']),
    multiplayer: z.object({
        minPlayers: z.number().int().min(1),
        maxPlayers: z.number().int().min(1),
    }).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
});

export type GameManifest = z.infer<typeof GameManifestSchema>;
```

### 6.3 游戏目录推荐结构

```
my-game/
├── game.json          # 必须：游戏清单（平台识别入口）
├── my-game.exe        # 必须：游戏入口（entry 字段所指定的文件）
├── icon.png          # 推荐：平台展示用图标
├── cover.png          # 推荐：平台展示用封面（460×215px）
├── assets/            # 游戏资源
│   ├── images/
│   ├── audio/
│   └── ...
└── ...
```

### 6.4 游戏启动——注入环境变量

平台通过 `child_process.spawn` 启动游戏时，注入以下环境变量：

```bash
# 平台标识
BZ_PLATFORM=1
BZ_PLATFORM_VERSION=1.0.0

# Game API Server 连接参数（游戏必须使用这两个值连接）
BZ_API_PORT=<动态分配的本地端口，如 49521>
BZ_API_TOKEN=<随机UUID，用于鉴权>

# 本地玩家信息
BZ_PLAYER_ID=<持久化UUID，从 AppSettings.playerId 读取>
BZ_PLAYER_NAME=<玩家昵称>
BZ_GAME_ID=com.example.my-game

# 联机信息（仅联机游戏时存在）
BZ_ROOM_ID=<房间UUID>
BZ_IS_HOST=true          # 或 false
```

---

## 七、联机系统

### 7.1 设计原则

1. **平台是联机中间件**：房间管理、消息中继、玩家状态全部由平台负责，游戏本身零网络代码。
2. **房主即服务端**：Room Server 运行在房主机器上，其他玩家的平台作为 Room Client 连接。
3. **内网穿透工具无关**：平台只使用固定本地端口（可配置），用户选用任何内网穿透工具均可。
4. **两层 WebSocket 服务**：
    - **Room Server/Client**：平台之间互联，处理房间状态与游戏消息中继。
    - **Game API Server**：平台与本机游戏进程互联，提供平台能力给游戏。

### 7.2 联机完整流程

#### 房主（Host）操作流程

```
1. 用户在游戏详情页点击「创建房间」
        │
2. 主进程启动 RoomServer，监听本地端口（settings.defaultRoomPort，默认 38080）
   并根据 game.json 中的 multiplayer.maxPlayers 设置房间最大人数
        │
3. Host 平台内部 RoomClient 连接本地 RoomServer
        │
4. UI 进入房间页，显示：
   - 当前房间监听端口：38080
   - 引导提示：请开启内网穿透，将本地 38080 端口映射到公网
   - 输入框：填写内网穿透获得的公网地址（如 60.26.220.79:39337）
        │
5. 房主填写公网地址，该地址展示在房间界面，供玩家复制
        │
6. 等待玩家加入，玩家列表实时更新，显示每位玩家的准备状态
        │
7. 所有玩家均「已准备」后，「开始游戏」按钮激活
        │
8. 房主点击「开始游戏」
        │
9. RoomServer 向所有 Client 广播 room:game:start 消息
        │
10. 房主平台启动本地游戏进程（注入联机环境变量）
        │
11. 游戏进程通过 GameApiServer 进行游戏内联机通信
```

#### 游戏结束与自动关闭

当房主结束游戏（或关闭游戏窗口）时：

1. 房主 `GameManager` 捕获游戏进程退出，通知 `RoomServer`。
2. `RoomServer` 广播 `room:game:end` 消息。
3. 所有客户端 `RoomClient` 收到 `room:game:end`，触发自动关闭逻辑。
4. 客户端 `GameManager` 强制终止本地游戏进程。

#### 玩家（Client）操作流程

```
1. 用户在游戏详情页点击「加入房间」
        │
2. 弹出输入框，输入房主提供的公网地址（如 60.26.220.79:39337）
        │
3. 主进程尝试 WebSocket 连接至该地址
        │
   ┌────┴──────────────┐
   │ 连接失败（超时等） │──► 提示用户检查地址与房主网络状态
   └────┬──────────────┘
        │ 连接成功
4. 发送 room:join 消息，携带玩家信息
        │
   ┌────┴────────┐
   │ 被房主拒绝  │──► 显示拒绝原因（房间已满 / 游戏已开始等）
   └────┬────────┘
        │ 加入成功
5. 收到 room:join:ack，同步房间状态
        │
6. 进入房间等待界面，点击「准备」
        │
7. 收到 room:game:start 事件
        │
8. 平台自动启动本地游戏进程（注入联机环境变量）
```

### 7.3 Room Server / Room Client 消息协议

Room Server 与 Room Client 之间使用 **WebSocket + JSON** 通信。

```typescript
// src/shared/types/room.types.ts

export type RoomMessageType =
// ── 房间管理 ──
    | 'room:join'            // Client → Server：请求加入房间
    | 'room:join:ack'        // Server → Client：加入成功确认
    | 'room:join:refused'    // Server → Client：拒绝加入（附原因）
    | 'room:player:joined'   // Server → All：新玩家已加入
    | 'room:player:left'     // Server → All：玩家已离开/断线
    | 'room:player:ready'    // Client → Server：玩家标记准备
    | 'room:player:unready'  // Client → Server：玩家取消准备
    | 'room:state:sync'      // Server → All：房间状态全量同步
    | 'room:game:start'      // Server → All：游戏开始
    | 'room:game:end'        // Client → Server / Server → All：游戏结束
    | 'room:chat'            // 双向：房间内聊天消息
    // ── 游戏消息中继 ──
    | 'game:message:relay'   // 将游戏进程发来的单播消息中继给目标玩家
    | 'game:broadcast:relay' // 将游戏进程发来的广播消息中继给所有玩家
    ;

export interface RoomMessage<T = unknown> {
    type: RoomMessageType;
    payload: T;
}

export interface RoomInfo {
    id: string;
    gameId: string;
    hostId: string;
    hostPublicAddress?: string;         // 房主填写的公网地址
    players: PlayerInRoom[];
    maxPlayers: number;
    state: 'waiting' | 'starting' | 'playing' | 'ended';
    createdAt: number;
}

export interface PlayerInRoom {
    id: string;
    name: string;
    isHost: boolean;
    isReady: boolean;
    joinedAt: number;
}

// room:join payload
export interface RoomJoinPayload {
    playerId: string;
    playerName: string;
    gameId: string;
    gameVersion: string;
}

// room:join:ack payload
export interface RoomJoinAckPayload {
    room: RoomInfo;
    yourPlayerId: string;
}

// room:join:refused payload
export interface RoomJoinRefusedPayload {
    reason: 'room_full' | 'game_started' | 'game_id_mismatch' | 'version_mismatch' | 'unknown';
    message: string;
}
```

### 7.4 Game API Server

平台在本机随机端口运行一个 WebSocket 服务，专供游戏进程使用。
连接参数通过环境变量 `BZ_API_PORT` 和 `BZ_API_TOKEN` 传递给游戏。

**消息基础格式：**

```typescript
// src/shared/types/game.types.ts

export interface GameApiRequest {
    id: string;              // 请求 ID，用于 request-response 匹配
    type: 'request';
    action: GameApiAction;
    payload?: unknown;
}

export interface GameApiResponse {
    id: string;              // 对应请求的 ID
    type: 'response';
    action: GameApiAction;
    payload?: unknown;
    error?: string;          // 仅出错时存在
}

export interface GameApiEvent {
    id: string;              // 随机 ID
    type: 'event';
    action: GameApiEventAction;
    payload: unknown;
}

export type GameApiMessage = GameApiRequest | GameApiResponse | GameApiEvent;
```

**消息流向示意：**

```
游戏进程 ──message.broadcast──► GameApiServer（主进程）
                                       │
              ┌────────────────────────┤
              │ 若为 Host              │ 若为 Client
              ▼                        ▼
     直接分发给所有          通过 RoomClient 发send到
     本地 Game 连接          RoomServer（Host）
     （单机场景同理）         Host 再中继给其他 Client
                                       │
                              各 Client 的 GameApiServer
                              将消息推送给本地游戏进程
```

---

## 八、平台 API 规范（面向游戏开发者）

> 游戏进程通过连接 `ws://127.0.0.1:{BZ_API_PORT}` 使用平台能力。
> 连接后必须**立刻发送 `auth` 请求**，否则 5 秒后连接将被服务端主动断开。

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
    // Step 1：认证
    send('auth', {token});
});

ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'event') {
        handleEvent(msg.action, msg.payload);
    } else if (msg.type === 'response') {
        resolveRequest(msg.id, msg.payload, msg.error);
    }
});

function send(action, payload) {
    const id = crypto.randomUUID();
    ws.send(JSON.stringify({id, type: 'request', action, payload}));
    return id;
}
```

### 8.2 API 方法（游戏 → 平台）

#### `auth` — 认证连接（首次必须调用）

```typescript
// Request
{
    action: 'auth', payload
:
    {
        token: string
    }
}

// Response
{
    action: 'auth',
        payload
:
    {
        success: true,
            player
    :
        {
            id: string;
            name: string;
            isHost: boolean
        }
    }
}
```

---

#### `player.getInfo` — 获取本地玩家信息

```typescript
// Response payload
interface PlayerInfo {
    id: string;
    name: string;
    isHost: boolean;
}
```

---

#### `room.getInfo` — 获取当前房间信息（仅联机）

```typescript
// Response payload
interface RoomInfo {
    id: string;
    gameId: string;
    hostId: string;
    players: Array<{
        id: string;
        name: string;
        isHost: boolean;
    }>;
    maxPlayers: number;
    state: 'waiting' | 'playing';
}
```

---

#### `message.send` — 向指定玩家发送消息

```typescript
// Request payload
{
    to: string;
    data: unknown
}

// Response payload
{
    success: true
}
```

---

#### `message.broadcast` — 向房间内所有玩家广播消息（不含自身）

```typescript
// Request payload
{
    data: unknown
}

// Response payload
{
    success: true
}
```

---

#### `game.ready` — 通知平台游戏已初始化完毕

```typescript
// 游戏窗口加载完成、资源就绪后调用
// Response payload
{
    acknowledged: true
}
```

---

#### `game.end` — 通知平台游戏已结束（用于联机游戏结算）

```typescript
// Request payload（可选）
{
    reason ? : string
}
```

---

### 8.3 平台事件（平台 → 游戏，type: 'event'）

| Action               | 触发时机              | Payload                           |
|----------------------|-------------------|-----------------------------------|
| `event.message`      | 收到其他玩家发送的消息       | `{ from: string; data: unknown }` |
| `event.playerJoined` | 有玩家加入房间（联机中途加入场景） | `{ player: { id, name } }`        |
| `event.playerLeft`   | 有玩家离开房间           | `{ playerId: string }`            |
| `event.gameEnd`      | 游戏结束通知            | `{ reason?: string }`             |

---

## 九、实战案例：井字棋 (Tic-Tac-Toe)

本项目内置了一个基于 HTML5 的井字棋联机游戏示例，位于 `井字棋/` 目录。

### 9.1 目录结构

```
井字棋/
├── game.json      # 游戏清单
├── index.html     # 游戏主逻辑 (Client)
├── server.js      # 简易静态文件服务 (Entry)
└── start.bat      # 启动脚本
```

### 9.2 关键实现逻辑

1. **启动与连接**：
    * `server.js` 启动 HTTP 服务，并从环境变量读取 `BZ_API_PORT` 和 `BZ_API_TOKEN`。
    * 打开浏览器时，将这些参数拼接到 URL Query 中。
    * `index.html` 解析 URL 参数，建立 WebSocket 连接。

2. **认证**：
   ```javascript
   ws.onopen = () => {
     send({
       id: crypto.randomUUID(),
       type: 'request',
       action: 'auth',
       payload: { token }
     });
   };
   ```

3. **状态同步**：
    * **落子**：玩家点击棋盘 -> 本地更新 UI -> 发送 `message.broadcast`。
   ```javascript
   send({
     id: crypto.randomUUID(),
     type: 'request',
     action: 'message.broadcast',
     payload: { type: 'move', index, symbol: mySymbol }
   });
   ```
    * **接收**：收到 `event.message` -> 更新棋盘。
   ```javascript
   if (msg.action === 'event.message') {
     const payload = msg.payload;
     if (payload.type === 'move') {
       handleMove(payload.index, payload.symbol);
     }
   }
   ```

这个示例展示了如何使用 BZ-Games 提供的“空壳”联机能力，游戏只需关注自身的逻辑和状态同步，无需处理复杂的网络连接和房间管理。

---

## 十、IPC 通信规范（主进程 ↔ 渲染进程）

### 10.1 IPC 频道常量（`src/shared/ipc-channels.ts`）

```typescript
export const IPC = {
    // ── 游戏管理 ──
    GAME_LOAD: 'game:load',            // 渲染→主：打开文件夹对话框并加载游戏
    GAME_REMOVE: 'game:remove',          // 渲染→主：移除游戏（id）
    GAME_LAUNCH: 'game:launch',          // 渲染→主：启动游戏（id, version?）
    GAME_GET_ALL: 'game:getAll',          // 渲染→主：获取全部游戏列表
    GAME_GET_RECORDS: 'game:getRecords',      // 渲染→主：获取游戏记录（含统计数据）
    GAME_GET_COVER: 'game:getCover',        // 渲染→主：获取游戏封面（返回 base64）
    GAME_GET_VERSIONS: 'game:getVersions',     // 渲染→主：获取游戏版本列表

    // ── 房间管理 ──
    ROOM_CREATE: 'room:create',          // 渲染→主：创建房间（gameId, version?）
    ROOM_JOIN: 'room:join',            // 渲染→主：加入房间（gameId, address, version?）
    ROOM_LEAVE: 'room:leave',           // 渲染→主：离开房间
    ROOM_READY: 'room:ready',           // 渲染→主：准备
    ROOM_UNREADY: 'room:unready',         // 渲染→主：取消准备
    ROOM_START: 'room:start',           // 渲染→主：开始游戏（仅 Host）
    ROOM_SET_ADDRESS: 'room:setAddress',      // 渲染→主：设置房主公网地址
    ROOM_GET_STATE: 'room:getState',        // 渲染→主：获取当前房间状态
    ROOM_SEND_CHAT: 'room:sendChat',        // 渲染→主：发送聊天消息

    // ── 房间事件推送（主→渲染，使用 ipcRenderer.on）──
    ROOM_EVENT: 'room:event',           // 主→渲染：通用房间事件

    // ── 游戏进程事件（主→渲染）──
    GAME_PROCESS_STARTED: 'game:process:started',
    GAME_PROCESS_ENDED: 'game:process:ended',

    // ── 系统 ──
    SYSTEM_GET_SETTINGS: 'system:getSettings',
    SYSTEM_SAVE_SETTINGS: 'system:saveSettings',
    SYSTEM_UPLOAD_AVATAR: 'system:uploadAvatar', // 渲染→主：上传头像
} as const;
```

### 10.2 Preload API 定义（`src/preload/api.ts`）

```typescript
import {contextBridge, ipcRenderer} from 'electron';
import {IPC} from '../shared/ipc-channels';
import type {AppSettings, GameManifest, RoomInfo, RoomEvent} from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
    game: {
        load: () => ipcRenderer.invoke(IPC.GAME_LOAD),
        remove: (id: string) => ipcRenderer.invoke(IPC.GAME_REMOVE, id),
        launch: (id: string) => ipcRenderer.invoke(IPC.GAME_LAUNCH, id),
        getAll: () => ipcRenderer.invoke(IPC.GAME_GET_ALL),
        getCover: (id: string) => ipcRenderer.invoke(IPC.GAME_GET_COVER, id),
        onProcessEvent: (callback: (type: 'start' | 'end', id: string) => void) => {
            const startHandler = (_: any, id: string) => callback('start', id);
            const endHandler = (_: any, id: string) => callback('end', id);
            ipcRenderer.on(IPC.GAME_PROCESS_STARTED, startHandler);
            ipcRenderer.on(IPC.GAME_PROCESS_ENDED, endHandler);
            return () => {
                ipcRenderer.removeListener(IPC.GAME_PROCESS_STARTED, startHandler);
                ipcRenderer.removeListener(IPC.GAME_PROCESS_ENDED, endHandler);
            };
        },
    },
    room: {
        create: (gameId: string) => ipcRenderer.invoke(IPC.ROOM_CREATE, gameId),
        join: (gameId: string, address: string) => ipcRenderer.invoke(IPC.ROOM_JOIN, gameId, address),
        leave: () => ipcRenderer.invoke(IPC.ROOM_LEAVE),
        ready: () => ipcRenderer.invoke(IPC.ROOM_READY),
        unready: () => ipcRenderer.invoke(IPC.ROOM_UNREADY),
        start: () => ipcRenderer.invoke(IPC.ROOM_START),
        setAddress: (address: string) => ipcRenderer.invoke(IPC.ROOM_SET_ADDRESS, address),
        getState: () => ipcRenderer.invoke(IPC.ROOM_GET_STATE),
        sendChat: (content: string) => ipcRenderer.invoke(IPC.ROOM_SEND_CHAT, content),
        // 事件监听
        onEvent: (callback: (event: RoomEvent) => void) => {
            const handler = (_: any, event: RoomEvent) => callback(event);
            ipcRenderer.on(IPC.ROOM_EVENT, handler);
            return () => ipcRenderer.removeListener(IPC.ROOM_EVENT, handler);
        },
    },
    settings: {
        get: () => ipcRenderer.invoke(IPC.SYSTEM_GET_SETTINGS),
        save: (settings: AppSettings) => ipcRenderer.invoke(IPC.SYSTEM_SAVE_SETTINGS, settings),
    },
});
```

**渲染进程类型声明（`src/renderer/src/types/electron-api.d.ts`）：**

```typescript
import type {AppSettings, GameManifest, RoomInfo, RoomEvent} from '../../../shared/types';

declare global {
    interface Window {
        electronAPI: {
            game: {
                load: () => Promise<{ success: boolean; manifest?: GameManifest; error?: string }>;
                remove: (id: string) => Promise<void>;
                launch: (id: string) => Promise<void>;
                getAll: () => Promise<GameManifest[]>;
                getCover: (id: string) => Promise<string | null>; // base64 data URL
                onProcessEvent: (callback: (type: 'start' | 'end', id: string) => void) => () => void;
            };
            room: {
                create: (gameId: string) => Promise<{ port: number }>;
                join: (gameId: string, address: string) => Promise<{ success: boolean; error?: string }>;
                leave: () => Promise<void>;
                ready: () => Promise<void>;
                unready: () => Promise<void>;
                start: () => Promise<void>;
                setAddress: (address: string) => Promise<void>;
                getState: () => Promise<RoomInfo | null>;
                sendChat: (content: string) => Promise<void>;
                onEvent: (callback: (event: RoomEvent) => void) => () => void;
            };
            settings: {
                get: () => Promise<AppSettings>;
                save: (settings: AppSettings) => Promise<void>;
            };
        };
    }
}
```

---

## 十一、状态管理（Pinia）

### `useGameStore`（`src/renderer/src/stores/useGameStore.ts`）

```typescript
import {defineStore} from 'pinia';
import type {GameManifest} from '../../../shared/game-manifest';

export const useGameStore = defineStore('game', () => {
    const games = ref<GameManifest[]>([]);
    const currentGame = ref<GameManifest | null>(null);
    const runningGameIds = ref<Set<string>>(new Set());
    const isLoading = ref(false);

    // 监听主进程发来的游戏启动/结束事件
    window.electronAPI.game.onProcessEvent((type, id) => {
        if (type === 'start') runningGameIds.value.add(id);
        else if (type === 'end') runningGameIds.value.delete(id);
    });

    async function loadGames() { /* ... */
    }

    async function addGame() { /* ... */
    }

    async function removeGame(id: string) { /* ... */
    }

    async function launchGame(id: string) { /* ... */
    }

    function selectGame(game: GameManifest | null) { /* ... */
    }

    return {games, currentGame, runningGameIds, isLoading, loadGames, addGame, removeGame, launchGame, selectGame};
});
```

### `useRoomStore`（`src/renderer/src/stores/useRoomStore.ts`）

```typescript
import {defineStore} from 'pinia';
import type {RoomInfo, RoomEvent} from '../../../shared/types/room.types';

export interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    timestamp: number;
    isSystem?: boolean;
}

export const useRoomStore = defineStore('room', () => {
    const room = ref<RoomInfo | null>(null);
    const isConnecting = ref(false);
    const chatMessages = ref<ChatMessage[]>([]);
    const localPlayerId = computed(() => /* ... */);

    const isHost = computed(() => room.value?.hostId === localPlayerId.value);
    const localPlayer = computed(() => room.value?.players.find(p => p.id === localPlayerId.value));
    const allReady = computed(() => room.value?.players.every(p => p.isReady || p.isHost));

    async function createRoom(gameId: string): Promise<{ port: number }> { /* ... */
    }

    async function joinRoom(gameId: string, address: string): Promise<boolean> { /* ... */
    }

    async function leaveRoom(): Promise<void> { /* ... */
    }

    async function setReady(ready: boolean): Promise<void> { /* ... */
    }

    async function startGame(): Promise<void> { /* ... */
    }

    async function sendChatMessage(content: string): Promise<void> { /* ... */
    }

    function handleRoomEvent(event: RoomEvent): void {
        switch (event.type) {
            case 'room:state:sync':
                room.value = event.payload;
                break;
            case 'room:chat':
                chatMessages.value.push(event.payload);
                break;
            case 'room:player:joined':
                /* 添加系统消息 + 缓存更新 */
                break;
            case 'room:player:left':
                /* 添加系统消息 + 缓存更新 */
                break;
        }
    }

    return {
        room, isConnecting, localPlayerId, isHost, localPlayer, allReady, chatMessages,
        createRoom, joinRoom, leaveRoom, setReady, startGame, handleRoomEvent, sendChatMessage
    };
});
```

---

## 十二、UI 页面结构

### 路由定义

```
/                   → 重定向到 /library
/library            → LibraryView（游戏库首页）
/library/:gameId    → GameDetailView（游戏详情页）
/room/:gameId       → RoomView（联机房间页，含创建/等待两种状态）
/settings           → SettingsView
```

### 各页面核心功能

#### LibraryView（游戏库）

- 网格布局展示所有已载入游戏的封面卡片
- 顶部工具栏：「添加游戏」按钮、搜索框
- 点击卡片跳转至游戏详情页

#### GameDetailView（游戏详情）

- 大图封面 + 游戏名/作者/版本/简介
- 单机游戏：「启动游戏」按钮
- 联机游戏：「创建房间」按钮 + 「加入房间」按钮（附地址输入框）
- 游戏运行时，按钮切换为「游戏运行中」禁用状态

#### RoomView（房间页）

- **玩家列表区**：展示所有玩家头像（首字母）、昵称、准备状态（已准备 / 未准备）
- **房主区域（isHost === true）**：
    - 显示 Room Server 监听端口
    - 提示卡：「请使用 SakuraFrp 等工具将本地端口 {port} 映射到公网，填写获得的地址：」
    - 输入框：填写公网地址，填写后一键复制按钮
    - 「开始游戏」按钮（仅 allReady 时激活）
- **玩家区域（isHost === false）**：
    - 「准备」/ 「取消准备」切换按钮
- **聊天区**：显示房间内实时聊天记录，支持发送消息
- **顶部导航**：点击“返回”或“我的游戏库”，如果正在房间中，智能判断跳转逻辑

#### SettingsView（设置）

- 玩家昵称输入
- 默认 Room Server 端口输入（默认 38080）
- 主题切换（暗色 / 亮色）

---

## 十三、开发规范

### 13.1 代码风格

- TypeScript `strict: true`，不允许 `any`（特殊情况需注释说明）
- Vue 组件一律使用 `<script setup lang="ts">` 语法
- 异步操作一律使用 `async/await`，不使用裸 Promise 链
- 所有魔法字符串（IPC 频道名、事件名）必须定义为常量

### 13.2 文件命名规范

| 类型          | 命名规范                | 示例                |
|-------------|---------------------|-------------------|
| Vue 组件      | `PascalCase.vue`    | `GameCard.vue`    |
| Pinia Store | `use{Name}Store.ts` | `useGameStore.ts` |
| 服务类         | `PascalCase.ts`     | `RoomServer.ts`   |
| IPC Handler | `{name}.ipc.ts`     | `game.ipc.ts`     |
| 类型文件        | `{name}.types.ts`   | `room.types.ts`   |
| 工具函数        | `camelCase.ts`      | `portUtils.ts`    |

### 13.3 安全规范

- **主进程不信任渲染进程**：所有来自渲染进程的文件路径必须经 `pathValidator.ts` 校验，防止路径穿越
- **Game API Server 必须鉴权**：每次游戏启动生成随机 UUID 作为 Token，5 秒内未完成认证则断开连接
- **禁止在渲染进程直接使用 `require('electron')` 或 Node.js API**，一律通过 preload 的 `contextBridge`

### 13.4 错误处理规范

- 所有 IPC Handler 必须用 `try/catch` 包裹，返回标准格式：
  ```typescript
  // 成功
  { success: true, data: T }
  // 失败
  { success: false, error: string }
  ```
- Game API Server 的 response 中有错误时，`error` 字段不为 `undefined`
- 网络断线（Room Client 断开）需在 UI 层给出明确提示，并提供重连或返回选项

### 13.5 端口管理

- **Room Server 端口**：由用户在设置中配置（默认 38080），固定占用，便于配置内网穿透
- **Game API Server 端口**：每次游戏启动动态分配（从 49152 开始随机查找可用端口），通过 `portUtils.ts` 实现

### 13.6 文件系统操作

- **避免使用 `fs.cpSync`**：在 Windows 环境下处理包含非 ASCII 字符（如中文）的路径时，原生的 `fs.cpSync` 可能会导致
  Electron/Node 进程崩溃。应使用手动递归调用 `fs.copyFileSync` 和 `fs.mkdirSync` 来替代。

---

## 十四、构建与打包

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 类型检查
pnpm typecheck

# 构建
pnpm build

# 打包为 Windows 安装包（.exe NSIS）
pnpm build:win
```

**`electron-builder` 关键配置（`package.json`）：**

```json
{
  "build": {
    "appId": "com.bz.launcher",
    "productName": "BZ-Games",
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

## 十五、重要约束与注意事项

1. **严禁引入任何后端服务**：本项目为纯本地应用，禁止引入需要远程服务器的功能。

2. **内网穿透工具无关性**：平台只负责运行本地 Room Server 并监听固定端口。用户无论使用 SakuraFrp、frp、ngrok
   还是其他工具，只要将该端口映射到公网，填写到平台中即可正常使用。平台不调用任何穿透工具的 API。

3. **游戏网络隔离原则**：联机游戏的所有玩家间通信**必须通过 Game API Server**，平台会负责消息中继。游戏进程自行建立 TCP/UDP
   连接用于玩家间通信是不符合规范的行为（会导致内网穿透无效）。

4. **跨平台禁止**：本项目仅支持 Windows，不引入任何跨平台 polyfill，不考虑 macOS/Linux 兼容。

5. **游戏内容安全**：平台不对游戏内容做安全审查。应在 UI 层添加免责声明提示，用户自行承担载入第三方游戏的风险。

6. **玩家 ID 持久化**：`playerId`（UUID）在首次启动时生成，存入 `AppSettings`，后续不再改变。这是玩家在联机中的唯一标识。

7. **端口冲突处理**：若 Room Server 端口（默认 38080）被占用，应给用户清晰提示，引导其在设置中修改端口后重试。

8. **ESM 兼容性**：主进程使用 CommonJS，但部分依赖（如 `electron-store` v10+）为 ESM。必须在 `electron.vite.config.ts` 中配置
   `externalizeDepsPlugin({ exclude: [...] })` 将其打包，并在 `tsconfig.node.json` 中设置 `"moduleResolution": "bundler"`
   以确保类型正确。
