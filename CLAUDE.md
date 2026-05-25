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

| 分类           | 技术 / 库                      | 备注                             |
|--------------|-----------------------------|--------------------------------|
| 桌面框架         | Electron                    | <br />                         |
| 前端框架         | Vue 3                       | <br />                         |
| 开发语言         | TypeScript（严格模式）            | <br />                         |
| UI 组件库       | Naive UI                    | <br />                         |
| 状态管理         | Pinia                       | <br />                         |
| 构建工具         | electron-vite               | <br />                         |
| 打包工具         | electron-builder            | <br />                         |
| 包管理器         | pnpm                        | <br />                         |
| 进程间通信        | Electron IPC（contextBridge） | <br />                         |
| 本地数据存储       | electron-store              | v10+ (ESM)，需在构建中配置 include     |
| 客户端更新        | electron-updater            | GitHub Releases 作为更新源          |
| WebSocket 服务 | ws                          | <br />                         |
| 版本比较         | semver                      | 用于平台版本与游戏版本兼容性检查               |
| ZIP 解压       | extract-zip                 | 纯 Node.js 解压，不依赖外部进程           |
| 7Z 解压        | 7zip-bin (7za)              | 通过 `child_process.execFile` 调用 |
| 目标平台         | Windows 10/11 x64           | <br />                         |

***

## 三、项目目录结构

```
bz-games/
├── CLAUDE.md                             # AI 开发上下文与项目规范文档
├── README.md                             # 项目简介与基础使用说明
├── DEVELOPER_GUIDE.md                    # 面向游戏接入方的开发接入指南
├── build/
│   └── installer.nsh                     # NSIS 自定义安装/卸载钩子（多语言支持）
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
│   │       │   ├── MarketListView.vue      # 市场列表页面（一级界面）
│   │       │   ├── MarketView.vue          # 市场游戏详情页面（二级界面）
│   │       │   ├── NotificationView.vue   # 通知窗口页面
│   │       │   ├── RoomView.vue           # 房间页面
│   │       │   ├── SettingsView.vue       # 设置页面
│   │       │   └── StatisticsView.vue     # 统计页面
│   │       ├── composables/
│   │       │   └── useImageCache.ts        # 统一图片缓存层（本地+远程）
│   │       ├── components/
│   │       │   ├── CachedImg.vue           # 远程图片缓存组件（市场专用）
│   │       │   ├── CheckInModal.vue        # 签到弹窗组件
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
│   │           ├── deleteEffect.ts         # 游戏删除碎裂特效工具
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

| 术语                                  | 说明                                                                             |
|-------------------------------------|--------------------------------------------------------------------------------|
| **游戏清单 (Game Manifest)**            | `game.json` 文件，描述游戏元信息与平台集成配置                                                  |
| **游戏库 (Library)**                   | 用户已载入平台的所有游戏集合，来源于本地默认目录与已记录的多游戏路径                                             |
| **房间 (Room)**                       | 一次联机会话，包含房主与所有玩家的状态                                                            |
| **房主 (Host)**                       | 创建房间的玩家，其平台负责运行 Room Server                                                    |
| **玩家 (Player)**                     | 加入房间的用户（含房主自身）                                                                 |
| **Room Server**                     | 房主平台运行的 WebSocket 服务器，经内网穿透工具对外暴露                                              |
| **Room Client**                     | 非房主玩家的平台连接 Room Server 的 WebSocket 客户端                                         |
| **Game API Server**                 | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力                               |
| **游戏市场目录 (Market Directory)**       | 顶层 `market.json` 文件，`sources` 数组列出所有可用市场源，平台一级界面展示                             |
| **游戏市场索引 (Market Index)**           | 远程 `market.json` 文件（每个市场源仓库中），描述该市场内可展示和可下载的游戏及其版本信息                           |
| **市场安装包 (Market Package)**          | 市场游戏某个版本对应的下载产物，平台下载后校验并安装到默认游戏目录                                              |
| **下载任务 (Download Task)**            | 市场下载安装的一次任务实例，包含状态机、不可变元数据和 AbortController，支持暂停/恢复/取消                         |
| **下载任务快照 (Download Task Snapshot)** | 暂停或中断时持久化到 `pending-tasks.json` 的进度数据，包含已下载字节数、下载 URL、SHA256 等，用于断点续传恢复        |
| **断点续传 (Resume Download)**          | 利用 HTTP Range 请求头从上次断点继续下载，服务端不支持时自动降级为全量下载                                    |
| **bz-config.js**                    | 平台在游戏启动前生成的配置文件（包含端口、Token、玩家信息、房间 ID、`isHost` 与 `isMultiple`），解决进程环境变量传递不可靠问题 |
| **内网穿透**                            | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                                   |
| **平台 SDK**                          | 未来提供的 npm 包（`bz-launcher-sdk`），封装 Game API Server 调用，供游戏开发者使用                  |

### 4.1 Game Manifest 规范

- **统计信息国际化**：`statistics` 字段支持键值对格式（`[{ "key": "Display Name" }]`），用于在平台统计界面显示本地化的统计项名称。
- **时间追踪优化**：平台会自动追踪并记录所有游戏的游玩时长（`time`），无需在 `statistics` 字段中显式定义。若定义了 `time`
  ，平台也会正常处理。
- **详情媒体扩展**：`video` 字段为可选项，指向游戏目录内预览视频（`mp4/webm/ogv/mov/m4v`），仅用于详情页展示。
- **本地存储加密开关**：`encryptLocalStorage` 为可选布尔字段，仅作用于 Web 游戏 `localStorage` 对应的 `gamedata.json` 持久化。
- **游戏类型扩展**：`type` 支持 `singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`，其中 `singlemultiple`
  代表同时支持单人与联机，`networkgame` 代表网页游戏（仅启动网页，不参与房间联机流程）。
- **网页游戏版本豁免**：`networkgame` 类型游戏导入/安装时**忽略 `version` 字段**，仅以 `id` 判断是否已存在。同一 `id` 的网页游戏不可重复导入，若需更新版本请先删除旧版再重新导入。版本号不参与 semver 校验。
- **远程网页启动**：`entry` 新增 `url` 模式；当 `entry=url` 时，Manifest 必须提供 `web_url`（合法 URL），平台直接打开该网页地址。

### 4.2 游戏市场索引 JSON 规范

- **托管方式**：游戏市场索引文件由独立 GitHub 仓库维护，推荐固定文件名为 `market.json`。平台优先读取 GitHub 原始地址
  `https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json`；若 GitHub 拉取失败，必须自动回退到 OSS 镜像地址 `https://web-bz.oss-cn-beijing.aliyuncs.com/market.json`。
- **两级市场架构**：顶层 `market.json` 作为**市场目录**，`sources` 数组列出所有可用市场源；每个市场源的仓库中有自己的
  `market.json`。顶层 `market.json` 同时保留 `games` 字段（对应 `sources[0]`）。外部市场源从其仓库 raw 地址直接加载，不经 OSS
  回退。
- **拉取时机**：用户首次进入"游戏市场"列表页面时拉取市场目录（`getSources`），进入具体市场时拉取该市场的游戏索引（`getIndex`
  ）。均有 1 小时内存缓存。
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
  "generatedAt": "2026-05-22T04:21:02.000Z",
  "sources": [
    {
      "marketId": "official",
      "marketName": "BZ Games Market",
      "coverUrl": "http://cdn.bzgames.top/bz-games-market/cover.png",
      "generatedAt": "2026-05-22T04:21:02.000Z",
      "repository": "https://github.com/baozha2023/bz-games-market.git",
      "branch": "master",
      "featured": true,
      "visibility": "public"
    }
  ],
  "games": []
}
```

#### 顶层字段说明

| 字段              | 类型               | 必填 | 说明                                                    |
|-----------------|------------------|----|-------------------------------------------------------|
| `schemaVersion` | `string`         | 是  | 市场索引格式版本，建议使用语义化版本，便于未来升级兼容逻辑。                        |
| `marketId`      | `string`         | 是  | 当前市场的唯一标识，与 `sources[0].marketId` 一致。                 |
| `marketName`    | `string`         | 是  | 当前市场的显示名称。                                            |
| `generatedAt`   | `string`         | 是  | 索引生成时间，ISO 8601 格式。平台在市场页面标题下方展示该时间（本地化格式）。           |
| `sources`       | `MarketSource[]` | 是  | 市场源列表，至少 1 项。平台一级界面展示所有 `visibility !== "hidden"` 的源。 |
| `games`         | `MarketGame[]`   | 是  | 当前市场（sources[0]）中的游戏列表。                               |

#### 市场源对象 `MarketSource`

| 字段            | 类型        | 必填 | 说明                       |
|---------------|-----------|----|--------------------------|
| `marketId`    | `string`  | 是  | 市场唯一标识。                  |
| `marketName`  | `string`  | 是  | 市场显示名称。                  |
| `coverUrl`    | `string`  | 否  | 市场封面图，用于一级界面卡片。          |
| `generatedAt` | `string`  | 是  | 该市场索引的生成时间。              |
| `repository`  | `string`  | 是  | GitHub 仓库地址（仅支持 GitHub）。 |
| `branch`      | `string`  | 是  | 仓库分支。                    |
| `featured`    | `boolean` | 否  | 是否重点推荐。                  |
| `visibility`  | `string`  | 否  | `public` / `hidden`。     |

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

- **格式识别**：平台必须根据 `downloadUrl` 的文件后缀自动识别压缩包格式；支持 `.zip`（`extract-zip` 纯 Node.js 解压）和
  `.7z`（`7zip-bin` 内置 `7za` 解压），不要求市场维护者额外填写格式字段。
- **解压方式**：`.zip` 使用 `extract-zip`（纯 Node.js 实现），不依赖 PowerShell 或外部解压工具；`.7z` 使用 `7zip-bin` 内置的
  `7za` 二进制。
- **目录约束**：压缩包解压后的根目录或第一层单子目录中必须存在 `game.json`，且整体目录结构应能直接作为一次普通"本地导入"
  输入目录。
- **一致性校验**：平台安装前必须校验下载包的 `sha256`、`size`、`game.json.id`、`game.json.version`；
  `game.json.platformVersion` 使用 `semver` 做语义化兼容性检查（支持 string 和 tuple 两种 manifest 格式），**不做字符串直接比对
  **。
- **安全约束**：压缩包内不得出现绝对路径、盘符路径或 `../` 路径穿越条目；发现后直接拒绝安装。
- **覆盖策略**：若本地已存在相同 `id + version`，默认视为"已安装"，不重复覆盖；后续若要支持"重新安装"，需单独增加明确交互。**网页游戏（`networkgame`）仅以 `id` 判断**，同一 `id` 不可重复导入，若需更新请先删除旧版。
- **落盘路径**：市场安装目标目录优先使用当前设置中的 `gameStoragePath`；若未设置，则回退到应用根目录下的默认 `games/` 目录。

#### 市场任务状态与错误码类型

```typescript
// src/shared/types/market.types.ts

type MarketTaskStatus =
    | "idle" | "downloading" | "verifying" | "extracting"
    | "installing" | "completed" | "error" | "canceled"
    | "paused" | "interrupted";

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
- **任务状态推送**：主进程每次更新任务状态后通过 `market:event` 推送给渲染进程。通知由根布局组件 `AppContent`
  统一处理，确保用户在任何页面都能收到安装完成/失败的通知。
- **通知去重与生命周期**：模块级 `notifiedTaskIds` Set 防止重复弹 toast（仅在 `completed`/`error`/`canceled` 终态时写入，
  `paused`/`interrupted` 等中间态不污染 Set）；`AppContent` 作为始终挂载的根组件保证通知可跨页面送达，`onUnmounted`
  时注销事件监听器。
- **幂等性设计**：前端 `pendingDownloads`/`pendingCancels`/`pendingPauses`/`pendingResumes` Set + 后端状态机守卫 +
  `startPipeline().catch()` 中 `signal.aborted` 检查，多层防护确保同一任务不会并发执行或被重复触发。
- **内存管理**：主进程 `finalize()` 在终态时删除临时文件并延迟 30 秒清理 `tasks` Map 条目。MarketView
  组件卸载时注销事件监听器并清理所有定时器。

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
- 拉取远程游戏市场索引、下载市场安装包并执行校验与安装。所有 OSS 请求均携带 `Referer: https://bz-game-client.local` 防盗链
  header（fetch 显式设置 + `session.webRequest.onBeforeSendHeaders` 全量拦截）
- 运行 Room Server（Host 时）/ Room Client（Client 时）
- 运行 Game API Server（每次有游戏运行时）
- 注册并处理所有 IPC Handler
- 广播游戏进程生命周期事件（start/end）
- 更新检查、下载、安装由 `UpdateService` 统一处理

#### 渲染进程 (Renderer Process)

- Vue 3 + TypeScript UI，仅负责界面展示与交互
- 通过 `window.electronAPI` 调用主进程功能（严禁直接使用 Node.js API，所有文件操作与系统调用必须通过 IPC）
- 使用 Pinia 管理前端状态（GameStore, RoomStore）
- 负责游戏市场页面展示、版本选择、下载进度/取消、安装结果反馈、索引更新时间展示。通过 `pendingDownloads`/`pendingCancels` Set
  实现按钮幂等保护，`isAlive` 标志位防止卸载后 toast 泄漏
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
  ，实现跨启动模式（File/Serve）的数据互通与版本隔离。采用内存缓存 + 500ms 防抖批量落盘策略，避免 IPC 同步写盘导致游戏卡顿。
- **Web 存储上下文模式**：游戏窗口使用 `contextIsolation: false` 以确保 preload 脚本在游戏 JS 执行前覆盖
  `window.localStorage`。配合 `nodeIntegration: false` 维持基本安全隔离。窗口关闭时通过 `beforeunload` 回调 +
  `ipcRenderer.sendSync` 确保数据完整落盘，避免异步 send 丢数据。
- **Web 游戏独立渲染进程**：每个游戏窗口使用独立 `partition: persist:game_<id>_<version>`，通过 Chromium
  站点隔离机制自动分配到独立的渲染进程，确保不同游戏进程不互相干扰。
- **Web 存储可选加密**：支持通过 Manifest 字段 `encryptLocalStorage` 控制 `gamedata.json` 是否加密存储（默认关闭）。
- **Web 联机模式标记**：平台生成的 `bz-config.js` 提供 `isMultiple` 字段，便于 `singlemultiple` 游戏在运行时区分单人模式与联机模式。
- **远程网页模式约束**：当 `entry=url` 时，平台不生成 `bz-config.js`，也不向页面注入 `window.BZ_CONFIG`。

### 5.5 代码组织与内聚性

- **模块化**：复杂逻辑（如 `GameLoader.loadGameFromDialog`）拆分为独立函数（`validateManifestFile`, `checkPlatformVersion`,
  `checkEntryFile` 等），提升可读性与可维护性。
- **环境配置抽离**：游戏环境变量准备与 `bz-config.js` 生成逻辑由 `GameEnvironment` 统一处理，提高 `GameManager` 的内聚性。
  `stripProcessEnv()` 过滤 `ELECTRON_`/`NODE_`/`NPM_`/`VSCODE_` 前缀的环境变量，避免平台内部环境泄漏到子进程。
- **GameManager 生命周期**：`cleanupApiOnly()` 方法仅清理 WebSocket/HTTP 服务器资源，不终止游戏进程也不关闭窗口。当 API
  Server 超时自动停止时调用，避免误杀正在运行的游戏。
- **MarketService 设计**：
    - **两级市场架构**：`getSources()` 拉取顶层市场目录（通过 `fetchDirectory()` 获取，主源 GitHub + 备源 OSS），
      `getIndex(sourceIdx)` 拉取指定市场源的游戏索引。sourceIdx=0 使用 `fetchIndexInternal()`（主备双源），sourceIdx>0 使用
      `fetchIndexForSource()`（通过 `gitToRawUrl()` 推导 raw URL 直接加载，无 OSS 回退）。
    - `fetchJson(url)` 为通用 HTTP JSON 获取器，统一注入 `Referer` 防盗链 header。`fetchDirectory()` 与
      `fetchIndexFromUrl()` 均基于此构建，各司其职：前者解析 `MarketDirectorySchema`，后者解析 `MarketIndexSchema` 并过滤
      `hidden` 游戏。
    - `getSources()` 与 `getIndex(sourceIdx, forceRefresh)` 均内置 1 小时内存缓存，按 sourceIdx 独立缓存，
      `forceRefresh=true` 或缓存过期时重新拉取，应用重启后自动失效。同时，`forceRefresh=true` 时一并清除全部图片缓存（
      `cachedImages`），保证封面/图标数据与索引数据同步刷新。
    - `getCachedImageDataUrl(url)` 为按需图片缓存方法，通过 `fetch(url)` 下载远程图片并转 base64 Data URL，缓存于
      `cachedImages` Map（1 小时 TTL）。15 秒超时 + `AbortController` 保护，`finally` 块必定清理定时器。**双重防线**：校验
      response body 非空（防止网络超时缓存空 Data URL）和 `content-type` 必须以 `image/` 开头（防止非图片响应被错误缓存）。
      仅当渲染进程的 `<CachedImg>` 组件请求时才触发下载，不预载所有图片。
    - `CachedImg` 为通用图片缓存组件，初始显示原始 URL（浏览器直连），异步调用 `getCachedImage` IPC 拿到 Data URL 后无缝替换。
      `onUnmounted` 时 abort 飞行中的请求，防止内存泄漏。
    - `downloadAndInstall(gameId, version, sourceIdx)` 中 `sourceIdx` 为**必传参数**，直接从对应 source
      拉取索引后查找目标游戏，无回退逻辑。
    - `gitToRawUrl()` 从 GitHub 仓库地址推导 raw 文件
      URL：`https://raw.githubusercontent.com/{owner}/{repo}/{branch}/market.json`。
    - `inferArchiveType()` 根据 `downloadUrl` 后缀自动识别压缩包格式（当前支持 `.zip` 和 `.7z`）。`.zip` 使用 `extract-zip`
      纯 Node.js 解压，`.7z` 使用 `7zip-bin` 内置的 `7za` 二进制通过 `child_process.execFile` 解压。
    - **下载管线架构**（v2.2）：下载子系统采用清晰的 **不可变元数据 + 活动任务 + 单一状态机** 三层模型。
        - `TaskMeta`（不可变元数据）：包含 `downloadUrl`、`sha256`、`size`、`downloadPath`、`archiveType`、`sourceIdx` 等固定参数。
        - `ActiveTask`：运行时对象，绑定 `state`（MarketTaskState）、`meta`（TaskMeta）、`abort`（AbortController）。
          `AbortController` 不再是可选字段，每个活动任务必定拥有。
        - `transition(taskId, status, extra?)` 是**唯一的状态转换入口**（Single Source of Truth），内置状态机守卫：终态（
          completed/error/canceled）不可再转换。`paused` / `interrupted` 可被 `cancel` 正常取消（并清理快照文件）。
          所有状态变更必须经过此方法。
    - **Pipeline 与状态管理解耦**：`startPipeline()` (fire-and-forget) → `runPipeline()`（纯执行，仅接收 `AbortSignal`
      参数，不感知"暂停"）。`runPipeline()` 编排五阶段流程（download → verify → extract → install → finalize），各阶段之间通过
      `signal.throwIfAborted()` 检查是否被中止。错误处理统一在 `startPipeline().catch()` 中：若 `signal.aborted`
      则静默返回（状态已由 pause/cancel 设置）；否则调用 `transition("error", ...)` + `finalize()`。
    - **断点续传**：`downloadArchive()` 下载前通过 `getPartialFileSize()` 检查已存在部分文件。若有部分文件且服务端支持
      HTTP Range（返回 `206`），以追加模式续传；若服务端返回 `200`（不支持 Range），自动删除部分文件从头下载（自动降级）。下载流通过
      `writer.write()` 返回值判断背压，配合 `drain` 事件保证内存安全。
    - **暂停/恢复/取消**：
        - `pauseTask()`：先将 status 设为 `paused`（同步，保证 pipeline catch 块见到"paused"而不覆盖状态），再
          `abort.abort()`，最后将进度写入 `pending-tasks.json` 持久化快照。
        - `resumeTask()`：从 `pending-tasks.json` 读取快照，重新拉取索引校验兼容性后调用 `startTask()` + `startPipeline()`
          启动新管线。
        - `cancelTask()`：对运行中任务先 `transition("canceled")` 再 `abort.abort()` + `finalize()`；对已暂停任务直接
          `transition("canceled")` + `finalize()` + 删除快照。
    - **快照持久化**：`writeSnapshot()` / `removeSnapshot()` 操作 `${userData}/.market-cache/pending-tasks.json`。应用启动时
      `restorePendingTasks()` 读取快照重建 `interrupted` 状态任务，前端通过 `getPendingTasks` 在 `onMounted` 时同步到 UI。
    - **文件生命周期**：`finalize()` 在终态（completed/error/canceled）时删除临时下载文件与解压目录。暂停/中断时**保留**
      部分文件以便续传。
    - 错误分类由 `classifyErrorCode()` 统一处理，根据错误消息自动归类为四种错误码（download/verify/extract/install）。
    - `tasks` Map 维护任务全生命周期，`finalize()` 在清理临时文件后延迟 30 秒删除 Map 条目，确保 UI 能读到终态。
- **useImageCache 统一图片缓存层**：
    - 模块级 `Map<string, CacheEntry>` 跨所有组件共享，一份 data URL 在整个渲染进程中只加载一次，消除视图切换导致的重复
      IPC
      调用与磁盘 I/O。
    - `load(key, loader, ttlMs)` 采用**策略模式**：缓存层不关心数据来源，通过 `loader` 闭包注入；TTL 由调用方通过 `ttlMs`
      参数自行管理（`ttlMs <= 0` 永不过期，`ttlMs > 0` 超时后重新拉取）。
    - 内置 `pendingLoads` Map 防止缓存击穿：同一 key 的并发 `load()` 调用共享同一份飞行中 Promise，避免重复网络请求。
      `.finally()` 确保无论加载成功还是失败都清理 `pendingLoads`，失败后允许自动重试，避免永久阻塞。
    - LRU 淘汰策略（上限 500 条目），`evictLRU()` 遍历全 Map 找最旧条目（O(n)，500 规模可接受）。
    - `clear()` 同时清理缓存与 `pendingLoads`；`invalidatePrefix(prefix)` 支持按前缀批量失效。
    - 导出独立函数 `gameAssetKey(gameId, version, field)` / `gameAssetPrefix(gameId, version)` 封装 key 生成规则（
      `<id>@<version>@<field>`），与 composable 核心逻辑解耦。
    - 导出独立函数 `invalidateGameAssetCache(gameId)`：接收 gameId，按前缀 `gameId@` 清除该游戏的所有 asset 缓存。从 Pinia
      store（`addGame`/`removeGame`）和 `AppContent`（市场安装完成事件）直接调用，无需 Vue setup 上下文。
    - 消费者：`GameCover.vue`（cover/video，`ttlMs=0` 永不过期）、`GameIcon.vue`（icon，`ttlMs=0` 永不过期）、`CachedImg.vue`（远程
      URL，`ttlMs=60*60*1000` 即 1 小时，由组件内部 `MARKET_IMAGE_TTL_MS` 常量管理）。
- **应用入口 OSS 拦截**：`index.ts` 在 `app.whenReady` 中注册 `session.defaultSession.webRequest.onBeforeSendHeaders`，对所有
  `web-bz.oss-cn-beijing.aliyuncs.com` 请求注入 `Referer` header，覆盖 `<img>` 标签等非 fetch 请求。

### 5.6 CSS 变量主题系统

- **语义变量**：`theme.css` 定义全局 `:root` 层基础色板（`--bz-gold`、`--bz-green`、`--bz-red`、`--bz-amber`、`--bz-info-blue`
  等），`.theme-dark` 与 `.theme-light` 分别定义暗/亮专属变量（`--bz-bg-*`、`--bz-text-*`、`--bz-border-*`、`--bz-chat-*`
  等），组件层统一使用 `var(--bz-*)` 引用，彻底消除硬编码色值。
- **`theme: "auto"` 模式**：`AppSettings.theme` 新增 `"auto"` 选项（默认值）。`App.vue` 通过
  `window.matchMedia('(prefers-color-scheme: dark)')` 监听系统主题变化，自动切换 `.theme-dark` / `.theme-light` CSS
  class。`onUnmounted` 时注销 `change` 监听器。NaiveUI 的 `n-config-provider :theme` 同步联动。
- **通知窗口独立主题**：`NotificationService` 创建成就弹窗时，根据用户设置的 `theme` 字段解析实际主题（`auto` →
  `nativeTheme.shouldUseDarkColors`），注入到 `NotificationView` 组件。`NotificationView` 独立导入 `theme.css` 获取 CSS 变量。
  `GameDetailView` 的灯光秀金色边框也统一迁移为 `--bz-gold` 变量。

***

## 六、开发规范与约束

### 6.1 游戏导入与市场安装规范

- **任意文件夹导入**：`GameLoader` 支持任意目录导入。若目录缺少 `game.json`，前端需弹出补录表单，由用户填写核心字段后生成
  Manifest 并继续导入。
- **文件选择策略**：Windows 下文件选择对话框使用 `openDirectory` 模式。
- **版本检查**：导入时会检查 `game.json` 中的 `platformVersion` 字段，若当前平台版本不满足要求（使用 `semver`
  比较），将拒绝导入并提示用户。
- **拖拽路径解析统一**：游戏库拖拽导入路径统一使用 `webUtils.getPathForFile(file)` 获取。
- **市场入口拉取策略**：进入"游戏市场"页面时，若缓存有效（1 小时内且未重启应用）则直接使用缓存数据；超过 1 小时或首次进入则自动请求远程
  `market.json`。用户可点击"刷新"按钮强制重新拉取。应用重启后缓存自动失效（仅内存缓存，不落盘）。
- **市场索引更新时间展示**：`MarketView` 从 `index.generatedAt` 读取时间戳，在标题"游戏市场"右侧以小字展示（格式
  `YYYY-MM-DD HH:mm`），使用 `updatedAtLabel` computed 实现，三语 i18n 支持。
- **OSS 防盗链 Referer**：所有指向 `web-bz.oss-cn-beijing.aliyuncs.com` 的请求（市场索引拉取、游戏包下载、封面/图标/截图
  `<img>` 标签）均携带 `Referer: https://bz-game-client.local`。实现分两层：`fetch` 请求在 `fetchIndexFromUrl()` 和
  `downloadArchive()` 中显式设置 header；`<img>` 标签等渲染层请求由 `index.ts` 中
  `session.defaultSession.webRequest.onBeforeSendHeaders` 全局拦截注入。
- **市场下载暂存**：市场安装包应先下载到应用可控的临时目录（如 `.market-cache/`）中，校验通过后再解压并导入。
- **市场安装统一导入**：市场下载成功后，解压目录必须复用现有 `GameLoader` 导入链路，避免形成独立且不一致的安装逻辑。
- **市场安装失败保护**：下载、校验、解压或导入任一步失败时，不得破坏已有游戏记录；仅清理当前失败任务产生的临时文件（`finally`
  块中执行 `removeIfExists`，`.catch(() => undefined)` 防止清理异常阻断流程）。
- **市场错误码分类**：所有安装失败必须归类为四种错误码之一：`download`（下载失败）、`verify`（校验失败，含 sha256 与 size 不匹配）、
  `extract`（解压失败）、`install`（安装/导入失败）。主进程通过错误信息自动归类（`classifyErrorCode`），渲染进程根据错误码映射
  i18n 文案展示给用户，禁止直接暴露内部错误码。
- **市场取消逻辑**：`cancelTask()` 对运行中任务先通过 `transition("canceled")` 设置状态，再 `abort.abort()` 触发 pipeline
  中止，最后 `finalize()` 清理临时文件。对已暂停/中断任务，直接 `transition("canceled")` + 删除快照 + `finalize()`。
- **市场安装包 platformVersion 校验**：`installGame` 对 manifest 的 `platformVersion`（支持 string 和 tuple `[min, max]`
  两种格式）使用 `semver` 做语义化兼容性检查，**不得**与市场索引的 `platformVersion` 做字符串 `!==` 比较。tuple 格式 join
  后必然不等于市场字符串，会导致校验 100% 失败。
- **市场幂等性保护**：
    - **前端**：`pendingDownloads` / `pendingCancels` / `pendingPauses` / `pendingResumes` 四个 `Set` 追踪飞行中的请求。
      `handleDownload` 覆盖 `paused`/`interrupted` 防重复（暂停态按钮 disabled + 后端状态机守卫）。`handleCancel` 覆盖
      active + paused + interrupted 全态。`finally` 块清理 Set。
    - **后端**：`downloadAndInstall` 覆盖 `ACTIVE_STATUSES` + `paused` + `interrupted` 所有非终态。`transition()`
      状态机守卫终态不可再转换、paused 不可被 cancel 覆盖。`startPipeline().catch()` 通过 `signal.aborted` 静默返回，不覆写已设置的状态。
- **市场内存管理**：`finalize()` 在终态（completed/error/canceled）时删除临时下载文件与解压目录，延迟 30 秒清理 `tasks` Map
  条目，防止长期运行内存泄漏。
- **市场下载背压处理**：`downloadArchive` 写入流检查 `writer.write()` 返回值，返回 `false` 时 await `drain`
  事件，防止极端快速下载场景下内存激增。
- **市场 Toast 跨页面通知**：市场安装完成/失败通知由根布局组件 `AppContent` 统一监听 `market:event`
  处理，确保用户在游戏库、设置等任何页面都能收到。`marketNotifiedTaskIds` Set 在 `completed`/`error`/`canceled` 终态时写入，中间态（
  `idle`/`downloading`/`paused`/`interrupted` 等）不污染 Set，保证每次安装只弹一次 toast。
- **市场平台兼容性前端检测**：渲染进程通过 `system:getAppVersion` 获取当前平台版本，使用 `semver.satisfies` 判断每个游戏版本的
  `platformVersion` 兼容性；不兼容时下载按钮变灰并显示"平台版本不兼容"文案。
- **市场任务状态管理**：已完成/失败/取消的任务在 500ms 后从渲染进程 `taskStates` 中自动清除，进度条 UI 回归原始布局；
  `paused`/`interrupted` 状态保留不自动清除。页面切换回来时通过 `syncExistingTasks`
  恢复进行中（downloading/verifying/extracting/installing/paused/interrupted）的任务；启动时通过 `getPendingTasks`
  恢复持久化快照。终态通知由 `AppContent` 统一处理并确保不重复。
- **重复版本处理**：若本地已安装相同 `id` 与 `version`，市场页应明确展示"已安装"状态，并阻止重复安装。**网页游戏（`networkgame`）例外**：仅以 `id` 判断是否已安装，忽略版本号。
- **表单约束**：
    - `id` 需实时检测重复并校验反向域名格式。
    - `platformVersion` 固定为当前平台版本，不允许修改。
    - `type` 使用下拉框；仅当 `type` 为 `multiplayer` 或 `singlemultiple` 时展示 `minPlayers/maxPlayers`。
    - `version` 必须通过语义化版本校验（`x.y.z`）；**网页游戏（`networkgame`）除外**，版本号不做校验但仍需填写。
    - `entry` 会自动探测并允许用户手动修改；仅当 `entry` 为 `.html` 时校验入口文件存在。`entry=serve` 或 `entry=url`
      不做入口文件存在性校验。
    - `entry=url` 时必须提供 `web_url`（合法 URL）。
    - `icon/cover` 若填写则必须是游戏目录内存在的相对路径。

### 6.1.1 NSIS 多语言安装程序

- **语言选择**：`electron-builder` NSIS 配置启用 `multiLanguageInstaller: true`，支持 `zh_CN`、`en_US`、`ja_JP`
  三种安装语言。用户在安装向导第一步选择语言后，NSIS 继续以该语言完成安装流程。
- **语言标记文件**：`build/installer.nsh` 在 `customInstall` 钩子中根据 `$LANGUAGE` 常量（1033=en-US, 2052=zh-CN,
  1041=ja-JP）写入 `.initial-language` 标记文件到安装目录。首次启动时 `StoreService.getSettings()`
  读取该文件，覆盖默认语言设置后立即删除文件，确保语言设置只生效一次。
- **卸载数据清理**：`installer.nsh` 的 `customUnInstall` 钩子在卸载时清理 `%APPDATA%\BZ-Games` 目录，确保卸载后无残留数据。
- **仅 Windows**：`installer.nsh` 为 NSIS 专用脚本，仅对 Windows 平台打包生效，不影响 macOS/Linux 构建。

### 6.1.2 游戏保存路径管理

- **空目录约束**：`system:selectGameStoragePath` 通过 `fs.readdirSync` 检查所选目录是否为空。若非空，返回
  `{ path, error: "directory_not_empty" }`，由前端通过 `dialog.warning()` 弹出友好提示（使用三语 i18n
  文案），阻止选择。防止未来卸载时误删该目录中的其他文件。
- **精确清理**：`system:removeGameStoragePath` 删除保存路径时，仅删除路径下含 `game.json` 清单的一级子目录（
  `removeEmptyGameDirs`），不删除存储根目录下的其他文件或子目录。避免用户将游戏库目录与其他用途文件混放时误删数据。
- **单层检测**：`removeEmptyGameDirs` 仅检查存储根目录的一级子目录，不递归检测嵌套目录。符合"游戏库根目录 → gameId 子目录 →
  version 子目录"的标准目录结构。

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
- `market:getSources`：拉取并解析市场目录（含 sources 列表）。
- `market:getIndex`：拉取并解析指定市场源的远程游戏市场索引。
- `market:getCachedImage`：按需下载远程图片并返回 base64 Data URL，缓存 1 小时。供 `<CachedImg>` 组件使用。
- `market:downloadAndInstall`：下载指定市场游戏版本、执行完整性校验并安装到默认游戏目录。支持断点续传（HTTP
  Range），服务端不支持时自动降级为全量下载。
- `market:getTaskState`：获取市场下载/安装任务状态与进度。
- `market:cancelTask`：取消指定市场下载/安装任务（含已暂停和中断的任务）。
- `market:pauseTask`：暂停正在进行的下载任务，进度持久化到本地快照文件。
- `market:resumeTask`：从暂停快照恢复下载任务，重新拉取索引校验兼容性后启动新管线续传。
- `market:getPendingTasks`：读取本地快照文件，返回所有未完成的暂停/中断任务。
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
- `room:reconnect`：客机游戏进程崩溃后重新启动游戏（要求 room.state === "playing"）。
- `system:getSettings`：读取当前应用设置。
- `system:getAppVersion`：获取当前平台版本号（供渲染进程进行平台兼容性判断）。
- `system:saveSettings`：保存应用设置并应用相关系统行为。
- `system:uploadAvatar`：选择并处理玩家头像。
- `system:selectGameStoragePath`：弹窗选择默认游戏保存路径。返回 `{ path: string }` 或
  `{ path: string; error: "directory_not_empty" }`，要求所选目录为空（防止卸载时误删其他文件），若非空则由前端弹出友好提示。
- `system:openPath`：在系统文件管理器中打开路径。
- `system:removeGameStoragePath`：删除保存路径及其内部已导入游戏数据。仅删除含 `game.json` 清单的一级子目录，不删除存储根目录下的其他文件或子目录。
- `system:uninstall`：卸载客户端。先检查 `uninstall.exe` 存在性，可选删除所有游戏库目录（`deleteGames: boolean`
  ），随后打开系统卸载程序并退出应用。返回 `{ success: boolean; error?: string }`。
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
- `game:storage:flush`：将内存缓存的 localStorage 数据批量落盘（sendSync 同步调用，确保 beforeunload 时不丢数据）。
- `system:openUrl`：使用系统默认浏览器打开外部 URL。

### 6.3 UI 交互规范

- **返回导航**：所有二级页面（设置、统计、成就等）的 `n-page-header` 必须包含返回按钮，统一导航回 `Library` 页面。
- **市场入口位置**：在游戏库左侧导航区域"游戏市场"按钮，点击后进入市场列表页面（一级界面 `/markets`）。
- **市场两级导航**：一级界面（`MarketListView`）以卡片网格展示所有可用市场源（来自 `sources`
  数组），展示市场封面、名称、更新时间。用户点击任意市场卡片进入该市场的游戏列表（二级界面 `/market/:sourceIdx`
  ）。二级界面左上角有返回按钮可回到市场列表。
- **市场刷新行为**：市场列表和游戏索引均有 1
  小时内存缓存。首次进入或缓存过期时自动拉取最新数据；加载中展示骨架屏或加载态；全部来源失败时展示错误态与重试按钮。用户可通过"
  刷新"按钮强制拉取最新数据。缓存有效期内重复进入不发起网络请求。
- **市场索引时间展示**：市场页面标题"游戏市场"右侧以小字展示索引更新时间（`generatedAt` 字段，格式 `YYYY-MM-DD HH:mm`
  ），安装目录另起一行独立展示。
- **市场展示内容**：市场列表至少展示封面/图标、游戏名、作者、类型、标签、简介、最新版本、安装状态与下载按钮。
- **市场详情与安装**
  ：用户可查看游戏简介、当前选中版本详情、版本列表、平台兼容要求、包体大小；当前选中版本的说明与下载操作区必须紧跟在选中游戏信息下方展示，不得沉到底部；点击下载后展示下载进度、校验中、安装中、完成/失败等明确状态。
- **市场列表容器**：市场页不应再额外包一层无业务意义的“市场游戏”外层卡片；应直接展示游戏列表项，减少视觉嵌套。
- **市场展开交互**：市场列表需支持手动展开/收起动画，默认全部收起；已展开项不得因为用户点击其他游戏而自动收回，必须由用户主动收起。展开/收起箭头按钮使用
  `@click.stop` 阻止事件冒泡，避免点击箭头时因父级 div 也绑定了 `@click` 导致双重 toggle。
- **市场安装目录提示**：市场页需明确提示当前安装目标目录；若用户未设置 `gameStoragePath`，需提示将安装到默认 `games/` 目录。
- **市场版本状态**：对于已安装版本、当前最新版本、预发布版本，需要在版本列表中展示不同状态标记，避免重复安装或误装测试版。
- **成就展示**：成就列表支持按游戏版本筛选，支持展开/收起，默认收起。若当前版本无成就，显示空列表。
- **动态元数据**：游戏详情页切换版本时，应优先展示当前选中版本的元数据（如简介、成就），若为空则直接展示为空，不应回退到最新版本数据。
- **游戏库展示**：
    - 游戏封面展示区域统一使用 **16:9** 比例，图片模式为 `contain`（完整显示）或 `cover`（填满）。
    - 支持 **长按** 游戏封面进入编辑模式，此时可拖动调整游戏排序。
    - 支持将任意游戏文件夹直接拖拽到游戏库窗口导入；缺少 `game.json` 时弹出补录表单。
    - 排序结果需持久化存储。
    - 聊天消息：当前用户发送的消息，名字显示为绿色，使用 `--bz-green` CSS 变量。
    - 语音消息：录制采用 Opus 编码（`audio/webm;codecs=opus`），采样率 24kHz、码率 32kbps，通过 `MediaRecorder` API 实现。语音消息最长
      10 秒，过短（<0.5s）不予发送。
    - 语音播放：点击语音消息气泡触发播放，文字切换为"播放中..."带三个依次闪烁的圆点动画（`dot-blink` @keyframes，
      `animation-delay` 错位 0s/0.2s/0.4s）。再次点击停止播放（`audio.pause()` + 状态清除）。`audio.onended` 自动恢复文字。
      `currentAudio` 引用确保停止行为确实终止音频播放。
    - 收藏游戏：特别喜欢的游戏在封面右上角展示爱心图标。
- **游戏详情页**：
    - 删除游戏功能升级为模态框，支持多选版本进行删除，默认选中当前版本。
    - 若 Manifest 配置了 `video` 字段，详情页进入后自动播放预览视频；视频结束后自动回退显示封面。
- **加入房间地址**：加入房间输入框需要回填最近一次成功地址（持久化于设置），减少重复输入。
- **房间连接状态可视化**：房间页需展示 `connecting / reconnecting / failed / disconnected` 状态，以及重连倒计时与失败原因。
- **统计/成就搜索**：右上角默认展示搜索图标，点击后展开输入框并支持按游戏名或游戏 ID 模糊搜索。
- **房间开始按钮冷却**：房间内收到 `room:game:end` 后，Host 的「开始游戏」按钮需禁用 5 秒。
- **客机重连按钮**：客机游戏进程意外退出后，当前仍是 `playing` 状态时，Ready/Unready 按钮位替换为"重连"按钮。点击后重新
  `launch()` 同一游戏版本。`room:game:start` 或 `playing→waiting` 时恢复原状。
- **统计界面**：卡片右上角需展示该游戏的所有版本号，使用自动换行布局。
- **设置页更新入口**：设置页需提供「检查更新」按钮，点击后弹出更新状态弹层，显示下载进度与安装按钮。
- **设置页卸载入口**：设置页底部（与保存按钮同行，`justify-content: space-between`）提供"卸载客户端"按钮（
  `type="error" secondary`）。点击后弹出 NaiveUI 自定义确认弹窗，包含不可撤销的警告文案、是否同时删除所有游戏库目录的勾选项、以及删除路径列表预览。确认后调用
  `system:uninstall` IPC 执行卸载。若处于开发模式或卸载程序不可用，弹出友好提示。
- **设置页头像预览**：点击设置页头像缩略图（`n-avatar` 添加 `class="avatar-clickable"` hover 缩放+阴影），弹出
  `n-modal preset="card"` 模态框，280×280 圆形大图预览；无头像时显示玩家名首字母大字（使用 `--bz-bg-card-placeholder` 和
  `--bz-text-on-placeholder` CSS 变量适配暗/亮主题）。
- **设置页主题跟随系统**：主题选择器新增"跟随系统"选项（`themeAuto`）。当选择 `auto` 时，平台自动跟随操作系统亮/暗模式切换，无需用户手动调整。
- **设置页官网链接**：设置页需展示官方网址 `http://www.bzgames.top/`，使用 NaiveUI `n-a` 组件渲染为可点击链接，`
  @click.prevent` 拦截默认跳转后通过 `system:openUrl` IPC 调用 `shell.openExternal` 打开系统默认浏览器。
- **设置页数据自检**：设置页需提供"数据自检"按钮，展示 `config.json`、游戏目录、版本路径、Manifest 完整性等检查结果。
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
    - **Host 聊天本地投递**：房主发送聊天消息时，直接通过 `mainWindow.webContents.send` + `roomServer.broadcast`
      （排除自己）推送，不经过 WebSocket 本地回环。
5. **游戏结束语义**：
    - `game.end` API：游戏主动调用，平台仅回复 `{success: true}`，不改变房间状态、不杀死进程、不通知他人。为未来战绩展示预留。
    - 游戏真正结束仅由 **Host 进程退出** 触发：`handleProcessExit` → `notifyRoomGameEnd` → state 变 `"waiting"` + 广播
      `room:game:end` + `room:state:sync`。客机 `RoomClient` 收到 `room:game:end` 后调用 `onGameStop` → `stop()`
      杀死所有客机进程。
    - 前端通过 `room:state:sync` 检测 `playing→waiting` 态变化来显示"游戏已结束"聊天消息，避免重复。

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

#### 客机重连流程（v2.0.5 新增）

当客机游戏进程意外崩溃退出后：

1. **触发条件**：`GameManager.handleProcessExit` → `GAME_PROCESS_ENDED` → `useRoomStore.onProcessEvent` 检测
   `type==="end" && room.state==="playing" && !isHost` → `isReconnectMode = true`。
2. **UI 表现**：客机玩家在房间页看到"重连"按钮，替代原有的 Ready/Unready 按钮。
3. **点击重连**：`handleReconnect()` → `reconnectGame()` → `room.reconnect` IPC → `gameManager.launch(gameId, version)`。
   `launch()` 内部 `isGameRunning()` 守卫（已退出进程为 false）→ 正常启动新进程，注入同一个 `BZ_ROOM_ID`。
4. **对其他人零影响**：Host 和其他客机完全不受影响，房间 `state` 保持 `"playing"`。客机进程退出不广播 `room:game:end`（只有
   Host 进程退出才会触发 `notifyRoomGameEnd`）。
5. **游戏侧适配**：重连的游戏进程是全新实例（运行时状态丢失），游戏需要调用 `room.getInfo()` 判断 `state`：若 `"playing"`
   则是重连；若 `"waiting"` 则是正常启动。

### 7.3 Room Server / Room Client 消息协议

Room Server 与 Room Client 之间使用 **WebSocket + JSON** 通信。

#### 消息类型 (RoomMessageType)

| 类型                     | 方向              | 说明                                                              |
|:-----------------------|:----------------|:----------------------------------------------------------------|
| `room:join`            | Client → Server | 请求加入房间，携带玩家信息与游戏版本                                              |
| `room:join:ack`        | Server → Client | 加入成功，返回房间信息                                                     |
| `room:join:refused`    | Server → Client | 拒绝加入（房间满、版本不匹配等）                                                |
| `room:player:joined`   | Server → All    | 通知有新玩家加入                                                        |
| `room:player:left`     | Server → All    | 通知玩家离开                                                          |
| `room:player:ready`    | Client → Server | 玩家标记为已准备                                                        |
| `room:player:unready`  | Client → Server | 玩家取消准备                                                          |
| `room:state:sync`      | Server → All    | 房间状态全量同步                                                        |
| `room:game:start`      | Server → All    | 游戏开始信号                                                          |
| `room:game:end`        | Server → All    | 游戏结束信号（仅 Host 方触发，`notifyRoomGameEnd` / `RoomServer` broadcast） |
| `room:disbanded`       | Server → All    | 房间已解散                                                           |
| `room:kicked`          | Server → Target | 被踢通知（仅目标玩家）                                                     |
| `room:player:kicked`   | Server → All    | 广播玩家被踢事件                                                        |
| `room:chat`            | Bidirectional   | 聊天消息                                                            |
| `game:message:relay`   | Bidirectional   | 游戏内单播消息中继                                                       |
| `game:broadcast:relay` | Bidirectional   | 游戏内广播消息中继                                                       |

#### 消息中继约束

- `message.broadcast` 默认仅转发给其他玩家，不会回环给发送者。
- `message.send` 必须提供目标玩家（`to` 或 `targetPlayerId`），否则返回错误。
- 中继层会自动补齐 `senderId`、`messageId`、`sentAt` 字段，便于游戏侧幂等处理与时序判断。
- Host 处理来自客机、且目标为房主本机游戏的 `game:message:relay` / `game:broadcast:relay` 时，应优先直接投递给本机
  `GameApiServer`，不要通过房主本地 `RoomClient` 再走一次 WebSocket。
- `RoomClient` 需通过 `room:event` 向渲染层同步连接状态变化，包括
  `connecting / connected / reconnecting / failed / disconnected` 及重试信息。
- 房间已满时允许同一 `playerId` 重连加入（Rejoin），不会被误判为 `room_full`。
- **房主聊天本地优化**：Host 发送聊天消息时，`room.ipc` 判为 Host 后直接 `roomServer.broadcast(msg, hostSocket)` +
  `mainWindow.webContents.send` 推送自身渲染层，不经 WebSocket 回环。
- **房间结束消息双重源**：`room:game:end` 由 Host 广播（`notifyRoomGameEnd`）触发前端 `isReconnectMode=false`；"游戏已结束"
  聊天消息由前端 `room:state:sync` 检测 `playing→waiting` 态变化产生。两者互补不重复。

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
