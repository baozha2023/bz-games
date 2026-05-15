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
|----------------|---------------------------------------------------|
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
- 游戏市场（远程发现、详情展示、下载并安装到默认游戏目录）
- 系统设置（玩家信息、主题、端口、语言、更新、游戏保存路径）

***

## 二、技术栈

| 分类           | 技术 / 库                      | 备注                         |
|--------------|-----------------------------|----------------------------|
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
| ZIP 解压       | extract-zip                 | 纯 Node.js 解压，不依赖外部进程       |
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
│   │   │   ├── market.ipc.ts               # 游戏市场 IPC 处理器
│   │   │   ├── room.ipc.ts                # 房间相关 IPC 处理器
│   │   │   ├── system.ipc.ts              # 设置/系统/更新 IPC 处理器
│   │   │   └── storage.ipc.ts             # Web 游戏本地存储 IPC 处理器
│   │   ├── services/
│   │   │   ├── GameApiServer.ts           # 游戏进程本地 WebSocket API 服务
│   │   │   ├── GameEnvironment.ts         # 游戏启动环境变量与 bz-config.js 生成
│   │   │   ├── GameLoader.ts              # 游戏导入、校验、扫描与记录同步
│   │   │   ├── GameManager.ts             # 游戏进程启动/停止与生命周期管理
│   │   │   ├── MarketService.ts           # 游戏市场索引拉取、下载、校验、解压与安装
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
│   │       │   ├── MarketView.vue          # 游戏市场页面
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
│   │       ├── game.types.ts               # Game API 消息类型
│   │       ├── index.ts                    # 共享类型聚合导出
│   │       ├── market.types.ts             # 市场索引、任务状态与错误码类型
│   │       ├── room.types.ts               # 房间协议与房间模型类型
│           └── store.types.ts              # 本地存储模型类型
│
├── resources/
│   └── icon.png                            # 应用图标资源
```

***

## 四、核心概念与术语

| 术语                         | 说明                                                                             |
|----------------------------|--------------------------------------------------------------------------------|
| **游戏清单 (Game Manifest)**   | `game.json` 文件，描述游戏元信息与平台集成配置                                                  |
| **游戏库 (Library)**          | 用户已载入平台的所有游戏集合，来源于本地默认目录与已记录的多游戏路径                                             |
| **房间 (Room)**              | 一次联机会话，包含房主与所有玩家的状态                                                            |
| **房主 (Host)**              | 创建房间的玩家，其平台负责运行 Room Server                                                    |
| **玩家 (Player)**            | 加入房间的用户（含房主自身）                                                                 |
| **Room Server**            | 房主平台运行的 WebSocket 服务器，经内网穿透工具对外暴露                                              |
| **Room Client**            | 非房主玩家的平台连接 Room Server 的 WebSocket 客户端                                         |
| **Game API Server**        | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力                               |
| **游戏市场索引 (Market Index)**  | 远程 `market.json` 文件，描述市场内可展示和可下载的游戏及其版本信息                                      |
| **市场安装包 (Market Package)** | 市场游戏某个版本对应的下载产物，平台下载后校验并安装到默认游戏目录                                              |
| **bz-config.js**           | 平台在游戏启动前生成的配置文件（包含端口、Token、玩家信息、房间 ID、`isHost` 与 `isMultiple`），解决进程环境变量传递不可靠问题 |
| **内网穿透**                   | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                                   |
| **平台 SDK**                 | 未来提供的 npm 包（`bz-launcher-sdk`），封装 Game API Server 调用，供游戏开发者使用                  |

### 4.1 Game Manifest 规范

- **统计信息国际化**：`statistics` 字段支持键值对格式（`[{ "key": "Display Name" }]`），用于在平台统计界面显示本地化的统计项名称。
- **时间追踪优化**：平台会自动追踪并记录所有游戏的游玩时长（`time`），无需在 `statistics` 字段中显式定义。若定义了 `time`
  ，平台也会正常处理。
- **详情媒体扩展**：`video` 字段为可选项，指向游戏目录内预览视频（`mp4/webm/ogv/mov/m4v`），仅用于详情页展示。
- **本地存储加密开关**：`encryptLocalStorage` 为可选布尔字段，仅作用于 Web 游戏 `localStorage` 对应的 `gamedata.json` 持久化。
- **游戏类型扩展**：`type` 支持 `singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`，其中 `singlemultiple`
  代表同时支持单人与联机，`networkgame` 代表网络网页游戏（仅启动网页，不参与房间联机流程）。
- **远程网页启动**：`entry` 新增 `url` 模式；当 `entry=url` 时，Manifest 必须提供 `web_url`（合法 URL），平台直接打开该网页地址。

### 4.2 游戏市场索引 JSON 规范

- **托管方式**：游戏市场索引文件由独立 GitHub 仓库维护，推荐固定文件名为 `market.json`。平台优先读取 GitHub 原始地址
  `https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json`；若 GitHub 拉取失败，必须自动回退到 OSS 镜像地址 `https://web-bz.oss-cn-beijing.aliyuncs.com/market.json`。
- **拉取时机**：用户每次点击左侧“游戏市场”按钮时，平台都必须主动重新拉取最新索引；若未来实现本地缓存，也只能作为网络失败时的兜底展示，不能跳过本次远程请求。
- **镜像同步**：允许市场仓库通过 GitHub Actions 等自动化流程在 `market.json` 更新后同步 OSS 镜像；平台无需感知同步过程，只要求优先
  GitHub、失败回退 OSS。
- **展示目标**：索引文件必须同时满足“列表展示”“下载校验”“安装校验”三类需求，因此除基础元信息外，还需要包含封面、简介、标签、文件校验值、包大小等字段。
- **安装原则**：市场下载安装本质上仍走统一导入流程；平台下载并解压版本包后，必须继续校验包内 `game.json` 与市场索引中的
  `id`、`version`、`platformVersion` 是否一致。

#### 顶层结构

```json
{
  "schemaVersion": "1.0.0",
  "marketId": "official",
  "marketName": "BZ Games Market",
  "generatedAt": "2026-05-15T12:00:00.000Z",
  "source": {
    "repository": "https://github.com/baozha2023/bz-games-market.git",
    "branch": "master"
  },
  "games": []
}
```

#### 顶层字段说明

| 字段                  | 类型             | 必填 | 说明                             |
|---------------------|----------------|----|--------------------------------|
| `schemaVersion`     | `string`       | 是  | 市场索引格式版本，建议使用语义化版本，便于未来升级兼容逻辑。 |
| `marketId`          | `string`       | 是  | 市场唯一标识，如 `official`。           |
| `marketName`        | `string`       | 是  | 市场显示名称。                        |
| `generatedAt`       | `string`       | 是  | 索引生成时间，ISO 8601 格式。            |
| `source.repository` | `string`       | 否  | 索引来源仓库地址，用于诊断与展示。              |
| `source.branch`     | `string`       | 否  | 索引来源分支，如 `master`。             |
| `games`             | `MarketGame[]` | 是  | 市场中的游戏列表。                      |

#### 游戏对象 `MarketGame`

| 字段              | 类型                    | 必填 | 说明                                                                                        |
|-----------------|-----------------------|----|-------------------------------------------------------------------------------------------|
| `id`            | `string`              | 是  | 游戏唯一 ID，必须与安装包内 `game.json.id` 一致，推荐使用反向域名格式。                                             |
| `name`          | `string`              | 是  | 游戏名。                                                                                      |
| `author`        | `string`              | 是  | 游戏作者或工作室名称。                                                                               |
| `type`          | `string`              | 是  | 游戏类型，取值与 `game.json.type` 一致：`singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`。 |
| `summary`       | `string`              | 是  | 游戏简介，列表卡片和详情页都使用该字段展示，建议 1~2 句话。                                                          |
| `tags`          | `string[]`            | 否  | 游戏标签，如 `["休闲", "平台跳跃"]`。                                                                  |
| `iconUrl`       | `string`              | 否  | 游戏图标远程地址，建议 HTTPS。                                                                        |
| `coverUrl`      | `string`              | 否  | 游戏封面远程地址，建议 16:9。                                                                         |
| `screenshots`   | `string[]`            | 否  | 详情页截图列表。                                                                                  |
| `featured`      | `boolean`             | 否  | 是否在市场首页重点推荐。                                                                              |
| `visibility`    | `string`              | 否  | 可见性，推荐取值：`public`、`hidden`、`deprecated`。默认 `public`。                                      |
| `minPlayers`    | `number`              | 否  | 多人游戏最小人数；仅多人相关类型建议填写。                                                                     |
| `maxPlayers`    | `number`              | 否  | 多人游戏最大人数；仅多人相关类型建议填写。                                                                     |
| `latestVersion` | `string`              | 是  | 当前推荐展示/安装的最新稳定版本号。                                                                        |
| `versions`      | `MarketGameVersion[]` | 是  | 该游戏可安装的版本列表，至少 1 项。                                                                       |

#### 版本对象 `MarketGameVersion`

| 字段                | 类型        | 必填 | 说明                                          |
|-------------------|-----------|----|---------------------------------------------|
| `version`         | `string`  | 是  | 版本号，语义化版本格式，必须与安装包内 `game.json.version` 一致。 |
| `description`     | `string`  | 是  | 该版本说明，可用于更新日志或版本简介。                         |
| `platformVersion` | `string`  | 是  | 当前版本对平台版本的兼容范围，使用 `semver` 语法，如 `>=1.9.5`。  |
| `downloadUrl`     | `string`  | 是  | 版本安装包下载地址，建议 HTTPS。                         |
| `sha256`          | `string`  | 是  | 安装包 SHA-256 摘要，用于完整性校验。                     |
| `size`            | `number`  | 是  | 安装包字节大小，用于展示下载体积和二次校验。                      |
| `publishedAt`     | `string`  | 否  | 版本发布时间，ISO 8601 格式。                         |
| `releaseNotes`    | `string`  | 否  | 更详细的版本更新内容。                                 |
| `isPrerelease`    | `boolean` | 否  | 是否为预发布版本；预发布版本默认不作为 `latestVersion`。        |

#### 安装包约束

- **格式识别**：平台必须根据 `downloadUrl` 的文件后缀自动识别压缩包格式；首版至少支持 `.zip`，若未来扩展 `.7z`
  ，也必须由平台自动判断，不要求市场维护者额外填写格式字段。
- **解压方式**：使用 `extract-zip`（纯 Node.js 实现），不依赖 PowerShell 或外部解压工具，避免 .NET Framework 版本兼容性问题。
- **目录约束**：压缩包解压后的根目录或第一层单子目录中必须存在 `game.json`，且整体目录结构应能直接作为一次普通"本地导入"
  输入目录。
- **一致性校验**：平台安装前必须校验下载包的 `sha256`、`size`、`game.json.id`、`game.json.version`；
  `game.json.platformVersion` 使用 `semver` 做语义化兼容性检查（支持 string 和 tuple 两种 manifest 格式），**不做字符串直接比对**。
- **安全约束**：压缩包内不得出现绝对路径、盘符路径或 `../` 路径穿越条目；发现后直接拒绝安装。
- **覆盖策略**：若本地已存在相同 `id + version`，默认视为“已安装”，不重复覆盖；后续若要支持“重新安装”，需单独增加明确交互。
- **落盘路径**：市场安装目标目录优先使用当前设置中的 `gameStoragePath`；若未设置，则回退到应用根目录下的默认 `games/` 目录。


#### 市场任务状态与错误码类型

```typescript
// src/shared/types/market.types.ts

type MarketTaskStatus =
    | "idle" | "downloading" | "verifying" | "extracting"
    | "installing" | "completed" | "error" | "canceled";

type MarketErrorCode = "download" | "verify" | "extract" | "install";

interface MarketTaskState {
    taskId: string;           // 格式: `${gameId}@${version}`
    gameId: string;
    version: string;
    status: MarketTaskStatus;
    progress: number;         // 0-100
    bytesReceived?: number;
    totalBytes?: number;
    message?: string;
    error?: string;
    errorCode?: MarketErrorCode;  // 失败时自动归类
    createdAt: number;
    updatedAt: number;
}
```

- **错误码自动归类**：主进程 `classifyErrorCode()` 根据异常信息自动映射为 `download` / `verify` / `extract` / `install`
  ，渲染进程通过 `MARKET_EVENT` 接收 `errorCode` 并映射 i18n 文案。
- **任务状态推送**：主进程每次更新任务状态后通过 `market:event` 推送给渲染进程，渲染进程的 `onEvent` 回调处理 toast 通知与
  UI 更新。
- **终态清理策略**：`completed` / `error` / `canceled` 三种终态在 500ms 后从渲染进程移除，切回页面时通过
  `syncExistingTasks` 仅恢复进行中的任务；`notifiedTaskIds` 集合防止重复弹 toast。
- **幂等性设计**：前端 `pendingDownloads`/`pendingCancels` Set + 后端 `idle` 状态保护 + `.catch()` 回调 canceled 守卫，三层防护确保同一任务不会并发执行或被重复触发。
- **内存管理**：主进程 `tasks` Map 在任务终态后 30 秒自动清理；渲染进程 `isAlive` 标志位防止组件卸载后异步 toast。

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
- 拉取远程游戏市场索引、下载市场安装包并执行校验与安装
- 运行 Room Server（Host 时）/ Room Client（Client 时）
- 运行 Game API Server（每次有游戏运行时）
- 注册并处理所有 IPC Handler
- 广播游戏进程生命周期事件（start/end）
- 更新检查、下载、安装由 `UpdateService` 统一处理

#### 渲染进程 (Renderer Process)

- Vue 3 + TypeScript UI，仅负责界面展示与交互
- 通过 `window.electronAPI` 调用主进程功能（严禁直接使用 Node.js API，所有文件操作与系统调用必须通过 IPC）
- 使用 Pinia 管理前端状态（GameStore, RoomStore）
- 负责游戏市场页面展示、版本选择、下载进度/取消、安装结果反馈。通过 `pendingDownloads`/`pendingCancels` Set 实现按钮幂等保护，`isAlive` 标志位防止卸载后 toast 泄漏
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
- **Web 游戏存储接管**：通过 Preload 脚本接管 `localStorage`，将数据重定向存储至 `games/<id>/<version>/gamedata.json`
  ，实现跨启动模式（File/Serve）的数据互通与版本隔离。
- **Web 存储可选加密**：支持通过 Manifest 字段 `encryptLocalStorage` 控制 `gamedata.json` 是否加密存储（默认关闭）。
- **Web 联机模式标记**：平台生成的 `bz-config.js` 提供 `isMultiple` 字段，便于 `singlemultiple` 游戏在运行时区分单人模式与联机模式。
- **远程网页模式约束**：当 `entry=url` 时，平台不生成 `bz-config.js`，也不向页面注入 `window.BZ_CONFIG`。

### 5.5 代码组织与内聚性

- **模块化**：复杂逻辑（如 `GameLoader.loadGameFromDialog`）拆分为独立函数（`validateManifestFile`, `checkPlatformVersion`,
  `checkEntryFile` 等），提升可读性与可维护性。
- **环境配置抽离**：游戏环境变量准备与 `bz-config.js` 生成逻辑由 `GameEnvironment` 统一处理，提高 `GameManager` 的内聚性。
- **MarketService 设计**：
    - `runDownloadTask` 编排四阶段流水线（download → verify → extract → install），各阶段语义清晰、状态更新完整。
    - `AbortController` 贯穿全流程，下载阶段通过 `fetch({ signal })` 原生响应，校验/解压阶段在入口强制检查 `signal.aborted`。
    - 错误分类由 `classifyErrorCode()` 统一处理，根据错误消息自动归类为四种错误码（download/verify/extract/install）。
    - `tasks` Map 维护任务全生命周期，终态任务 30 秒自动清理，`finally` 块确保临时文件必然清理。

***

## 六、开发规范与约束

### 6.1 游戏导入与市场安装规范

- **任意文件夹导入**：`GameLoader` 支持任意目录导入。若目录缺少 `game.json`，前端需弹出补录表单，由用户填写核心字段后生成
  Manifest 并继续导入。
- **文件选择策略**：Windows 下文件选择对话框使用 `openDirectory` 模式。
- **版本检查**：导入时会检查 `game.json` 中的 `platformVersion` 字段，若当前平台版本不满足要求（使用 `semver`
  比较），将拒绝导入并提示用户。
- **拖拽路径解析统一**：游戏库拖拽导入路径统一使用 `webUtils.getPathForFile(file)` 获取。
- **市场入口拉取策略**：每次进入“游戏市场”页面时，必须重新请求远程 `market.json`，不得仅依赖本地旧数据。
- **市场下载暂存**：市场安装包应先下载到应用可控的临时目录（如 `.market-cache/`）中，校验通过后再解压并导入。
- **市场安装统一导入**：市场下载成功后，解压目录必须复用现有 `GameLoader` 导入链路，避免形成独立且不一致的安装逻辑。
- **市场安装失败保护**：下载、校验、解压或导入任一步失败时，不得破坏已有游戏记录；仅清理当前失败任务产生的临时文件（`finally`
  块中执行 `removeIfExists`，`.catch(() => undefined)` 防止清理异常阻断流程）。
- **市场错误码分类**：所有安装失败必须归类为四种错误码之一：`download`（下载失败）、`verify`（校验失败，含 sha256 与 size 不匹配）、
  `extract`（解压失败）、`install`（安装/导入失败）。主进程通过错误信息自动归类（`classifyErrorCode`），渲染进程根据错误码映射
  i18n 文案展示给用户，禁止直接暴露内部错误码。
- **市场取消逻辑**：取消操作用 `AbortController` 实现；下载阶段通过 `fetch({ signal })` 取消 HTTP 请求；校验/解压阶段在入口处检查
  `controller.signal.aborted`，进入后立即响应取消；各阶段之间检查并主动抛出中断异常；`finally` 块保证取消后临时文件被清理。
- **市场安装包 platformVersion 校验**：`installExtractedGame` 对 manifest 的 `platformVersion`（支持 string 和 tuple `[min, max]` 两种格式）使用 `semver` 做语义化兼容性检查，**不得**与市场索引的 `platformVersion` 做字符串 `!==` 比较。tuple 格式 join 后必然不等于市场字符串，会导致校验 100% 失败。
- **市场幂等性保护**：
    - **前端**：`pendingDownloads` / `pendingCancels` 两个 `Set` 追踪飞行中的请求。`handleDownload` 进入时先检查 `pendingDownloads` 和本地 `taskStates` 是否已有进行中任务；`handleCancel` 进入时检查 `pendingCancels` 和任务状态是否可取消。`finally` 块清理 Set。
    - **后端**：`downloadAndInstall` 的防重复检查覆盖 `idle` 状态（防止 `createTask` 刚创建的 idle 任务被重复调用覆盖，导致两份并行下载）；`.catch()` 回调写入 `"error"` 前检查当前状态是否已被标记为 `"canceled"`。
- **市场内存管理**：`MarketService.tasks` Map 在任务进入终态（completed/error/canceled）后 30 秒自动清理，防止长期运行内存泄漏。
- **市场下载背压处理**：`downloadArchive` 写入流检查 `writer.write()` 返回值，返回 `false` 时 await `drain` 事件，防止极端快速下载场景下内存激增。
- **市场 Toast 生命周期绑定**：`MarketView` 维护 `isAlive` 标志位，`onUnmounted` 时置 `false`，所有异步回调中的 `message.*` toast 调用前检查 `isAlive`，防止组件卸载后仍弹出 toast。
- **市场平台兼容性前端检测**：渲染进程通过 `system:getAppVersion` 获取当前平台版本，使用 `semver.satisfies` 判断每个游戏版本的
  `platformVersion` 兼容性；不兼容时下载按钮变灰并显示"平台版本不兼容"文案。
- **市场任务状态管理**：已完成/失败/取消的任务在 500ms 后从渲染进程 `taskStates` 中自动清除，进度条 UI 回归原始布局；页面切换回来时通过
  `syncExistingTasks` 仅恢复进行中（downloading/verifying/extracting/installing）的任务；终态任务通过 `notifiedTaskIds`
  集合确保每次安装只弹一次 toast，避免切回页面时重复通知。
- **重复版本处理**：若本地已安装相同 `id` 与 `version`，市场页应明确展示“已安装”状态，并阻止重复安装。
- **表单约束**：
    - `id` 需实时检测重复并校验反向域名格式。
    - `platformVersion` 固定为当前平台版本，不允许修改。
    - `type` 使用下拉框；仅当 `type` 为 `multiplayer` 或 `singlemultiple` 时展示 `minPlayers/maxPlayers`。
    - `version` 必须通过语义化版本校验（`x.y.z`）。
    - `entry` 会自动探测并允许用户手动修改；仅当 `entry` 为 `.html` 时校验入口文件存在。`entry=serve` 或 `entry=url`
      不做入口文件存在性校验。
    - `entry=url` 时必须提供 `web_url`（合法 URL）。
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
- `market:getIndex`：拉取并解析远程游戏市场索引。
- `market:downloadAndInstall`：下载指定市场游戏版本、执行完整性校验并安装到默认游戏目录。
- `market:getTaskState`：获取市场下载/安装任务状态与进度。
- `market:cancelTask`：取消指定市场下载/安装任务。
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
- `system:getAppVersion`：获取当前平台版本号（供渲染进程进行平台兼容性判断）。
- `system:saveSettings`：保存应用设置并应用相关系统行为。
- `system:uploadAvatar`：选择并处理玩家头像。
- `system:selectGameStoragePath`：弹窗选择默认游戏保存路径。
- `system:openPath`：在系统文件管理器中打开路径。
- `system:removeGameStoragePath`：删除保存路径及其内部已导入游戏数据。
- `system:getUserData`：读取用户经济与签到数据。
- `system:checkIn`：执行每日签到并返回奖励结果。
- `system:dataHealthCheck`：执行本地数据健康检查，返回结构化报告（错误/警告/摘要）。
- `system:getUpdateStatus`：获取当前更新状态。
- `system:checkUpdate`：检查是否有可用更新。
- `system:downloadUpdate`：下载可用更新包。
- `system:installUpdate`：安装更新并重启。
- `room:event`：主进程推送房间事件给渲染层。
- `game:process:started`：推送游戏进程启动事件。
- `game:process:ended`：推送游戏进程结束事件。
- `game:launch:failed`：推送游戏启动失败事件。
- `system:update:event`：推送更新状态变化事件。
- `market:event`：推送市场下载/安装任务状态变化事件。
- `game:unlockAchievement`：推送成就解锁事件到渲染层。
- `game:storage:init`：初始化 Web 游戏本地存储数据。
- `game:storage:save`：保存单个 localStorage 键值。
- `game:storage:remove`：删除单个 localStorage 键。
- `game:storage:clear`：清空当前游戏版本 localStorage 数据。

### 6.3 UI 交互规范

- **返回导航**：所有二级页面（设置、统计、成就等）的 `n-page-header` 必须包含返回按钮，统一导航回 `Library` 页面。
- **市场入口位置**：在游戏库左侧导航区域新增“游戏市场”按钮，入口层级与游戏库其他主导航一致。
- **市场刷新行为**：点击“游戏市场”后立即拉取最新远程索引；默认先请求 GitHub，失败后自动回退
  OSS；加载中需展示骨架屏或加载态，全部来源都失败时展示错误态与重试按钮。
- **市场展示内容**：市场列表至少展示封面/图标、游戏名、作者、类型、标签、简介、最新版本、安装状态与下载按钮。
- **市场详情与安装**
  ：用户可查看游戏简介、当前选中版本详情、版本列表、平台兼容要求、包体大小；当前选中版本的说明与下载操作区必须紧跟在选中游戏信息下方展示，不得沉到底部；点击下载后展示下载进度、校验中、安装中、完成/失败等明确状态。
- **市场列表容器**：市场页不应再额外包一层无业务意义的“市场游戏”外层卡片；应直接展示游戏列表项，减少视觉嵌套。
- **市场展开交互**：市场列表需支持手动展开/收起动画，默认全部收起；已展开项不得因为用户点击其他游戏而自动收回，必须由用户主动收起。
- **市场安装目录提示**：市场页需明确提示当前安装目标目录；若用户未设置 `gameStoragePath`，需提示将安装到默认 `games/` 目录。
- **市场版本状态**：对于已安装版本、当前最新版本、预发布版本，需要在版本列表中展示不同状态标记，避免重复安装或误装测试版。
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
- **房间连接状态可视化**：房间页需展示 `connecting / reconnecting / failed / disconnected` 状态，以及重连倒计时与失败原因。
- **统计/成就搜索**：右上角默认展示搜索图标，点击后展开输入框并支持按游戏名或游戏 ID 模糊搜索。
- **房间开始按钮冷却**：房间内收到 `room:game:end` 后，Host 的「开始游戏」按钮需禁用 5 秒。
- **统计界面**：卡片右上角需展示该游戏的所有版本号，使用自动换行布局。
- **设置页更新入口**：设置页需提供「检查更新」按钮，点击后弹出更新状态弹层，显示下载进度与安装按钮。
- **设置页数据自检**：设置页需提供“数据自检”按钮，展示 `config.json`、游戏目录、版本路径、Manifest 完整性等检查结果。
- **更新错误诊断**：更新失败时前端必须展示归类后的错误码文案与技术摘要，避免仅显示底层原始错误。
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
    - **Host 本地投递优化**：当客机消息目标是房主本机游戏进程时，`RoomServer` 应直接调用 `GameApiServer.sendEvent()`
      投递，避免再经房主本地 `RoomClient` 走一跳 WebSocket 回环。

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
|:-----------------------|:--------------------|:-------------------|
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
| `room:player:kicked`   | Server → All        | 广播玩家被踢事件           |
| `room:chat`            | Bidirectional       | 聊天消息               |
| `game:message:relay`   | Bidirectional       | 游戏内单播消息中继          |
| `game:broadcast:relay` | Bidirectional       | 游戏内广播消息中继          |

#### 消息中继约束

- `message.broadcast` 默认仅转发给其他玩家，不会回环给发送者。
- `message.send` 必须提供目标玩家（`to` 或 `targetPlayerId`），否则返回错误。
- 中继层会自动补齐 `senderId`、`messageId`、`sentAt` 字段，便于游戏侧幂等处理与时序判断。
- Host 处理来自客机、且目标为房主本机游戏的 `game:message:relay` / `game:broadcast:relay` 时，应优先直接投递给本机
  `GameApiServer`，不要通过房主本地 `RoomClient` 再走一次 WebSocket。
- `RoomClient` 需通过 `room:event` 向渲染层同步连接状态变化，包括
  `connecting / connected / reconnecting / failed / disconnected` 及重试信息。
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
        payload: {token}
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
|:---------------------|:------------------------------------------------|:-----------------------------------------------------|:----------------------------------------------|
| `auth`               | `{ token: string }`                             | `{ success: boolean, player: { id, name, isHost } }` | **必须**。连接后首个请求，用于鉴权。                          |
| `player.getInfo`     | -                                               | `{ id, name }`                                       | 获取当前玩家信息。                                     |
| `room.getInfo`       | -                                               | `{ id, hostId, players, ... }`                       | 获取当前房间信息（若在房间中）。                              |
| `game.ready`         | -                                               | `{ acknowledged: true }`                             | 告知平台游戏已准备就绪（平台会广播给其他玩家）。                      |
| `game.end`           | -                                               | `{ success: true }`                                  | 告知平台游戏结束（通常由 Host 调用）。                        |
| `message.send`       | `{ to?: string, targetPlayerId?: string, ... }` | `{ success: true }`                                  | 发送单播消息给指定玩家（必须包含 `to` 或 `targetPlayerId` 之一）。 |
| `message.broadcast`  | `{ ... }`                                       | `{ success: true }`                                  | 广播消息给所有玩家（平台中继）。                              |
| `achievement.list`   | -                                               | `[{ id, title, description, unlocked, unlockedAt }]` | 获取当前游戏版本的成就列表及解锁状态。                           |
| `achievement.unlock` | `{ achievementId, playerId }`                   | `{ success: true, new: boolean }`                    | 解锁成就。`playerId` 必须为当前玩家 ID。                   |
| `stats.report`       | `Record<string, number>`                        | `{ success: true }`                                  | 上报统计数据；平台根据 Manifest 配置按增量/全量写入。              |

### 8.3 事件列表 (Event)

平台会主动推送以下事件给游戏进程：

- `event.message`: 收到其他玩家的消息（Payload 至少包含 `{ senderId, messageId, sentAt, ... }`）
- `event.playerJoined`: 有新玩家加入房间
- `event.playerLeft`: 有玩家离开房间
- `event.gameEnd`: 游戏被强制结束（如房间解散）
