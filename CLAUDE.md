# CLAUDE.md — BZ-Games 项目规范

> 本文档为 AI 辅助开发上下文文件，定义项目架构、功能边界、接口规范与实现约定。
> 开发工作必须遵循本文档中的结构、命名、流程与安全要求。

***

## 一、项目概述

### 平台简介

**BZ-Games** 是一个本地优先的 Windows 游戏平台，类似于 Steam / Epic Games Store，
基于 **Vue 3 + TypeScript + Electron** 构建，运行平台为 **Windows 10/11（x64）**。

### 核心设计原则

| 原则             | 说明                                                |
|----------------|---------------------------------------------------|
| **本地优先**       | 用户配置、游戏记录、经济数据与统计数据存储于本地，平台账号体系不依赖远程后端                        |
| **便携式存储**      | 配置默认存储在应用根目录，游戏可存放在默认目录或用户维护的多路径目录中               |
| **开放式游戏管理**    | 用户可将符合平台规范的游戏载入平台，平台会自动复制并管理游戏文件                  |
| **统一联机基础设施**   | 平台提供房间管理、玩家状态、聊天、游戏消息中继、断线重连与公网入口能力               |
| **公网入口可切换**     | 局域网入口持续可用，公网入口支持用户自备 frp 与官方中继服务器短地址 |
| **Windows 专用** | 面向 Windows 10/11 x64 设计、开发、测试与打包                             |

### 平台核心功能

- 游戏库管理（导入、删除、排序、收藏、封面/图标展示）
- 游戏启动与进程生命周期管理（主进程统一托管）
- 联机房间系统（创建、加入、准备、开始、离开、聊天、踢人、解散同步）
- 房间发现系统（局域网自动发现、官方服务器房间列表、加入前本地游戏与版本校验）
- 国际化（`zh-CN / en-US / ja-JP`）
- 成就系统（列表、解锁、系统通知、红点提示）
- 统计系统（支持增量/全量统计模式，游玩时长自动累计）
- 经济系统（签到、BZ 币、累计游玩时长、头像框解锁与装备）
- Game API Server（本地 `ws://127.0.0.1`，向游戏进程提供平台能力，v2 支持 JSON 控制帧与二进制实时帧）
- 游戏市场（远程发现、详情展示、下载并安装到默认游戏库，GitHub Release Asset 自动补齐 sha256/size）
- 个性化系统（头像框解锁、装备、预览，支持多场景展示）
- 系统设置（玩家信息、主题、端口、语言、更新、游戏库列表、GitHub Token）

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
| SQLite 数据存储      | better-sqlite3              | 游玩会话记录、日历热力图数据查询            |
| 客户端更新        | electron-updater            | GitHub Releases 作为更新源          |
| WebSocket 服务 | ws                          | Game API、Room Server、Room Client 均基于 WebSocket，v2 高频通信支持原始二进制帧 |
| 版本比较         | semver                      | 用于平台版本与游戏版本兼容性检查               |
| ZIP/7Z 解压     | 7zip-bin (7za)              | 通过 `child_process.spawn` 调用，统一处理 .zip 和 .7z |
| 目标平台         | Windows 10/11 x64           | <br />                         |

***

## 三、项目目录结构

```
bz-games/
├── CLAUDE.md                             # AI 开发上下文与项目规范文档
├── README.md                             # 项目简介与基础使用说明
├── DEVELOPER_GUIDE.md                    # 面向游戏接入方的开发接入指南
├── docs/
│   └── GAME_API_V1_V2_REFERENCE.md        # Game API v1/v2 接口说明文档
├── relay-server/                          # 官方中继服务器（Node.js HTTP + WebSocket，透明转发 Room/Game API 消息）
│   ├── API.md                             # 中继服务器接口规范
│   ├── DEPLOY.md                          # 中继服务器部署手册
│   ├── package.json                       # 中继服务器独立依赖
│   └── src/index.js                       # 中继服务器入口
├── build/
│   └── installer.nsh                     # NSIS 自定义安装/卸载钩子（多语言支持）
├── package.json                          # 依赖、脚本与打包发布配置
├── private-build.config.example.json      # 私有构建配置模板（CDN/OSS/中继/加密种子等环境变量）
├── pnpm-lock.yaml                        # pnpm 依赖锁定文件
├── tsconfig.json                         # TypeScript 根配置
├── tsconfig.node.json                    # 主进程/预加载/共享代码 TS 配置
├── tsconfig.web.json                     # 渲染进程 TS 配置
├── electron.vite.config.ts               # Electron-Vite 构建配置（读取 private-build.config.json 注入构建期常量）
├── config.json                           # 本地持久化配置（运行生成）
├── db/                                   # SQLite 数据库目录（运行生成）
│   └── play_sessions.db                  # 游玩会话数据库
├── games/                                # 首次初始化的默认游戏库目录（运行生成，可由用户迁移）
│   └── <id>/
│       └── <version>/
│
├── src/
│   ├── main/                              # Electron 主进程
│   │   ├── index.ts                       # 主进程入口与应用生命周期初始化
│   │   ├── window.ts                      # 主窗口创建与管理
│   │   ├── chat-window.ts                 # 聊天弹窗窗口创建、关闭与事件转发
│   │   ├── ipc/
│   │   │   ├── index.ts                   # IPC 统一注册入口
│   │   │   ├── game.ipc.ts                # 游戏相关 IPC 处理器
│   │   │   ├── market.ipc.ts               # 游戏市场 IPC 处理器
│   │   │   ├── room.ipc.ts                # 房间相关 IPC 处理器
│   │   │   ├── system.ipc.ts              # 设置/系统/更新 IPC 处理器
│   │   │   ├── storage.ipc.ts             # Web 游戏本地存储 IPC 处理器
│   │   │   └── statistics.ipc.ts          # 统计数据查询 IPC 处理器
│   │   ├── services/
│   │   │   ├── storage/
│   │   │   │   ├── DatabaseService.ts     # SQLite 游玩会话记录与日历热力图数据查询
│   │   │   │   └── StoreService.ts        # 本地数据读写与业务数据维护
│   │   │   ├── game/
│   │   │   │   ├── GameEnvironment.ts     # 游戏启动环境变量、bz-config.js 生成与清理
│   │   │   │   ├── GameLoader.ts          # 游戏导入、校验、扫描与记录同步
│   │   │   │   └── GameManager.ts         # 游戏进程启动/停止与生命周期管理
│   │   │   ├── game-api/
│   │   │   │   ├── GameApiServer.ts       # 游戏进程本地 WebSocket API 服务（连接认证、协议路由、事件分发）
│   │   │   │   ├── V1GameApiProtocol.ts   # v1 游戏 API 通信协议（send/broadcast）
│   │   │   │   └── V2GameApiProtocol.ts   # v2 游戏 API 增强通信协议（send/broadcast/publish/batch/subscribe + 二进制帧）
│   │   │   ├── room/
│   │   │   │   ├── RelayRoomService.ts    # 房主侧官方中继接入、短地址注册、relay bridge
│   │   │   │   ├── RoomClient.ts          # 客机房间连接与重连管理（支持 v2 二进制帧中继）
│   │   │   │   ├── RoomCommunicationConstants.ts # 房间通信常量集中管理（消息大小、心跳间隔、超时等）
│   │   │   │   ├── RoomDiscoveryService.ts # 局域网/官方中继房间发现与加入前校验
│   │   │   │   └── RoomServer.ts          # 房主房间服务与消息中继（支持 v2 二进制帧中继、ordered delivery）
│   │   │   ├── market/
│   │   │   │   └── MarketService.ts       # 游戏市场索引拉取、下载、校验、解压与安装
│   │   │   └── system/
│   │   │       ├── NotificationService.ts # 系统通知窗口服务
│   │   │       └── UpdateService.ts       # 客户端更新检查/下载/安装服务
│   │   └── utils/
│   │       ├── appPath.ts                 # 应用根路径工具
│   │       ├── fileUtils.ts               # 文件复制等通用文件工具
│   │       ├── logger.ts                  # 日志输出封装（生产模式下 error 日志自动写入 exe 同级目录的 bz-games-error.log）
│   │       ├── portUtils.ts               # 可用端口探测工具
│   │       └── requestInterceptor.ts      # HTTP 请求头统一注入（Referer 防盗链 + GitHub Token）
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
│   │       │   ├── ChatPopoutView.vue    # 聊天弹窗独立窗口页面
│   │       │   ├── NotificationView.vue   # 通知窗口页面
│   │       │   ├── FloatBallView.vue       # 下载悬浮球独立窗口页面
│   │       │   ├── PersonalizationView.vue # 个性化页面（头像框管理 + 昵称样式）
│   │       │   ├── RoomDiscoveryView.vue   # 房间发现页面（局域网/服务器 Tab）
│   │       │   ├── RoomView.vue           # 房间页面
│   │       │   ├── SettingsView.vue       # 设置页面
│   │       │   └── StatisticsView.vue     # 统计页面
│   │       ├── composables/
│   │       │   ├── useRoomJoin.ts          # 房间地址加入公共逻辑（服务器 Tab 与手动短地址共用）
│   │       │   └── useImageCache.ts        # 统一图片缓存层（本地+远程）
│   │       ├── components/
│   │       │   ├── CachedImg.vue           # 远程图片缓存组件（市场专用）
│   │       │   ├── CalendarHeatmap.vue      # GitHub 风格日历热力图组件（统计页）
│   │       │   ├── CheckInModal.vue        # 签到弹窗组件
│   │       │   ├── AvatarWithFrame.vue     # 头像+头像框叠加组件（CSS overlay 算法）
│   │       │   ├── NicknameText.vue        # 昵称样式渲染组件（颜色/渐变/字体/字重/特效动画 + 主题色自适应）
│   │       │   ├── game/
│   │       │   │   ├── GameAchievementsModal.vue # 游戏成就弹窗组件
│   │       │   │   ├── GameCard.vue        # 游戏卡片组件
│   │       │   │   ├── GameCover.vue       # 游戏封面组件
│   │       │   │   ├── GameDeleteModal.vue # 游戏删除弹窗组件
│   │       │   │   └── GameIcon.vue        # 游戏图标组件
│   │       │   └── room/
│   │       │       ├── PlayerCard.vue      # 房间玩家卡片组件
│   │       │       ├── PlayerList.vue      # 房间玩家列表组件
│   │       │       ├── RoomChat.vue        # 房间聊天组件
│   │       │       └── ImageViewer.vue      # 图片预览器（全屏蒙层，点击空白退出，自定义光标）
│   │       ├── locales/
│   │       │   ├── en-US.ts                # 英文文案
│   │       │   ├── ja-JP.ts                # 日文文案
│   │       │   └── zh-CN.ts                # 中文文案
│   │       ├── types/
│   │       │   └── electron-api.d.ts       # window.electronAPI 类型声明
│   │       └── utils/
│   │           ├── achievementNotifier.ts  # 成就通知辅助逻辑
│   │           ├── deleteEffect.ts         # 游戏删除碎裂特效工具
│   │           ├── nicknameColor.ts        # 昵称颜色主题感知适配（WCAG 相对亮度算法）
│   │           └── sound.ts                # 音效播放工具
│   │
│   └── shared/
│       ├── avatar-frames.ts                # 头像框定义数据（8款头像框的解锁条件与图片文件名）
│       ├── constants.ts                    # 平台常量（CDN/OSS/GitHub/官方中继参数/LAN发现/游玩奖励/悬浮球/DB路径，值由 electron.vite.config.ts 构建期注入 private-build.config.json）
│       ├── binary-protocol.ts              # v2 二进制帧编码/解码工具（4字节头长度 + JSON header + binary body）
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
│   ├── icon.png                            # 应用图标资源
│   └── avatar-frames/                      # 头像框图片资源（8款 PNG，平台运行时读取）
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
| **Game API Server**                 | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力；控制面走 JSON，v2 高频实时数据可走二进制帧 |
| **v2 二进制帧**                       | 高频实时通信帧格式：4字节 big-endian header 长度 + UTF-8 JSON header + 原始 binary body，仅用于 `message.send` / `message.broadcast` / `message.publish` |
| **官方中继服务器 (Relay Server)**      | 公网 Node.js HTTP + WebSocket 服务，负责房间登记、房间码、容量保护和透明转发，不拼接或识别短地址，不解析游戏业务语义。                            |
| **官方短地址**                         | 平台按 `DEFAULT_RELAY_PUBLIC_HOST + roomCode` 拼接的 `<relay-public-host>:随机数字` 地址，展示、复制、服务器列表和手动输入统一使用该格式。                         |
| **官方房间码**                         | 中继服务器生成并识别的数字房间码；平台从短地址中解析后通过 `relay:join.payload.roomCode` 发送给中继服务器。                         |
| **房间发现 (Room Discovery)**          | 平台房间页面的局域网/服务器 Tab。局域网通过 UDP 发现本地房主，服务器通过官方中继 `/rooms` 获取房间列表。                      |
| **游戏市场目录 (Market Directory)**       | 顶层 `market.json` 文件，`sources` 数组列出所有可用市场源，平台一级界面展示                             |
| **游戏市场索引 (Market Index)**           | 远程 `market.json` 文件（每个市场源仓库中），描述该市场内可展示和可下载的游戏及其版本信息                           |
| **市场安装包 (Market Package)**          | 市场游戏某个版本对应的下载产物，平台下载后校验并安装到默认游戏库                                              |
| **下载任务 (Download Task)**            | 市场下载安装的一次任务实例，包含状态机、不可变元数据和 AbortController，支持暂停/恢复/取消                         |
| **下载任务快照 (Download Task Snapshot)** | 暂停或中断时持久化到 `pending-tasks.json` 的进度数据，包含已下载字节数、下载 URL、SHA256 等，用于断点续传恢复        |
| **断点续传 (Resume Download)**          | 利用 HTTP Range 请求头从上次断点继续下载，服务端不支持时自动降级为全量下载                                    |
| **bz-config.js**                    | 平台在游戏启动前生成的配置文件（包含端口、Token、玩家信息、房间 ID、`isHost` 与 `isMultiple`），游戏退出时自动删除。 |
| **内网穿透**                            | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                                   |

### 4.0 游戏库路径体系

- **游戏库列表**：`settings.gameStorageHistory` 维护用户配置的游戏库路径列表；首次初始化写入 exe 同级 `games/`。
- **默认游戏库**：`settings.gameStoragePath` 表示当前默认项，且必须存在于 `gameStorageHistory` 中；设置页维护游戏库列表与默认项。
- **路径获取边界**：业务模块通过 `StoreService.getDefaultGameStoragePath()` / `getGameStoragePath()` 获取默认游戏库。
- **迁移与删除安全**：迁移游戏库复制源游戏库全部文件，复制完成后删除原游戏库；迁移失败时提示用户、清空目标目录中已迁移数据并保留目标文件夹。文件占用类错误展示“当前有文件正在打开，无法迁移，已回退”。删除游戏库时按 `gameId/version/game.json` 识别平台游戏内容，保留用户自有文件。删除单个游戏时按游戏根目录递归删除。
- **默认库迁移提示**：`settings.lastOpenedAt` 标记首次打开；非首次打开且游戏库列表中存在 exe 同级 `games/` 时，提示用户迁移或选择不再提醒。

### 4.1 Game Manifest 规范

- **统计信息国际化**：`statistics` 字段支持键值对格式（`[{ "key": "Display Name" }]`），用于在平台统计界面显示本地化的统计项名称。
- **时间追踪**：平台自动追踪并记录所有游戏的游玩时长（`time`）；Manifest 可显式定义 `time` 统计项。
- **详情媒体扩展**：`video` 字段为可选项，指向游戏目录内预览视频（`mp4/webm/ogv/mov/m4v`），仅用于详情页展示。
- **本地存储加密开关**：`encryptLocalStorage` 为可选布尔字段，仅作用于 Web 游戏 `localStorage` 对应的 `gamedata.json` 持久化。
- **游戏类型**：`type` 支持 `singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`，通过 `src/shared/types/game.types.ts` 的 `GameType` 枚举维护；调整类型时同步 Schema、业务判断和 UI 文案。`singlemultiple` 代表同时支持单人与联机，`networkgame` 代表远程网页游戏。
- **网页游戏版本规则**：`networkgame` 类型游戏导入/安装时以 `id` 判断是否已存在，版本号不参与 semver 校验；同一 `id` 的网页游戏通过删除旧版本后重新导入完成更新。
- **远程网页启动**：`entry=url` 时 Manifest 必须提供合法 `web_url`，平台直接打开该网页地址。
- **作者主页链接**：`author_url` 为可选合法 URL，在游戏详情页和市场详情展开卡片展示跳转图标；市场游戏的 `author_url` 可在 `gameManifest` 中覆盖，默认继承 Market Game 层级配置。

### 4.2 游戏市场索引 JSON 规范

- **托管方式**：游戏市场索引文件由独立 GitHub 仓库维护，固定文件名为 `market.json`。平台优先读取 GitHub 原始地址
  `https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json`；若 GitHub 拉取失败，必须自动回退到构建期注入的私有镜像地址。
- **两级市场架构**：顶层 `market.json` 作为**市场目录**，`sources` 数组列出所有可用市场源；每个市场源的仓库中有自己的
  `market.json`。顶层 `market.json` 同时保留 `games` 字段（对应 `sources[0]`）。外部市场源从其仓库 raw 地址直接加载。
- **拉取时机**：用户首次进入"游戏市场"列表页面时拉取市场目录（`getSources`），进入具体市场时拉取该市场的游戏索引（`getIndex`
  ）。均有 1 小时内存缓存。
- **镜像同步**：市场仓库可通过 GitHub Actions 等自动化流程同步 OSS 镜像；平台按 GitHub 优先、OSS 回退顺序读取。
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
      "coverUrl": "https://cdn.example.com/bz-games-market/cover.png",
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
| `schemaVersion` | `string`         | 是  | 市场索引格式版本，使用语义化版本，供兼容逻辑识别。                        |
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
| `author_url`    | `string`              | 否  | 作者主页链接，详情页展开后作者名称旁将显示跳转图标。                                                              |
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
| `description`     | `string`  | 是  | 该版本说明或版本简介。                         |
| `platformVersion` | `string`  | 是  | 当前版本对平台版本的兼容范围，使用 `semver` 语法，如 `>=1.9.5`。  |
| `downloadUrl`     | `string`  | 是  | 版本安装包下载地址，建议 HTTPS。                         |
| `sha256`          | `string`  | 否  | 安装包 SHA-256 摘要，用于完整性校验。全可选（任何 downloadUrl 均可省略），若提供则格式必须为 64 位 hex。 |
| `size`            | `number`  | 否* | 安装包字节大小，用于展示下载体积和二次校验。`downloadUrl` 为 GitHub Releases 直链时可省略，平台下载时自动获取。非 GitHub 直链时**必填**。 |
| `publishedAt`     | `string`  | 否  | 版本发布时间，ISO 8601 格式。                         |
| `releaseNotes`    | `string`  | 否  | 更详细的版本更新内容。                                 |
| `isPrerelease`    | `boolean` | 否  | 是否为预发布版本；预发布版本默认不作为 `latestVersion`。        |
| `gameManifest`    | `object`  | 否  | Manifest 覆盖配置（`GameManifestOverride`），可覆盖/补充安装包内 `game.json` 的任意字段。当安装包内不含 `game.json` 时，该项**必填**，平台将据此自动生成完整 Manifest。 |

#### GameManifestOverride 覆盖机制

当市场游戏安装包内不包含 `game.json` 文件时（例如通用 HTML5 游戏包），市场维护者可通过 `gameManifest` 字段为每个版本提供 Manifest 覆盖配置。覆盖规则如下：

```typescript
// src/shared/types/market.types.ts — GameManifestOverrideSchema
// 所有字段均为可选（覆盖粒度），结构完全对齐 GameManifestSchema
```

- **字段覆盖优先级**：`gameManifest` 中的值 > MarketGame 层级对应字段 > 默认值
  - `name` → `gm.name || game.name`
  - `description` → `gm.description || game.summary`
  - `author` → `gm.author || game.author`
  - `author_url` → `gm.author_url !== undefined ? gm.author_url : game.author_url`
  - `type` → `gm.type || game.type`
  - `platformVersion` → `gm.platformVersion || targetVersion.platformVersion`
  - `entry` → `gm.entry`（若为空则自动探测 `detectEntryFile(importDir)`）
  - `multiplayer` → `gm.multiplayer`（类型为多人且未配置时从 `game.minPlayers`/`game.maxPlayers` 生成）
- **安装流程**：`resolveExtractedImportDir()` 查找包内 `game.json`，未找到时使用 `gameManifest` 构建完整 Manifest，写入安装目录后继续执行标准导入流程。进度模拟（`startProgressSim` / `tickProgress`）在 verify（65→69）、extract（70→94）、install（95→99）阶段以 500ms 间隔平滑推进。
- **Manifest 构建**：`buildManifestFromMarket()` 在 `game.json` 缺失时触发。

#### 安装包约束

- **格式识别**：平台根据 `downloadUrl` 的文件后缀自动识别压缩包格式；支持 `.zip` 和 `.7z`，统一使用 `7zip-bin` 内置 `7za` 通过 `child_process.spawn` 解压。
- **解压方式**：`.zip` 和 `.7z` 均使用 `7zip-bin` 内置的 `7za` 二进制通过 `spawn` 调用。
- **目录约束**：压缩包解压后的根目录或第一层单子目录中必须存在 `game.json`，且整体目录结构应能直接作为一次普通"本地导入"
  输入目录。若安装包内无 `game.json`，必须通过 `gameManifest` 字段提供完整覆盖配置，平台将自动生成并安装。
- **一致性校验**：平台安装前校验下载包的 `size`、`game.json.id`、`game.json.version`。`sha256` 在校验值存在时执行比对；未提供 sha256 时跳过哈希校验。`size` 为 GitHub Release 直链时可由平台下载阶段自动补齐。`game.json.platformVersion` 使用 `semver` 做语义化兼容性检查（支持 string 和 tuple 两种 manifest 格式）。
- **安全约束**：压缩包内出现绝对路径、盘符路径或 `../` 路径穿越条目时拒绝安装。
- **覆盖策略**：本地已存在相同 `id + version` 时视为"已安装"。**网页游戏（`networkgame`）仅以 `id` 判断**，同一 `id` 的更新通过删除旧版本后重新导入完成。
- **落盘路径**：市场安装目标目录必须通过 `StoreService.getDefaultGameStoragePath()` 获取当前默认游戏库；若列表为空，`StoreService.getSettings()` 会初始化 exe 同级 `games/` 作为首个游戏库。

#### 市场任务状态与错误码类型

```typescript
// src/shared/types/market.types.ts

type MarketTaskStatus =
    | "idle" | "downloading" | "verifying" | "extracting"
    | "installing" | "completed" | "error" | "canceled"
    | "paused" | "interrupted";

type MarketErrorCode = "network" | "download" | "verify" | "extract" | "install" | "manifest";

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

interface FloatBallProgress {
    totalProgress: number;
    activeTaskCount: number;
    completedTaskCount: number;
    totalTaskCount: number;
}
```

- **错误码自动归类**：主进程 `classifyErrorCode()` 根据异常信息自动映射为 `network`（fetch failed/ECONNREFUSED/ETIMEDOUT/ENOTFOUND）/ `download` / `verify` / `extract` / `install` / `manifest`，渲染进程通过 `MARKET_EVENT` 接收 `errorCode` 并映射 i18n 文案。`manifest` 错误码对应游戏包缺少 `game.json` 清单文件的情况。
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
║  │                             │  │ ws://0.0.0.0:38080  ││───┼──╫──► frp 公网入口
║  │                             │  │ 局域网/frp 直连入口  ││   │  ║    用户自备映射
║  │                             │  ├─────────────────────┤│   │  ║
║  │                             │  │  RelayRoomService   ││───┼──╫──► 官方 Relay Server
║  │                             │  │  注册房间/桥接中继    ││   │  ║    HTTP + WebSocket
║  │                             │  ├─────────────────────┤│   │  ║
║  │                             │  │   GameApiServer     ││   │  ║
║  │                             │  │ ws://127.0.0.1:*    ││   │  ║
║  │                             │  └──────────┬──────────┘│   │  ║
║  │                             └─────────────┼───────────┘   │  ║
║  └───────────────────────────────────────────┼──────────────┘  ║
║                                              │ localhost        ║
║  ┌───────────────────────────────────────────┴──────────────┐   ║
║  │                   游戏进程 (game.exe)                      │  ║
║  │   ws://127.0.0.1:{BZ_API_PORT}                            │   ║
║  │   通过 Game API Server 进行所有联机通信                     │  ║
║  └───────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
           ▲                                      ▲
           │                                      │
           │ RoomServer WebSocket 直连             │ relay:host / room:state:sync
           │ RoomMessage / Game API v1/v2          │ RoomMessage / Game API v1/v2 透明转发
           │                                      │
           ▼                                      ▼
╔══════════════════════════════╗      ╔══════════════════════════════════════════════════════════════════╗
║        frp 公网入口           ║      ║                    官方 Relay Server（公网）                      ║
║                              ║      ║                                                                  ║
║  ┌────────────────────────┐  ║      ║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ 用户自备 frp / SakuraFrp│  ║      ║  │  HTTP：/health、/rooms、/rooms/:roomCode                  │  ║
║  │ 公网地址 -> RoomServer  │  ║      ║  │  WebSocket：relay:host、relay:join、relay:leave、heartbeat │  ║
║  │ 平台只负责保存和直连地址 │  ║      ║  │  职责：生成 roomCode、维护房间列表、容量保护、透明转发消息    │  ║
║  └────────────────────────┘  ║      ║  │  不解析游戏业务语义；短地址由平台按 publicHost + roomCode 拼接 │ ║
╚══════════════════════════════╝      ║  └────────────────────────────────────────────────────────────┘  ║
           ▲                         ╚══════════════════════════════════════════════════════════════════╝
           │                                      ▲
           │                                      │ relay:join(roomCode)
           │                                      │ RoomMessage / Game API v1/v2 透明转发
           │                                      ▼
           │
           │
╔══════════════════════════════════════════════════════════════════╗
║                      CLIENT 客机（可多个）                        ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │                    Electron 平台进程                       │   ║
║  │                                                           │   ║
║  │  ┌─────────────┐    IPC     ┌─────────────────────────┐   │   ║
║  │  │  渲染进程    │◄─────────►│       主进程             │   │   ║
║  │  │  - 房间页    │            │  ┌─────────────────────┐│   │  ║
║  │  │  - 设置页    │            │  │    RoomClient       ││───┼──╫──► 官方 Relay Server
║  │  │  - 游戏详情  │            │  │  短地址/房间码加入   ││   │  ║
║  │  │             │            │  │  或 frp 地址直连     ││───┼──╫──► frp 公网入口
║  │  └─────────────┘            │  ├─────────────────────┤│   │   ║
║  │                             │  │   GameApiServer     ││   │   ║
║  │                             │  │   (状态同步缓存)     ││   │   ║
║  │                             │  └──────────┬──────────┘│   │   ║
║  │                             └─────────────┼───────────┘   │   ║
║  └───────────────────────────────────────────┼──────────────┘   ║
║                                              │ localhost        ║
║  ┌───────────────────────────────────────────┴──────────────┐   ║
║  │                   游戏进程 (game.exe)                      │  ║
║  └────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 5.2 Electron 进程职责

#### 主进程 (Main Process)

- BrowserWindow 生命周期管理
- **单实例锁**：`app.requestSingleInstanceLock()` 确保同一时间仅运行一个平台实例；第二实例启动时自动聚焦并恢复已有主窗口（最小化时恢复，不可见时显示）
- 读写本地存储（electron-store），**配置与数据均存储于应用根目录**
- 调用系统 API（文件对话框、环境变量、子进程）
- 游戏进程启动 / 管理 / 终止（`child_process.spawn`，支持 Windows 隐藏窗口）
- 拉取远程游戏市场索引、下载市场安装包并执行校验与安装。所有私有资源请求均携带构建期注入的 Referer 防盗链
  header（fetch 显式设置 + `session.webRequest.onBeforeSendHeaders` 全量拦截）
- 运行 Room Server（Host 时）/ Room Client（Client 时）
- 运行 Room Discovery UDP 服务，提供局域网房间响应；按需连接官方 Relay Server 注册房间短地址
- 运行 Game API Server（每次有游戏运行时）
- 注册并处理所有 IPC Handler
- 广播游戏进程生命周期事件（start/end）
- 通过 `DatabaseService` 自动记录每次游戏启动→关闭为一次"游玩会话"（写入 SQLite `play_sessions.db`）
- 系统托盘动态菜单：游戏退出时自动刷新「最近游玩」列表，支持从托盘快速启动最近玩过的游戏
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

- **配置加密存储**：`config.json` 以加密格式持久化，启动时识别明文配置并自动迁移为加密格式。

```typescript
// src/shared/types/store.types.ts
interface UserData {
    bzCoins: number;
    cumulativePlayTime: number;
    checkIn: {
        lastCheckInDate: string;
        consecutiveDays: number;
        totalDays: number;
    };
    ownedFrames: string[];
    equippedFrame?: string;
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

type NicknameFont = "system" | "rounded" | "serif" | "mono" | "fantasy";

type NicknameEffect =
  | "none" | "glow" | "sparkle" | "flame" | "neon"
  | "rainbow" | "aurora" | "stardust" | "crystal" | "comet" | "heartbeat";

interface NicknameStyle {
    color: string;
    gradientStart?: string;
    gradientEnd?: string;
    font: NicknameFont;
    effect: NicknameEffect;
    weight: "normal" | "semibold" | "bold";
}

interface AppSettings {
    playerName: string;
    playerId: string;
    avatar?: string;
    nicknameStyle?: NicknameStyle;
    libraryLayout?: "card" | "icon" | "steam";
    lastJoinRoomAddress?: string;
    language: "zh-CN" | "en-US" | "ja-JP";
    theme: "dark" | "light" | "auto";
    defaultRoomPort: number;
    closeBehavior: "tray" | "exit";
    autoLaunch: boolean;
    ignoredUpdateVersion?: string;
    gameStoragePath?: string;
    gameStorageHistory?: string[];
    lastOpenedAt?: number;
    ignoreDefaultGamesMigrationPrompt?: boolean;
    githubToken?: string;
    chatWindowBounds?: { x: number; y: number; width: number; height: number };
    chatInputHeight?: number;
    downloadFloatBall?: boolean;
    floatBallPosition?: { x: number; y: number };
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
- **远程网页模式约束**：当 `entry=url` 时，平台不生成 `bz-config.js`，也不向页面注入 `window.BZ_CONFIG`。游戏退出时平台自动清理生成的 `bz-config.js` 文件。

### 5.5 代码组织与内聚性

- **模块化**：复杂逻辑（如 `GameLoader.loadGameFromDialog`）拆分为独立函数（`validateManifestFile`, `checkPlatformVersion`,
  `checkEntryFile` 等），提升可读性与可维护性。
- **环境配置抽离**：游戏环境变量准备、`bz-config.js` 生成与清理逻辑由 `GameEnvironment` 统一处理，提高 `GameManager` 的内聚性。
  `stripProcessEnv()` 过滤 `ELECTRON_`/`NODE_`/`NPM_`/`VSCODE_` 前缀的环境变量，避免平台内部环境泄漏到子进程。
  `removeConfig()` 在游戏退出时自动删除残留的 `bz-config.js` 文件。`activeVersionPaths` Map 追踪版本目录路径，确保所有退出路径（窗口关闭、进程退出、主动停止、启动失败）都能正确清理。
- **GameManager 生命周期**：`cleanupApiOnly()` 方法仅清理 WebSocket/HTTP 服务器资源，不终止游戏进程也不关闭窗口。当 API
  Server 超时自动停止时调用，避免误杀正在运行的游戏。
- **游戏库布局状态**：`settings.libraryLayout` 持久化游戏库布局，取值为 `card`、`icon`、`steam`。`LibraryView` 挂载时必须先读取设置再渲染游戏库，避免启动时默认布局闪烁；Steam 布局右侧详情页使用嵌入式 `GameDetailView`，通过 `/library?steamGameId=<id>` 恢复来源游戏详情。
- **游玩会话记录**：每次游戏启动（`spawnGameProcess` / `createGameWindow`）调用 `databaseService.startSession()` 在
  `play_sessions.db` 创建一条记录（含 `game_id`、`game_name`、`version`、`start_time`）；游戏退出时（
  `handleProcessExit` → `recordPlaytime`）调用 `databaseService.endSession()` 写入 `end_time` 和 `duration_ms`。
  `storeService.updatePlaytime()` 维护 JSON 汇总统计，SQLite 作为独立游玩历史记录层，为日历热力图和统计图表提供数据支撑。
  `handleProcessExit` 中通过动态 `import("../window")` 调用 `updateTrayMenu()` 刷新托盘快捷菜单。
- **DatabaseService 设计**：
    - SQLite WAL 模式：`journal_mode = WAL` 提升并发读写性能。
    - 表结构 `play_sessions (id TEXT PK, game_id TEXT, game_name TEXT, version TEXT, start_time INTEGER, end_time INTEGER, duration_ms INTEGER)`，对 `game_id` 和 `start_time` 建立索引。
    - `getRecentGames(limit)`：`GROUP BY game_id` 去重，返回最近玩过的游戏列表（供托盘快捷菜单使用）。
    - `getDailyPlayDurations(days)`：按自然日聚合 `SUM(duration_ms)`，返回日历热力图数据源。
    - `getRecentSessions(limit)`：按 `start_time DESC` 返回最近会话。
    - `getSessionsByDate(date)`：按本地自然日查询已结束会话，用于统计热力图点击日期后的当日记录弹窗。
    - 应用退出 (`before-quit`) 必须调用 `databaseService.close()` 正常关闭 WAL 连接，否则 WAL 文件不会自动合并。
- **MarketService 设计**：
    - **两级市场架构**：`getSources()` 拉取顶层市场目录（通过 `fetchDirectory()` 获取，主源 GitHub + 备源 OSS），
      `getIndex(sourceIdx)` 拉取指定市场源的游戏索引。sourceIdx=0 使用 `fetchIndexInternal()`（主备双源），sourceIdx>0 使用
      `fetchIndexForSource()`（通过 `gitToRawUrl()` 推导 raw URL 直接加载）。
    - `fetchJson(url)` 为通用 HTTP JSON 获取器，内部使用 `withRetry(3, 1000)` 包裹 fetch（指数退避 1s→2s→4s）。请求头通过 `RequestInterceptor.buildHeaders()` 统一注入 `Referer` 防盗链和可选的 GitHub Token。`fetchDirectory()` 与
      `fetchIndexFromUrl()` 均基于此构建：前者解析 `MarketDirectorySchema`，后者使用**容错解析**（`parseGameTolerant()`）逐游戏校验并过滤 `hidden` 游戏。单个游戏或版本数据异常时跳过无效数据并记录警告日志。
    - `getSources()` 与 `getIndex(sourceIdx, forceRefresh)` 均内置 1 小时内存缓存，按 sourceIdx 独立缓存，
      `forceRefresh=true` 或缓存过期时重新拉取，应用重启后自动失效。同时，`forceRefresh=true` 时一并清除全部图片缓存（
      `cachedImages`），保证封面/图标数据与索引数据同步刷新。
    - `getCachedImageDataUrl(url)` 为按需图片缓存方法，通过 `fetch(url)` 下载远程图片并转 base64 Data URL，缓存于
      `cachedImages` Map（1 小时 TTL）。15 秒超时 + `AbortController` 保护，`finally` 块必定清理定时器。**双重防线**：校验
      response body 非空和 `content-type` 必须以 `image/` 开头。
      渲染进程的 `<CachedImg>` 组件按需触发下载。
    - `CachedImg` 为通用图片缓存组件，初始显示原始 URL（浏览器直连），异步调用 `getCachedImage` IPC 拿到 Data URL 后无缝替换。
      `onUnmounted` 时 abort 飞行中的请求，防止内存泄漏。
    - `downloadAndInstall(gameId, version, sourceIdx)` 中 `sourceIdx` 为**必传参数**，直接从对应 source
      拉取索引后查找目标游戏。
    - `gitToRawUrl()` 从 GitHub 仓库地址推导 raw 文件
      URL：`https://raw.githubusercontent.com/{owner}/{repo}/{branch}/market.json`。
    - `inferArchiveType()` 根据 `downloadUrl` 后缀自动识别压缩包格式，支持 `.zip` 和 `.7z`。`.zip` 和 `.7z` 统一使用 `7zip-bin` 内置的 `7za` 通过 `child_process.spawn` 解压。
    - **Electron asar 补丁防御**：`copyFolderRecursiveSync()` 在执行文件复制前设置 `process.noAsar = true`，复制完成后通过 `finally` 块恢复原值，用于复制含 `.asar` 的游戏包。
    - **EBUSY 重试防御**：`removeIfExists()` 和 `GameLoader.installGameFiles()` 中的 `fs.rmSync` 统一使用 `{ maxRetries: 10, retryDelay: 500 }` 参数。
    - **安装包内 .asar 防御**：`GameLoader.installGameFiles()` 检查 `gameRootDir` 是否为文件；若为文件则先 `rmSync` 删除后再创建目录。
    - **下载管线架构**：下载子系统采用 **不可变元数据 + 活动任务 + 单一状态机** 三层模型。
        - `TaskMeta`（不可变元数据）：包含 `downloadUrl`、`sha256`、`size`、`downloadPath`、`archiveType`、`sourceIdx` 等固定参数。
        - `ActiveTask`：运行时对象，绑定 `state`（MarketTaskState）、`meta`（TaskMeta）、`abort`（AbortController）。
          每个活动任务绑定一个 `AbortController`。
        - `transition(taskId, status, extra?)` 是**唯一的状态转换入口**（Single Source of Truth），内置状态机守卫：终态（
          completed/error/canceled）不可再转换。`paused` / `interrupted` 可被 `cancel` 正常取消（并清理快照文件）。
          所有状态变更必须经过此方法。
    - **Pipeline 与状态管理解耦**：`startPipeline()` (fire-and-forget) → `runPipeline()`（纯执行，仅接收 `AbortSignal`
      参数）。`runPipeline()` 编排五阶段流程（download → verify → extract → install → finalize），各阶段之间通过
      `signal.throwIfAborted()` 检查是否被中止。错误处理统一在 `startPipeline().catch()` 中：若 `signal.aborted`
      则静默返回（状态已由 pause/cancel 设置）；否则调用 `transition("error", ...)` + `finalize()`。
    - **断点续传**：`downloadArchive()` 下载前通过 `getPartialFileSize()` 检查已存在部分文件。若有部分文件且服务端支持
      HTTP Range（返回 `206`），以追加模式续传；若服务端返回 `200`（不支持 Range），自动删除部分文件从头下载（自动降级）。下载流通过
      `writer.write()` 返回值判断背压，配合 `drain` 事件保证内存安全。`settled` 闭包标志位防止 `writer.on("error")` 和 `reader.read()` 异常双重 reject Promise。
    - **暂停/恢复/取消**：
        - `pauseTask()`：先将 status 设为 `paused`（同步，保证 pipeline catch 块见到"paused"而不覆盖状态），再
          `abort.abort()`，最后将进度写入 `pending-tasks.json` 持久化快照。仅 `downloading` / `verifying` 状态可暂停；`extracting` / `installing` 阶段暂停按钮禁用并在 hover 时提示"解压或安装过程中无法暂停"。
        - `resumeTask()`：从 `pending-tasks.json` 读取快照，重新拉取索引校验兼容性后调用 `startTask()` + `startPipeline()`
          启动新管线。
        - `cancelTask()`：对运行中任务先 `transition("canceled")` 再 `abort.abort()` + `finalize()`；对已暂停任务直接
          `transition("canceled")` + `finalize()` + 删除快照。
    - **快照持久化**：`writeSnapshot()` / `removeSnapshot()` 操作 `${userData}/.market-cache/pending-tasks.json`。应用启动时
      `restorePendingTasks()` 读取快照重建 `interrupted` 状态任务，前端通过 `getPendingTasks` 在 `onMounted` 时同步到 UI。
    - **文件生命周期**：`finalize()` 在终态（completed/error/canceled）时删除临时下载文件与解压目录。暂停/中断时**保留**
      部分文件以便续传。
    - **容错解析**：`parseGameTolerant(rawGame)` 提供两层容错机制：先尝试 `MarketGameSchema.safeParse()` 严格解析，成功则直接返回；失败后分别校验游戏元数据（宽松版 `GameMetaSchema`，ID 只需非空即可）和版本列表（`MarketGameVersionSchema.safeParse` 逐个版本校验），跳过无效版本但保留有效版本。至少有一个有效版本的游戏才会被展示，全部无效则记录警告并跳过该游戏。
    - **sha256 全可选 + 下载时懒解析**：版本对象的 `sha256` 字段已变为全可选。下载阶段 `downloadAndInstall()` 按优先级获取 sha256/size：① 版本对象直接提供 → ② `resolvedAssets` 缓存（1小时 TTL）→ ③ GitHub Releases 直链时通过 `resolveGitHubAssetInfo()` 实时从 GitHub API 获取（`parseGitHubReleaseUrl()` 解析 owner/repo/tag/assetName，调用 `GET /repos/{owner}/{repo}/releases/tags/{tag}` 获取 asset 的 digest/size）。GitHub API 返回值中的 digest 必须同时满足 64 位长度和纯 hex 格式才被接受为 sha256，否则置 undefined。若 size 最终仍为 null，拒绝下载（`market_missing_size`）；sha256 为 undefined 时仅跳过校验不拒绝。
    - **下载校验条件化**：`verifyArchive()` 中 size 校验仅当 `meta.size > 0` 时执行，sha256 校验仅当 `meta.sha256` 存在时执行。若版本未提供 sha256 且 GitHub API 也未返回有效 sha256，则跳过哈希校验直接进入解压阶段。
    - 错误分类由 `classifyErrorCode()` 统一处理，根据错误消息自动归类为四种错误码（download/verify/extract/install）。
    - `tasks` Map 维护任务全生命周期，`finalize()` 在清理临时文件后延迟 30 秒删除 Map 条目，确保 UI 能读到终态。
    - **下载悬浮球进度推送**：`emitFloatBallProgress(force)` 方法在每次 `emit()` 状态变更时自动调用，将加权合并进度通过 `market:floatBall:event` 推送给悬浮球窗口。推送速率由 `FLOAT_BALL_THROTTLE_MS`（1 秒）节流控制，`force` 参数用于关键事件（恢复、取消、暂停、终态清理）立即推送。`computeTotalProgress()` 使用任务文件大小加权平均算法计算整体进度百分比，同时统计活跃/已完成/总任务数。有活跃任务时自动显示悬浮球（`showInactive()`），全部完成后自动隐藏（`hide()`）。`getAllTaskStates()` 返回所有当前任务状态快照，供悬浮球窗口挂载时初始同步。
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
- **应用入口 OSS 拦截**：`index.ts` 在 `app.whenReady` 中调用 `requestInterceptor.registerSessionHandler(session.defaultSession)`，统一注册 Electron 全局请求拦截器（Referer 防盗链）。
- **RequestInterceptor 统一请求头注入**：
    - 提取至 `src/main/utils/requestInterceptor.ts`，替代原先散落在 `MarketService.ts` 和 `index.ts` 中的 header 拼接代码。
    - 构造函数注入 `getTokenFn` 回调（惰性读取 `settings.githubToken`），避免静态导入 `StoreService` 造成循环依赖。
    - `buildHeaders(url, extra)` 方法为 fetch 请求构建 headers：CDN/OSS 域名自动加 `Referer`、GitHub API/Raw 域名检测 `githubToken` 并注入 `Authorization: Bearer <token>`。
    - `registerSessionHandler(session)` 方法在 `app.whenReady` 中注册 Electron 全局拦截器，覆盖 `<img>` 标签等非 fetch 请求。
    - `constants.ts` 集中定义 `CDN_BASE`、`OSS_BASE`、`GITHUB_API_BASE`、`GITHUB_RAW_BASE`、`REFERER` 五个常量，供 `MarketService` 和 `requestInterceptor` 共享。
- **CalendarHeatmap 日历热力图组件**：
    - 纯 Vue 3 + CSS Grid 实现，不依赖第三方图表库，渲染 GitHub 贡献墙风格的 7×53+ 格子日历。
    - 颜色渐变 5 档（空 → `#39d353` → `#26a641` → `#006d32` → `#0e4429`），图例标注"少 ↔ 多"。
    - 通过 IPC `stats:getDailyPlayDurations(365)` 从 `play_sessions.db` 加载近一年每日游玩时长。
    - `dayLabels`、`monthNames`、`formatDurationMs` 均通过 `useI18n()` 实现三语切换，
      使用逗号分隔字符串 `t('statistics.weekDays')` / `t('statistics.monthNames')` 存储数组数据，`t('statistics.hour/minute')` 存储时间单位。
    - 每个格子通过 `n-tooltip` 展示日期和当天游玩时长。底部显示近一年总游玩时长。
    - 每次打开统计页面 (`onMounted`) 自动拉取最新数据。
- **头像框系统（Avatar Frame）**：
    - **数据定义**：`src/shared/avatar-frames.ts` 导出 `AVATAR_FRAMES` 常量数组（8 款头像框），每款定义 `id`、`name`、`imageFileName`、`rarity`、`unlockMethod`（playtime/consecutive_checkin/total_checkin/bzcoin）、`unlockValue`。同时导出 `getFrameImageFileName(id)` 工具函数。
    - **类型定义**：`AvatarFrameDef` 和 `AvatarFrameUnlockMethod` 定义在 `src/shared/types/store.types.ts`，通过 `shared/types/index.ts` 统一导出。
    - **渲染组件**：`AvatarWithFrame.vue` 使用 CSS absolute 叠加方案：底层 `n-avatar` (z=0)，上层 `<img>` overlay (z=1, `pointer-events: none`)。
      - **算法**：`FRAME_MARGIN = 60`（帧图留白像素），`contentSize = w - 2*MARGIN`，`scale = w / contentSize`，`offsetPercent = -50*(scale-1)`。通过 `naturalWidth` 获取帧图原始尺寸后计算 scale/offset，适配任意帧图。
      - **中心对称原则**：只要帧图的中心镂空区域与图片几何中心对齐，不同 margin 的帧图均可正确叠加，无需调整算法。
      - **帧图加载**：通过 IPC `system:getAvatarFrameImage` 从 `resources/avatar-frames/` 读取 PNG → base64 Data URL，组件内 `Image()` 解码获取 `naturalWidth`。
    - **主进程原子操作**（`StoreService`）：
        - `performBuyFrame(frameId, coinCost)`：校验已拥有 / BZ 币余额 → 扣币 → 写入 `ownedFrames[]` → 自动装备 → 返回结果对象。
        - `performEquipFrame(frameId)`：仅校验 `ownedFrames[]` 含此 frame → `equippedFrame = frameId`。
        - `performUnequipFrame(frameId)`：仅当 `equippedFrame === frameId` 时 → `equippedFrame = undefined`。
        - `performSaveNicknameStyle(style, coinCost)`：校验 BZ 币余额 → 扣币 → `saveSettings({ nicknameStyle: style })`。余额不足返回 `{ success: false, code: "insufficient_coins" }`。
    - **自动解锁**：`tryUnlockPlaytimeFrames()` 和 `tryUnlockCheckInFrames()` 为 `StoreService` 私有方法，分别在 `addPlayTime()` 和 `performCheckIn()` 写盘前调用。扫描 `AVATAR_FRAMES` 数组，满足条件且不在 `ownedFrames[]` 中时自动 push 并记录日志。
    - **单一真相源**：`ownedFrames[]` 是头像框解锁状态的唯一权威数据源。所有解锁逻辑（签到/时长/BZ币购买）均在主进程中写入此数组，前端 `isUnlocked()` **仅检查 `ownedFrames.includes(frameId)`**，不做任何条件比较。
    - **个性化页面**（`PersonalizationView.vue`）：网格布局展示 8 款头像框卡片，每张卡片包含预览（`AvatarWithFrame` 96px）、名称、解锁条件文字+图标、操作按钮（装备/卸下/购买/未解锁）。购买成功后自动装备并刷新用户数据。路由 `/personalization`。
    - **应用入口展示**：`AppContent.vue` 顶栏头像使用 `AvatarWithFrame`（28px）替代原始 `n-avatar`，绑定 `userData.equippedFrame`。
    - **设置页展示**：`SettingsView.vue` 头像上传区小头像（40px）和头像预览弹窗（280px）均使用 `AvatarWithFrame`。
    - **联机传递**：`RoomJoinPayload` 和 `PlayerInRoom` 包含 `playerAvatarFrame` / `avatarFrame` 字段。房主 `RoomServer` 创建玩家对象时写入，客机 `RoomClient` 加入时携带。`PlayerCard.vue` 使用 `AvatarWithFrame` 渲染。
    - **签到累计天数**：`UserData.checkIn.totalDays` 记录累计签到总天数，在 `performCheckIn` 中自增。签到弹窗展示"累计签到 N 天"。

- **官方中继联机系统**：
    - **公网入口模型**：局域网联机始终可用；房间页的 frp/官方服务器选择只决定公网入口。frp 由用户自备映射到本地 `RoomServer`，官方服务器由房主连接 `RelayRoomService` 注册短地址。
    - **中继服务职责**：`relay-server/src/index.js` 处理 `relay:host`、`relay:join`、`relay:leave`、`relay:heartbeat` 等控制信令；RoomMessage、Game API v1 JSON 和 Game API v2 binary frame 均透明转发。中继服务端使用 `roomId` 管理内部房间，只发送和识别 `roomCode`。
    - **短地址加入**：房主注册成功后服务端返回 `roomCode`；平台按 `DEFAULT_RELAY_PUBLIC_HOST + roomCode` 拼接短地址。平台展示、复制、服务器 Tab 和手动输入统一使用短地址；客机 `RoomClient` 识别短地址后提取 `roomCode`，连接 `DEFAULT_RELAY_SERVER_URL` 并发送 `relay:join`，收到 `relay:join:ack` 后再发送标准 `room:join`。
    - **加入入口统一**：服务器 Tab 与游戏详情页手动地址加入共用 `useRoomJoin.ts`，地址标准化、短地址识别、加入调用、错误提示保持一致；服务器列表按钮状态用于展示，真实连接结果由 `RoomClient` 与 `RoomServer` 决定。
    - **校验集中化**：客机最终进入房主本地 `RoomServer.handleJoin()`，统一执行 kickedPlayers、人数、房间状态、gameId、gameVersion 校验。
    - **relay bridge**：`RelayRoomService` 将中继收到的原始 text/binary 帧交给 `RoomServer.handleRelayRawMessage()`，房主返回给 relay 客机的消息追加 `__relayTo` 路由字段；binary frame 只重封 header，body 原样保留。
    - **状态同步与幽灵房间防护**：`RoomServer.broadcastState()` 触发 `RelayRoomService.syncRoomState()`；中继服务端根据房主发送的无目标 `room:state:sync` 更新 `/rooms` 中的状态、人数、游戏名、版本等元信息；带 `__relayTo` 的 `room:state:sync` 继续按目标转发给对应玩家。房主断开、房主解散、房间 TTL 过期时通过 `closeRoom()` 清理房间和连接。
    - **中继加入拦截**：中继服务端在 `relay:join` 阶段拒绝房主离线、已开始、满员和加入自己房间等请求；房主本地 `RoomServer.handleJoin()` 继续执行最终业务校验。
    - **容量保护**：官方中继通过 `MAX_ROOMS`、`MAX_CLIENTS`、`MAX_CLIENTS_PER_ROOM`、`MAX_EVENT_LOOP_DELAY_MS` 控制新房间与新玩家接入。
    - **切换安全**：房主切换 frp/官方服务器公网入口前必须先通知当前其他玩家离开并清理连接；官方服务器注册失败时 UI 回退到 frp 状态。

- **下载悬浮球系统（Float Ball）**：
    - **独立窗口架构**：悬浮球运行在独立的 `BrowserWindow` 中（透明无边框、置顶、72×72px），通过 `/float-ball` 路由加载 `FloatBallView.vue` 组件。`AppContent` 将其识别为弹窗窗口（`isPopupWindow`），跳过主菜单渲染。
    - **窗口生命周期**：`createFloatBallWindow()` 在用户开启"下载悬浮球"设置时调用（应用启动时检查设置、保存设置时同步开关）。`destroyFloatBallWindow()` 在关闭设置时调用。窗口关闭时自动保存最后位置到 `floatBallPosition`。
    - **位置管理**：创建时从 `settings.floatBallPosition` 恢复上次位置（默认主屏右下角），`clampFloatBallToScreen()` 确保悬浮球在多显示器环境下始终可见。拖动时通过 300ms 节流的 `saveFloatBallPositionThrottled()` 持久化位置。注册 `display-metrics-changed` 监听器，显示器配置变更时自动校验并修正位置。
    - **拖拽状态**：`will-move` 事件触发时推送 `floatBall:dragState=true`，停止移动后 150ms 防抖推送 `false`。前端根据拖拽状态应用缩放/透明度动画。
    - **进度数据流**：挂载时通过 `market:getAllTaskStates` IPC 获取所有任务状态快照并计算初始进度，之后通过 `market:floatBall:event` 实时接收主进程 `MarketService.emitFloatBallProgress()` 推送的合并进度（`FloatBallProgress`：`totalProgress`、`activeTaskCount`、`completedTaskCount`、`totalTaskCount`）。有活跃任务时自动显示，全部完成后自动隐藏。
    - **进度环渲染**：使用 CSS `conic-gradient` 绘制环形进度条，颜色根据进度分段（<30% 蓝色 → <70% 橙色 → 高绿色）。`will-change: transform, opacity` 优化渲染性能。
    - **交互行为**：双击悬浮球打开主窗口（`system:openUrl` 传入空字符串即恢复主窗口）。`-webkit-app-region: drag` 支持拖动。`active`/`dragging` 伪状态应用缩放和阴影效果。
    - **类型定义**：`FloatBallProgress` 接口定义在 `src/shared/types/market.types.ts`，包含 `totalProgress`、`activeTaskCount`、`completedTaskCount`、`totalTaskCount`。

- **昵称样式系统（Nickname Style）**：
    - **功能范围**：玩家可在个性化页面自定义昵称的显示样式，包括文字颜色、渐变（起点+终点）、字体、字重和特效动画，保存需消耗 30 BZ 币。
    - **类型定义**：`NicknameStyle` 接口定义在 `src/shared/types/store.types.ts`，包含 `color`、`gradientStart`、`gradientEnd`、`font`（`system`/`rounded`/`serif`/`mono`/`fantasy`）、`effect`（`none`/`glow`/`sparkle`/`flame`/`neon`/`rainbow`/`aurora`/`stardust`/`crystal`/`comet`/`heartbeat`）、`weight`（`normal`/`semibold`/`bold`）。默认样式 `DEFAULT_NICKNAME_STYLE` 的 `color` 为 `"inherit"`。
    - **渲染组件**：`NicknameText.vue` 使用 CSS 自定义属性（`--nickname-color`/`--nickname-gradient-start`/`--nickname-gradient-end`）驱动样式，通过 `NicknameEffect` 值动态激活对应的 CSS class 和 @keyframes 动画。渐变特效（neon/flame/aurora 等）使用 `background-clip: text` + `color: transparent` 实现渐变文字。粒子特效（sparkle/stardust/comet）通过绝对定位的 `<span>` 粒子元素 + CSS 动画实现。光环特效（aurora/crystal/heartbeat）通过绝对定位的背景层实现。
    - **主题色自适应**：`nicknameColor.ts` 使用 WCAG 相对亮度公式计算颜色亮度。亮色主题下禁止偏白色（luminance > 0.72），暗色主题下禁止偏黑色（luminance < 0.28），不满足时自动取对称色。`adaptNicknameStyleForTheme()` 接收 `NicknameStyle` 和 `EffectiveTheme`（`useSettingsStore.effectiveTheme`），返回适配后的样式。`NicknameText` 组件接收 `effectiveTheme` prop 后自动调用适配。
    - **保存与消费**：`performSaveNicknameStyle(style, 30)` 在主进程原子执行：校验 BZ 币余额 → 扣除 30 BZ 币 → 写入 `userData.bzCoins` → 调用 `saveSettings({ nicknameStyle: style })` 持久化到 `settings`。余额不足返回 `{ success: false, code: "insufficient_coins" }`。
    - **UI 面板**：`PersonalizationView.vue` 新增双栏布局（`.nickname-style-panel`）：左侧预览卡片展示 `NicknameText` 实际效果（含单人/Room 两场景），右侧表单配置颜色/渐变/字体/字重/特效。保存前通过 `isNicknameColorAllowedForTheme` 检验对比度，不通过弹出警告。支持重置为默认样式（`resetNicknameStyle()`）。
    - **联机传递**：`RoomJoinPayload` 新增 `playerNicknameStyle` 字段，`PlayerInRoom` 新增 `nicknameStyle` 字段，`DiscoveredRoom` 新增 `hostStyle` 字段，`ChatPayload` 新增 `senderStyle` 字段。`RoomServer`/`RoomClient` 创建玩家对象时写入，`PlayerCard.vue` 和 `RoomChat.vue` 使用 `NicknameText` 渲染。房间发现页（`RoomDiscoveryView.vue`）房间名称使用 `NicknameText` 展示房主昵称样式。
    - **`effectiveTheme` 响应式**：`useSettingsStore` 新增 `effectiveTheme` computed（跟随 `settings.theme` 和 `prefersDark` 系统偏好），新增 `setPrefersDark()` 方法供 `App.vue` 的 `matchMedia` 监听器调用。`PersonalizationView` 中 watch `effectiveTheme` 自动适配预览颜色。

### 5.6 CSS 变量主题系统

- **语义变量**：`theme.css` 定义全局 `:root` 层基础色板（`--bz-gold`、`--bz-green`、`--bz-red`、`--bz-amber`、`--bz-info-blue`
  等），`.theme-dark` 与 `.theme-light` 分别定义暗/亮专属变量（`--bz-bg-*`、`--bz-text-*`、`--bz-border-*`、`--bz-chat-*`
  等），组件层统一使用 `var(--bz-*)` 引用，彻底消除硬编码色值。
- **`theme: "auto"` 模式**：`AppSettings.theme` 支持 `"auto"` 选项（默认值）。`App.vue` 通过
  `window.matchMedia('(prefers-color-scheme: dark)')` 监听系统主题变化，自动切换 `.theme-dark` / `.theme-light` CSS
  class。`onUnmounted` 时注销 `change` 监听器。NaiveUI 的 `n-config-provider :theme` 同步联动。
- **通知窗口独立主题**：`NotificationService` 创建成就弹窗时，根据用户设置的 `theme` 字段解析实际主题（`auto` →
  `nativeTheme.shouldUseDarkColors`），注入到 `NotificationView` 组件。`NotificationView` 独立导入 `theme.css` 获取 CSS 变量。
  `GameDetailView` 的灯光秀金色边框统一使用 `--bz-gold` 变量。

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
- **私有资源防盗链 Referer**：所有指向私有 CDN/OSS 的请求均携带构建期注入的 Referer。实现分两层：`fetch` 请求通过 `RequestInterceptor.buildHeaders()` 统一注入；`<img>` 标签等渲染层请求由 `RequestInterceptor.registerSessionHandler()` 注册的 Electron 全局拦截器注入。
- **市场下载暂存**：市场安装包应先下载到应用可控的临时目录（如 `.market-cache/`）中，校验通过后再解压并导入。
- **市场安装统一导入**：市场下载成功后，解压目录复用 `GameLoader` 导入链路。
- **市场安装失败保护**：下载、校验、解压或导入任一步失败时保留已有游戏记录；清理当前失败任务产生的临时文件（`finally`
  块中执行 `removeIfExists`，`.catch(() => undefined)` 隔离清理异常）。
- **市场错误码分类**：所有安装失败必须归类为四种错误码之一：`download`（下载失败）、`verify`（校验失败，含 sha256 与 size 不匹配）、
  `extract`（解压失败）、`install`（安装/导入失败）。主进程通过错误信息自动归类（`classifyErrorCode`），渲染进程根据错误码映射
  i18n 文案展示给用户。
- **市场取消逻辑**：`cancelTask()` 对运行中任务先通过 `transition("canceled")` 设置状态，再 `abort.abort()` 触发 pipeline
  中止，最后 `finalize()` 清理临时文件。对已暂停/中断任务，直接 `transition("canceled")` + 删除快照 + `finalize()`。
- **市场安装包 platformVersion 校验**：`installGame` 对 manifest 的 `platformVersion`（支持 string 和 tuple `[min, max]`
  两种格式）使用 `semver` 做语义化兼容性检查。
- **市场幂等性保护**：
    - **前端**：`pendingDownloads` / `pendingCancels` / `pendingPauses` / `pendingResumes` 四个 `Set` 追踪飞行中的请求。
      `handleDownload` 覆盖 `paused`/`interrupted` 防重复（暂停态按钮 disabled + 后端状态机守卫）。`handleCancel` 覆盖
      active + paused + interrupted 全态。`finally` 块清理 Set。
    - **后端**：`downloadAndInstall` 覆盖 `ACTIVE_STATUSES` + `paused` + `interrupted` 所有非终态。`transition()`
      状态机守卫终态不可再转换、paused 不可被 cancel 覆盖。`startPipeline().catch()` 通过 `signal.aborted` 静默返回，不覆写已设置的状态。
- **市场内存管理**：`finalize()` 在终态（completed/error/canceled）时删除临时下载文件与解压目录，延迟 30 秒清理 `tasks` Map
  条目。
- **市场下载背压处理**：`downloadArchive` 写入流检查 `writer.write()` 返回值，返回 `false` 时 await `drain`
  事件。
- **市场 Toast 跨页面通知**：市场安装完成/失败通知由根布局组件 `AppContent` 统一监听 `market:event`
  处理，确保用户在游戏库、设置等任何页面都能收到。`marketNotifiedTaskIds` Set 在 `completed`/`error`/`canceled` 终态时写入，中间态（
  `idle`/`downloading`/`paused`/`interrupted` 等）不写入 Set，保证每次安装只弹一次 toast。
- **市场平台兼容性前端检测**：渲染进程通过 `system:getAppVersion` 获取当前平台版本，使用 `semver.satisfies` 判断每个游戏版本的
  `platformVersion` 兼容性；不兼容时下载按钮变灰并显示"平台版本不兼容"文案。
- **市场任务状态管理**：已完成/失败/取消的任务在 500ms 后从渲染进程 `taskStates` 中自动清除，进度条 UI 回归原始布局；
  `paused`/`interrupted` 状态保留不自动清除。页面切换回来时通过 `syncExistingTasks`
  恢复进行中（downloading/verifying/extracting/installing/paused/interrupted）的任务；启动时通过 `getPendingTasks`
  恢复持久化快照。终态通知由 `AppContent` 统一处理并确保不重复。
- **重复版本处理**：本地已安装相同 `id` 与 `version` 时，市场页展示"已安装"状态并阻止重复安装。**网页游戏（`networkgame`）例外**：仅以 `id` 判断是否已安装，忽略版本号。
- **表单约束**：
    - `id` 需实时检测重复并校验反向域名格式。
    - `platformVersion` 固定为当前平台版本。
    - `type` 使用下拉框；仅当 `type` 为 `multiplayer` 或 `singlemultiple` 时展示 `minPlayers/maxPlayers`。
    - `version` 必须通过语义化版本校验（`x.y.z`）；**网页游戏（`networkgame`）**版本号需填写但不做 semver 校验。
    - `entry` 会自动探测并允许用户手动修改；探测支持 `.html`、`.htm`、`.exe`、`.bat`、`.cmd`，优先匹配常见入口名并排除安装器、卸载器、崩溃处理器等误判可执行文件。
    - `entry=.html/.htm` 时校验入口文件存在，`entry=.exe/.bat/.cmd` 由游戏启动流程执行存在性校验，`entry=serve` 或 `entry=url` 时跳过入口文件存在性校验。
    - `entry=url` 时必须提供 `web_url`（合法 URL）。
    - `icon/cover` 若填写则必须是游戏目录内存在的相对路径。

### 6.1.1 NSIS 多语言安装程序

- **语言选择**：`electron-builder` NSIS 配置启用 `displayLanguageSelector: true` + `multiLanguageInstaller: true`，支持 `zh_CN`、`en_US`、`ja_JP`
  三种安装语言。安装向导第一步显示语言选择器，用户选择后 NSIS 继续以该语言完成安装流程。
- **语言标记文件**：`build/installer.nsh` 在 `customInstall` 钩子中根据 `$LANGUAGE` 常量（1033=en-US, 2052=zh-CN,
  1041=ja-JP）写入 `.initial-language` 标记文件到安装目录。首次启动时 `StoreService.getSettings()`
  读取该文件，覆盖默认语言设置后立即删除文件，确保语言设置只生效一次。
- **卸载数据清理**：`installer.nsh` 的 `customUnInstall` 钩子在卸载时清理 `%APPDATA%\BZ-Games` 目录，确保卸载后无残留数据。
- **Windows 安装包**：`installer.nsh` 为 NSIS 专用脚本，对 Windows 平台打包生效。

### 6.1.2 游戏库列表管理

- **空目录约束**：`system:selectGameStoragePath` 通过 `fs.readdirSync` 检查所选目录是否为空。非空时返回
  `{ path, error: "directory_not_empty" }`，由前端通过 `dialog.warning()` 弹出友好提示（使用三语 i18n
  文案），阻止选择。
- **默认项约束**：默认游戏库由 `settings.gameStoragePath` 表示，且必须存在于 `settings.gameStorageHistory`；设置页维护“游戏库列表”。
- **精确清理**：`system:removeGameStoragePath` 删除游戏库时，删除标准结构 `gameId/version` 下存在 `game.json` 的版本目录，并在游戏根目录或库根目录为空时删除空目录。
- **迁移语义**：迁移游戏库复制源游戏库中的全部文件；复制全部成功后删除原游戏库并更新游戏记录和游戏库列表。迁移失败时主进程返回结构化错误，并删除目标目录中已复制的部分数据。
- **单游戏删除**：`game:remove` 删除单个游戏时沿用游戏根目录递归删除策略。

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
- `stats:getDailyPlayDurations`：查询最近 N 天的每日游玩时长（日历热力图数据源）。
- `stats:getRecentSessions`：查询最近 N 条游玩会话记录。
- `stats:getSessionsByDate`：查询指定本地自然日的已结束游玩会话记录。
- `market:getSources`：拉取并解析市场目录（含 sources 列表）。
- `market:getIndex`：拉取并解析指定市场源的远程游戏市场索引。
- `market:getCachedImage`：按需下载远程图片并返回 base64 Data URL，缓存 1 小时。供 `<CachedImg>` 组件使用。
- `market:downloadAndInstall`：下载指定市场游戏版本、执行完整性校验并安装到默认游戏库。支持断点续传（HTTP
  Range），服务端不支持时自动降级为全量下载。
- `market:getTaskState`：获取市场下载/安装任务状态与进度。
- `market:cancelTask`：取消指定市场下载/安装任务（含已暂停和中断的任务）。
- `market:pauseTask`：暂停正在进行的下载任务，进度持久化到本地快照文件。
- `market:resumeTask`：从暂停快照恢复下载任务，重新拉取索引校验兼容性后启动新管线续传。
- `market:getPendingTasks`：读取本地快照文件，返回所有未完成的暂停/中断任务。
- `market:resolveAssetInfo`：通过 GitHub REST API 解析 Release Asset 的 sha256/size（5次指数退避重试，1小时缓存）。
- `market:getAllTaskStates`：获取所有当前下载任务的状态快照（供悬浮球窗口初始同步）。
- `market:floatBall:event`：主进程 → 悬浮球渲染进程，推送合并后的下载进度数据（`FloatBallProgress`），节流 1 秒。
- `floatBall:dragState`：主进程 → 悬浮球渲染进程，通知拖拽状态（拖动中/停止）。
- `room:create`：创建房间并在本地启动房间服务。
- `room:join`：加入指定房主地址的房间。
- `room:leave`：离开房间（房主离开会解散房间）。
- `room:ready`：标记当前玩家为已准备。
- `room:unready`：取消当前玩家准备状态。
- `room:start`：由房主触发房间开始游戏。
- `room:setAddress`：设置并广播房主公网地址。
- `room:getState`：获取当前房间状态快照。
- `room:sendChat`：发送文本、语音或图片聊天消息（支持文字+图片打包发送）。
- `room:kickPlayer`：房主踢出指定玩家。
- `room:reconnect`：客机游戏进程崩溃后重新启动游戏（要求 room.state === "playing"）。
- `room:discoverLan`：扫描同一局域网内等待中的 BZ-Games 房间，并返回已带加入校验结果的房间列表。
- `room:discoverRelay`：从官方中继服务器 `/rooms` 拉取服务器房间列表，并返回已带加入校验结果的房间列表。
- `room:validateDiscovered`：对发现到的房间执行加入前校验，包括是否为自己的房间、房间状态、人数、本地是否安装游戏和版本是否匹配。
- `room:enableRelayHost`：房主切换到官方服务器公网入口，先断开其他玩家，再向官方中继注册房间并返回短地址。
- `room:disableRelayHost`：房主关闭官方服务器公网入口，断开中继连接并清空短地址。
- `room:popOutChat`：将聊天弹出到独立窗口，传递当前聊天历史。
- `room:popInChat`：关闭独立聊天窗口，聊天回到主窗口。
- `room:getChatHistory`：获取缓存的聊天历史记录。
- `room:chatWindowClosed`：主进程 → 渲染进程事件，通知主窗口聊天弹窗已关闭。
- `system:getSettings`：读取当前应用设置。
- `system:getAppVersion`：获取当前平台版本号（供渲染进程进行平台兼容性判断）。
- `system:saveSettings`：保存应用设置并应用相关系统行为。
- `system:savePartialSettings`：保存部分应用设置（合并写入，不会覆盖未传入的字段）。
- `system:uploadAvatar`：选择并处理玩家头像。
- `system:selectGameStoragePath`：弹窗选择新的游戏库路径。返回 `{ path: string }` 或
  `{ path: string; error: "directory_not_empty" }`，要求所选目录为空（防止卸载时误删其他文件），若非空则由前端弹出友好提示。
- `system:selectGameStoragePathRelaxed`：弹窗选择迁移目标路径，路径合法性和空目录约束由主进程迁移逻辑再次校验。
- `system:getGameStoragePaths`：返回游戏库列表及默认项标记。
- `system:addGameStoragePath`：添加新的空游戏库目录。
- `system:setDefaultGameStoragePath`：将游戏库列表中的指定路径设为默认游戏库。
- `system:migrateDefaultGamesLibrary`：迁移 exe 同级默认 `games/` 中的全部文件并同步已记录游戏版本路径，支持“不再提醒”。
- `system:migrateGameStorageLibrary`：迁移任意已配置游戏库中的全部文件并同步游戏库列表；失败时返回结构化错误并清理目标目录中的部分迁移数据。
- `system:openPath`：在系统文件管理器中打开路径。
- `system:removeGameStoragePath`：删除游戏库列表项及其内部已导入游戏数据。仅删除标准 `gameId/version/game.json` 可确认的游戏版本目录，不删除存储根目录下的用户自有文件或子目录。
- `system:uninstall`：卸载客户端。先检查 `uninstall.exe` 存在性，可选删除所有游戏库目录（`deleteGames: boolean`
  ），随后打开系统卸载程序并退出应用。返回 `{ success: boolean; error?: string }`。
- `system:clearCache`：清除应用 C 盘缓存目录（`Roaming\bz-launcher` 和 `Local\bz-launcher-updater`），逐项删除并静默跳过锁定文件。返回 `{ totalSize: number; clearedSize: number }`。
- `system:getUserData`：读取用户经济与签到数据。
- `system:checkIn`：执行每日签到并返回奖励结果。
- `system:buyFrame`：原子购买头像框（校验余额 + 已拥有，成功自动装备）。
- `system:saveNicknameStyle`：保存昵称样式（颜色/渐变/字体/字重/特效），扣除 30 BZ 币。
- `system:equipFrame`：原子装备头像框（仅校验已拥有）。
- `system:unequipFrame`：原子卸下头像框（仅当前装备时生效）。
- `system:getAvatarFrameImage`：从 `resources/avatar-frames/` 读取帧图返回 base64 Data URL。
- `system:setIgnoredUpdateVersion`：原子设置忽略的更新版本号。
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
  刷新"按钮强制拉取最新数据。缓存有效期内重复进入复用缓存。
- **市场索引时间展示**：市场页面标题"游戏市场"右侧以小字展示索引更新时间（`generatedAt` 字段，格式 `YYYY-MM-DD HH:mm`
  ），安装目录另起一行独立展示。
- **市场展示内容**：市场列表至少展示封面/图标、游戏名、作者、类型、标签、简介、最新版本、安装状态与下载按钮。
- **市场详情与安装**
  ：用户可查看游戏简介、当前选中版本详情、版本列表、平台兼容要求、包体大小；当前选中版本的说明与下载操作区紧跟在选中游戏信息下方展示；点击下载后展示下载进度、校验中、安装中、完成/失败等明确状态。
- **市场列表容器**：市场页直接展示游戏列表项。
- **市场展开交互**：市场列表支持手动展开/收起动画，默认全部收起；已展开项由用户主动收起。展开/收起箭头按钮使用
  `@click.stop` 阻止事件冒泡。
- **市场安装目录提示**：市场页需明确提示当前默认游戏库；若游戏库列表为空，应由主进程初始化 exe 同级 `games/` 后再展示。
- **市场版本状态**：已安装版本、当前最新版本、预发布版本在版本列表中展示不同状态标记。
- **成就展示**：成就列表支持按游戏版本筛选，支持展开/收起，默认收起。若当前版本无成就，显示空列表。
- **动态元数据**：游戏详情页切换版本时，优先展示当前选中版本的元数据（如简介、成就）；为空时展示空状态。
- **房间入口**：顶部导航的“房间”按钮进入 `/rooms`，包含“局域网”和“服务器”两个 Tab；顶部头像与玩家名点击进入个性化页面。
- **局域网始终可用**：房间页的 frp/官方服务器选择只表示公网入口，局域网发现和 `房主局域网IP:defaultRoomPort` 直连始终可用。
- **官方服务器模式**：房主开启官方服务器模式后展示 `<relay-public-host>:随机数字` 短地址和复制按钮；切换公网入口前必须先通知其他玩家离开，注册失败自动回退到 frp 显示状态。
- **房间发现校验**：局域网/服务器卡片加入前必须校验本地是否安装对应游戏、版本是否匹配、房间是否等待中、人数是否已满、是否为自己的房间；自己的房间点击加入时必须给出友好提示。
- **服务器卡片展示**：服务器房间卡片展示官方短地址；游戏名称显示游戏本身名称，优先本地 Manifest，其次中继返回的 `gameName`，最后兜底 `gameId`。
- **游戏库展示**：
    - 游戏封面展示区域统一使用 **16:9** 比例，图片模式为 `contain`（完整显示）或 `cover`（填满）。
    - 支持 **长按** 游戏封面进入编辑模式，此时可拖动调整游戏排序。
    - 支持将任意游戏文件夹直接拖拽到游戏库窗口导入；缺少 `game.json` 时弹出补录表单。
    - 排序结果需持久化存储。
    - 聊天消息：当前用户发送的消息，名字显示为绿色，使用 `--bz-green` CSS 变量。文字使用 `white-space: pre-wrap` 保留换行符。
    - 语音消息：录制采用 Opus 编码（`audio/webm;codecs=opus`），采样率 24kHz、码率 32kbps，通过 `MediaRecorder` API 实现。语音消息最长
      10 秒，过短（<0.5s）不予发送。
    - 语音播放：点击语音消息气泡触发播放，文字切换为"播放中..."带三个依次闪烁的圆点动画（`dot-blink` @keyframes，
      `animation-delay` 错位 0s/0.2s/0.4s）。再次点击停止播放（`audio.pause()` + 状态清除）。`audio.onended` 自动恢复文字。
      `currentAudio` 引用确保停止行为确实终止音频播放。
    - 收藏游戏：特别喜欢的游戏在封面右上角展示爱心图标。
- **聊天弹窗窗口**：
    - 房间聊天支持弹出为独立窗口，点击 RoomChat 标题栏右侧展开按钮触发。
    - 弹窗窗口尺寸和位置自动持久化到 `config.json`（`chatWindowBounds`），下次打开恢复。
    - 弹窗关闭时自动通知主窗口恢复聊天显示；主窗口显示"聊天已弹出到独立窗口"提示与收回按钮。
    - 弹窗窗口通过加载同一 Vue 应用的路由 `/chat-popout` 渲染，`AppContent` 通过 `isPopupWindow` 判断跳过主菜单渲染。
    - 主进程 `sendRoomEventToChat()` 统一转发所有房间事件（聊天消息、状态同步、连接状态等）给弹窗。
    - 弹窗输入框使用原生 `<textarea>` 替代 `<n-input>`，支持 Shift+Enter 换行、Enter 发送。
    - 输入框底部拖动条（`.chat-resize-handle`）可调整输入区高度（60px~260px），高度持久化到 `chatInputHeight`。
- **聊天图片消息**：
    - 弹窗聊天框支持 Ctrl+V 粘贴图片、拖拽图片文件和点击"发送图片"按钮选择图片发送，单张限制 5MB。
    - 点击"发送图片"按钮（📷 图标）触发隐藏的 `<input type="file" accept="image/*" multiple>`，支持批量选择。选择后和粘贴/拖拽统一走 `addImageFromFile()` 处理。
    - 录音过程中图片发送按钮禁用。
    - 图片以缩略图（max 240×200px）展示在输入框上方预览区，发送前可删除。
    - 文字和图片打包为一条消息（`images[]` 数组），消息展示时图片在上、文字在下。
    - 消息列表中图片使用自定义放大镜光标（黑色 SVG data URI），点击弹出全屏预览。
- **图片预览器**：
    - `ImageViewer.vue` 组件使用 `<teleport to="body">` 渲染全屏半透明蒙层（z-index: 9999）。
    - 无边框、无关闭按钮、无 NaiveUI Modal 依赖；点击蒙层空白处退出。
    - 图片最大 92vw×92vh，`object-fit: contain`。
    - 蒙层使用自定义缩小光标（白色 SVG data URI），图片区域 `cursor: default`。
- **内嵌聊天自适应高度**：
    - RoomChat 使用完整 flex 布局链，`.chat-messages` 为 `flex:1; min-height:200px`，随窗口大小自动调整。
- **游戏详情页**：
    - 删除游戏功能使用模态框，支持多选版本进行删除，默认选中当前版本。
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
  `type="error" secondary`），右侧提供"清除缓存"按钮。点击卸载弹出 NaiveUI 自定义确认弹窗，包含不可撤销的警告文案、是否同时删除所有游戏库目录的勾选项、以及删除路径列表预览。确认后调用
  `system:uninstall` IPC 执行卸载。若处于开发模式或卸载程序不可用，弹出友好提示。
- **设置页清除缓存入口**：设置页底部"卸载客户端"按钮右侧提供"清除缓存"按钮（`secondary`），旁边提供"迁移游戏库"按钮。点击"清除缓存"后弹出 `n-modal preset="card"` 弹窗（400px），展示确认文案。点击"清除缓存"后启动模拟进度条（200ms 间隔随机递增 5-20%，最高到 90%），同时通过 `system:clearCache` IPC 调用主进程执行实际清理。主进程清理 `AppData\Roaming\bz-launcher` 和 `AppData\Local\bz-launcher-updater` 两个缓存目录，逐项删除并静默跳过锁定文件（`force: true, maxRetries: 3`），返回已清理的空间大小。IPC 完成后进度条跳至 100%，展示释放空间结果。取消/确认按钮统一在弹窗右下角（`#action` slot + `justify="end"`）。
- **设置页头像预览**：点击设置页头像缩略图（`AvatarWithFrame` 组件，40px），弹出
  `n-modal preset="card"` 模态框，280×280 圆形大图预览（含头像框）；无头像时显示玩家名首字母大字（使用 `--bz-bg-card-placeholder` 和
  `--bz-text-on-placeholder` CSS 变量适配暗/亮主题）。
- **设置页主题跟随系统**：主题选择器提供"跟随系统"选项（`themeAuto`）。当选择 `auto` 时，平台自动跟随操作系统亮/暗模式切换。
- **设置页官网链接**：设置页需展示官方网址，使用 NaiveUI `n-a` 组件渲染为可点击链接，`
  @click.prevent` 拦截默认跳转后通过 `system:openUrl` IPC 调用 `shell.openExternal` 打开系统默认浏览器。
- **GitHub Token 设置**：设置页提供 `githubToken` 字段（`n-input type="password"`，`@copy.prevent` + `@cut.prevent` 防剪贴板泄漏）。填写有效的 GitHub Personal Access Token 后，平台所有 GitHub API 请求自动携带 `Authorization: Bearer <token>`，将 API 限流从 60 次/小时提升至 5000 次/小时（用于 Release Asset 解析）。
- **设置页数据自检**：设置页需提供"数据自检"按钮，展示 `config.json`、游戏目录、版本路径、Manifest 完整性等检查结果。
- **更新错误诊断**：更新失败时前端展示归类后的错误码文案与技术摘要。
- **设置页游戏库列表管理**：
    - 支持维护多个游戏库路径，并为每个项提供默认游戏库切换、打开路径和删除入口。
    - 默认游戏库影响新导入或市场下载安装的游戏，已导入游戏所在目录保持不变。
    - 删除游戏库时必须阻止删除最后一个路径，并通过 i18n 展示结构化错误文案。
    - 迁移游戏库时先选择源游戏库，再选择新的空目录；迁移源目录中的全部文件，成功后删除源目录，并同步更新游戏记录和游戏库列表。
    - 支持展示“当前 + 历史”路径列表、打开路径、删除路径。
    - 删除路径时只删除该路径中平台可识别的游戏版本目录，并更新本地记录；用户自行放入的非游戏文件必须保留。
- **房间管理增强**：
    - Host 可在玩家列表中踢人，被踢玩家收到弹窗并自动离开房间。
    - 被踢玩家在同一房间生命周期内禁止重新加入。
    - 房主解散房间后，所有客户端需稳定收到 `room:disbanded` 并退出房间页。
- **成就弹窗版本一致性**：成就弹窗读取 Manifest 时使用当前运行版本。
- **经济系统前端同步**：游戏结束事件后需刷新用户数据，确保每 10 分钟时长奖励的 BZ 币能即时反映在 UI。

### 6.4 打包与原生成模块

- **原生模块编译**：`better-sqlite3` 为 C++ 原生模块，`postinstall` 脚本中的 `electron-builder install-app-deps` 会在每次 `npm install` 后自动针对当前 Electron 版本重编译 `.node` 文件。
- **asarUnpack 必需**：原生 `.node` 文件从 `app.asar` 外部加载，`package.json` 的 `build.asarUnpack` 配置为 `["node_modules/better-sqlite3/**"]`。
- **extraResources 用于原生可执行文件**：`7zip-bin` 提供的 `7za.exe` 通过 `child_process.spawn()` 调用。使用 `build.extraResources` 将其拷贝到 `process.resourcesPath`，代码中通过 `process.resourcesPath` 手动拼接路径。配置示例：`{ "from": "node_modules/7zip-bin/win/x64", "to": "7za", "filter": ["7za.exe"] }`。
- **pnpm 依赖提升（hoisting）**：`electron-updater` 的传递依赖 `debug` 需要 `ms` 模块；`ms` 声明为项目直接依赖，由 pnpm 提升到顶层 `node_modules`。项目中 `ms` 作为兼容性占位依赖，代码不直接引用。
- **electron-rebuild 手动补充**：开发阶段出现 `NODE_MODULE_VERSION` 不匹配错误时，执行 `npx electron-rebuild -f -w better-sqlite3` 补齐重编译。
- **GitHub Release Asset 自动校验**：
  - `sha256` 和 `size` 为可选字段（`sha256` 全可选，`size` 仅 GitHub 直链时可省略）。
  - **双重解析路径**：① **前端预解析**（展开卡片时）：`MarketView.toggleExpand()` → `resolveMissingAssetInfo()` → `loadAssetInfo()` → IPC `market:resolveAssetInfo` → `MarketService.resolveAssetInfo()`。展开后 sha256/size 尚未返回时，size 区域显示 `<n-skeleton>` 骨架；返回后自动更新。② **下载时懒解析**：`downloadAndInstall()` 阶段对 GitHub 直链实时调用 `resolveGitHubAssetInfo()` 从 GitHub API 获取并缓存。
  - `resolveGitHubAssetInfo()` 调用 GitHub REST API `GET /repos/{owner}/{repo}/releases/tags/{tag}`，从 `assets[].digest` 提取 SHA256（去除 `sha256:` 前缀），从 `assets[].size` 提取文件大小。**digest 校验**：必须同时满足 64 位长度和纯 hex 字符才被接受；不满足则 sha256 置 `undefined`。`parseGitHubReleaseUrl()` 从 `downloadUrl` 解析出 owner/repo/tag/assetName。
  - **自动重试**：`withRetry()` 通用工具，使用指数退避（1s → 2s → 4s → 8s → 16s），最多重试 5 次（含首次共 6 次尝试）。失败结果不写入缓存。
  - **缓存**：`MarketService.resolvedAssets` Map（`{ sha256?: string; size: number; at: number }`），TTL 1 小时（`CACHE_TTL_MS`），与市场索引缓存一致。
  - **手动刷新**：GitHub Release 游戏的 size 右侧显示 🔄 刷新图标（`RefreshOutline`），点击可强制清除前端缓存后重新请求。`isAssetRefreshable()` 控制按钮出现条件。
  - **版本完整性分级**：前端使用 `getVersionIntegrity()` 返回五档结果：`"ok"`（一切正常）、`"missingSha256"`（缺 sha256，黄色警告标签）、`"missingSize"`（缺 size，黄色警告标签）、`"invalid"`（下载链接非法或非 GitHub 直链缺少 size，红色错误标签）、`null`（GitHub 直链 Asset 信息尚未解析，不显示标签）。`isVersionDownloadable()` 仅用于下载按钮禁用判断：非 GitHub 直链缺 size 时禁用。
  - **下载阶段**：`downloadAndInstall()` 按优先级获取 sha256/size：① 版本对象 → ② `resolvedAssets` 缓存 → ③ GitHub 直链实时 API。size 缺失则拒绝下载（`market_missing_size`），sha256 缺失仅跳过哈希校验不拒绝。

### 6.5 客户端更新发布规范

- **更新源**：使用 GitHub Releases（仓库：`baozha2023/bz-games`）作为 `electron-updater` 的发布源。
- **发布资产**：每个版本 Release 单独上传 `BZ-Games Setup x.x.x.exe`、`latest.yml`、`*.blockmap`。
- **版本策略**：发布前需先提升 `package.json` 版本号，并使用对应 Tag 创建 Release。
- **生效条件**：自动更新在打包后的生产环境可用；开发模式（`pnpm dev`）下提示不支持。
- **本地数据保护**：
    - 在下载更新与安装更新前，`UpdateService` 必须创建数据快照目录（`.update-snapshots/<timestamp-stage>`）。
    - 快照至少包含 `config.json` 备份文件、SQLite `db/` 目录副本与所有游戏保存根目录副本（支持多路径）。
    - 快照写入失败时记录日志并保留现有 `config.json` 与所有游戏目录。

***

## 七、联机系统详解

### 7.1 设计原则

1. **平台是联机中间件**：房间管理、消息中继、玩家状态全部由平台负责，游戏通过 Game API 接入平台联机能力。
2. **房主即服务端**：Room Server 运行在房主机器上，其他玩家的平台作为 Room Client 连接。
3. **内网穿透工具无关**：平台只使用固定本地端口（可配置），用户选用任何内网穿透工具均可。
4. **两层 WebSocket 服务**：
    - **Room Server/Client**：平台之间互联，处理房间状态与游戏消息中继。
    - **Game API Server**：平台与本机游戏进程互联，提供平台能力给游戏。
    - **Host 本地投递优化**：当客机消息目标是房主本机游戏进程时，`RoomServer` 应直接调用 `GameApiServer.sendEvent()`
      投递，跳过房主本地 `RoomClient` WebSocket 回环。
    - **Host 聊天本地投递**：房主发送聊天消息时，直接通过 `mainWindow.webContents.send` + `roomServer.broadcast`
      （排除自己）推送，不经过 WebSocket 本地回环。
    - **游戏中继 UI 隔离**：`game:message:relay` / `game:broadcast:relay` / `game:message:ack` 进入 `GameManager.relayToGame()`，不转发到房间 UI 或聊天窗口 IPC。
    - **中继幂等缓存**：`RoomServer` 和 `RoomClient` 使用最近 `messageId` 缓存过滤重复游戏中继消息，默认缓存最近 1000 条。
5. **游戏结束语义**：
    - `game.end` API：游戏主动调用，平台回复 `{success: true}`；房间状态和进程生命周期由 Host 进程退出事件驱动。
    - 游戏真正结束仅由 **Host 进程退出** 触发：`handleProcessExit` → `notifyRoomGameEnd` → state 变 `"waiting"` + 广播
      `room:game:end` + `room:state:sync`。客机 `RoomClient` 收到 `room:game:end` 后调用 `onGameStop` → `stop()`
      杀死所有客机进程。
    - 前端通过 `room:state:sync` 检测 `playing→waiting` 态变化来显示"游戏已结束"聊天消息。

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

#### 客机重连流程

当客机游戏进程意外崩溃退出后：

1. **触发条件**：`GameManager.handleProcessExit` → `GAME_PROCESS_ENDED` → `useRoomStore.onProcessEvent` 检测
   `type==="end" && room.state==="playing" && !isHost` → `isReconnectMode = true`。
2. **UI 表现**：客机玩家在房间页看到"重连"按钮，位于 Ready/Unready 按钮区域。
3. **点击重连**：`handleReconnect()` → `reconnectGame()` → `room.reconnect` IPC → `gameManager.launch(gameId, version)`。
   `launch()` 内部 `isGameRunning()` 守卫（已退出进程为 false）→ 正常启动新进程，注入同一个 `BZ_ROOM_ID`。
4. **房间状态**：Host 和其他客机维持当前流程，房间 `state` 保持 `"playing"`。客机进程退出不广播 `room:game:end`；Host 进程退出触发 `notifyRoomGameEnd`。
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
| `room:chat`            | Bidirectional   | 聊天消息（支持文字、语音、图片，文字和图片可打包为一条消息）                          |
| `room:chat:history:sync`| Server → ChatWin| 主进程向聊天弹窗同步历史消息                                              |
| `game:message:relay`   | Bidirectional   | 游戏内单播消息中继                                                       |
| `game:broadcast:relay` | Bidirectional   | 游戏内广播消息中继                                                       |
| `game:message:ack`     | Bidirectional   | 可靠游戏消息的中继确认                                                     |

#### 消息中继约束

- **v1 基础通信 API**：`message.broadcast` 默认转发给其他玩家；`message.send` 必须提供目标玩家（`to` 或 `targetPlayerId`）。中继层会自动补齐 `senderId`、`messageId`、`sentAt` 字段，便于游戏侧幂等处理与时序判断。
- **v2 增强通信 API**：v2 是 v1 的增强层，游戏通过 `auth.payload.capabilities.protocolVersion === 2` 判断是否可用。v2 `message.send` 会校验目标玩家仍在当前房间中；目标不存在时返回结构化错误 `TARGET_NOT_FOUND`。
- **v2 频道与批量**：`message.publish` 是频道化广播接口，会额外补齐 `channel`、`mode: "publish"`；`message.batch` 是批量广播接口，单批最多 32 条，平台会在投递到游戏前拆分为多条 `event.message`，保持旧事件处理器兼容。
- **v2 订阅与投递语义**：`message.subscribe` / `message.unsubscribe` 在本机 `GameApiServer` 内过滤投递给游戏进程的 `event.message`，默认 `"*"` 表示接收所有频道。`delivery` 支持 `reliable / ordered / latest / unreliable`：`ordered` 在 RoomServer 按 sender+channel+seq 丢弃倒序包。
- **v2 可靠确认**：`reliable: true` 或 `delivery: "reliable"` 会启用平台级确认，发送方游戏收到 `event.messageAck` 可用于清理本地等待队列；平台提供确认和去重。重连恢复或最新状态缓存由游戏自身协议实现。
- **v2 上限与内容类型**：游戏本地 API 单条请求最大约 64KB，超过限制会被平台丢弃或拒绝；`contentType: "binary"` 仅表示 JSON payload 中承载的是二进制内容编码，不代表底层 WebSocket 已切换为 binary frame。
- **v2 中继安全边界**：`RoomServer` 接受已加入房间的 WebSocket 发送游戏中继消息，并以连接绑定的 `playerId` 覆盖 payload 内的 `senderId`；`game:message:ack` 由平台中继层生成并转发，客户端上行 ACK 会被忽略。
- **v2 中继状态生命周期**：`RoomServer.start()` / `RoomClient.connect()` / `RoomClient.disconnect()` 会重置 v2 引入的 `messageId` 去重缓存与 `ordered` seq 缓存，确保上一轮房间或上一次连接的状态不影响新房间的合法消息。
- Host 处理来自客机、且目标为房主本机游戏的 `game:message:relay` / `game:broadcast:relay` 时，优先直接投递给本机
  `GameApiServer`。
- `RoomClient` 需通过 `room:event` 向渲染层同步连接状态变化，包括
  `connecting / connected / reconnecting / failed / disconnected` 及重试信息。
- 房间已满时允许同一 `playerId` 重连加入（Rejoin）。
- **房主聊天本地优化**：Host 发送聊天消息时，`room.ipc` 判为 Host 后直接 `roomServer.broadcast(msg, hostSocket)` +
  `mainWindow.webContents.send` 推送自身渲染层，不经 WebSocket 回环。
- **房间结束消息双重源**：`room:game:end` 由 Host 广播（`notifyRoomGameEnd`）触发前端 `isReconnectMode=false`；"游戏已结束"
  聊天消息由前端 `room:state:sync` 检测 `playing→waiting` 态变化产生。

***

## 八、平台 API 规范（面向游戏开发者）

> 游戏进程通过连接 `ws://127.0.0.1:{BZ_API_PORT}` 使用平台能力。
> 连接后必须**立刻发送** **`auth`** **请求**，否则 **60 秒**后连接将被服务端主动断开。

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

### 8.2 v1 API 列表

v1 是稳定兼容层，已有游戏应优先按 v1 接入。

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

### 8.3 v2 API 列表

v2 是增强层，适合实时同步、频道过滤和可靠确认。游戏应先读取 `auth` 响应中的 `capabilities` 再使用 v2 API。

| Action               | Payload (Request)                               | Returns (Response Payload)                           | Description                                   |
|:---------------------|:------------------------------------------------|:-----------------------------------------------------|:----------------------------------------------|
| `message.publish`    | `{ channel?, seq?, reliable?, data, ... }`      | `{ success: true }`                                  | 频道化广播消息，适合实时状态/输入流。                           |
| `message.batch`      | `{ channel?, messages: [] }`                    | `{ success: true }`                                  | 批量广播消息，平台拆分为多条 `event.message` 投递。              |
| `message.subscribe`  | `{ channel?: string, channels?: string[] }`     | `{ success: true, channels: string[] }`              | 订阅指定消息频道。                                      |
| `message.unsubscribe`| `{ channel?: string, channels?: string[] }`     | `{ success: true, channels: string[] }`              | 取消订阅指定消息频道。                                    |

重连恢复或最新状态缓存由游戏自身协议实现。

### 8.4 事件列表 (Event)

平台会主动推送以下事件给游戏进程：

- `event.message`: 收到其他玩家的消息（Payload 至少包含 `{ senderId, messageId, sentAt, ... }`）
- `event.messageAck`: 可靠消息中继确认（Payload 包含 `{ messageId, senderId, to, sentAt }`）
- `event.playerJoined`: 有新玩家加入房间
- `event.playerLeft`: 有玩家离开房间
- `event.gameEnd`: 游戏被强制结束（如房间解散）
