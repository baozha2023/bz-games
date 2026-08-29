# CLAUDE.md — BZ-Games 项目规范

> 本文档为 AI 辅助开发上下文文件，定义项目架构、功能边界、接口规范与实现约定。
> 开发工作必须遵循本文档中的结构、命名、流程与安全要求。

---

## 一、项目概述

### 平台简介

**BZ-Games** 是一个本地优先的 Windows 游戏平台，类似于 Steam / Epic Games Store，
基于 **Vue 3 + TypeScript + Electron** 构建，运行平台为 **Windows 10/11（x64）**。

### 核心设计原则

| 原则                 | 说明                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **本地优先**         | 用户配置、游戏记录、经济数据与统计数据存储于本地；账号、论坛与反馈属于可选在线能力，不影响核心功能 |
| **便携式存储**       | 配置默认存储在应用根目录，游戏可存放在默认目录或用户维护的多路径目录中                             |
| **开放式游戏管理**   | 用户可将符合平台规范的游戏载入平台，平台会自动复制并管理游戏文件                                   |
| **统一联机基础设施** | 平台提供房间管理、玩家状态、聊天、游戏消息中继、断线重连与公网入口能力                             |
| **公网入口可切换**   | 局域网入口持续可用，公网入口支持用户自备 frp 与官方中继服务器短地址                                |
| **Windows 专用**     | 面向 Windows 10/11 x64 设计、开发、测试与打包                                                      |

### 平台核心功能

- 游戏库管理（异步多任务导入、进度占位、取消/重试/中断恢复、删除、排序、收藏、封面/图标展示）
- 游戏启动与进程生命周期管理（主进程统一托管）
- 联机房间系统（创建、加入、准备、开始、离开、聊天、踢人、解散同步）
- 房间发现系统（局域网自动发现、官方服务器房间列表、加入前本地游戏与版本校验）
- 国际化（`zh-CN / en-US / ja-JP / zh-TW / de-DE`）
- 成就系统（列表、解锁、系统通知、红点提示）
- 统计系统（支持增量/全量统计模式，游玩时长自动累计）
- 经济系统（签到、BZ 币、累计游玩时长、头像框解锁与装备）
- Game API Server（本地 `ws://127.0.0.1`，向游戏进程提供平台能力，v2 支持 JSON 控制帧与二进制实时帧）
- 游戏市场（远程发现、详情展示、下载并安装到默认游戏库，GitHub Release Asset 自动补齐 sha256/size）
- 游戏托管（创作者、管理员和超级管理员上传 ZIP 到官方服务器；创作者提交后需审核，管理员与超级管理员直接发布，市场通过逻辑地址下载）
- 个性化系统（头像框解锁、装备、预览，支持多场景展示）
- 系统设置（玩家信息、主题、端口、语言、版本迁移、游戏库列表、GitHub Token）
- 官方账号服务（GitHub OAuth 登录、资料昵称同步与用户主动开启的在线状态）
- 建言献策（仅 GitHub 登录用户可提交文字与图片，每个账号每 12 小时一次）
- 论坛（仅登录用户；帖子纯文本+图片、服务端敏感词过滤、点赞/评论、游标信息流与独立详情页）
- 创作者中心（所有 GitHub 用户可登录；数据库 RBAC 控制反馈管理、游戏投稿、审核和发布；Vue 3 + Vite 独立构建为 `/admin/` 同源静态站点；生产由 Nginx 直接托管页面并将接口转发给本机 Relay）
- 客户端卸载系统（根目录独立 Rust 卸载器、崩溃恢复、任务阻塞、可选数据清理与路径安全防护）
- 默认封面/图标静态回退（`GameCover.vue` / `GameIcon.vue` 在无自定义资源时使用内置静态图片）
- 官网最新安装包下载（正式 GitHub Release 原子同步到官方服务器，固定接口支持断点续传并对全部并发下载合计限速 100 Mbps）
- 平台版本管理（管理员可查看当前版本，仅超级管理员可在管理端上传稳定版 EXE，手动上传允许升版或降版；Actions 仍只允许升版；两条链路统一经过暂存、SHA-256/PE/semver 校验、发布锁和 latest 原子切换，并把发布文件归一到发布目录属主、属组与 `0640` 权限）

---

## 二、技术栈

| 分类            | 技术 / 库                                    | 备注                                                                                |
| --------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| 桌面框架        | Electron                                     | <br />                                                                              |
| 前端框架        | Vue 3                                        | <br />                                                                              |
| 开发语言        | TypeScript（严格模式）                       | <br />                                                                              |
| UI 组件库       | Naive UI                                     | <br />                                                                              |
| 状态管理        | Pinia                                        | <br />                                                                              |
| 页面截图        | html2canvas                                  | 统计热力图分享图生成                                                                |
| 静态文件服务    | serve-static                                 | `entry=serve` 游戏本地 HTTP 服务，根路径回落到 `index.html`                         |
| 构建工具        | electron-vite                                | <br />                                                                              |
| 打包与更新      | electron-builder + Velopack 1.2.0            | electron-builder 只生成 Electron 目录包，Velopack 管理 `.runtime` 全量/增量更新     |
| 原生引导层      | Rust                                         | 根目录稳定启动器、独立卸载器、安装向导、健康守护与回滚                              |
| 包管理器        | npm                                          | 以 `package-lock.json` 为唯一锁文件                                                 |
| 进程间通信      | Electron IPC（contextBridge）                | <br />                                                                              |
| 本地数据存储    | electron-store                               | v10+ (ESM)，需在构建中配置 include                                                  |
| SQLite 数据存储 | better-sqlite3-multiple-ciphers              | ChaCha20 加密的游戏实体、会话、成就与统计事件                                       |
| 在线服务元数据  | MySQL                                        | 用户、OAuth、会话、在线状态、反馈以及论坛帖子/评论/点赞/搜索 outbox                 |
| 图片对象存储    | MongoDB GridFS                               | 保存反馈图片与论坛帖子图片                                                          |
| Multipart 解析  | busboy                                       | 中继服务流式接收反馈和论坛图片并限制字段、文件数量及大小                            |
| 论坛搜索        | 可选 Elasticsearch 8.19.x + analysis-ik      | MySQL 为事实源；ES 未配置或未就绪时隐藏搜索，标题/正文使用 `ik_max_word`/`ik_smart` |
| 管理前端        | Vue 3 + TypeScript + Vite + Pinia + Naive UI | 构建为 `/admin/` 同源静态站点                                                       |
| 本地备份        | 7zip-bin / `.bzgames` V1、V2                 | V1 永久只读导入 v3.4.2；V2 为 4.x 长期导入导出协议，源文件永不删除                  |
| WebSocket 服务  | ws                                           | Game API、Room Server、Room Client 均基于 WebSocket，v2 高频通信支持原始二进制帧    |
| 版本比较        | semver                                       | 用于平台版本与游戏版本兼容性检查                                                    |
| ZIP/7Z 解压     | 7zip-bin (7za)                               | 通过 `child_process.spawn` 调用，统一处理 .zip 和 .7z                               |
| 目标平台        | Windows 10/11 x64                            | <br />                                                                              |

---

## 三、项目目录结构

```
bz-games/
├── .eslintrc.cjs                       # Electron/Vue/TypeScript ESLint 规则与生成目录忽略配置
├── CLAUDE.md                             # AI 开发上下文与项目规范文档
├── README.md                             # 项目简介与基础使用说明
├── DEVELOPER_GUIDE.md                    # 面向游戏接入方的开发接入指南
├── docs/
│   └── GAME_API_V1_V2_REFERENCE.md        # Game API v1/v2 接口说明文档
├── bz-games-admin/                        # 被父仓库忽略的独立管理端仓库；不参与父仓库提交
├── relay-server/                          # 官方服务端（中继 / OAuth / 账号 / 反馈 / 论坛 / 管理 API）
│   ├── API.md                             # 中继服务器接口规范
│   ├── DATA_MODEL.md                      # MySQL/MongoDB 数据模型说明
│   ├── DEPLOY.md                          # 中继服务器部署手册
│   ├── bz-games-relay.service.example     # 与 src/config.js 一一对应的 systemd 配置示例
│   ├── package.json                       # 中继服务器独立依赖
│   ├── scripts/
│   │   ├── relay-e2e-test.js              # 房间中继端到端测试
│   │   ├── feedback-service.test.js       # 反馈限流、上传与管理接口测试
│   │   ├── forum-service.test.js          # 论坛鉴权、轻量游标和搜索降级测试
│   │   ├── auth-service.test.js           # OAuth 回跳白名单测试
│   │   ├── access-control-service.test.js # Portal RBAC 与 Cookie 写请求同源校验测试
│   │   ├── game-hosting-service.test.js   # 游戏托管、审核、容量与文件回滚测试
│   │   ├── portal-user-service.test.js    # Portal 会话、角色调整与管理员用户列表测试
│   │   └── admin-static-service.test.js   # 管理静态站点与路径安全测试
│   └── src/
│       ├── index.js                       # 中继服务器入口（HTTP + WebSocket 统一启动）
│       ├── state.js                       # 共享运行时状态（rooms / clients Map）
│       ├── config.js                      # 环境变量集中配置
│       ├── http-server.js                 # HTTP 服务创建与路由分发
│       ├── ws-server.js                   # WebSocket 服务创建与鉴权
│       ├── services/
│       │   ├── auth-service.js            # GitHub OAuth 认证与会话管理
│       │   ├── access-control-service.js  # Portal 认证、RBAC、所有权与同源写入校验
│       │   ├── admin-static-service.js     # Relay 直连/开发时的 `/admin/` 静态资源、SPA fallback 与安全响应头
│       │   ├── feedback-service.js        # 登录反馈上传、限流、GridFS 图片与管理 API
│       │   ├── forum-service.js           # 论坛帖子、评论、点赞、限流、GridFS 图片与管理 API
│       │   ├── forum-search-service.js    # Elasticsearch 索引、search_after 与 alias 适配
│       │   ├── game-hosting-service.js    # 游戏投稿、审核、托管资源与市场配置导出
│       │   ├── message-router.js          # WebSocket 消息路由分发（含中继侧敏感词过滤与图片拦截）
│       │   ├── mongo-service.js           # MongoDB GridFS 连接管理
│       │   ├── mysql-service.js           # MySQL 连接池与最新完整建表结构
│       │   ├── portal-user-service.js     # Portal 创作者激活与管理员用户查询
│       │   ├── release-download-service.js # 桌面发行版校验、原子发布与限速下载
│       │   ├── room-service.js            # 房间创建、加入、密码、清理
│       │   ├── system-monitor-service.js  # CPU、内存、磁盘、网络和连接状态监控
│       │   └── sensitive-word-service.js  # 中继侧敏感词过滤服务（词库加载 + Unicode 安全字符级掩码）
│       ├── vocabulary/                    # 敏感词词库目录（7 个高置信分类 .txt 文件）
│       ├── utils/
│           ├── http.js                    # HTTP 工具（Cookie / Bearer / redirect / JSON 响应）
│           ├── protocol.js                # 通信协议常量（relay:* 指令集）
│           ├── relay-auth.js              # HTTP/WS 统一 relayToken 鉴权工具（timingSafeEqual）
│           └── ws.js                      # WebSocket 消息序列化与广播发送
├── native/bootstrap/                     # Rust 稳定启动器、独立卸载器、安装向导与健康回滚
├── package.json                          # 依赖、脚本与打包发布配置
├── private-build.config.example.json      # 私有构建配置模板（CDN/OSS/中继/加密种子等环境变量）
├── scripts/
│   ├── check-config-examples.mjs          # 客户端/服务端配置示例字段及敏感路径忽略规则检查
│   ├── run-database-test.mjs              # 隔离目录内构建并运行数据库服务测试
│   ├── test-database-service.ts           # v4 最终 Schema、旧库拒绝、路径规则与仓储行为测试
│   ├── run-v1-conversion.mjs              # 独立执行 v3.4.2 V1 转换器
│   └── build-velopack.ps1                 # Electron、Velopack 与 Rust 安装器构建链
├── package-lock.json                     # npm 依赖锁定文件
├── tsconfig.json                         # TypeScript 根配置
├── tsconfig.node.json                    # 主进程/预加载/共享代码 TS 配置
├── tsconfig.web.json                     # 渲染进程 TS 配置
├── vitest.config.ts                      # Vue 论坛组件与 composable 的 jsdom 测试配置
├── electron.vite.config.ts               # Electron-Vite 构建配置（读取 private-build.config.json 注入构建期常量）
├── config.json                           # 本地持久化配置（运行生成）
├── db/                                   # SQLite 数据库目录（运行生成）
│   └── bz_games.db                       # 游戏/版本实体、游玩会话、成就解锁与统计上报统一加密数据库
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
│   │   │   ├── system.ipc.ts              # 设置与系统 IPC 处理器
│   │   │   ├── storage.ipc.ts             # Web 游戏本地存储 IPC 处理器
│   │   │   ├── log.ipc.ts                # 渲染进程错误日志回传 IPC 处理器
│   │   │   └── statistics.ipc.ts          # 统计数据查询 IPC 处理器
│   │   ├── services/
│   │   │   ├── storage/
│   │   │   │   ├── database/
│   │   │   │   │   ├── AsyncSqliteDatabase.ts        # 加密异步 SQLite 引擎（Worker Thread、事务批处理）
│   │   │   │   │   ├── BzGamesDatabase.ts            # v4 最终 schema、游戏仓储、完整性与外键校验
│   │   │   │   │   └── PlaySessionDatabaseService.ts # 游玩会话启动/结束及统计查询
│   │   │   │   ├── ConfigCodec.ts          # v4 配置密文信封、严格 Schema 与 AES-256-GCM 编解码
│   │   │   │   └── StoreService.ts        # 本地数据读写与业务数据维护
│   │   │   ├── game/
│   │   │   │   ├── GameEnvironment.ts     # 游戏启动环境变量、bz-config.js 生成与清理
│   │   │   │   ├── GameImportTaskService.ts # 手动导入任务队列、持久化、取消/重试与中断恢复
│   │   │   │   ├── GameLoader.ts          # 统一异步复制、原子落盘、校验与记录同步
│   │   │   │   ├── GameManifestFileService.ts # 已安装 Manifest 的 AES-GCM 严格读写；v4 运行时拒绝明文
│   │   │   │   ├── GameWindowIdentityRegistry.ts # WebContents 与 gameId/version 的可信身份绑定，供存储 IPC 鉴权
│   │   │   │   ├── ProcessTreeService.ts  # 跨平台进程树查询与终止（Windows PowerShell / macOS/Linux ps）
│   │   │   │   └── GameManager.ts         # 游戏进程启动/停止与生命周期管理
│   │   │   ├── game-api/
│   │   │   │   ├── GameApiServer.ts       # 游戏进程本地 WebSocket API 服务（连接认证、协议路由、事件分发）
│   │   │   │   ├── V1GameApiProtocol.ts   # v1 游戏 API 通信协议（send/broadcast）
│   │   │   │   └── V2GameApiProtocol.ts   # v2 游戏 API 增强通信协议（send/broadcast/publish/batch/subscribe + 二进制帧）
│   │   │   ├── room/
│   │   │   │   ├── LocalNetworkService.ts      # 局域网发现、网卡扫描、子网匹配（独立服务，解耦自 RoomDiscoveryService）
│   │   │   │   ├── RelayRoomService.ts    # 房主侧官方中继接入、短地址注册、relay bridge
│   │   │   │   ├── RoomContext.ts          # 按游戏 ID + 版本解析当前匹配房间，供启动校验与环境注入复用
│   │   │   │   ├── RoomClient.ts          # 客机房间连接与重连管理（支持 v2 二进制帧中继）
│   │   │   │   ├── RoomDiscoveryService.ts # 局域网/官方中继房间发现与加入前校验
│   │   │   │   ├── RoomPasswordProbeService.ts # 加入前密码探测（直连/官方短地址）
│   │   │   │   └── RoomServer.ts          # 房主房间服务与消息中继（支持 v2 二进制帧中继、ordered delivery）
│   │   │   ├── market/
│   │   │   │   ├── MarketCatalogClient.ts # 市场目录请求、来源切换与索引解析
│   │   │   │   └── MarketService.ts       # 市场内存缓存、下载、校验、解压与安装
│   │   │   ├── backup/                  # V2 导入导出、完整替换与正式 V1 导入转换器
│   │   │   └── system/
│   │       ├── AccountService.ts      # GitHub OAuth、登出、账号资料同步与主动在线状态
│   │       ├── FeedbackService.ts     # 图片选择/验证、multipart 上传、历史详情查询与被动登录失效联动
│   │       ├── ForumService.ts        # 论坛鉴权、信息流/搜索、帖子引用解析、发帖评论与图片上传客户端
│   │       ├── NotificationService.ts # 系统通知窗口服务
│   │       ├── UninstallService.ts    # 卸载任务阻塞、版本化计划与临时 worker 安全交接
│   │       ├── HealthService.ts       # 写入健康令牌并校验刷新根目录卸载器
│   │       └── UpdateService.ts       # Velopack 检查、下载、应用与更新前快照
│   │   └── utils/
│   │       ├── appPath.ts                 # 应用根路径工具
│   │       ├── externalUrl.ts             # 外部链接 http/https 协议白名单校验与统一打开
│   │       ├── fileUtils.ts               # 并发扫描、异步复制、字节进度与取消工具
│   │       ├── logger.ts                  # Logger 类：生产模式 error→文件日志（5MB 上限 + 3 份轮转备份）；开发模式全量 console 输出；全局异常捕获（uncaughtException / unhandledRejection / render-process-gone / child-process-gone）；console 代理（log/warn/error 统一路由到 Logger）；结构化渲染进程错误接收（RendererLogPayload）
│   │       ├── relayCloseError.ts         # WebSocket 关闭帧错误码映射工具（统一 mapRelayCloseError，三处 room 服务共用）
│   │       └── requestInterceptor.ts      # HTTP 请求头统一注入（Referer 防盗链 + GitHub Token）
│   │
│   ├── preload/
│   │   ├── api.ts                         # 暴露给渲染进程的安全 API
│   │   ├── error-forwarding.ts            # 渲染进程错误捕获与回传（contextIsolated 双世界桥接、结构化 RendererLogPayload + 有界序列化）
│   │   ├── game.ts                        # Web 游戏 localStorage 接管（身份仅取构建窗口时注入的 process argv）
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
│   │       │   ├── useForumStore.ts       # 论坛列表/搜索/游标与滚动位置状态管理
│   │       │   ├── useGameStore.ts        # 游戏库状态管理
│   │       │   ├── useRoomStore.ts        # 房间状态管理
│   │       │   └── useSettingsStore.ts    # 设置状态管理
│   │       ├── views/
│   │       │   ├── AchievementsView.vue   # 成就页面
│   │       │   ├── GameDetailView.vue     # 游戏详情页面
│   │       │   ├── LibraryView.vue        # 游戏库首页
│   │       │   ├── MarketListView.vue      # 市场列表页面（一级界面）
│   │       │   ├── MarketView.vue          # 市场游戏详情页面（二级界面）
│   │       │   ├── SocialView.vue          # 论坛搜索、轻量信息流、无限滚动与发帖
│   │       │   ├── SocialPostDetailView.vue # 帖子正文、图片、点赞与评论详情
│   │       │   ├── ChatPopoutView.vue    # 聊天弹窗独立窗口页面
│   │       │   ├── NotificationView.vue   # 通知窗口页面
│   │       │   ├── FloatBallView.vue       # 下载悬浮球独立窗口页面
│   │       │   ├── PersonalizationView.vue # 个性化页面（头像框管理 + 昵称样式）
│   │       │   ├── RoomDiscoveryView.vue   # 房间发现页面（局域网/服务器 Tab，物理+虚拟局域网合并）
│   │       │   ├── RoomView.vue           # 房间页面
│   │       │   ├── SettingsView.vue       # 设置页面
│   │       │   └── StatisticsView.vue     # 统计页面
│   │       ├── composables/
│   │       │   ├── useForumCommandController.ts # 论坛斜杠指令多级选择状态机（由统一注册表驱动）
│   │       │   ├── useForumPostPicker.ts   # `/post` 的 ES 可用性、最近/搜索结果、限量与竞态取消
│   │       │   ├── useForumReferenceCandidates.ts # `@game` 与斜杠指令共用的市场/游戏候选加载与筛选
│   │       │   ├── useGameListView.ts      # 游戏列表搜索/筛选/版本选择/交错渲染公共逻辑（AchievementsView 与 StatisticsView 共享）
│   │       │   ├── useImageCache.ts        # 统一图片缓存层（本地+远程）
│   │       │   ├── useRoomJoin.ts          # 房间地址加入公共逻辑（服务器 Tab 与手动短地址共用）
│   │       │   └── useScrollContainer.ts   # Naive UI 滚动容器定位与滚动状态复用逻辑
│   │       ├── components/
│   │       │   ├── CachedImg.vue           # 远程图片缓存组件（市场专用）
│   │       │   ├── CalendarHeatmap.vue      # GitHub 风格日历热力图组件（统计页）
│   │       │   ├── CheckInModal.vue        # 签到弹窗组件
│   │       │   ├── AvatarWithFrame.vue     # 头像+头像框叠加组件（CSS overlay 算法）
│   │       │   ├── NicknameText.vue        # 昵称样式渲染组件（颜色/渐变/字体/字重/特效动画 + 主题色自适应）
│   │       │   ├── common/
│   │       │   │   └── ImageSelectionPanel.vue # 建言献策与论坛发帖共用的图片选择、预览、排序和删除面板
│   │       │   ├── game/
│   │       │   │   ├── AchievementIcon.vue # Manifest 自定义成就图标加载与默认奖杯回退
│   │       │   │   ├── GameAchievementsModal.vue # 游戏成就弹窗组件
│   │       │   │   ├── GameCard.vue        # 游戏卡片组件
│   │       │   │   ├── GameCover.vue       # 游戏封面组件（缺失时使用构建期静态默认封面）
│   │       │   │   ├── GameDeleteModal.vue # 游戏删除弹窗组件
│   │       │   │   ├── GameImportOverlay.vue # 导入阶段、进度与任务操作遮罩
│   │       │   │   ├── GameImportPlaceholder.vue # 新游戏默认素材占位卡片
│   │       │   │   └── GameIcon.vue        # 游戏图标组件（缺失时使用构建期静态默认图标）
│   │       │   ├── settings/
│   │       │   │   └── FeedbackModal.vue   # 建言献策文字/图片选择、限流与提交结果弹窗
│   │       │   ├── social/
│   │       │   │   ├── ForumAuthorIdentity.vue # 论坛列表、正文与评论共用的昵称 + GitHub 身份链接
│   │       │   │   ├── ForumPostBody.vue   # 帖子正文与评论共用的纯文本引用解析和展示
│   │       │   │   ├── ForumPostEditor.vue # 发帖与评论共用的纯文本引用编辑器和指令选择界面
│   │       │   │   ├── forum-editor-document.ts # 编辑器纯文档模型、引用替换与无损序列化
│   │       │   │   └── forum-editor-dom.ts # contenteditable 渲染、光标和触发上下文 DOM 适配层
│   │       │   └── room/
│   │       │       ├── PlayerCard.vue      # 房间玩家卡片组件
│   │       │       ├── PlayerList.vue      # 房间玩家列表组件
│   │       │       ├── GameReportCard.vue   # 战绩报告卡片组件（纯文本 / 内置布局 / 自定义 HTML 三种模式）
│   │       │       ├── RoomChat.vue        # 房间聊天组件
│   │       │       ├── LanGuideModal.vue    # 局域网联机引导弹窗组件（NatFrp + EasyTier 配置指引，不再硬编码引导节点地址，RoomView 与 RoomDiscoveryView 共享）
│   │       │       └── ImageViewer.vue      # 聊天图片预览器（复用 Naive UI NImagePreview 工具栏）
│   │       ├── services/
│   │       │   ├── forum-command-registry.ts # 五种斜杠指令的定义、流程、可用条件与协议映射
│   │       │   ├── forum-market-reference-service.ts # 市场目录/索引缓存及引用解析所需的加载状态
│   │       │   ├── forum-page-registry.ts   # 稳定页面 ID、国际化信息及安全导航行为注册表
│   │       │   ├── forum-post-reference-service.ts # 帖子引用批量解析、缓存与并发请求合并
│   │       │   └── forum-reference-view-model.ts # 编辑器与正文共用的五类引用展示状态映射
│   │       ├── locales/
│   │       │   ├── de-DE.ts                # 德文文案
│   │       │   ├── en-US.ts                # 英文文案
│   │       │   ├── forum-commands.ts        # 五种论坛指令及页面注册项的多语言文案聚合
│   │       │   ├── ja-JP.ts                # 日文文案
│   │       │   ├── zh-CN.ts                # 中文文案
│   │       │   └── zh-TW.ts                # 繁体中文文案
│   │       ├── types/
│   │       │   └── electron-api.d.ts       # window.electronAPI 类型声明
│   │       └── utils/
│   │           ├── achievementNotifier.ts  # 成就通知辅助逻辑
│   │           ├── deleteEffect.ts         # 游戏删除碎裂特效工具
│   │           ├── nicknameColor.ts        # 昵称颜色主题感知适配（WCAG 相对亮度算法，支持 hex/rgb 输入归一化）
│   │           └── sound.ts                # 音效播放工具
│   │
│   └── shared/
│       ├── avatar-frames.ts                # 头像框定义数据（16款头像框的解锁条件、白名单归一化与图片文件名）
│       ├── AppConstants.ts                 # 平台构建期常量（CDN/OSS/GitHub/官方中继/配置、数据库及 Manifest 加密种子等，由 electron.vite.config.ts 构建期注入）
│       ├── RoomConstants.ts                # 房间通信与 Game API 常量（消息大小限制、心跳间隔、重连/延迟探测定时器等）
│       ├── binary-protocol.ts              # v2 二进制帧编码/解码工具（4字节头长度 + JSON header + binary body）
│       ├── forum-references.ts              # `@game` 与五种斜杠指令的纯文本协议、解析和序列化
│       ├── game-launch.ts                  # 四种入口分流与 Web/Native 启动配置纯函数
│       ├── game-manifest.ts                # Game Manifest Schema 与类型
│       ├── ipc-channels.ts                 # IPC 频道常量定义
│       ├── log-serialization.ts            # 日志序列化工具（有界深度/数组/字符串截断 + RendererLogPayload 结构化格式）
│       ├── market-search.ts                # 市场/游戏候选的规范化、索引构建和跨市场搜索纯函数
│       └── types/
│           ├── forum.types.ts              # 论坛帖子、评论、引用解析和图片选择共享模型
│           ├── game.types.ts               # Game API 消息与游戏启动结果类型
│           ├── index.ts                    # 共享类型聚合导出
│           ├── market.types.ts             # 市场索引、任务状态与错误码类型
│           ├── report.types.ts             # 游戏战绩报告类型（game.report API 的 payload 定义）
│           ├── room.types.ts               # 房间协议与房间模型类型
│           └── store.types.ts              # 本地存储模型类型
│
├── resources/
│   ├── icon.png                            # 应用图标源图（运行时及设计资源）
│   ├── icon.ico                            # Windows 安装器、启动器和 Electron 包的多尺寸图标
│   ├── avatar-frames/                      # 头像框图片资源（16款透明 PNG，平台运行时读取）
│   ├── default_cover.png                   # 默认游戏封面回退图片（16:9，GameCover.vue 在无自定义封面时使用）
│   ├── default_icon.png                    # 默认游戏图标回退图片（1:1，GameIcon.vue 在无自定义图标时使用）
│   └── vocabulary/                         # 客户端侧敏感词库（7 个高置信分类 .txt 文件）
```

---

## 四、核心概念与术语

| 术语                                      | 说明                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **游戏清单 (Game Manifest)**              | `game.json` 文件，描述游戏元信息与平台集成配置；外部安装包为明文，已安装游戏库中为版本化密文信封                                                                    |
| **游戏库 (Library)**                      | 用户已载入平台的所有游戏集合，来源于本地默认目录与已记录的多游戏路径                                                                                                |
| **房间 (Room)**                           | 一次联机会话，包含房主与所有玩家的状态                                                                                                                              |
| **房主 (Host)**                           | 创建房间的玩家，其平台负责运行 Room Server                                                                                                                          |
| **玩家 (Player)**                         | 加入房间的用户（含房主自身）                                                                                                                                        |
| **Room Server**                           | 房主平台运行的 WebSocket 服务器，经内网穿透工具对外暴露                                                                                                             |
| **Room Client**                           | 非房主玩家的平台连接 Room Server 的 WebSocket 客户端                                                                                                                |
| **Game API Server**                       | 平台在本机运行的本地 WebSocket 服务（`127.0.0.1`），供游戏进程调用平台能力；控制面走 JSON，v2 高频实时数据可走二进制帧                                              |
| **v2 二进制帧**                           | 高频实时通信帧格式：4字节 big-endian header 长度 + UTF-8 JSON header + 原始 binary body，仅用于 `message.send` / `message.broadcast` / `message.publish`            |
| **官方中继服务器 (Relay Server)**         | 公网 Node.js HTTP + WebSocket 服务；房间链路保持透明转发，同时提供 OAuth、账号、反馈和管理员 API。                                                                  |
| **官方短地址**                            | 平台按 `DEFAULT_RELAY_PUBLIC_HOST + roomCode` 拼接的 `<relay-public-host>:随机数字` 地址，展示、复制、服务器列表和手动输入统一使用该格式。                          |
| **官方房间码**                            | 中继服务器生成并识别的数字房间码；平台从短地址中解析后通过 `relay:join.payload.roomCode` 发送给中继服务器。                                                         |
| **房间发现 (Room Discovery)**             | 平台房间页面的局域网/服务器 Tab。局域网 Tab 合并了物理局域网和虚拟局域网（通过 `Promise.all` 并发扫描），按网卡分类过滤；服务器通过官方中继 `/rooms` 获取房间列表。 |
| **游戏市场目录 (Market Directory)**       | 顶层 `market.json` 文件，`sources` 数组列出所有可用市场源，平台一级界面展示                                                                                         |
| **游戏市场索引 (Market Index)**           | 远程 `market.json` 文件（每个市场源仓库中），描述该市场内可展示和可下载的游戏及其版本信息                                                                           |
| **市场安装包 (Market Package)**           | 市场游戏某个版本对应的下载产物，平台下载后校验并安装到默认游戏库                                                                                                    |
| **下载任务 (Download Task)**              | 市场下载安装的一次任务实例，包含状态机、不可变元数据和 AbortController，支持暂停/恢复/取消                                                                          |
| **下载任务快照 (Download Task Snapshot)** | 暂停或中断时持久化到 `pending-tasks.json` 的进度数据，包含已下载字节数、下载 URL、SHA256 等，用于断点续传恢复                                                       |
| **断点续传 (Resume Download)**            | 利用 HTTP Range 请求头从上次断点继续下载，服务端不支持时自动降级为全量下载                                                                                          |
| **bz-config.js**                          | 平台仅为本地 HTML/Serve 游戏生成的临时配置文件（包含端口、Token、玩家、游戏、平台版本及房间信息），游戏退出或启动失败时自动删除。                                   |
| **内网穿透**                              | 由用户自备（如 SakuraFrp），将 Room Server 本地端口映射到公网地址                                                                                                   |

### 联机通信架构流程

```
                          ┌─────────────────────────┐
                          │   官方 Relay Server      │
                          │   (relay-server/)        │
                          │                          │
                          │  • 房间注册 / 短地址     │
                          │  • WebSocket 透明转发    │
                          │  • GitHub OAuth 认证     │
                          │  • 账号 / 在线状态       │
                          │  • 建言献策 / 管理后台   │
                          │  • MySQL + MongoDB       │
                          └────┬──────────┬─────────┘
                               │  ws://   │ https://
                    (中继转发)  │          │ (OAuth / API)
               ┌───────────────┘          └───────────────┐
               ▼                                          ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│        HOST 主机              │         │       CLIENT 客机 (N 台)     │
│                              │         │                              │
│  ┌──────────────────────┐    │         │  ┌──────────────────────┐    │
│  │  Electron Platform   │    │         │  │  Electron Platform   │    │
│  │                      │    │         │  │                      │    │
│  │  Renderer (Vue UI)   │    │         │  │  Renderer (Vue UI)   │    │
│  │       ↕ IPC          │    │         │  │       ↕ IPC          │    │
│  │  Main Process ───────┼────┼────┐    │  │  Main Process ───────┼────┼──┐
│  │  • RoomServer        │    │    │    │  │  • RoomClient        │    │  │
│  │  • RelayRoomService  │    │    │    │  │  • RoomDiscoverySvc  │    │  │
│  │  • GameApiServer ◄───┼──┐ │    │    │  │  • GameApiServer ◄───┼──┐ │  │
│  │  • AccountService    │  │ │    │    │  │                      │  │ │  │
│  └──────────────────────┘  │ │    │    │  └──────────────────────┘  │ │  │
│                             │ │    │    │                             │ │  │
│  ┌──────────────────────┐   │ │    │    │  ┌──────────────────────┐   │ │  │
│  │  Game Process        │   │ │    │    │  │  Game Process        │   │ │  │
│  │  (game.exe)          │   │ │    │    │  │  (game.exe)          │   │ │  │
│  │  ws://127.0.0.1:PORT │◄──┘ │    │    │  │  ws://127.0.0.1:PORT │◄──┘ │  │
│  └──────────────────────┘     │    │    │  └──────────────────────┘     │  │
│                               │    │    │                               │  │
│  公网入口 (frp / Relay):       │    │    │  连接入口:                     │  │
│  局域网 或 wss://relay:PORT    │    │    │  frp地址 或 relay短地址        │  │
│           ▲                   │    │    │           │                   │  │
│           └───────────────────┼────┘    │           └───────────────────┼──┘
│              (ws / wss)       │         │          (ws / wss)          │
└──────────────────────────────┘         └──────────────────────────────┘

       ◄──── 局域网 UDP 发现 (port 38081) ────►

  联机数据流：Game Process ←ws→ GameApiServer ←IPC→ RoomServer/Client ←ws→ Peer / Relay
```

**关键设计理念**：

| 理念              | 说明                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **本地 Game API** | 游戏进程只与本地 `ws://127.0.0.1` 通信，无需感知网络拓扑；平台透明代理所有联机消息。                    |
| **房主单点**      | RoomServer 运行在房主机上，经由 frp 或中继暴露；客机 RoomClient 连接房主地址。                          |
| **中继透明转发**  | Relay Server 不解析游戏协议语义，仅按 `relay:*` 指令做房间管理 + 消息转发，保持零耦合。                 |
| **多入口并存**    | 同一房间可同时有局域网直连、frp 公网、中继转发的玩家混入，房主本地 RoomServer 统一处理。                |
| **断线重连**      | RoomClient 在 WebSocket 断开后自动重连，房主侧维护 `reconnectPlayerIds` 列表，支持游戏进程无缝恢复。    |
| **v2 二进制帧**   | 高频实时通信走 4B 长度头 + JSON header + binary body，减少序列化开销，仅用于 `send/broadcast/publish`。 |

### 4.0 游戏库路径体系

- **游戏库列表**：`game_libraries` 是唯一事实源；内置库记录固定为 `id=builtin, kind=builtin`，真实路径始终由 `<数据根>/games` 推导，外部库保存规范绝对根路径。
- **默认游戏库**：`game_libraries.is_default` 的唯一部分索引与启动不变量保证全局恰好一个 active 默认库；默认库可以是 builtin 或 external，builtin 必须始终 active，但不得被误判为必须始终默认。配置文件不再保存任何游戏库路径数组。
- **路径获取边界**：业务模块统一通过 `StoreService.getDefaultGameStoragePath()` 获取默认游戏库；版本绝对路径只能通过 `resolveGameVersionPath()` 在主进程文件系统边界生成。
- **迁移与删除安全**：迁移游戏库只接受空目标目录，并拒绝目录联接、符号链接及其祖先重解析点；完整复制并校验目录结构后，以稳定 `library_id` 更新 `game_libraries` 并核对 `game_versions` 引用数，最后才删除源目录。复制、数据库更新和源目录删除均最多重试 3 次。复制失败会清空目标；数据库更新失败会恢复原仓库记录并清空目标；源目录删除失败会从目标副本恢复源目录、恢复数据库并清空目标。游戏或版本删除采用“同卷原子隔离目录 → SQLite 批事务更新生命周期 → 清理隔离目录”的两阶段提交；扫描器忽略 `.imports` 与 `.bz-games-trash`，准备或数据库提交失败必须恢复原路径。数据库不物理删除游戏、版本、游戏库、游玩、成就或统计历史；外部游戏库使用 `active/removed` 生命周期，从设置移除后不再参与路径解析，再次添加时重新激活原记录。
- **版本路径**：`game_versions` 只保存 `library_id + relative_path`，运行时解析为实际路径；禁止写回旧版绝对 `path`、`is_present` 字段。

### 4.1 Game Manifest 规范

- **版本分派**：只有精确数值 `manifestVersion: 2` 使用 Manifest V2；字段缺失或任何非 2 值均按长期保留的 V1 单语言协议解析。版本判断只允许存在于 `parseGameManifest()`。
- **V2 国际化**：V2 使用 `defaultLocale + localizations`，游戏名、简介、成就标题/描述和统计显示名属于完整语言包；已声明语言必须覆盖全部稳定成就/统计 ID。当前语言不存在时整包回退到 `defaultLocale`，禁止逐字段混用语言。
- **业务消费边界**：主进程和渲染进程业务只能消费 `ResolvedGameManifest`。切换语言后刷新投影缓存，不重写加密 `game.json`；游戏与版本关系、成就解锁和统计聚合以稳定 ID 为身份，历史事件表可以额外保存事件发生时的本地化显示文本快照，但不得用显示文本参与关联或去重。
- **存储边界**：开发者目录、手动导入源和市场安装包继续使用明文 `game.json`；复制到 `<游戏库>/<id>/<version>` 后由 `GameManifestFileService` 写为 AES-256-GCM 版本化密文信封，平台只在内存中透明解密。
- **密钥注入**：`private-build.config.json` 必须配置至少 32 字节随机值的 Base64 `gameManifestEncryptionSeed`，构建期注入 `GAME_MANIFEST_ENCRYPTION_SEED`。缺失或无效时开发启动和构建必须直接失败，禁止降级为明文。
- **运行时隔离**：Manifest V1 与 V2 都是长期游戏接入能力，不属于兼容设计。游戏库内的运行时 Manifest 读取（`readGameManifestFile` 及其全部调用方）只接受密文，明文必须直接拒绝。导入源目录是唯一例外：手动导入校验（`GameLoader.loadManifest`）与市场安装包（`MarketService`）允许明文 `game.json`，用 `parseGameManifest` 只读解析且禁止改写源文件，落盘统一由 `installGameFiles` 写为密文；v3.4.2 的正式 V1 数据导入中，明文 `game.json` 的校验和加密只允许在 `backup/v1/V1ImportAdapter.ts` 内执行。更换种子后旧密文不可读取，本期不支持密钥轮换。
- **安全边界**：密钥编译在桌面客户端中，Manifest 加密用于阻止直接查看和普通篡改，不能抵御能够逆向客户端的攻击者。
- **路径与 URL 约束**：`version` 必须是完整 SemVer；`platformVersion` 必须是有效 SemVer 范围或合法闭区间；`entry`、游戏媒体及成就图标只能是游戏目录内的安全相对路径；`author_url`、`web_url` 只允许 HTTP(S)。`entry=serve` 必须存在根目录 `index.html`。
- **字段关系约束**：`multiplayer` / `singlemultiple` 必须声明合法且有序的玩家人数范围；`networkgame` 必须使用 `entry=url`；`env` 禁止声明平台保留的 `BZ_` 前缀。市场 V1/V2 `gameManifest` 生成结果必须再次通过对应完整 Schema。
- **统计与成就国际化**：V1 保留原单语言显示字段；V2 基础定义只保存稳定 ID、模式和图标，显示文本全部来自当前语言包。
- **时间追踪**：平台自动追踪并记录所有游戏的游玩时长（`time`）；游戏不得通过 `stats.report` 上报或覆盖该平台保留统计项。
- **详情媒体扩展**：`video` 字段为可选项，指向游戏目录内预览视频（`mp4/webm/ogv/mov/m4v`），仅用于详情页展示。
- **本地存储加密开关**：`encryptLocalStorage` 为可选布尔字段，仅作用于 Web 游戏 `localStorage` 对应的 `gamedata.json` 持久化。
- **游戏类型**：`type` 支持 `singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`，通过 `src/shared/types/game.types.ts` 的 `GameType` 枚举维护；调整类型时同步 Schema、业务判断和 UI 文案。`singlemultiple` 代表同时支持单人与联机，`networkgame` 代表远程网页游戏。
- **网页游戏版本规则**：`networkgame` 类型游戏导入/安装时以 `id` 判断是否已存在，但仍必须声明合法 SemVer；同一 `id` 的网页游戏通过删除旧版本后重新导入完成更新。
- **语言注入**：Native 游戏获得 `BZ_LOCALE`；本地 `serve/html` 游戏获得 `window.BZ_CONFIG.locale`。`entry=url` 远程网页保持隔离，不注入本地配置。
- **远程网页启动**：`entry=url` 时 Manifest 必须提供合法 `web_url`，平台直接打开该网页地址。
- **作者主页链接**：`author_url` 为可选合法 URL，在游戏详情页和市场详情展开卡片展示跳转图标；市场游戏的 `author_url` 可在 `gameManifest` 中覆盖，默认继承 Market Game 层级配置。

### 4.2 游戏市场索引 JSON 规范

- **托管方式**：游戏市场索引文件由独立 GitHub 仓库维护并同步到 OSS，固定文件名为 `market.json`。官方文件优先读取构建期 `marketOssIndexUrl` 指定的 OSS 镜像；OSS 单次请求包含响应体解析，最多等待 5 秒，任何失败均整份切换到 GitHub 原始地址 `https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json`。GitHub 单次最多等待 8 秒，仅网络错误、超时、HTTP 408/429/5xx 在等待 1 秒后重试一次；确定性 4xx、JSON 或 Schema 错误不重试。
- **两级市场架构**：顶层 `market.json` 作为**市场目录**，`sources` 数组列出所有可用市场源；每个市场源的仓库中有自己的
  `market.json`。顶层 `market.json` 同时保留 `games` 字段，官方索引通过自身 `marketId` 与 `sources` 中的同 ID 项关联。外部市场源从其仓库 raw 地址直接加载。
- **拉取时机**：用户首次进入"游戏市场"列表页面时通过 `getSources` 拉取官方文件，进入具体市场时通过 `getIndex` 获取索引。官方一级目录与官方二级索引从同一响应原子解析并共用 1 小时内存缓存；相同的进行中请求会被合并。第三方索引按 `marketId + repository + branch` 缓存，直接请求 GitHub Raw 并使用相同的 GitHub 超时与重试策略。
- **镜像同步**：市场仓库通过 GitHub Actions 等自动化流程同步 OSS 镜像；平台按 OSS 优先、GitHub 兜底顺序读取官方目录和官方索引。外部市场源仍从各自仓库的 raw 地址直接加载，不使用官方 OSS 镜像。
- **协议边界**：市场只接受严格数值 `schemaVersion: 2`，不存在 Schema 1.x 解析或字段别名。可达但版本错误或结构无效的外部市场直接隐藏；网络失败保留来源供用户重试。
- **展示目标**：索引文件必须同时满足“列表展示”“下载校验”“安装校验”三类需求。游戏名、简介、标签、版本描述和更新说明通过 `defaultLocale + localizations` 提供完整语言包。
- **安装原则**：市场下载安装本质上仍走统一导入流程；平台下载并解压版本包后，必须继续校验包内 `game.json` 与市场索引中的
  `id`、`version`、`platformVersion` 是否一致。

#### 顶层结构

```json
{
  "schemaVersion": 2,
  "marketId": "official",
  "marketName": "BZ Games Market",
  "generatedAt": "2026-05-22T04:21:02.000Z",
  "updatedAt": "2026-06-16T10:32:44.000Z",
  "repository": "https://github.com/baozha2023/bz-games-market.git",
  "author": "baozha2023",
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

| 字段            | 类型             | 必填 | 说明                                                                         |
| --------------- | ---------------- | ---- | ---------------------------------------------------------------------------- |
| `schemaVersion` | `number`         | 是   | 固定为数值 `2`；其他值拒绝。                                                 |
| `marketId`      | `string`         | 是   | 当前市场的唯一标识，必须与 `sources` 中恰好一个同 ID 项关联。                |
| `marketName`    | `string`         | 是   | 当前市场的显示名称。                                                         |
| `generatedAt`   | `string`         | 是   | 索引生成时间，ISO 8601 格式。首次创建时填写。                                |
| `updatedAt`     | `string`         | 是   | 索引最后更新时间，ISO 8601 格式。每次更新需刷新。                            |
| `repository`    | `string`         | 否   | 该市场的 GitHub 仓库地址。                                                   |
| `author`        | `string`         | 否   | 该市场的维护作者。                                                           |
| `sources`       | `MarketSource[]` | 是   | 市场源列表，至少 1 项。平台一级界面展示所有 `visibility !== "hidden"` 的源。 |
| `games`         | `MarketGame[]`   | 是   | `marketId` 所标识官方市场中的游戏列表。                                      |

#### 市场源对象 `MarketSource`

| 字段          | 类型      | 必填 | 说明                                                                                  |
| ------------- | --------- | ---- | ------------------------------------------------------------------------------------- |
| `marketId`    | `string`  | 是   | 市场唯一标识。                                                                        |
| `marketName`  | `string`  | 是   | 市场显示名称。                                                                        |
| `coverUrl`    | `string`  | 否   | 市场封面图，用于一级界面卡片。                                                        |
| `generatedAt` | `string`  | 是   | 该市场索引的生成时间。                                                                |
| `repository`  | `string`  | 是   | 规范 HTTPS GitHub 仓库地址，只允许仓库根路径，不允许凭据、端口、查询参数或 fragment。 |
| `branch`      | `string`  | 是   | 合法 Git 分支名，允许 `/` 分层，拒绝路径穿越与 Git 非法 ref 字符。                    |
| `featured`    | `boolean` | 否   | 是否重点推荐。                                                                        |
| `visibility`  | `string`  | 否   | `public` / `hidden`。                                                                 |

#### 游戏对象 `MarketGame`

| 字段            | 类型                  | 必填 | 说明                                                                                                     |
| --------------- | --------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `id`            | `string`              | 是   | 游戏唯一 ID，必须与安装包内 `game.json.id` 一致，推荐使用反向域名格式。                                  |
| `defaultLocale` | `SupportedLocale`     | 是   | 默认语言，必须存在于 `localizations`。                                                                   |
| `localizations` | `object`              | 是   | 每种语言完整提供 `name`、`summary` 和国际化 `tags`。                                                     |
| `author`        | `string`              | 是   | 游戏作者或工作室名称。                                                                                   |
| `author_url`    | `string`              | 否   | 作者主页链接，详情页展开后作者名称旁将显示跳转图标。                                                     |
| `type`          | `string`              | 是   | 游戏类型，取值与 `game.json.type` 一致：`singleplayer`、`multiplayer`、`singlemultiple`、`networkgame`。 |
| `iconUrl`       | `string`              | 否   | 游戏图标远程地址，建议 HTTPS。                                                                           |
| `coverUrl`      | `string`              | 否   | 游戏封面远程地址，建议 16:9。                                                                            |
| `screenshots`   | `string[]`            | 否   | 详情页截图列表。                                                                                         |
| `featured`      | `boolean`             | 否   | 是否在市场首页重点推荐。                                                                                 |
| `visibility`    | `string`              | 否   | 可见性，推荐取值：`public`、`hidden`、`deprecated`。默认 `public`。                                      |
| `minPlayers`    | `number`              | 否   | 多人游戏最小人数；仅多人相关类型建议填写。                                                               |
| `maxPlayers`    | `number`              | 否   | 多人游戏最大人数；仅多人相关类型建议填写。                                                               |
| `latestVersion` | `string`              | 是   | 当前推荐展示/安装的最新稳定版本号。                                                                      |
| `versions`      | `MarketGameVersion[]` | 是   | 该游戏可安装的版本列表，至少 1 项。                                                                      |

#### 版本对象 `MarketGameVersion`

| 字段              | 类型      | 必填 | 说明                                                                                                                                                                                                          |
| ----------------- | --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`         | `string`  | 是   | 版本号，语义化版本格式，必须与安装包内 `game.json.version` 一致。                                                                                                                                             |
| `localizations`   | `object`  | 是   | 语言集合必须与所属游戏一致，每种语言提供 `description` 和可选 `releaseNotes`。                                                                                                                                |
| `platformVersion` | `string`  | 是   | 当前版本对平台版本的兼容范围，使用 `semver` 语法，如 `>=1.9.5`。                                                                                                                                              |
| `downloadUrl`     | `string`  | 是   | 版本安装包下载地址，建议 HTTPS。                                                                                                                                                                              |
| `sha256`          | `string`  | 否   | 安装包 SHA-256 摘要，用于完整性校验。全可选（任何 downloadUrl 均可省略），若提供则格式必须为 64 位 hex。                                                                                                      |
| `size`            | `number`  | 否\* | 安装包字节大小，用于展示下载体积和二次校验。`downloadUrl` 为 GitHub Releases 直链时可省略，平台下载时自动获取。非 GitHub 直链时**必填**。                                                                     |
| `publishedAt`     | `string`  | 否   | 版本发布时间，ISO 8601 格式。                                                                                                                                                                                 |
| `isPrerelease`    | `boolean` | 否   | 是否为预发布版本；预发布版本默认不作为 `latestVersion`。                                                                                                                                                      |
| `gameManifest`    | `object`  | 否   | Manifest 生成配置；市场客户端支持 V1/V2 包，管理端托管接口只接受严格 V2 override。override 可继承市场公共字段，但成就、统计和语言集合必须形成可生成完整 V2 Manifest 的闭合数据。声明后不会合并包内 Manifest。 |

#### GameManifestOverride 覆盖机制

市场版本声明 `gameManifest` 后，解压暂存目录中原有 `game.json` 必须先删除，再以市场元数据和该配置从零生成新文件，禁止字段覆盖合并。未声明时才读取包内原有 V1/V2 Manifest。

```typescript
// src/shared/types/market.types.ts — GameManifestOverrideSchema
// 公共运行字段按覆盖粒度可选；最终生成结果必须通过 GameManifestV1Schema 或 GameManifestV2Schema
```

- **V1/V2 生成**：桌面市场把 V1 与 V2 作为并列、长期支持的 Manifest 能力，并按精确 `manifestVersion: 2` 分派；托管管理端只生成 V2 override。V2 override 可省略各语言 `name/description` 并由市场游戏本地化字段补齐，但已声明的成就和统计必须在市场游戏的每种语言中完整覆盖。
- **公共字段优先级**：`gameManifest` 明确字段 > MarketGame/MarketVersion 对应字段 > 默认值
  - `author` → `gm.author || game.author`
  - `author_url` → `gm.author_url !== undefined ? gm.author_url : game.author_url`
  - `type` → `gm.type || game.type`
  - `platformVersion` → `gm.platformVersion || targetVersion.platformVersion`
  - `entry` → `gm.entry`（若为空则自动探测 `detectEntryFile(importDir)`）
  - `multiplayer` → `gm.multiplayer`（类型为多人且未配置时从 `game.minPlayers`/`game.maxPlayers` 生成）
- **安装流程**：`prepareManifestForInstall()` 实施“包内原文件读取”或“声明后删除并重建”二选一；生成后统一校验并写成加密 Manifest，再进入标准导入流程。

#### 安装包约束

- **格式识别**：平台根据 `downloadUrl` 的文件后缀自动识别压缩包格式；支持 `.zip` 和 `.7z`，统一使用 `7zip-bin` 内置 `7za` 通过 `child_process.spawn` 解压。
- **解压方式**：`.zip` 和 `.7z` 均使用 `7zip-bin` 内置的 `7za` 二进制通过 `spawn` 调用。
- **目录约束**：未声明 `gameManifest` 时，压缩包根目录或第一层单子目录必须存在合法 V1/V2 `game.json`；声明时允许平台从市场配置生成。两种路径最终都使用相同校验和加密写入。
- **一致性校验**：平台安装前校验下载包的 `size`、`game.json.id`、`game.json.version`。`sha256` 在校验值存在时执行比对；未提供 sha256 时跳过哈希校验。`size` 为 GitHub Release 直链时可由平台下载阶段自动补齐。`game.json.platformVersion` 使用 `semver` 做语义化兼容性检查（支持 string 和 tuple 两种 manifest 格式）。
- **安全约束**：解压前必须显式列出并校验全部归档条目，拒绝绝对路径、盘符路径、空路径、`../` 路径穿越、ADS、符号链接、目录联接和其他重解析点；解压后再次以 `lstat` 校验暂存树。不得把 7za 的默认行为当作安全边界。本阶段点击下载时只按安装包声明大小检查下载缓存所在磁盘的剩余空间，不预估解压后的安装体积。
- **覆盖策略**：本地已存在相同 `id + version` 时视为"已安装"。**网页游戏（`networkgame`）仅以 `id` 判断**，同一 `id` 的更新通过删除旧版本后重新导入完成。
- **托管地址**：`games.bzgames.top/<gameId>/<version>/<role>/<encodedFileName>` 是不依赖 DNS 的市场逻辑地址，`role` 仅允许 `package/icon/cover`。客户端严格校验规范编码后，将安装包与市场图片统一改写到构建配置 `relayServerUrl` 下的 `/api/v1/game-hosting/assets/*`，并由主进程附加 Relay Token；普通 HTTP(S) 地址保持原行为，不兼容旧 UUID 托管地址。
- **落盘路径**：市场安装目标目录必须通过 `StoreService.getDefaultGameStoragePath()` 获取当前默认游戏库；全新 v4 数据库初始化时固定创建 `builtin` 游戏库记录，其实际路径由数据根目录下的 `games/` 推导，配置文件不参与游戏库初始化。

#### 市场任务状态与错误码类型

```typescript
// src/shared/types/market.types.ts

type MarketTaskStatus =
  | "idle"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "completed"
  | "error"
  | "canceled"
  | "paused"
  | "interrupted";

type MarketErrorCode =
  | "network"
  | "download"
  | "verify"
  | "extract"
  | "install"
  | "manifest";

interface MarketTaskState {
  taskId: string; // 格式: `${gameId}@${version}`
  gameId: string;
  version: string;
  status: MarketTaskStatus;
  progress: number; // 0-100
  bytesReceived?: number;
  totalBytes?: number;
  message?: string;
  error?: string;
  errorCode?: MarketErrorCode; // 失败时自动归类
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

---

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
- **生产环境 DevTools 锁定**：通过 `app.on("browser-window-created")` 拦截所有窗口的 F12 / Ctrl+Shift+I 快捷键，并监听 `devtools-opened` 事件自动关闭 DevTools；同时启用 F11 全屏切换。开发模式（`!app.isPackaged`）保留 DevTools 功能。
- 读写本地存储（electron-store），**配置与数据均存储于应用根目录**
- 调用系统 API（文件对话框、环境变量、子进程）
- 游戏进程启动 / 管理 / 终止（`child_process.spawn`，支持 Windows 隐藏窗口）以及统一运行时状态维护
- 拉取远程游戏市场索引、下载市场安装包并执行校验与安装。所有私有资源请求均携带构建期注入的 Referer 防盗链
  header（fetch 显式设置 + `session.webRequest.onBeforeSendHeaders` 全量拦截）
- 运行 Room Server（Host 时）/ Room Client（Client 时）
- 运行 Room Discovery UDP 服务，提供局域网房间响应；按需连接官方 Relay Server 注册房间短地址
- 运行 Game API Server（每次有游戏运行时）
- 注册并处理所有 IPC Handler
- 广播游戏进程生命周期事件（start/end）
- 通过 `PlaySessionDatabaseService` 自动记录每次游戏启动→关闭为一次"游玩会话"（写入 SQLite `bz_games.db`）
- 通过 `StoreService` 与统一数据库仓储记录成就解锁和统计事件（写入加密 SQLite `bz_games.db`）
- 系统托盘动态菜单：游戏退出时自动刷新「最近游玩」列表，支持从托盘快速启动最近玩过的游戏
- 本地备份由 `backup/` 统一处理；更新由 Velopack `UpdateService` 处理。v4.0.0 未发布前不保留实验协议、旧字段、别名或运行时兼容分支；v3.4.2 V1 数据导入是物理隔离的正式转换能力，不进入运行时路径。

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

数据根目录固定保存 `config.json`、`games/` 和 `db/bz_games.db`，程序运行区只存在于 `.runtime/`：

- **配置加密存储**：`ConfigCodec` 只接受严格的 `{ format:"bz-games-config", formatVersion:4, algorithm:"aes-256-gcm", iv, tag, payload }` 信封；`iv` 必须是 12 字节规范 Base64，认证标签必须是 16 字节规范 Base64，载荷和整个配置文件有大小上限。解密后的 `settings`、`userData` 使用严格白名单，未知字段、错误类型和错误版本直接拒绝。
- **运行时只接受最终结构**：配置不存在才创建默认值；运行时不得清理、重命名或补齐任何旧字段。`feedbackHistory`、NSIS 迁移字段、旧更新忽略字段和旧游戏库路径只由正式 V1 导入转换器读取并一次性转换或丢弃。

```typescript
// src/shared/types/store.types.ts
interface UserData {
  bzCoins: number;
  checkIn: {
    lastCheckInDate: string;
    consecutiveDays: number;
    totalDays: number;
  };
  ownedFrames: string[];
  equippedFrame?: string;
}

interface AppStore {
  settings: AppSettings;
  userData: UserData;
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
  | "none"
  | "glow"
  | "flame"
  | "neon"
  | "aurora"
  | "crystal"
  | "comet"
  | "heartbeat"
  | "hologram"
  | "inkflow"
  | "eclipse";

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
  accountSessionToken: string;
  accountSessionExpiresAt: string;
  accountUserLogin: string;
  accountUserName: string;
  accountUserProfileUrl: string;
  nicknameStyle: NicknameStyle;
  libraryLayout: "card" | "icon" | "steam";
  lastJoinRoomAddress: string;
  language: "zh-CN" | "en-US" | "ja-JP" | "zh-TW" | "de-DE";
  theme: "dark" | "light" | "auto";
  defaultRoomPort: number;
  closeBehavior: "tray" | "exit";
  autoLaunch: boolean;
  updatePromptSuppressedForAppVersion?: string;
  githubToken: string;
  chatWindowBounds?: { x: number; y: number; width: number; height: number };
  chatInputHeight: number;
  downloadFloatBall: boolean;
  sensitiveWordFilter: boolean;
  floatBallPosition?: { x: number; y: number };
}
```

### 5.4 Web 游戏运行与存储隔离

- **Web 游戏隔离**：Web 游戏启动时使用 `persist:game_<id>_<version>` 分区，实现版本间的数据隔离（Cookie/LocalStorage）。
- **Web 游戏存储接管**：通过 Preload 脚本接管 `localStorage`，将数据重定向存储至 `games/<id>/<version>/gamedata.json`
  ，实现跨启动模式（File/Serve）的数据互通与版本隔离。采用内存缓存 + 500ms 防抖批量落盘策略，避免 IPC 同步写盘导致游戏卡顿。
- **Web 存储键兼容**：内存存储使用无原型对象并通过自有属性操作读写，保证 `__proto__`、`constructor`、`hasOwnProperty` 等合法 localStorage 键不会触发原型修改或覆盖对象方法；主进程解析持久化内容时拒绝数组。
- **Web 存储 IPC 鉴权**：`GameWindowIdentityRegistry` 在窗口创建时绑定可信 `webContents.id → gameId/version`；所有 `game:storage:*` IPC 必须同时通过 Game ID、SemVer 和发送方身份校验。Preload 优先且仅使用 `additionalArguments` 中的平台注入身份，页面查询参数不能覆盖身份。单个 `gamedata.json` 读写上限为 5 MB。
- **Web 存储上下文模式**：游戏窗口使用 `contextIsolation: false` 以确保 preload 脚本在游戏 JS 执行前覆盖
  `window.localStorage`。配合 `nodeIntegration: false` 维持基本安全隔离。窗口关闭时通过 `beforeunload` 回调 +
  `ipcRenderer.sendSync` 确保数据完整落盘，避免异步 send 丢数据。
- **Web 游戏独立渲染进程**：每个游戏窗口使用独立 `partition: persist:game_<id>_<version>`，通过 Chromium
  站点隔离机制自动分配到独立的渲染进程，确保不同游戏进程不互相干扰。
- **Web 窗口启动状态**：`windowedFullscreen` 仅适用于 `serve`、`url`、`.html` 和 `.htm` 入口；未配置或为
  `false` 时创建 `1280×720` 的普通窗口，为 `true` 时仍先以 `1280×720` 创建隐藏窗口，再在显示前调用
  `BrowserWindow.maximize()`。窗口保留标题栏、边框和可调整大小能力，用户还原后恢复 `1280×720`，不使用无边框或
  `setFullScreen()`。
- **Web 存储可选加密**：支持通过 Manifest 字段 `encryptLocalStorage` 控制 `gamedata.json` 是否加密存储（默认关闭）。
- **Web 联机模式标记**：平台生成的 `bz-config.js` 提供 `isMultiple` 字段，便于 `singlemultiple` 游戏在运行时区分单人模式与联机模式。
- **远程网页模式约束**：当 `entry=url` 时，平台不生成 `bz-config.js`，也不启动 Game API Server 或注入 `window.BZ_CONFIG`。
- **Serve 根入口与同源保护**：`entry=serve` 的本地 HTTP 服务仅绑定 `127.0.0.1`，必须等待监听成功并将 `/` 解析为根目录 `index.html`；启动 URL 使用 `/?gameId=...&version=...`，否则坦克大战等联机 Web 游戏会显示主进程的 `Not Found` 页面。Game API 与静态服务器均通过 `listen(0, "127.0.0.1")` 让操作系统在绑定时原子分配端口，禁止恢复“先探测空闲端口、再监听”的竞态流程。静态服务必须拒绝 `Sec-Fetch-Site: cross-site` 或不匹配本地服务 Origin 的请求，避免其他网页读取含 Game API Token 的 `bz-config.js`。
- **平台保留文件**：游戏根目录中的 `game.json` 与 `bz-config.js` 为平台保留文件名，接入游戏不得复用为游戏自身内容。`activeConfigPaths` 只追踪 HTML/Serve 启动实际生成的配置，Native 与 URL 入口不得写入或清理该文件。

### 5.5 代码组织与内聚性

- **模块化**：复杂逻辑（如异步游戏导入任务）拆分为独立函数（`validateManifestFile`, `checkPlatformVersion`,
  `checkEntryFile` 等），提升可读性与可维护性。
- **环境配置抽离**：`game-launch.ts` 统一四入口分类及 Web/Native 配置映射；`GameEnvironment` 只负责读取 Electron/房间上下文和临时文件 I/O。Native 环境过滤 `ELECTRON_`/`NODE_`/`NPM_`/`VSCODE_`，Manifest `args` 原样传递，平台 `BZ_` 变量最后注入且不可覆盖。
- **统一游戏运行时**：`GameManager.activeRuntimes` 是运行状态的唯一内存记录。Native 游戏记录入口 PID 和已发现的子进程 PID，由 `ProcessTreeService` 通过 Windows PowerShell `Get-CimInstance Win32_Process` 或 macOS/Linux `ps` 查询进程树；入口进程退出但已记录子进程仍存活时，游戏继续视为运行中，进程树为空后才结束。Web 游戏记录 `BrowserWindow` 和 `webContents.getOSProcessId()`，窗口关闭或 `render-process-gone` 后结束。进程树查询连续失败时降级为入口进程跟踪并记录日志。
- **运行状态快照**：`game:getRunningIds` 由主进程返回当前 `activeRuntimes` 中仍运行的游戏 ID；渲染层 `useGameStore` 初始化时读取一次快照，之后通过 `game:process:started` / `game:process:ended` 增量维护。快照提交必须受事件版本保护，不能覆盖请求期间已收到的生命周期事件。
- **启动成功语义**：HTML/URL 必须等待 `loadFile`/`loadURL` 成功，Serve 必须等待回环端口监听成功，Native 必须收到子进程 `spawn` 事件，`launch()` 才返回成功。请求 ID/版本必须与解密 Manifest 一致，且每次启动重新校验 `platformVersion`。`multiplayer` 入口要求本地玩家位于同一游戏、同一版本的房间，但不得依赖 `waiting`/`starting`/`playing` 的瞬时同步状态；能否开局由房间 IPC 单独校验。
- **房间上下文粒度**：`RoomContext.findMatchingRoom()` 是环境注入和 Multiplayer 启动门禁的唯一房间匹配入口，只接受游戏 ID 与 Manifest 版本均一致的房间。不得因为客户端当前加入了其他游戏的房间而错误注入 `BZ_ROOM_ID`、`BZ_IS_HOST` 或 `BZ_IS_MULTIPLE`。
- **IPC 结果契约**：启动、房间创建/加入和重连的返回结果在 `shared/types` 中统一定义，Preload 与 Renderer 声明必须同步复用；`game.launch`、`room.start`、`room.reconnect` 均返回 `boolean`，房间创建/加入返回结构化 `success/error/params`，不得把失败的 IPC 调用误显示为成功。
- **生命周期幂等**：`launchingGames` 阻止同一游戏并发启动；窗口/进程退出只处理仍与活动实例匹配的回调，`finishingGames` 防止 error/exit/closed 重复结算。主动停止、自然退出和启动失败统一清理窗口、进程、静态服务、Game API 与临时配置。
- **Manifest 能力约束**：主进程仅允许解锁 Manifest 已声明成就；`stats.report` 仅接受已声明的有限数值且拒绝平台管理的 `time`；创建、加入和开始房间均通过 `GameLoader.getManifest()` 透明解密本地清单，并校验清单 ID/版本、游戏类型、平台版本、`minPlayers`、`maxPlayers` 与全员准备状态。
- **GameManager 生命周期**：`cleanupApiOnly()` 方法仅清理 WebSocket/HTTP 服务器资源，不终止游戏进程也不关闭窗口。当 API
  Server 超时自动停止时调用，避免误杀正在运行的游戏。
- **Logger 类设计**：
  - 模块级 `Logger` 类单例（`export const logger = new Logger()`）。`installGlobalHandlers()` 在 `index.ts` 入口处调用。
  - **Console 代理**：`installConsoleProxy()` 将全局 `console.log`/`console.warn`/`console.error` 替换为 Logger 方法，统一所有日志路由。
  - **双模式输出**：开发模式（`!app.isPackaged`）全部级别输出到控制台（调用保留下来的 `nativeConsole` 原始引用，避免无限递归）；生产模式 `info`/`warn` 静默丢弃，仅 `error` 写入 exe 同级 `bz-games-error.log` 文件。
  - **错误日志轮转**：`rotateErrorLogsIfNeeded()` 在每次写入前检查文件大小，超过 `maxErrorLogBytes`（5MB）时执行轮转（保留 3 份历史备份 `bz-games-error.log.1`/`.2`/`.3`）。单条消息超过 5MB 时先轮转再写入（不拒绝超大消息）。
  - **全局异常捕获**：注册 `process.on("uncaughtException")`、`process.on("unhandledRejection")`、`app.on("render-process-gone")`、`app.on("child-process-gone")` 四个全局处理器，异常信息通过 Logger 统一写入错误日志。
  - **结构化渲染进程错误**：`captureRendererError(payload)` 接收来自 preload 脚本的 `RendererLogPayload` 结构化对象（含 `context.source`/`url`/`userAgent`/`timestamp`/`gameId`/`version` + `args` 数组），通过 `normalizeRendererLogPayload()` 校验并补全默认值，格式化输出 `[Renderer:<source>]` 前缀日志。对非结构化旧格式数据也有降级处理。
- **Renderer 错误捕获管线**：
  - **共享序列化模块**：`src/shared/log-serialization.ts` 提供 `serializeLogArg()` / `serializeLogArgs()` / `formatLogValue()` / `normalizeRendererLogPayload()` 统一序列化工具。序列化有界保护：最大深度 6 层、数组最多 100 项、对象最多 100 键、字符串最长 20000 字符，超出截断并标记 `[truncated ...]`。定义 `LogSource` 联合类型（`main-window` / `game-window` / `chat-window` / `float-ball` / `notification-window`）和 `RendererLogPayload` / `RendererLogContext` 接口。
  - **Preload 世界**：`installPreloadWorldForwarding()` 代理 `console.error`，调用 `buildContext()` 构建窗口身份上下文（source 通过 URL hash 自动识别窗口类型，game-window 额外附带 gameId/version），通过 `buildPayload()` 生成结构化 `RendererLogPayload` 后经 IPC `system:log:error` 发送至主进程。
  - **Main World 桥接**（contextIsolated 模式）：注入精简版 `MAIN_WORLD_BRIDGE_SOURCE` 脚本，仅负责将原始 args 通过 CustomEvent 抛出，序列化统一在 preload 侧完成，消除双世界之间的序列化代码重复。
  - `window.addEventListener("error", ...)` 和 `window.addEventListener("unhandledrejection", ...)` 捕获未被 try-catch 覆盖的运行时异常。
  - 主进程 `log.ipc.ts` 注册 `ipcMain.on(SYSTEM_LOG_ERROR)` 监听器，接收 `RendererLogPayload` 并调用 `logger.captureRendererError()` 记录。
- **游戏库布局状态**：`settings.libraryLayout` 持久化游戏库布局，取值为 `card`、`icon`、`steam`。`LibraryView` 挂载时必须先读取设置再渲染游戏库，避免启动时默认布局闪烁；Steam 布局右侧详情页使用嵌入式 `GameDetailView`，通过 `/library?steamGameId=<id>` 恢复来源游戏详情。
- **游玩会话记录**：每次游戏启动（`spawnGameProcess` / `createGameWindow`）调用 `playSessionDatabaseService.startSession()` 在
  `bz_games.db` 创建一条记录（含 `game_id`、`game_name`、`version`、`start_time`）；游戏退出时（
  `handleProcessExit` → `recordPlaytime`）调用 `playSessionDatabaseService.endSession(sessionId, startTime)` 直接传入启动时间戳计算 duration_ms，避免额外的 DB 查询。
  `storeService.updatePlaytime()` 从会话表推导累计时间并结算奖励，SQLite 会话是游玩历史和时长统计的唯一数据源。
  `handleProcessExit` 中通过动态 `import("../window")` 调用 `updateTrayMenu()` 刷新托盘快捷菜单。
- **SQLite 异步架构**：
  - **AsyncSqliteDatabase**：通过 `worker_threads` 隔离访问。新库在同卷临时文件中以完整 `V4_SCHEMA_SQL` 单事务创建、校验后原子提交；已有库必须通过 `application_id`、`user_version=40000`、Schema 指纹、结构指纹、`integrity_check` 与 `foreign_key_check`。
  - **BzGamesDatabase**：`V4_SCHEMA_SQL` 是唯一结构真相来源，维护 `game_libraries`、相对版本路径、生命周期以及会话/成就/统计；初始化还验证 builtin 库结构与 active 状态、恰好一个 active 默认库及已安装版本不得指向已移除库。运行时代码禁止 `ALTER TABLE`、`PRAGMA table_info` 自动补列、旧字段重命名和 Schema 兼容分支。
  - **卸载重装数据语义**：删除游戏只软删除本机 `games` / `game_versions` 实体，必须保留同一 `gameId + version` 的游玩会话、成就和统计事件；重新扫描、导入或安装后，`StoreService` 必须从 `BzGamesDatabase.getGames()` 重建完整缓存，禁止用新建记录中的空派生字段覆盖数据库结果。渲染进程读取游戏记录前必须先等待磁盘扫描同步完成，确保重装后立即恢复历史数据；成就重复解锁继续保持幂等。
  - **数据库加密边界**：`databaseEncryptionSeed` 是离线生成一次后固定使用的规范 Base64，解码结果必须恰好为 32 个随机字节；运行时禁止生成、替换或修复种子，缺失或无效时开发启动和构建必须直接失败。种子由私有构建配置注入主进程，运行时经 SHA-256 派生 ChaCha20 密钥。种子编译在桌面客户端中，只用于提高本地文件直接读取门槛，不能抵御能够逆向客户端的攻击者。
  - **PlaySessionDatabaseService**：只封装会话启动、结束和统计查询。
  - SQLite WAL 模式：`journal_mode = WAL` 提升并发读写性能（在 Worker 初始化时设置）。
  - 应用退出路径必须先停止账号在线状态心跳，再等待统一数据库 `close()` 完成及 Worker 退出，最后才允许 Electron 进程退出。
- **AccountService 设计**：
  - **职责边界**：只负责 GitHub OAuth 登录、登出、账号资料昵称同步与用户主动开启的在线状态；客户端与服务端均不存在 Platform Snapshot 上传、下载、元数据、进度事件或平台数据云同步接口。
  - **本地状态**：设置页通过 `getLocalStatus()` 同步读取已保存账号状态，不为验证登录而轮询网络。OAuth 成功后保存 `accountSession*` / `accountUser*` 字段并发送 `system:account:authChanged`。
  - **在线状态**：每次应用启动都重置为离线，只有用户主动开启后才发送在线状态并启动单实例串行心跳；关闭、登出或应用退出必须停止心跳并尽力发送离线状态。
  - **被动会话失效**：仅业务接口返回 `session_expired` / `session_invalid` 时清空本地账号会话并通知渲染进程。普通 `unauthorized`、网络错误、超时、限流和服务端错误不得清理本地令牌。
  - **设置写入隔离**：渲染进程提交普通设置时，`system.ipc.ts` 必须按明确白名单提取字段；`playerId`、账号会话/账号身份和窗口位置由主进程或专用 IPC 独占写入，防止陈旧表单覆盖后台状态。
  - **未来边界**：若未来增加游戏存档云端存储，必须独立设计对象、引用、冲突和恢复协议，不复活已删除的平台快照。经验记录见 `docs/GAME_SAVE_CLOUD_STORAGE_DESIGN_LESSONS.md`。
- **MarketService 设计**：
  - **职责分离**：`MarketCatalogClient` 负责官方 OSS→GitHub 来源切换、第三方 GitHub Raw 请求、结构化错误与索引解析；`MarketService` 只负责内存缓存、进行中请求合并及市场安装业务。目录请求不复用下载或 Release Asset 的通用重试逻辑。
  - **官方原子目录**：官方 `market.json` 每轮只下载一次，同一原始对象同时解析 `MarketDirectory` 和官方 `MarketIndex`，并在写入缓存前按 `index.marketId` 查找同 ID source；目录顺序不承载业务身份。目录或索引任一步失败时整份数据切换来源，禁止 OSS/GitHub 混用。
  - **严格边界**：目录和索引整体严格按 Schema 2 校验，不接受旧字段、别名或逐条容错；任一结构错误使整个外部市场隐藏，`hidden` 游戏不展示。
  - **有界请求**：OSS 只请求一次且超时 5 秒。GitHub 单次超时 8 秒，仅网络错误、超时、HTTP 408/429/5xx 延迟 1 秒重试一次，最长约 17 秒；官方链路含 OSS 时最长约 22 秒。所有请求继续通过 `RequestInterceptor.buildHeaders()` 注入 Referer 和可选 GitHub Token。
  - **缓存与刷新**：官方目录和官方索引共用 1 小时原子内存缓存；第三方索引以 `marketId + repository + branch` 为键缓存；相同远程请求共享 Promise。`forceRefresh=true` 绕过缓存并清除图片缓存，第三方刷新会先刷新官方目录。刷新失败明确报错但不覆盖此前有效缓存；应用重启后缓存自动失效，不落盘。
  - `getCachedImageDataUrl(url)` 为按需图片缓存方法，通过 `fetch(url)` 下载远程图片并转 base64 Data URL，缓存于
    `cachedImages` Map（1 小时 TTL）。15 秒超时 + `AbortController` 保护，`finally` 块必定清理定时器，同时校验 response body 非空和 `content-type` 以 `image/` 开头。市场 JSON 不设置业务大小上限；安装包在任务创建前按声明 `size` 与已下载分片计算剩余所需空间，下载缓存磁盘不足时拒绝启动。
    渲染进程的 `<CachedImg>` 组件按需触发下载。
  - `CachedImg` 为通用图片缓存组件，初始显示原始 URL（浏览器直连），异步调用 `getCachedImage` IPC 拿到 Data URL 后无缝替换。
    `onUnmounted` 时 abort 飞行中的请求，防止内存泄漏。
  - `downloadAndInstall(gameId, version, marketId)` 只接受稳定 `marketId`；路由、IPC、缓存、任务快照、恢复和论坛引用均禁止使用数组下标。平台全局保证不同市场不存在重复游戏 ID，因此市场任务身份固定为 `gameId + version`；终态延迟清理器必须绑定任务实例或 generation，绝不能删除同键的新任务。
  - `gitToRawUrl()` 从 GitHub 仓库地址推导 raw 文件
    URL：`https://raw.githubusercontent.com/{owner}/{repo}/{branch}/market.json`。
  - `inferArchiveType()` 根据 `downloadUrl` 后缀自动识别压缩包格式，支持 `.zip` 和 `.7z`。`.zip` 和 `.7z` 统一使用 `7zip-bin` 内置的 `7za` 通过 `child_process.spawn` 解压。
  - **Electron asar 补丁防御**：`copyFolderRecursiveSync()` 在执行文件复制前设置 `process.noAsar = true`，复制完成后通过 `finally` 块恢复原值，用于复制含 `.asar` 的游戏包。
  - **清理失败语义**：`MarketCacheCleaner.prepare()` 是进入下载、解压或安装阶段前的强制前置条件，异步有限重试、删除及不存在验证任一步失败都必须终止任务；`MarketCacheCleaner.reclaim()` 只负责终态缓存回收，失败写入持久错误日志并保留残留，但绝不能改写已经确定的 completed/error/canceled 结果。禁止在未清空的解压目录上覆盖安装。
  - **安装目标类型防御**：`GameLoader.installGameFiles()` 发现 `gameRootDir` 已存在且不是普通目录时必须拒绝安装，不得自动删除未知文件。
  - **下载管线架构**：下载子系统采用 **不可变元数据 + 活动任务 + 单一状态机** 三层模型。
    - `TaskMeta`（不可变元数据）：包含 `downloadUrl`、`sha256`、`size`、`downloadPath`、`archiveType`、`marketId` 等固定参数。
    - `ActiveTask`：运行时对象，绑定 `state`（MarketTaskState）、`meta`（TaskMeta）、`abort`（AbortController）。
      每个活动任务绑定一个 `AbortController`。
    - `transition(taskId, status, extra?)` 是**唯一的状态转换入口**（Single Source of Truth），转换规则集中定义在 `MarketTaskStateMachine` 的显式矩阵中：归档安装只允许 `idle → downloading → verifying → extracting → installing → completed`，Manifest-only 安装只允许 `idle → installing → completed`；下载、校验、解压和安装允许同阶段进度更新；活动阶段允许进入 error/canceled，只有 downloading/verifying 可进入 paused，paused/interrupted 只允许进入 canceled，completed/error/canceled 不允许任何后续转换。恢复会从快照创建新任务实例，不在旧实例上反向转换。缺失任务、跳阶段、倒退和终态改写均拒绝应用 extra 字段并记录持久错误日志。
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
  - **sha256 全可选 + 下载时懒解析**：版本对象的 `sha256` 字段已变为全可选。下载阶段 `downloadAndInstall()` 按优先级获取 sha256/size：① 版本对象直接提供 → ② `resolvedAssets` 缓存（1小时 TTL）→ ③ GitHub Releases 直链时通过 `resolveGitHubAssetInfo()` 实时从 GitHub API 获取（`parseGitHubReleaseUrl()` 解析 owner/repo/tag/assetName，调用 `GET /repos/{owner}/{repo}/releases/tags/{tag}` 获取 asset 的 digest/size）。GitHub API 返回值中的 digest 必须同时满足 64 位长度和纯 hex 格式才被接受为 sha256，否则置 undefined。若 size 最终仍为 null，拒绝下载（`market_missing_size`）；sha256 为 undefined 时仅跳过校验不拒绝。
  - **下载校验条件化**：`verifyArchive()` 中 size 校验仅当 `meta.size > 0` 时执行，sha256 校验仅当 `meta.sha256` 存在时执行。若版本未提供 sha256 且 GitHub API 也未返回有效 sha256，则跳过哈希校验直接进入解压阶段。
  - 错误分类由 `classifyErrorCode()` 统一处理，根据错误消息自动归类为四种错误码（download/verify/extract/install）。
  - `tasks` Map 维护任务全生命周期，`finalize()` 在清理临时文件后延迟 30 秒删除 Map 条目，确保 UI 能读到终态。
  - **下载悬浮球进度推送**：`emitFloatBallProgress(force)` 方法在每次 `emit()` 状态变更时自动调用，将加权合并进度通过 `market:floatBall:event` 推送给悬浮球窗口。主窗口任务事件与悬浮球事件均按 100 ms 合并高频进度并保留尾值，`force` 参数用于关键事件（恢复、取消、暂停、终态清理）立即推送。`computeTotalProgress()` 使用任务文件大小加权平均算法计算整体进度百分比，同时统计活跃/已完成/总任务数。有活跃任务时自动显示悬浮球（`showInactive()`），全部完成后立即隐藏（`hide()`）。`getAllTaskStates()` 返回所有当前任务状态快照，供悬浮球窗口挂载时初始同步。
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
  - 提取至 `src/main/utils/requestInterceptor.ts`，作为独立单例导出（`export const requestInterceptor`），替代原先散落在 `MarketService.ts` 和 `index.ts` 中的 header 拼接代码。
  - 构造函数注入 `getTokenFn` 回调（惰性读取 `settings.githubToken`），避免静态导入 `StoreService` 造成循环依赖。
  - `buildHeaders(url, extra)` 方法为 fetch 请求构建 headers：CDN/OSS 域名自动加 `Referer`、GitHub API/Raw 域名检测 `githubToken` 并注入 `Authorization: Bearer <token>`、中继服务器域名自动注入 `x-relay-token`。
  - `buildWebSocketUrl(url)` 方法为 WebSocket 连接 URL 自动追加 `relayToken` 查询参数，供 `RoomClient` 连接中继服务器时鉴权。
  - `registerSessionHandler(session)` 方法在 `app.whenReady` 中注册 Electron 全局拦截器，覆盖 `<img>` 标签等非 fetch 请求。
  - 提供 `normalizeHttpBase()` 和 `normalizeWebSocketBase()` 工具函数，用于 ws/wss/http/https 协议互转。
  - `AppConstants.ts` 集中定义 CDN/OSS/GitHub/Referer、官方中继及 Manifest 加密种子等构建期常量，供主进程服务共享；私有值只能进入主进程构建产物。
- **CalendarHeatmap 日历热力图组件**：
  - 纯 Vue 3 + CSS Grid 实现，不依赖第三方图表库，渲染 GitHub 贡献墙风格的 7×53+ 格子日历。
  - 颜色渐变 5 档（空 → `#39d353` → `#26a641` → `#006d32` → `#0e4429`），图例标注"少 ↔ 多"。
  - 通过 IPC `stats:getDailyPlayDurations(365)` 从 `PlaySessionDatabaseService`（内部查询 `bz_games.db`）加载近一年每日游玩时长。起始日期为当前日期向前 364 天并回退到周日，确保覆盖最近约 52 周（365 天数据点）。
  - `dayLabels`、`monthNames`、`formatDurationMs` 均通过 `useI18n()` 实现三语切换，
    使用逗号分隔字符串 `t('statistics.weekDays')` / `t('statistics.monthNames')` 存储数组数据，`t('statistics.hour/minute')` 存储时间单位。
  - 每个格子通过 `n-tooltip` 展示日期和当天游玩时长。底部显示近一年总游玩时长。
  - 统计页可用 `html2canvas` 在内存中生成包含玩家信息、总时长和热力图的 PNG 分享图，再通过 `system:savePng` 保存。插入 HTML 的玩家字段必须转义，头像仅接受 HTTPS 或有界的 raster base64 Data URL。
  - 统计页默认不自动加载热力图数据，用户点击「加载热力图」按钮后按需加载（`hasLoadedHeatmap` 状态守卫防重复请求）。加载期间通过 `await nextTick()` 先提交 DOM 更新（确保 loading 状态渲染）再发起异步 IPC；异步操作保证至少 180ms 延迟（`Promise.all` + `setTimeout`），防止数据瞬间返回导致的 loading 闪烁。
  - 日期点击弹出会话详情弹窗时：先清空 `selectedDateSessions`、设置 `isLoadingSessions = true` 并 `await nextTick()` 确保弹窗以 loading 态打开，再发起 IPC 查询。会话加载中展示居中的 `n-spin` 旋转指示器（最小高度 160px），替代骨架屏，视觉上更轻量且无布局抖动。
  - ResizeObserver 使用 `requestAnimationFrame` 节流 + 同值跳过，避免热力图容器宽度频繁变化引起的布局抖动。
- **头像框系统（Avatar Frame）**：
  - **数据定义**：`src/shared/avatar-frames.ts` 导出 `AVATAR_FRAMES` 常量数组（16 款头像框），每款定义 `id`、`name`、`description`、`imageFileName`、`contentInsetPx` 和 `unlock`。新增星河罗盘、青竹流云、熔金机芯、霜华王冠、金缮月轮、像素跃迁、纸鸢春信和龙脊余烬。`normalizeAvatarFrameId()`、`normalizeAvatarFrameFileName()` 与 `getFrameImageFileName()` 共同提供统一白名单边界。
  - **类型定义**：`AvatarFrameDef` 和 `AvatarFrameUnlockMethod` 定义在 `src/shared/types/store.types.ts`，通过 `shared/types/index.ts` 统一导出。
  - **渲染组件**：`AvatarWithFrame.vue` 使用 CSS absolute 叠加方案：底层 `n-avatar` (z=0)，上层 `<img>` overlay (z=1, `pointer-events: none`)。渲染入口必须先通过 `normalizeAvatarFrameFileName()` 校验文件名；旧客户端、联机载荷或异常值统一回落为无头像框，不生成资源请求。异步图片加载使用请求序号隔离，快速切换时旧请求不得覆盖新头像框。
    - **算法**：`FRAME_MARGIN = 60`（帧图留白像素），`contentSize = w - 2*MARGIN`，`scale = w / contentSize`，`offsetPercent = -50*(scale-1)`。通过 `naturalWidth` 获取帧图原始尺寸后计算 scale/offset，适配任意帧图。
    - **中心对称原则**：只要帧图的中心镂空区域与图片几何中心对齐，不同 margin 的帧图均可正确叠加，无需调整算法。
    - **帧图加载**：通过 IPC `system:getAvatarFrameImage` 从 `resources/avatar-frames/` 读取 PNG → base64 Data URL，组件内 `Image()` 解码获取 `naturalWidth`。
  - **主进程原子操作**（`StoreService`）：
    - `performBuyFrame(frameId)`：主进程按 `AVATAR_FRAMES` 解析并校验 BZ 币价格，不信任渲染进程传入价格；校验已拥有 / BZ 币余额 → 扣币 → 写入 `ownedFrames[]` → 自动装备 → 返回结果对象。
    - `performEquipFrame(frameId)`：仅校验 `ownedFrames[]` 含此 frame → `equippedFrame = frameId`。
    - `performUnequipFrame(frameId)`：仅当 `equippedFrame === frameId` 时 → `equippedFrame = undefined`。
    - `performSaveNicknameStyle(style, coinCost)`：校验 BZ 币余额 → 扣币 → `saveSettings({ nicknameStyle: style })`。余额不足返回 `{ success: false, code: "insufficient_coins" }`。
  - **自动解锁**：`tryUnlockPlaytimeFrames()` 和 `tryUnlockCheckInFrames()` 为 `StoreService` 私有方法，分别在 `addPlayTime()` 和 `performCheckIn()` 写盘前调用。扫描 `AVATAR_FRAMES` 数组，满足条件且不在 `ownedFrames[]` 中时自动 push 并记录日志。
  - **单一真相源**：`ownedFrames[]` 是头像框解锁状态的唯一权威数据源。所有解锁逻辑（签到/时长/BZ币购买）均在主进程中写入此数组，前端 `isUnlocked()` **仅检查 `ownedFrames.includes(frameId)`**，不做任何条件比较。
  - **个性化页面**（`PersonalizationView.vue`）：网格布局展示 16 款头像框卡片，每张卡片包含预览（`AvatarWithFrame` 96px）、名称、解锁条件文字+图标、操作按钮（装备/卸下/购买/未解锁）。购买成功后自动装备并刷新用户数据。路由 `/personalization`。
  - **应用入口展示**：`AppContent.vue` 顶栏头像使用 `AvatarWithFrame`（28px）替代原始 `n-avatar`，绑定 `userData.equippedFrame`。
  - **设置页展示**：`SettingsView.vue` 头像上传区小头像（40px）和头像预览弹窗（280px）均使用 `AvatarWithFrame`。
  - **联机传递**：`RoomJoinPayload` 和 `PlayerInRoom` 包含 `playerAvatarFrame` / `avatarFrame` 字段。房主 `RoomServer` 创建玩家对象时写入，客机 `RoomClient` 加入时携带。`PlayerCard.vue` 使用 `AvatarWithFrame` 渲染。
  - **签到累计天数**：`UserData.checkIn.totalDays` 记录累计签到总天数，在 `performCheckIn` 中自增。签到弹窗展示"累计签到 N 天"。

- **官方中继联机系统**：
  - **公网入口模型**：房间模式仅允许 `lan` 与 `relay` 两种。`RoomServer` 优先监听 `settings.defaultRoomPort`（默认 38080）；若该端口已被其他进程占用，则原子回退到系统分配端口，并由房间创建结果和局域网发现统一使用实际监听端口。无论房主当前选择局域网还是官方服务器模式，本地物理局域网 IP、虚拟局域网 IP 和用户自备 frp 地址都仍然可以直连；官方服务器模式只是在此基础上额外注册一个短地址入口。
  - **中继服务职责**：`relay-server/src/index.js` 处理 `relay:host`、`relay:join`、`relay:leave`、`relay:latency:ping`、`relay:latency:probe`、`relay:latency:pong` 等控制信令；RoomMessage、Game API v1 JSON 和 Game API v2 binary frame 均透明转发。中继服务端使用 `roomId` 管理内部房间，只发送和识别 `roomCode`。
  - **中继聊天内容安全**：中继服务器对转发的聊天消息执行内容安全过滤，作为独立于客户端过滤的第二道防线：
    - **敏感词过滤**：`sensitive-word-service.js` 从 `vocabulary/` 目录加载 7 个高置信分类词库文件（涉政、极不文明脏话、极度色情、赌博、毒品），按长度降序排序后使用 Unicode 安全算法（`Array.from()` + code-unit→char-index 映射表）对 `contentType` 为 `text` 或 `mixed` 的聊天消息执行字符级掩码替换（敏感词 → `*`）。词库不包含单字词和广告、武器、疫情、泛生活等类别。词库文件缺失时 `hasWords()` 返回 `false`，`message-router.js` 通过 `canFilterRelayChatMessage()` 门控静默丢弃无法过滤的文字消息（fail-closed 安全设计）。
    - **图片拦截**：`isBlockedRelayChatMessage()` 拦截并静默丢弃以下三类聊天消息：① `contentType === "image"` 的纯图片消息；② content 字段为 `data:image/` base64 的嵌入式图片；③ `images[]` 数组非空的带图消息。拦截在消息级执行，不等同于逐图片扫描。
    - **透传放行**：`contentType === "audio"` 的语音消息不经过滤直接转发。
    - **游戏消息不受影响**：`game:message:relay`、`game:broadcast:relay`、`game:message:ack` 等游戏中继消息不经过上述过滤管线。
  - **短地址加入**：房主注册成功后服务端返回 `roomCode`；平台按 `DEFAULT_RELAY_PUBLIC_HOST + roomCode` 拼接短地址。平台展示、复制、服务器 Tab 和手动输入统一使用短地址；客机 `RoomClient` 识别短地址后提取 `roomCode`，连接 `DEFAULT_RELAY_SERVER_URL` 并发送 `relay:join`，收到 `relay:join:ack` 后再发送标准 `room:join`。
  - **加入入口统一**：服务器 Tab、局域网卡片加入和游戏详情页手动地址加入共用 `useRoomJoin.ts`，地址标准化、短地址识别、加入调用、错误提示保持一致；列表按钮状态仅用于展示，真实连接结果由 `RoomClient` / `RoomServer` / relay-server 联合决定。
  - **密码模型**：房间密码只保存在房主本地 `RoomServer.roomPassword` 与 relay-server 内存中，房间状态与发现结果只暴露 `hasPassword`，绝不广播真实密码。
  - **密码探测与前置拦截**：`RoomPasswordProbeService` 负责加入前探测目标房间是否设置密码。物理局域网/虚拟局域网直连先向房主发送 `room:password:probe`；官方短地址先向中继发送 `relay:room:password:probe`。响应必须同时返回 `hasPassword` 与 `hostId`：前者决定是否弹出密码输入框，后者用于房主切换到其他房间前确认目标不是自己的当前房间；探测失败或缺少 `hostId` 时不得关闭当前房间。
  - **校验集中化**：官方短地址加入先由 relay-server 在 `relay:join` 阶段执行房间存在、房主在线、已开始、满员、密码必填/错误等准入校验，再转发到房主；物理局域网/虚拟局域网直连由 `RoomServer.handleJoin()` 统一执行密码、kickedPlayers、人数、房间状态、gameId、gameVersion 校验。
  - **relay bridge**：`RelayRoomService` 将中继收到的原始 text/binary 帧交给 `RoomServer.handleRelayRawMessage()`，房主返回给 relay 客机的消息追加 `__relayTo` 路由字段；binary frame 只重封 header，body 原样保留。
  - **中继延迟测量**：房主每 15 秒通过 `RelayRoomService` 发送 `relay:latency:ping` 到中继服务器，服务器立即回复 `relay:latency:pong` 计算单向 RTT（`RELAY_LATENCY_REFRESH_INTERVAL_MS` = 15s，`RELAY_LATENCY_TIMEOUT_MS` = 5s 超时）。客机同样每 15 秒发送 `relay:latency:probe` → 中继转发至房主 → 房主回复 `relay:latency:pong` → 中继转发回客机，计算总往返延迟。延迟测量同时承担保活功能（`touchRoom` 刷新 TTL），已移除冗余的 `relay:heartbeat`（25s）定时器。房间内右上角 WiFi 风格 UI 显示延迟：房主显示到中继的延迟，客机显示经中继到房主的总延迟；发现页 Server Tab 描述横幅显示到中继服务器的 HTTP 延迟（通过 `/health` 端点测量）。发现页手动刷新使用 5 秒冷却，但 Tab 切换不受冷却限制且不会重复请求。
  - **状态同步与幽灵房间防护**：`RoomServer.broadcastState()` 触发 `RelayRoomService.syncRoomState()`；中继服务端根据房主发送的无目标 `room:state:sync` 更新 `/rooms` 中的状态、人数、游戏名、版本、`hasPassword` 等元信息；带 `__relayTo` 的 `room:state:sync` 继续按目标转发给对应玩家。房主断开、房主解散、房间 60s 无活动（`ROOM_TTL_MS`）时通过 `closeRoom()` 清理房间和连接。WebSocket 层 30s ping/pong 检测死连接。
  - **密码同步**：房主更新密码时，`room.ipc.ts` 先更新本地 `RoomServer`，再调用 `RelayRoomService.syncRoomPassword()` 将密码同步给 relay-server，保证短地址准入规则与房主本地保持一致。
  - **容量保护**：官方中继通过 `MAX_ROOMS`、`MAX_CLIENTS`、`MAX_CLIENTS_PER_ROOM`、`MAX_EVENT_LOOP_DELAY_MS` 控制新房间与新玩家接入。
  - **切换安全**：房主切换 `lan` / `relay` 模式前必须先通知当前其他玩家离开并清理连接；官方服务器注册失败时 UI 回退到 `lan` 状态。
  - **WebSocket 关闭错误映射**：`RelayRoomService`、`RoomClient`、`RoomPasswordProbeService` 均实现了 `mapRelayCloseError(code, reason)` 私有方法，将 WebSocket 关闭帧中的 `1008` + `"unauthorized"` reason 映射为 `"unauthorized"` 错误码供上层展示。三处均使用 `settled` 守卫模式防止 Promise 多重 resolve（timeout / error / close 竞态）。

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
  - **类型定义**：`NicknameStyle` 接口定义在 `src/shared/types/store.types.ts`，包含 `color`、`gradientStart`、`gradientEnd`、`font`（`system`/`rounded`/`serif`/`mono`/`fantasy`）、`effect`（`none`/`glow`/`flame`/`neon`/`aurora`/`crystal`/`comet`/`heartbeat`/`hologram`/`inkflow`/`eclipse`）、`weight`（`normal`/`semibold`/`bold`）。`NICKNAME_EFFECTS` 是唯一有效值来源，读取设置时无效或已移除的特效统一归一为 `none`。默认样式 `DEFAULT_NICKNAME_STYLE` 的 `color` 为 `"#000000"`。
  - **渲染组件**：`NicknameText.vue` 使用 CSS 自定义属性驱动样式。彗星使用单一粒子骨架；极光、冰晶、心跳、全息和日蚀使用背景层；墨韵使用双层径向/线性渐变。全息错位、墨韵流转、日蚀光环分别提供数字故障、东方水墨和环形掠光三种差异化视觉，并通过 `prefers-reduced-motion` 尊重系统减少动态效果设置。
  - **主题色自适应**：`nicknameColor.ts` 使用 WCAG 相对亮度公式计算颜色亮度。亮色主题下禁止偏白色（luminance > 0.72），暗色主题下禁止偏黑色（luminance < 0.28），不满足时自动取对称色。`adaptNicknameStyleForTheme()` 接收 `NicknameStyle` 和 `EffectiveTheme`（`useSettingsStore.effectiveTheme`），返回适配后的样式。`NicknameText` 组件接收 `effectiveTheme` prop 后自动调用适配。
  - **保存与消费**：`performSaveNicknameStyle(style, 30)` 在主进程原子执行：校验 BZ 币余额 → 扣除 30 BZ 币 → 写入 `userData.bzCoins` → 调用 `saveSettings({ nicknameStyle: style })` 持久化到 `settings`。余额不足返回 `{ success: false, code: "insufficient_coins" }`。
  - **UI 面板**：`PersonalizationView.vue` 新增双栏布局（`.nickname-style-panel`）：左侧预览卡片展示 `NicknameText` 实际效果（含单人/Room 两场景），右侧表单配置颜色/渐变/字体/字重/特效。保存前通过 `isNicknameColorAllowedForTheme` 检验对比度，不通过弹出警告。支持重置为默认样式（`resetNicknameStyle()`）。
  - **联机传递**：`RoomJoinPayload` 新增 `playerNicknameStyle` 字段，`PlayerInRoom` 新增 `nicknameStyle` 字段，`DiscoveredRoom` 新增 `hostStyle` 字段，`ChatPayload` 新增 `senderStyle` 字段。`RoomServer`/`RoomClient` 创建玩家对象时写入，`PlayerCard.vue` 和 `RoomChat.vue` 使用 `NicknameText` 渲染。房间发现页（`RoomDiscoveryView.vue`）房间名称使用 `NicknameText` 展示房主昵称样式。
  - **`effectiveTheme` 响应式**：`useSettingsStore` 新增 `effectiveTheme` computed（跟随 `settings.theme` 和 `prefersDark` 系统偏好），新增 `setPrefersDark()` 方法供 `App.vue` 的 `matchMedia` 监听器调用。`PersonalizationView` 中 watch `effectiveTheme` 自动适配预览颜色。

- **论坛系统设计（ForumService）**：
  - **运行边界**：论坛客户端接口必须同时携带 relayToken 和有效 GitHub Bearer Session；管理端只使用同源 Portal Cookie。MySQL 是帖子、评论、计数、点赞和软删除的事实源，MongoDB GridFS 仅保存帖子图片。帖子和评论的 `status` 为 0/1/2，分别表示正常、作者删除、管理员删除；`deleted_at` 只记录删除时间，`deleted_by` 记录实际操作人。
  - **信息流与详情**：`SocialView.vue` 只读取每页 10 条标题/时间/点赞数/评论数，使用 MySQL 最新流游标或 Elasticsearch `search_after` 搜索；`SocialPostDetailView.vue` 读取正文、图片和按点赞数/时间/ID排序的评论。列表、搜索词、游标和实际 `.n-layout-scroll-container` 滚动位置由 `useForumStore` 保留，返回详情不重新加载首页。
  - **文字与图片**：标题、正文和评论在服务端使用现有敏感词服务替换为等量 `*` 后存储；客户端主进程和服务端都必须校验图片真实 MIME、扩展名、大小、尺寸和像素数，客户端选区还按 SHA-256 拒绝同批及跨批重复图片，详情图片必须校验响应 MIME 与声明大小。帖子最多 4 张、单张最多 5 MiB，正文与评论分别受服务端长度限制。
  - **互动与限流**：帖子和评论点赞通过复合唯一键与事务内计数更新保证幂等。发帖限流使用 `forum.post.create`，管理员/超级管理员 1 小时、其他登录用户 24 小时；评论使用 `forum.comment.create`，分别为 5 分钟和 30 分钟。multipart 发帖在读取图片前 reservation，失败释放，业务事务提交后 commit。
  - **搜索同步**：ES 仅索引过滤后的标题和正文，不索引图片、评论、点赞或原始敏感词。帖子创建/软删除与 `forum_search_outbox` 同事务，worker 失败重试；ES 不可用时最新流、发帖和评论不受影响，带搜索词请求返回可重试错误，不回退 `LIKE`。`GET /api/v1/forum/search-status` 是客户端搜索开关：ES 未配置、未就绪或同步异常时返回 `enabled: false`，客户端隐藏搜索框。后台 ES 调用静默失败，仅保留 outbox 重试状态。部署固定 Elasticsearch 8.19.0 与同版本 analysis-ik，`ik_max_word` 索引、`ik_smart` 查询，端口只监听本机。
  - **删除、恢复与管理端**：客户端作者可通过 `DELETE /api/v1/forum/posts/:id` 和 `DELETE /api/v1/forum/comments/:id` 删除自己的内容；服务端按作者 ID 和 `status=0` 最终校验，作者删除帖子会级联标记其有效评论。`forum.view` 控制查看，`forum.manage` 控制管理员删除，`forum.restore` 仅授予超级管理员并控制恢复；管理员与超级管理员拥有前两项 capability，超级管理员额外拥有恢复能力。管理员删除写入 `status=2`，删除帖子同时标记其有效评论并写入 ES 删除 outbox。恢复帖子只将帖子恢复为 `status=0` 并写入 ES upsert outbox，不自动恢复已删除评论；恢复评论要求所属帖子正常，并在事务内增加评论计数。普通客户端永远只读取 `status=0` 内容。

- **反馈系统设计（FeedbackService）**：
  - **图片选择与验证（v3.1.3 追加模式）**：`selectImages(existingSelectionId?)` 支持传入已有选区 ID 时以追加模式在现有图片上叠加新图片。读取文件后：① 魔术字节检测实际 MIME；② 比对实际格式与扩展名声明是否一致（`getDeclaredContentType`）；③ `nativeImage.createFromBuffer` 验证图形有效性；④ 每张图片生成 SHA-256 哈希用于跨批次去重（同一选区中哈希重复的图片被拒绝，前端弹出 `duplicate_image` 提示）。追加时若原选区已满 4 张或总图片数超限则返回 `too_many_images`；传入已过期选区 ID 返回 `feedback_images_expired`。通过后将 Buffer 与哈希存入进程内存 Map（`selectionId` 为键），供后续 multipart 上传引用。整组图片 30 分钟后自动清理；单张移除后刷新 `createdAt`。
  - **释放语义**：`releaseImages(selectionId, imageId?)` 支持单张移除或整组释放；单张移除后若 selection 为空则自动删除 Map 条目，否则刷新 `createdAt` 时间戳。
  - **提交管线**：建言献策仅对已登录用户开放；设置页仅在 GitHub 会话有效时显示入口，主进程的图片选择、历史读取、详情查询和提交 IPC 也独立校验本地会话。`submit()` 校验 content ≤ 5000 字、selectionId 有效性、文字或图片至少存在一种，通过 `FormData` 构造 multipart，注入 `appVersion` 与 `platform`，并由 `RequestInterceptor.buildHeaders()` 注入 relayToken 和必需的 GitHub Bearer Token。POST `/api/v1/feedback` 超时 45 秒。通过 `accountService.handleAuthFailure(body.error)` 统一处理登录失效——仅 `session_expired` / `session_invalid` 时清除本地账号会话。
  - **反馈历史**：通过 `GET /api/v1/feedback?limit=10&cursor=` 按当前登录账号查询；服务端按 `created_at DESC, id DESC` 使用键集游标固定返回 10 条，客户端用 `IntersectionObserver` 在滚动区距底部 320px 时加载下一页并按 ID 去重。翻页失败时保留当前游标和 `hasMore`。v4 运行时不读取或清理任何旧 `feedbackHistory`，该字段只在 V1 转换器中丢弃。展开条目按需查询详情且不设定时刷新。
  - **反馈详情查询**：`getDetail(feedbackId)` 通过 `/api/v1/feedback/:id` 获取用户可见详情。主进程校验 UUID 格式反馈 ID，然后校验响应结构（id、content、status、reply、imageCount、createdAt、updatedAt 及 images 数组的每个元素的类型与大小）。随后逐个通过 `/api/v1/feedback/:id/images/:imageId` 下载图片，校验实际 Content-Type 与 MySQL 记录的 MIME 一致、实际 body 长度与声明 size 一致、不超 MAX_IMAGE_BYTES。任一步不通过返回 `feedback_invalid_response`。通过 auth 失败或权限不足由 `handleAuthFailure` 统一收口。
  - **IPC 边界**：渲染进程仅通过 `FeedbackModal.vue` → `electronAPI.settings.selectFeedbackImages / releaseFeedbackImages / submitFeedback / getFeedbackHistory / getFeedbackDetail` 与主进程交互，不直接接触文件路径或服务端 relayToken / GitHub 会话。`getFeedbackHistory` 从服务端查询当前账号列表，主进程必须校验历史和详情响应结构、图片数量、大小、MIME 和实际响应长度后再生成 Data URL。
  - **服务端并联（v3.1.3 用户详情接口）**：`POST /api/v1/feedback`、`GET /api/v1/feedback`、`GET /api/v1/feedback/:id` 和图片读取接口均要求发行版 relayToken、有效 GitHub Bearer Token，并对历史、详情和图片校验反馈所有者。历史接口只返回当前账号的 `id/submittedAt` 及 `hasMore/nextCursor` 分页元数据；详情返回 `id/content/status/reply/imageCount/createdAt/updatedAt/images`，不含 `adminNote`；图片接口返回单张图片原始流。管理 API 详情额外包含 `adminNote`，更新接口接受 `status/adminNote/reply`，备注与回复均不超过 5000 字符。提交采用 busboy 流式 multipart、魔法字节校验、GitHub ID 进程内冷却、MySQL 事务 + GridFS。
  - **Portal 前端**：`bz-games-admin/` 为独立 Vue 3 + Vite + Pinia 项目，构建为 `/admin/` 同源静态站点。生产环境由 Nginx 直接从 `/var/www/campusmate/admin` 托管页面，Relay 的 `ADMIN_STATIC_DIR` 保留为本机直连或开发回退；Nginx 与 Relay 静态服务都必须提供 SPA fallback、路径穿越防护和 CSP/`nosniff`/`DENY` iframe 等安全响应头。服务端会话接口返回唯一 capability 集合，前端 `rbac.ts` 只校验能力契约，不维护角色到能力的映射；菜单、路由、按钮和提交前置检查均调用 `auth.can(capability)`。玩家进入欢迎页并管理自己的反馈，创作者仅管理自己的游戏托管，管理员无用户角色调整、托管容量查看、系统监控和桌面客户端版本上传能力，超级管理员拥有全部界面与操作。服务端仍是唯一授权决策源，并独立执行 capability、资源所有权、状态机和精确 Origin 校验。
- **卸载系统设计（UninstallService）**：
  - **唯一入口**：安装根固定包含 `BZ-Games-Uninstall.exe`，Windows `UninstallString` 固定为 `"<root>\BZ-Games-Uninstall.exe" --system`；根启动器只负责启动、健康检查和自动回退。系统入口始终保留全部游戏库、配置和数据库。
  - **安全交接**：游戏内入口原子写入 `UninstallPlanV1`，将卸载器复制到 `%LOCALAPPDATA%\BZ-Games\UninstallWork\<operationId>\uninstall-worker.exe`，并等待 worker 完成计划、根标记、journal 和资源预检后写入 `ready.json`。`accepted: true` 只表示 worker 已安全接管。
  - **任务互斥**：统一 `LifecycleOperationGuard` 只管理卸载与更新两个客户端操作；游戏、市场、导入、存储迁移、备份、更新与房间任务会阻止卸载，卸载不取消、不等待且不强制结束活动任务。自动回退由应用进程外的根启动器执行，不存在客户端回退操作类型。
  - **可恢复状态机**：journal 按 `prepared → waiting_for_processes → preflight_complete → recovery_registered → launcher_quarantined → runtime_removed → shell_integration_removed → optional_data_cleanup → root_binaries_removed → finalized` 逐阶段原子提交。提交前把卸载注册表临时切到 worker 的 `--resume`；同一安装根优先恢复未完成 journal。
  - **提交顺序**：worker 等待 Electron 退出后再次验证绝对路径、`.bz-games-root`、普通文件、重解析点、卷根、保护目录和危险嵌套；先隔离根启动器，再调用 Velopack 删除 `.runtime`。卸载是单向提交，失败时保留已完成阶段并由工作目录 worker 或根卸载器继续，不恢复启动器、运行时或用户数据；核心完成后才逐路径清理用户勾选的数据。
  - **结果语义**：游戏内“删除所有游戏库”和“删除配置与数据”相互独立；单个可选数据路径失败不改变核心卸载结果，只生成残留报告。完全成功静默清理工作目录；核心失败或存在残留时在 `%LOCALAPPDATA%\BZ-Games\UninstallReports` 写日志并显示原生窗口。全程普通用户权限，不使用重启后删除。
- **默认封面/图标回退**：
  - `GameCover.vue` 在无自定义 cover 且无 video 时，使用构建期 `import defaultCoverUrl from "resources/default_cover.png"` 提供的静态回退图片（16:9）。
  - `GameIcon.vue` 在无自定义 icon 时，使用构建期 `import defaultIconUrl from "resources/default_icon.png"` 提供的静态回退图片（1:1），不再渲染文本首字符。
  - 两组件移除了文本占位逻辑（"暂无封面"/"?"），改为静态图片回退，`GameIcon` 的 `gameName` prop 已移除。

### 5.6 CSS 变量主题系统

- **语义变量**：`theme.css` 定义全局 `:root` 层基础色板（`--bz-gold`、`--bz-green`、`--bz-red`、`--bz-amber`、`--bz-info-blue`
  等），`.theme-dark` 与 `.theme-light` 分别定义暗/亮专属变量（`--bz-bg`、`--bz-bg-*`、`--bz-text-*`、`--bz-border`、`--bz-border-*`、`--bz-chat-*`
  等），组件层统一使用 `var(--bz-*)` 引用，彻底消除硬编码色值。`.theme-dark` / `.theme-light` 中同时定义 `scrollbar-color`（Firefox）和
  `::-webkit-scrollbar`（Chrome/Edge）伪元素样式，滚动条跟随主题自动切换。聊天昵称统一采用固定色值（他人 `#333`，自己 `#389e0d` 深绿），不使用样式组件。
- **`theme: "auto"` 模式**：`AppSettings.theme` 支持 `"auto"` 选项（默认值）。`App.vue` 通过
  `window.matchMedia('(prefers-color-scheme: dark)')` 监听系统主题变化，自动切换 `.theme-dark` / `.theme-light` CSS
  class。`onUnmounted` 时注销 `change` 监听器。NaiveUI 的 `n-config-provider :theme` 同步联动。
- **通知窗口独立主题**：`NotificationService` 创建成就弹窗时，根据用户设置的 `theme` 字段解析实际主题（`auto` →
  `nativeTheme.shouldUseDarkColors`），注入到 `NotificationView` 组件。`NotificationView` 独立导入 `theme.css` 获取 CSS 变量。
  `GameDetailView` 的灯光秀金色边框统一使用 `--bz-gold` 变量。

---

## 六、开发规范与约束

- **静态质量检查**：提交前运行 `npm run lint`、`npm run typecheck` 与 `npm run build`。ESLint 覆盖 `src/` 下的 TypeScript、JavaScript 和 Vue 文件及根目录构建配置；生成目录和独立 `relay-server/` 不由根配置重复扫描。

### 6.1 游戏导入与市场安装规范

- **任意文件夹导入**：`GameLoader` 支持任意目录导入。若目录缺少 `game.json`，前端需弹出补录表单，由用户填写核心字段后生成
  Manifest 并继续导入。
- **文件选择策略**：Windows 下文件选择对话框使用 `openDirectory` 模式。
- **异步任务边界**：手动导入由主进程 `GameImportTaskService` 统一管理，每次选择一个目录，最多同时执行两个任务；任务按 `taskId` 隔离，禁止相同 `gameId + version` 的重复活动任务，网页游戏按 `gameId` 排他。渲染进程只创建、订阅和操作任务，不执行文件复制。
- **复制与落盘**：`fileUtils.copyFolderRecursive()` 先并发扫描并统计总字节，再以受控并发复制小文件、流式复制大文件；取消使用 `AbortSignal`，并等待所有已开始的复制收口后才允许清理。导入拒绝符号链接，避免越过源目录边界读取文件。
- **原子安装**：所有导入先写入默认游戏库 `.imports/<taskId>`，扫描游戏库时必须忽略 `.imports`。复制完成后写入加密 Manifest 和任务标记，再原子移动到 `<gameId>/<version>`；数据库记录更新串行执行。失败或取消清理暂存目录，异常退出若发生在原子移动后，仅允许凭匹配的任务标记删除对应目标，禁止按未校验路径清理。
- **任务恢复**：手动导入摘要持久化到用户数据目录。重启后未完成任务统一转为 `interrupted`，清理其受控半成品，不自动续传；用户可从原路径完整重试。完成任务必须先刷新对应游戏记录，再移除任务摘要。
- **游戏库占位**：新游戏的手动导入和市场安装占位统一显示在游戏库最后；已有游戏的新版本保留原素材并在原卡片叠加任务遮罩，同一游戏多版本分行展示。市场下载、校验和解压阶段不进入游戏库，只有最终调用 `GameLoader` 复制时设置 `installStarted` 并显示占位。
- **完成通知**：手动导入成功通知由根布局 `AppContent` 监听 `game:import:event` 的真实 `completed` 状态后全局展示，并按 `taskId` 去重；任务入队成功不得提前提示导入成功。
- **版本检查**：导入时会检查 `game.json` 中的 `platformVersion` 字段，若当前平台版本不满足要求（使用 `semver`
  比较），将拒绝导入并提示用户。
- **拖拽路径解析统一**：游戏库拖拽导入路径统一使用 `webUtils.getPathForFile(file)` 获取。
- **市场入口拉取策略**：进入"游戏市场"页面时，若缓存有效（1 小时内且未重启应用）则直接使用缓存数据；超过 1 小时或首次进入则自动请求远程
  `market.json`。用户可点击"刷新"按钮强制重新拉取；刷新失败会提示错误并保留原有效缓存，不将旧数据伪装成刷新结果。应用重启后缓存自动失效（仅内存缓存，不落盘）。
- **市场索引更新时间展示**：`MarketView` 从 `index.updatedAt` 读取时间戳，在标题"游戏市场"右侧以小字展示（格式
  `YYYY-MM-DD HH:mm`），使用 `updatedAtLabel` computed 实现，三语 i18n 支持。
- **私有资源防盗链 Referer**：所有指向私有 CDN/OSS 的请求均携带构建期注入的 Referer。实现分两层：`fetch` 请求通过 `RequestInterceptor.buildHeaders()` 统一注入；`<img>` 标签等渲染层请求由 `RequestInterceptor.registerSessionHandler()` 注册的 Electron 全局拦截器注入。
- **市场下载暂存**：市场安装包应先下载到应用可控的临时目录（如 `.market-cache/`）中，校验通过后再解压并导入。
- **市场安装统一导入**：市场下载成功后，解压目录复用 `GameLoader` 导入链路。
- **Manifest 加密落点**：`GameLoader.installGameFiles()` 在 `.imports/<taskId>` 完成文件复制后，使用已在内存中通过 Schema 校验的 Manifest 覆盖暂存目录内的 `game.json` 为密文，再原子移动到正式版本目录；失败时清理本次未完成目录且不新增游戏记录。所有已安装 Manifest 读取统一经过 `GameManifestFileService`，不得在启动过程中临时写回明文。
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
    严格执行显式转换矩阵；paused/interrupted 可以被用户取消，但不能被旧 pipeline 覆盖为 verifying/error 等其他状态。`startPipeline().catch()` 通过 `signal.aborted` 静默返回，不覆写已设置的状态。
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
  - 所有游戏类型的 `version` 均必须通过完整 SemVer 校验；预发布标识也必须符合 SemVer 规则。
  - `entry` 会自动探测并允许用户手动修改；探测支持 `.html`、`.htm`、`.exe`、`.bat`、`.cmd`，优先匹配常见入口名并排除安装器、卸载器、崩溃处理器等误判可执行文件。
  - `entry=.html/.htm` 时校验入口文件存在，`entry=.exe/.bat/.cmd` 由游戏启动流程执行存在性校验，`entry=serve` 或 `entry=url` 时跳过入口文件存在性校验。
  - `entry=url` 时必须提供 `web_url`（合法 URL）。
  - `icon/cover` 若填写则必须是游戏目录内存在的相对路径。

### 6.1.1 Velopack 与 Rust 安装生命周期

- **目录边界**：根目录稳定保存 `BZ-Games.exe`、`BZ-Games-Uninstall.exe`、`.bz-games-root`、`config.json`、`games/`、`db/`；Velopack 只管理 `.runtime/`，不得覆盖或卸载同级用户数据。
- **安装路径**：Rust 安装器使用两页原生 Windows 向导，先展示产品介绍，再让用户选择父目录并自动创建 `BZ-Games` 子目录；禁止系统目录、磁盘根、用户主目录根、网络路径、重解析点和不支持可靠原子重命名的位置；目标安装目录非空时不得覆盖。`--install-dir` 仅供自动化调用，表示明确的最终安装根目录。
- **稳定入口**：快捷方式、协议和自启动指向根目录启动器，卸载入口独立指向根目录卸载器；Velopack 使用 `--shortcuts None`。
- **卸载语义**：Windows 系统入口只移除客户端并保留 `config.json`、`games/`、`db/`；游戏内入口才允许分别选择删除全部游戏库或删除 `config.json`、`db/`，删除动作在 Electron 退出且核心预检通过后执行。
- **构建链**：`npm run build:win` 依次生成 Rust 根启动器与卸载器、Electron 目录包、Velopack 资产，以及同时嵌入 Setup、启动器和卸载器的最终 `BZ-Games-Setup-<version>.exe`。4.0.0 或显式 `-FullOnly` 只生成 full；后续常规构建必须先从 GitHub 下载上一稳定版 full/feed，并同时生成当前 full、delta 和 feed，下载或 delta 缺失时构建失败。

### 6.1.2 游戏库列表管理

- **空目录约束**：`system:selectGameStoragePath` 通过 `fs.readdirSync` 检查所选目录是否为空。非空时返回
  `{ path, error: "directory_not_empty" }`，由前端通过 `dialog.warning()` 弹出友好提示（使用三语 i18n
  文案），阻止选择。
- **默认项约束**：默认游戏库由 `game_libraries.is_default` 表示，数据库唯一索引保证至多一个默认项；设置页只调用数据库接口。
- **精确清理**：`system:removeGameStoragePath` 删除游戏库时，删除标准结构 `gameId/version` 下存在 `game.json` 的版本目录，并在游戏根目录或库根目录为空时删除空目录。
- **迁移语义**：迁移游戏库严格执行“目标空目录校验 → 复制与结构/大小校验 → 数据库仓库根路径更新与版本引用数验证 → 删除源目录”。各阶段最多重试 3 次；提交数据库或删除源目录失败时恢复原路径、内存缓存和文件状态，不允许数据库路径与实际有效仓库分叉。v4 配置文件不保存游戏库路径，唯一持久化来源为 `game_libraries`。
- **单游戏删除**：`game:remove` 删除单个游戏时沿用游戏根目录递归删除策略。

### 6.2 IPC 接口清单

- `game:prepareImport`：导入前预检查目录并返回建议草稿信息。
- `game:checkIdExists`：校验游戏 ID 是否已存在。
- `game:selectImportDirectory`：只选择单个手动导入目录，不执行复制。
- `game:startImport`：快速校验并创建异步手动导入任务，立即返回任务状态。
- `game:getImportTasks`：获取全部手动导入任务快照。
- `game:cancelImport` / `game:retryImport` / `game:dismissImport`：取消、完整重试或移除终态手动导入任务。
- `game:getAll`：获取用于展示的完整游戏列表数据。
- `game:getRecords`：获取原始游戏记录；版本位置仅包含 `libraryId + relativePath`，绝对路径只在主进程文件系统边界解析。
- `game:getManifest`：透明解密并读取指定游戏版本的 `game.json`，返回内存中的已校验 Manifest 对象。
- `game:getVideo`：读取指定版本视频并返回 Data URL。
- `game:getCover`：读取指定版本封面并返回 Data URL。
- `game:getIcon`：读取指定版本图标并返回 Data URL。
- `game:getAchievementIcon`：按 Manifest 声明的成就 ID 读取安全相对路径图标并返回 Data URL。
- `game:getVersions`：获取指定游戏的版本列表。
- `game:getInstallPath`：获取指定游戏的安装根目录（gameId 目录，不含版本子目录），用于在系统文件管理器中打开。
- `game:reorder`：保存游戏库排序结果。
- `game:toggleFavorite`：切换游戏收藏状态。
- `game:remove`：删除指定游戏或指定版本。
- `game:launch`：启动指定游戏版本。
- `game:getRunningIds`：返回主进程当前判定仍在运行的游戏 ID 快照。Native 游戏按入口进程及已发现的子进程树判断；Web 游戏按窗口和渲染进程生命周期判断。
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
- `market:dismissTask`：移除市场终态任务及其临时文件。
- `market:pauseTask`：暂停正在进行的下载任务，进度持久化到本地快照文件。
- `market:resumeTask`：从暂停快照恢复下载任务，重新拉取索引校验兼容性后启动新管线续传。
- `market:getPendingTasks`：读取本地快照文件，返回所有未完成的暂停/中断任务。
- `market:resolveAssetInfo`：通过 GitHub REST API 解析 Release Asset 的 sha256/size（5次指数退避重试，1小时缓存）。
- `market:getAllTaskStates`：获取所有当前下载任务的状态快照（供悬浮球窗口初始同步）。
- `market:floatBall:event`：主进程 → 悬浮球渲染进程，推送合并后的下载进度数据（`FloatBallProgress`），高频进度按 100 ms 合并并保留尾值，关键状态立即推送。
- `floatBall:dragState`：主进程 → 悬浮球渲染进程，通知拖拽状态（拖动中/停止）。
- `room:create`：创建房间并在本地启动房间服务。
- `room:join`：加入指定地址的房间（支持官方短地址、物理局域网 IP、虚拟局域网 IP、用户自备 frp 地址），并可附带密码。
- `room:leave`：离开房间（房主离开会解散房间）。
- `room:ready`：标记当前玩家为已准备。
- `room:unready`：取消当前玩家准备状态。
- `room:start`：由房主触发房间开始游戏。
- `room:setAddress`：设置并广播房主公网地址。
- `room:setPassword`：设置或清除房间密码，并同步到官方中继服务器（若当前已开启官方服务器模式）。
- `room:getState`：获取当前房间状态快照。
- `room:sendChat`：发送文本、语音或图片聊天消息（支持文字+图片打包发送）。
- `room:kickPlayer`：房主踢出指定玩家。
- `room:reconnect`：客机游戏进程崩溃后重新启动游戏（要求 `room.reconnectPlayerIds` 包含当前玩家 ID）。
- `room:discoverLan`：扫描并返回物理局域网房间列表。
- `room:discoverVirtualLan`：扫描并返回虚拟局域网房间列表（EasyTier、ZeroTier、Tailscale、WireGuard、Hamachi 等）。
- `room:discoverRelay`：从官方中继服务器 `/rooms` 拉取服务器房间列表，并返回已带加入校验结果的房间列表。
- `room:probePassword`：加入前探测目标房间是否设置密码；直连房间走房主本地探测，官方短地址走中继探测。
- `room:validateDiscovered`：对发现到的房间执行加入前校验，包括是否为自己的房间、房间状态、人数、本地是否安装游戏和版本是否匹配。
- `room:enableRelayHost`：房主切换到官方服务器公网入口，先断开其他玩家，再向官方中继注册房间并返回短地址。
- `room:disableRelayHost`：房主关闭官方服务器公网入口，断开中继连接并清空短地址。
- `room:popOutChat`：将聊天弹出到独立窗口，传递当前聊天历史。
- `room:popInChat`：关闭独立聊天窗口，聊天回到主窗口。
- `room:getChatHistory`：获取缓存的聊天历史记录。
- `room:chatWindowClosed`：主进程 → 渲染进程事件，通知主窗口聊天弹窗已关闭。
- `system:getSettings`：读取当前应用设置。
- `system:getAppVersion`：获取当前平台版本号（供渲染进程进行平台兼容性判断）。
- `system:getSensitiveWords`：从 `resources/vocabulary/` 加载并返回去重排序后的敏感词列表（按长度降序），结果缓存在主进程模块级变量中。
- `system:account:getLocalStatus`：从本地 `config.json` 同步读取账号状态，不发起网络请求。
- `system:account:getPresenceStatus` / `system:account:setPresence`：读取或由用户主动切换在线状态。
- `system:account:presenceChanged`：主进程 → 渲染进程推送在线状态变化。
- `system:account:loginGithub` / `system:account:logout`：触发 GitHub OAuth 登录或撤销当前账号会话。
- `system:account:authChanged`：主进程 → 渲染进程推送登录、登出、会话过期或会话失效事件（含 `LocalAccountStatus`）。
- `system:feedback:selectImages`：打开文件对话框选择反馈图片（支持传入 `selectionId` 追加模式），主进程侧执行 MIME 声明与实际格式一致性校验、SHA-256 去重。
- `system:feedback:releaseImages`：释放单张或全部已选反馈图片。
- `system:feedback:submit`：文本 ≤ 5000 字 + 可选图片 multipart 上传。
- `system:feedback:getHistory`：携带可选游标从服务端读取当前登录账号固定 10 条的反馈历史编号、提交时间戳和下一页元数据。
- `system:feedback:getDetail`：从服务端查询反馈详情（正文、处理状态、回复、图片），主进程侧校验响应结构后再返回 Data URL。
- `forum:listPosts` / `forum:getPost` / `forum:getComments`：主进程携带 relayToken 与登录 Bearer Session 读取论坛轻量列表、帖子详情和评论游标页。
- `forum:getSearchAvailability`：主进程读取服务端 ES 可用性；不可用时客户端不显示论坛搜索框。
- `forum:selectImages` / `forum:releaseImages` / `forum:createPost`：主进程管理论坛图片选区并以 multipart 发帖，渲染进程不接触本地路径、relayToken 或会话令牌。
- `forum:createComment` / `forum:deletePost` / `forum:deleteComment` / `forum:likePost` / `forum:unlikePost` / `forum:likeComment` / `forum:unlikeComment`：论坛评论、作者删除和幂等点赞 IPC。
- `system:saveSettings`：保存应用设置并应用相关系统行为。
- `system:savePartialSettings`：保存部分应用设置（合并写入，不会覆盖未传入的字段）。
- `system:uploadAvatar`：选择图片并返回原始 data URL（JPEG/PNG/WebP），不做缩放，裁切由前端 Crop 弹窗完成。
- `system:savePng`：将渲染进程生成的 PNG 保存到用户选择的位置；主进程只接受规范 PNG Data URL，限制解码后最大 16 MB，并校验 Base64 与 PNG 文件签名。
- `system:selectGameStoragePath`：弹窗选择新的游戏库路径。返回 `{ path: string }` 或
  `{ path: string; error: "directory_not_empty" }`，要求所选目录为空（防止卸载时误删其他文件），若非空则由前端弹出友好提示。
- `system:selectGameStoragePathRelaxed`：弹窗选择迁移目标路径，路径合法性和空目录约束由主进程迁移逻辑再次校验。
- `system:getGameStoragePaths`：返回游戏库列表及默认项标记。
- `system:addGameStoragePath`：添加新的空游戏库目录。
- `system:setDefaultGameStoragePath`：将游戏库列表中的指定路径设为默认游戏库。
- `system:migrateGameStorageLibrary`：迁移已配置的外部游戏库；目标必须为空。复制、数据库提交和源目录删除均有限重试，失败时返回结构化错误并执行文件与数据库回退。
- `system:openPath`：在系统文件管理器中打开路径。
- `system:removeGameStoragePath`：删除游戏库列表项及其内部已导入游戏数据。仅删除标准 `gameId/version/game.json` 可确认的游戏版本目录，不删除存储根目录下的用户自有文件或子目录。
- `system:uninstall`：游戏内卸载入口。“删除所有游戏库”和“删除配置与数据”是两个独立选项；活动游戏、市场、导入、迁移、备份、更新或房间任务会返回完整 blocker 列表。主进程生成版本化计划并等待临时 Rust worker 安全接管，返回 `{ accepted: true, operationId }` 或 `{ accepted: false, error, blockers? }`；后续删除与恢复完全由 worker journal 驱动。
- `system:clearCache`：通过 Electron Session API 清除当前应用身份对应的 HTTP 缓存，并清理当前 `app.getPath("userData")/.market-cache` 与市场内存缓存；存在可恢复下载任务时保留任务缓存。不得扫描或删除旧应用身份的目录。返回 `{ totalSize: number; clearedSize: number }`。
- `system:getUserData`：读取用户经济与签到数据。
- `system:checkIn`：执行每日签到并返回奖励结果。
- `system:buyFrame`：原子购买头像框（校验余额 + 已拥有，成功自动装备）。
- `system:saveNicknameStyle`：保存昵称样式（颜色/渐变/字体/字重/特效），扣除 30 BZ 币。
- `system:equipFrame`：原子装备头像框（仅校验已拥有）。
- `system:unequipFrame`：原子卸下头像框（仅当前装备时生效）。
- `system:getAvatarFrameImage`：从 `resources/avatar-frames/` 读取帧图返回 base64 Data URL。
- `system:dataHealthCheck`：执行本地数据健康检查，返回结构化报告（错误/警告/摘要）。
- `backup:export`：选择目标文件并导出 `.bzgames` V2；只备份内置游戏库，源数据永不删除。
- `backup:import` / `backup:import-confirm`：预检 V1/V2 并经二次确认完整替换当前数据；V1 由隔离转换器生成全新 v4 数据。
- `backup:cancel` / `backup:get-status` / `backup:event`：统一取消、状态和真实进度；单任务互斥。
- `update:check` / `update:download` / `update:cancel` / `update:apply` / `update:get-status` / `update:event`：Velopack 更新最小职责接口。
- 客户端不暴露回退查询或执行 IPC，也不接受用户指定的版本、包路径或快照路径。回退只能由根启动器在同一目标版本连续两次健康启动失败后自动触发，并同时恢复更新前配置和数据库。
- `system:log:error`：渲染进程错误日志回传主进程统一记录（`ipcRenderer.send` 单向推送，无需返回值）。
- `room:event`：主进程推送房间事件给渲染层。
- `game:process:started`：推送平台托管的游戏运行实体启动事件。Native 在入口进程 `spawn` 后发送；Web 在窗口加载成功并创建游玩会话后发送。
- `game:process:ended`：推送平台托管的游戏运行实体结束事件。Native 在入口进程及已发现的子进程树均结束后发送；Web 在窗口关闭或渲染进程崩溃/被杀死后发送。
- `game:launch:failed`：推送游戏启动失败事件。
- `market:event`：推送市场下载/安装任务状态变化事件。
- `game:import:event`：推送手动导入任务的阶段、字节进度和终态快照。
- `game:unlockAchievement`：推送成就解锁事件到渲染层。
- `game:storage:init`：初始化 Web 游戏本地存储数据。
- `game:storage:save`：保存单个 localStorage 键值。
- `game:storage:remove`：删除单个 localStorage 键。
- `game:storage:clear`：清空当前游戏版本 localStorage 数据。
- `game:storage:flush`：将内存缓存的 localStorage 数据批量落盘（sendSync 同步调用，确保 beforeunload 时不丢数据）。
- `system:openUrl`：使用系统默认浏览器打开外部 URL，仅允许有效的 `http:` / `https:` 地址。

### 6.3 UI 交互规范

- **返回导航**：所有二级页面（设置、统计、成就等）的 `n-page-header` 必须包含返回按钮，统一导航回 `Library` 页面。
- **市场入口位置**：在游戏库左侧导航区域"游戏市场"按钮，点击后进入市场列表页面（一级界面 `/markets`）。
- **市场两级导航**：一级界面（`MarketListView`）以响应式四列卡片网格展示所有可用市场源（来自 `sources`
  数组），支持按市场名称搜索并展示市场封面、名称、更新时间。用户点击卡片后始终以稳定 `marketId` 进入对应游戏列表（二级界面 `/market/:marketId`
  ）。二级界面左上角有返回按钮可回到市场列表。
- **市场刷新行为**：市场列表和游戏索引均有 1
  小时内存缓存。首次进入或缓存过期时自动拉取最新数据；加载中展示骨架屏或加载态；全部来源失败时展示错误态与重试按钮。用户可通过"
  刷新"按钮强制拉取最新数据。缓存有效期内重复进入复用缓存。
- **市场索引时间展示**：市场页面标题"游戏市场"右侧以小字展示索引更新时间（`updatedAt` 字段，格式 `YYYY-MM-DD HH:mm`
  ），安装目录另起一行独立展示。标题栏右侧提供市场源信息按钮（ⓘ），点击弹出模态框展示 `schemaVersion`、`marketId`、`marketName`、`generatedAt`、`updatedAt`、`author`、`repository`（可点击跳转）及游戏数量。
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
- **房间入口**：顶部导航的“房间”按钮进入 `/rooms`，包含“局域网”“服务器”两个 Tab；顶部头像与玩家名点击进入个性化页面。
- **局域网始终可用**：房主页面的模式切换仅控制是否启用官方短地址；`RoomServer` 的本地监听持续存在，物理局域网、虚拟局域网和用户自备 frp 地址直连始终可用。
- **官方服务器模式**：房主开启官方服务器模式后展示 `<relay-public-host>:随机数字` 短地址和复制按钮；切换入口前必须先通知其他玩家离开，注册失败自动回退到 `lan` 状态。
- **房间发现校验**：局域网/服务器卡片加入前必须校验本地是否安装对应游戏、版本是否匹配、房间是否等待中、人数是否已满、是否为自己的房间。加入目标房间前必须通过密码探测响应中的 `hostId` 判断目标是否确为本机房间；只有目标 `hostId === localPlayerId` 才返回 `own_room`。若本机正在开房但目标属于其他房主，必须依次断开房主本地 `RoomClient`、注销官方中继房间、`await roomServer.stop()`，成功后再连接目标；关闭失败返回 `close_current_room_failed`，不得误报 `own_room`。
- **房间密码交互**：房间页右上角提供密码按钮；发现页卡片加入前必须先探测 `hasPassword`，仅在目标房间有密码时再弹出密码输入框。
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
  - **中继房间图片限制**：当房间处于官方中继模式（`hostConnectionMode === 'relay'`）时，弹窗关闭图片发送功能：① 发送图片按钮 disabled + hover 提示；② `handleSend` 跳过 pending images；③ `addImageFromFile` / `handlePaste` / `handleDrop` / `handleImportImage` 均通过 `isRelayRoom` 门控直接返回；④ 切换至中继房间时立即清空 `pendingImages` 并重置拖拽状态。`isRelayRoom` 从 `room:state:sync` 事件中的 `hostConnectionMode` 字段派生。
- **聊天图片消息**：
  - 弹窗聊天框支持 Ctrl+V 粘贴图片、拖拽图片文件和点击"发送图片"按钮选择图片发送，单张限制 5MB。
  - 点击"发送图片"按钮（📷 图标）触发隐藏的 `<input type="file" accept="image/*" multiple>`，支持批量选择。选择后和粘贴/拖拽统一走 `addImageFromFile()` 处理。
  - 录音过程中图片发送按钮禁用。
  - 图片以缩略图（max 240×200px）展示在输入框上方预览区，发送前可删除。
  - 文字和图片打包为一条消息（`images[]` 数组），消息展示时图片在上、文字在下。
  - 消息列表中图片使用自定义放大镜光标（黑色 SVG data URI），点击弹出全屏预览。
- **图片预览器**：
  - `ImageViewer.vue` 是房间内嵌聊天、独立聊天窗口和待发送图片共用的薄封装，内部统一使用 Naive UI `NImagePreview`。
  - 预览保留 Naive UI 原生的旋转、复位、缩放、下载与关闭工具栏；缩略图尺寸仍由聊天组件控制，放大预览按原图比例完整显示。
- **内嵌聊天自适应高度**：
  - RoomChat 使用完整 flex 布局链，`.chat-messages` 为 `flex:1; min-height:200px`，随窗口大小自动调整。
- **聊天消息统一组件**：
  - `ChatMessageList.vue` 为 RoomChat 与 ChatPopoutView 提供统一的聊天消息渲染（文本、图片、语音、GameReportCard），消除两处重复代码。
  - 组件通过 props 接收消息列表、玩家 ID、播放状态、敏感词过滤开关与词库，通过 emits 向外传递图片预览和语音播放事件。
- **敏感词过滤**：
  - **客户端侧**（第一道防线）：功能默认开启；由 `SettingsView` 中的 `sensitiveWordFilter` 开关控制，持久化于 `AppSettings.sensitiveWordFilter`。词库存储在 `resources/vocabulary/*.txt`，主进程 `system:getSensitiveWords` 加载并缓存，渲染进程通过 `sensitiveWordFilter.ts` 的 `filterSensitiveText()` 对消息文本进行字符级掩码替换（敏感词替换为 `*`）。用户可以关闭。设置项旁提供帮助按钮（?），hover 展示说明：中继服务器房间由服务端自动过滤与本地开关无关，局域网/虚拟局域网房间由本地开关控制。
  - **中继服务器侧**（第二道防线）：对所有经中继转发的聊天消息强制执行，用户不可关闭。图片消息被拦截丢弃，文字/混合消息经敏感词过滤后转发。词库文件缺失时自动丢弃所有文字消息（fail-closed），确保中继链路不会成为未过滤内容的通道。详见「官方中继联机系统 → 中继聊天内容安全」。
  - 双端共用同一套 Unicode 安全算法（`Array.from()` + code-unit→char-index 映射表定位，词库按长度降序排序后逐词扫描，被命中的字符位置标记后批量替换为 `*`）。
- **游戏详情页**：
  - 删除游戏功能使用模态框，支持多选版本进行删除，默认选中当前版本。
  - 若 Manifest 配置了 `video` 字段，详情页进入后自动播放预览视频；视频结束后自动回退显示封面。
- **加入房间地址**：加入房间输入框需要回填最近一次成功地址（持久化于设置），减少重复输入。
- **房间连接状态可视化**：房间页需展示 `connecting / reconnecting / failed / disconnected` 状态，以及重连倒计时与失败原因。
- **统计/成就搜索**：右上角默认展示搜索图标，点击后展开输入框并支持按游戏名或游戏 ID 模糊搜索。
- **房间开始按钮冷却**：房间内收到 `room:game:end` 后，Host 的「开始游戏」按钮需禁用 5 秒。
- **客机重连按钮**：客机游戏进程意外退出后，由 `RoomServer` 将 `playerId` 加入 `RoomInfo.reconnectPlayerIds` 并广播状态同步。前端 `isReconnectMode` 从该数组派生，无需手动管理。重连状态下 Ready/Unready 按钮位替换为"重连"按钮。点击后重新 `launch()` 同一游戏版本。`room:game:start` 或 `playing→waiting` 时 `reconnectPlayerIds` 被清空，按钮恢复原状。
- **统计界面**：卡片右上角需展示该游戏的所有版本号，使用自动换行布局。
- **设置页更新入口**：健康启动完成 30 秒后每次启动至多自动检查一次，不存在周期定时器；自动失败静默。用户点击“稍后再说”写入当前安装版本，当前版本后续启动连网络检查也跳过；手动检查始终有效，升级后自动恢复。下载和安装都必须由用户分别确认。
- **设置页备份入口**：V2 导出与 V1/V2 导入使用同一弹窗。导入明确为完整替换且不删除源 `.bzgames`；成功 message 出现后进度条立即消失，应用自动经根启动器重启并执行健康检查。
- **玩家昵称校验**：昵称输入框限制 16 个字符（`maxlength="16" show-count`），表单校验规则包含三个维度：① 非空（`required`）；② 最长 16 字符（`max: 16`）；③ 禁止 `< > " ' \` & \\ /`等特殊字符（正则`/^[^<>\"'\`&\\\\/]+$/`）。`canSave`computed 通过`nicknameValid`门控：空名或包含非法字符时保存按钮 disabled。所有 6 种语言均提供`nameTooLong`/`nameInvalidChars` 错误提示。
- **设置页卸载入口**：设置页底部（与保存按钮同行，`justify-content: space-between`）提供"卸载客户端"按钮（
  `type="error" secondary`），右侧提供"清除缓存"按钮。点击卸载弹出 NaiveUI 自定义确认弹窗，包含不可撤销的警告文案、是否同时删除所有游戏库目录的勾选项、以及删除路径列表预览。确认后调用
  `system:uninstall` IPC 执行卸载。卸载准备期间锁定弹窗并显示加载状态；市场任务活跃、游戏库被占用、路径不安全、辅助进程或卸载器不可用时不得静默继续，必须保留客户端并展示对应错误。
- **设置页清除缓存入口**：设置页底部全宽操作栏提供"清除缓存"按钮（`secondary`）和"迁移游戏库"按钮（`type="warning" secondary` 黄色样式）。点击"清除缓存"后弹出 `n-modal preset="card"` 弹窗（400px）并调用 `system:clearCache`。主进程只清理当前 Electron Session HTTP 缓存、动态 `userData/.market-cache` 和市场内存缓存；为保证暂停或中断下载可恢复，存在保留任务时不删除市场任务缓存。IPC 完成后展示实际释放空间，取消/确认按钮统一位于弹窗右下角。
- **设置页未保存变更拦截**：进入页面时记录 `originalSettings` JSON 快照，`hasUnsavedChanges` 计算属性实时比对当前表单与快照。`onBeforeRouteLeave` 路由守卫检测到未保存变更时弹出 NaiveUI `dialog.warning`，提供"保存并离开 / 不保存 / 取消"三个选项。页面顶部返回按钮（`n-page-header @back`）同样先检查变更再跳转。保存成功后同步更新快照，不再触发拦截。
- **设置页头像裁切**：上传头像后弹出裁切弹窗（`n-modal preset="card"` 520px），Canvas 绘制原图 + 正方形裁切框（70% 容器边长，带九宫格参考线）。支持鼠标拖拽平移和滚轮/滑块缩放（自适应最小缩放至覆盖裁切框）。确认后从裁切框区域提取正方形内容，缩放至 256×256 JPEG 并自动保存。存储为正方形，圆形效果由 CSS `border-radius: 50%` 实现。
- **设置页头像预览**：点击设置页头像缩略图（`AvatarWithFrame` 组件，40px），弹出
  `n-modal preset="card"` 模态框，280×280 圆形大图预览（含头像框）；无头像时显示玩家名首字母大字（使用 `--bz-bg-card-placeholder` 和
  `--bz-text-on-placeholder` CSS 变量适配暗/亮主题）。
- **设置页主题跟随系统**：主题选择器提供"跟随系统"选项（`themeAuto`）。当选择 `auto` 时，平台自动跟随操作系统亮/暗模式切换。
- **设置页官网链接**：设置页需展示官方网址，使用 NaiveUI `n-a` 组件渲染为可点击链接，`
@click.prevent` 拦截默认跳转后通过 `system:openUrl` IPC 调用 `shell.openExternal` 打开系统默认浏览器。
  - **设置页建言献策**：仅登录用户可见底部入口，入口打开固定 72vw × 72vh 的 `FeedbackModal`，使用“建言献策 / 历史记录”两个 Tab，不再打开第二层历史弹窗。文字最多 5,000 字，可选最多 4 张 PNG/JPEG/WebP（单张 5 MiB）；重复选择通过顶部 message 提示，新增图片追加到当前选择，缩略图按最长边 `contain`，文件名完整换行显示。渲染进程只持有主进程生成的预览和选择 ID，不接触文件路径、发行版中继令牌或 GitHub 会话令牌。已登录用户每 12 小时可提交一次；触发限制时只展示服务端 `resetAt` 对应的一条提示。历史列表默认全部收起，右侧只显示展开按钮；展开时从服务端查询正文、图片、处理状态和回复，详情区内部显示状态，历史较多时在固定弹窗内容区滚动。
- **GitHub Token 设置**：设置页提供 `githubToken` 字段（`n-input type="password"`，`@copy.prevent` + `@cut.prevent` 防剪贴板泄漏）。填写有效的 GitHub Personal Access Token 后，平台所有 GitHub API 请求自动携带 `Authorization: Bearer <token>`，将 API 限流从 60 次/小时提升至 5000 次/小时（用于 Release Asset 解析）。
- **账号与在线状态**：设置页 GitHub 登录区域只提供登录、登出、账号资料和在线状态开关；在线状态默认关闭且不持久化，Platform Snapshot 入口与说明均不存在。
- **设置页数据自检**：设置页需提供“数据自检”按钮。清单检查复用 `GameManifestFileService` 严格验证密文信封、密钥、认证标签和最新 Schema；运行时明文 Manifest 是错误，不得自动改写。主进程返回稳定错误码和参数，渲染层使用 i18n 展示。
- **备份错误诊断**：导入导出失败时前端按共享错误码展示本地化原因；技术细节仅写入主进程日志，不向用户泄露绝对源路径或内部异常。
- **设置页游戏库列表管理**：
  - 支持维护多个游戏库路径，并为每个项提供默认游戏库切换、打开路径和删除入口。
  - 默认游戏库影响新导入或市场下载安装的游戏，已导入游戏所在目录保持不变。
  - 删除游戏库时必须阻止删除最后一个路径，并通过 i18n 展示结构化错误文案。
  - 迁移游戏库时先选择外部源游戏库，再选择新的空目录；复制与校验成功后同步数据库和内存缓存，最后删除源目录。任一提交阶段失败均有限重试并自动恢复原仓库。
  - 支持展示“当前 + 历史”路径列表、打开路径、删除路径。
  - 删除路径时只删除该路径中平台可识别的游戏版本目录，并更新本地记录；用户自行放入的非游戏文件必须保留。
- **房间管理增强**：
  - Host 可在玩家列表中踢人，被踢玩家收到弹窗并自动离开房间。
  - 被踢玩家在同一房间生命周期内禁止重新加入。
  - 房主解散房间后，所有客户端需稳定收到 `room:disbanded` 并退出房间页。
- **成就弹窗版本一致性**：成就弹窗读取 Manifest 时使用当前运行版本。
- **经济系统前端同步**：游戏结束事件后需刷新用户数据，确保每 10 分钟时长奖励的 BZ 币能即时反映在 UI。

### 6.4 打包与原生成模块

- **原生模块编译**：`better-sqlite3-multiple-ciphers` 为 C++ 原生模块，`postinstall` 脚本中的 `electron-builder install-app-deps` 会针对当前 Electron 版本重编译 `.node` 文件。
- **asarUnpack 必需**：原生 `.node` 文件从 `app.asar` 外部加载，`package.json` 的 `build.asarUnpack` 配置包含 `node_modules/better-sqlite3-multiple-ciphers/**`。
- **extraResources 用于原生可执行文件**：`7zip-bin` 提供的 `7za.exe` 通过 `child_process.spawn()` 调用。使用 `build.extraResources` 将其拷贝到 `process.resourcesPath`，代码中通过 `process.resourcesPath` 手动拼接路径。配置示例：`{ "from": "node_modules/7zip-bin/win/x64", "to": "7za", "filter": ["7za.exe"] }`。
- **electron-rebuild 手动补充**：开发阶段出现 `NODE_MODULE_VERSION` 不匹配错误时，执行 `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`。
- **GitHub Release Asset 自动校验**：
  - `sha256` 和 `size` 为可选字段（`sha256` 全可选，`size` 仅 GitHub 直链时可省略）。
  - **双重解析路径**：① **前端预解析**（展开卡片时）：`MarketView.toggleExpand()` → `resolveMissingAssetInfo()` → `loadAssetInfo()` → IPC `market:resolveAssetInfo` → `MarketService.resolveAssetInfo()`。展开后 sha256/size 尚未返回时，size 区域显示 `<n-skeleton>` 骨架；返回后自动更新。② **下载时懒解析**：`downloadAndInstall()` 阶段对 GitHub 直链实时调用 `resolveGitHubAssetInfo()` 从 GitHub API 获取并缓存。
  - `resolveGitHubAssetInfo()` 调用 GitHub REST API `GET /repos/{owner}/{repo}/releases/tags/{tag}`，从 `assets[].digest` 提取 SHA256（去除 `sha256:` 前缀），从 `assets[].size` 提取文件大小。**digest 校验**：必须同时满足 64 位长度和纯 hex 字符才被接受；不满足则 sha256 置 `undefined`。`parseGitHubReleaseUrl()` 从 `downloadUrl` 解析出 owner/repo/tag/assetName。
  - **自动重试**：`withRetry()` 通用工具，使用指数退避（1s → 2s → 4s → 8s → 16s），最多重试 5 次（含首次共 6 次尝试）。失败结果不写入缓存。
  - **缓存**：`MarketService.resolvedAssets` Map（`{ sha256?: string; size: number; at: number }`），TTL 1 小时（`CACHE_TTL_MS`），与市场索引缓存一致。
  - **手动刷新**：GitHub Release 游戏的 size 右侧显示 🔄 刷新图标（`RefreshOutline`），点击可强制清除前端缓存后重新请求。`isAssetRefreshable()` 控制按钮出现条件。
  - **版本完整性分级**：前端使用 `getVersionIntegrity()` 返回五档结果：`"ok"`（一切正常）、`"missingSha256"`（缺 sha256，黄色警告标签）、`"missingSize"`（缺 size，黄色警告标签）、`"invalid"`（下载链接非法或非 GitHub 直链缺少 size，红色错误标签）、`null`（GitHub 直链 Asset 信息尚未解析，不显示标签）。`isVersionDownloadable()` 仅用于下载按钮禁用判断：非 GitHub 直链缺 size 时禁用。
  - **下载阶段**：`downloadAndInstall()` 按优先级获取 sha256/size：① 版本对象 → ② `resolvedAssets` 缓存 → ③ GitHub 直链实时 API。size 缺失则拒绝下载（`market_missing_size`），sha256 缺失仅跳过哈希校验不拒绝。

### 6.5 v4 更新、V1 转换与 V2 备份规范

- **更新检查**：更新与健康 IPC 只接受主窗口 sender；同一次运行的健康提交必须幂等。仅在一次健康启动完成 30 秒后检查一次；`updatePromptSuppressedForAppVersion` 与当前安装版本相同时自动检查完全跳过。可选的回滚抑制标记损坏时丢弃并记录，不能阻断核心健康提交。设置页手动检查不受抑制字段影响。禁止恢复 `electron-updater` 或周期检查定时器。
- **更新提交**：自动检查不下载。用户分别确认下载和安装；下载前必须从 Velopack 当前包缓存将唯一匹配的当前版本 full 包保存到 `.runtime/rollback-package`，下载完成后不允许回退到旧回滚点或再次猜测包来源。应用前阻止新任务、等待已有任务结束、刷新配置并关闭 SQLite，仅从这份已验证暂存包以临时目录事务式生成 `.runtime/rollback`。最终回滚点固定包含当前 full 包、SHA-256、`config.json`、完整 `db/` 和 `rollback-state.json`；完整落盘后才原子替换旧点，游戏文件不进入快照。
- **健康与自动回滚**：同一安装根同时只允许一个根启动器执行健康守护；并发启动仅转交参数，不得重复累计更新失败。根启动器以随机令牌等待配置解密、SQLite、游戏索引、IPC、本地 API 和渲染首屏全部健康，健康记录的进程 ID 必须与受守护子进程一致；同一待更新版本连续失败两次后才自动回滚。客户端不提供手动回退入口。健康升级成功后立即清理已消费的回滚点；自动回滚使用固定路径、严格清单、版本关系、full 包 SHA-256、数据恢复和恢复后健康检查，成功后消费回滚点并抑制回退版本的自动更新检查，手动检查更新不受影响。
- **版本展示**：构建脚本把 `package.json` 版本注入 Rust 安装器；每次健康启动后根启动器使用健康文件中的合法 SemVer 刷新卸载注册表 `DisplayVersion`，升级和回退后的 Windows“已安装的应用”版本必须与实际运行版本一致。
- **正式 V1 导入能力**：V1 是 v4 的长期只读导入协议，不是运行时兼容设计；转换代码物理隔离在 `src/main/services/backup/v1/`。V1 只读打开 `db/bz_games.db`，使用旧数据的既定密钥读取后生成全新 v4 数据库；其他数据库、WAL、SHM、零字节库和 `.imports` 全部忽略，转换目标 `db/` 最终只能有 `bz_games.db`。
- **V1 路径、Manifest 与字段同步**：旧内置绝对路径转换为 `builtin + relative_path`；外部路径使用与 v4 业务代码相同的根路径规范化规则，版本相对路径必须通过最终规范校验。所有游戏版本的明文 `game.json` 在转换期加密；旧账号/云同步会话、账号身份与 `githubToken` 不导入。凡修改既有配置、数据库、游戏库或 Manifest 字段，必须同步检查 V1 自动转换映射和固定样本。
- **V2 长期契约**：根目录严格且仅包含 `backup-manifest.json`、`config.json`、`games/`、`db/`，其中 `db/` 只能有 `bz_games.db`；`formatVersion=2` 且独立声明 `dataModelVersion`。只复制内置游戏库，外部库只保存数据库引用；归档中的配置必须清空账号会话、账号身份与 `githubToken`。完整格式见 `docs/BACKUP_BUNDLE_V2.md`。
- **完整替换与回滚**：导入前执行 CRC、严格 Manifest Schema、根白名单、路径穿越、ADS、硬/符号链接、目录联接/重解析点、特殊文件、归档炸弹和空间检查，并展示预览后二次确认。当前数据逐项移入回滚目录并分别记录“已备份旧项”和“已安装新项”；失败时只撤销实际安装的新项并原样恢复已备份旧项，回滚本身失败必须保留现场。新数据健康启动后才删除回滚目录，源 `.bzgames` 永不删除。
- **最终数据结构**：v4 运行时只接受最终配置、数据库与 Manifest 结构，不提供启动迁移、旧字段回退或双读分支。开发阶段每次结构定稿后必须用一次性维护程序手工调整当前 dev 数据并通过严格 Schema、数据库指纹、完整性和外键检查；该维护程序不得进入正式运行路径。
- **回归样本**：V1、V2 样本和 SHA-256 必须使用测试密钥和合成数据；V1 导入能力长期保留，4.x 不反向导出 V1。修改 V1 转换器、Schema、配置或 Manifest 契约后必须执行 `npm run test:v1-fixture`；该测试需同时覆盖旧独立数据库/WAL/SHM/`.imports` 丢弃、路径相对化、配置字段映射和明文 Manifest 加密。

### 6.6 建言献策、管理后台与配置安全

- **客户端边界**：`FeedbackService` 在主进程完成登录状态检查、图片读取、实际格式校验、multipart 构造、发行版中继令牌和必需 GitHub Bearer Token 注入；IPC 输入必须视为不可信并进行运行时校验。
- **开发模式 OAuth 回跳**：`process.defaultApp` 下注册 `bzgames://` 时必须使用 `process.execPath` 加 `path.resolve(process.argv[1])`，确保协议启动命令与 `electron-vite dev` 当前的 `electron.exe .` 应用入口一致。禁止改用构建产物 `out/main/index.js` 或手写 Windows 注册表命令，否则回跳会启动不同应用身份，无法通过 `second-instance` 把 OAuth URL 交给当前开发实例。打包模式继续直接注册当前 EXE。
- **反馈限制**：客户端反馈接口必须携带有效 GitHub Bearer Session，服务端以 GitHub 用户 ID 作为唯一限流身份并限制每 12 小时一次；待处理占位必须在读取 multipart 之前建立，并持续到成功提交或失败释放，防止并发穿透和限流前资源消耗。匿名提交路径和匿名限流状态均不存在。
- **上传安全**：服务端使用 busboy 流式解析，总请求、字段、文件数量及单文件大小都必须设限；图片必须同时校验声明 MIME、文件签名、容器结构和合理尺寸。MySQL 失败时尽力删除本次 GridFS 文件，临时目录始终清理。
- **会话错误协议**：受保护 HTTP 接口统一区分 `authenticated / missing / expired / invalid`。缺少令牌返回 `401 unauthorized`，过期返回 `401 session_expired`，无效、撤销或未知令牌返回 `401 session_invalid`，并同时返回稳定 `error` 与可读 `message`。过期会话默认保留 7 天以便识别，由 `AUTH_EXPIRED_SESSION_RETENTION_MS` 配置；普通 `unauthorized` 不触发客户端清理登录。
- **Portal RBAC 与认证边界**：`users.role` 是唯一角色来源，只允许 `player`、`creator`、`administrator`、`super_administrator`。服务端唯一授权模块把角色映射为固定 capability 集合，未知角色和未知能力默认拒绝；超级管理员拥有全部能力，管理员无用户角色调整、托管容量查看、系统监控和桌面客户端版本上传能力，创作者仅能托管自己的游戏且提交必须审核，玩家仅能进入欢迎页并管理自己的反馈。`GET /api/portal/v1/session` 只通过同源 Session Cookie 返回当前用户、能力集合和过期时间，Portal 接口拒绝 Bearer 或混合凭据，写接口还必须校验精确 Origin；前端只消费能力集合，不得按角色推断授权。桌面客户端接口只接受 Bearer Session，需要登录的接口仅校验会话有效性，不读取角色或 capability。OAuth 只负责创建默认玩家、刷新 GitHub 资料和建立会话，永不自动修改已有角色。角色修改只允许超级管理员操作其他非超级管理员，且不能授予超级管理员。GitHub OAuth 的 Portal 回跳只允许 `PORTAL_PUBLIC_URL` 同源 `/admin/` 路径，Cookie 使用 HttpOnly、SameSite=Lax。管理静态文件必须阻止路径穿越和符号链接越界，并发送 CSP、`nosniff`、拒绝 iframe 等安全响应头。
- **MySQL schema 生命周期**：仓库代码只在 `mysql-service.js` 的 `ensureSchema()` 中维护最新、完整、幂等的 `CREATE TABLE IF NOT EXISTS` 初始化结构，不加入 `ALTER TABLE`、启动迁移或自动补列逻辑。历史托管 JSON 只能在维护窗口使用一次性离线转换程序处理，不能进入运行时路径。已发布表新增或改变列、索引、约束时，必须在部署前检查线上实际结构，并通过单独审核的手工 SQL 完成变更；部署文档需说明目标结构、执行顺序、历史数据默认值、管理员角色赋值和验证查询。反馈图片继续复用现有 GridFS Bucket。
- **三端接口**：反馈提交成功仅返回 `{ ok, id }`；登录账号限流返回 `429 + error + retryAfterSeconds + resetAt`。玩家列表与详情只能访问自己的反馈，详情返回 `id/content/status/reply/imageCount/createdAt/updatedAt/images`，不得包含 `adminNote`；玩家图片和删除接口复用同一所有权规则。管理详情额外返回 `adminNote`，更新接受 `status/adminNote/reply`，管理删除需要对应 capability。所有字段以 `relay-server/API.md` 为准，服务端测试、客户端共享类型、预加载声明与管理端 TypeScript 类型必须同步。
- **托管接口对齐**：逻辑地址的 `gameId/version/role/encodedFileName` 规则、市场导出结构、Portal 请求/响应类型和服务端校验必须保持同一字段语义；托管游戏/版本元数据只接受 Schema 2，`gameManifest` override 只接受严格 V2，并在继承市场公共字段后满足完整 Manifest 的语言覆盖与字段关系。ZIP 内部 `game.json` 不由 Relay 解压或改写。新增、替换、审核、设为最新、删除及下载分别使用最小职责接口，写接口由服务端执行角色、所有权、状态机和精确 Origin 校验，不能依赖前端隐藏按钮。客户端仅可把规范逻辑地址改写到配置的 Relay `origin`。
- **令牌注入边界**：客户端附加 GitHub Token、Relay Token 或专用 Referer 前，必须使用 `URL` 解析并精确校验协议、`origin` 与允许的路径边界；禁止使用字符串 `startsWith` 判断可信主机，禁止向相似前缀域名、用户信息段、重定向后的第三方地址或任意市场 URL 发送凭据。
  - **配置唯一来源**：客户端真实关键配置只允许出现在被 Git 忽略的 `private-build.config.json`；服务端真实关键配置只允许存在于服务器的 systemd 主单元及 drop-in 配置，权限必须为 `root:root 0600`；管理端生产环境使用同源 `/api` 与 `/auth`，当前无环境字段。生产管理端构建产物只部署到 Nginx 的 `/var/www/campusmate/admin`，不把服务器真实配置回写仓库。
  - **生产公网入口唯一化**：Nginx 只监听公网 `:38090`，Relay 只监听本机 `127.0.0.1:38091`；Nginx 直接托管 `/admin/` 静态页面，并将当前 `/api/...`、`/auth/...`、房间 HTTP 接口和 `/ws/` WebSocket 转发到本机 Relay。不得保留旧服务前缀或 Relay `:38091` 的公网兼容入口。官网和客户端发行版下载统一使用 `/api/v1/releases/latest/download`；GitHub Actions 发布通过 SSH 调用服务器发布脚本，超级管理员桌面版本上传使用 `/api/admin/v1/desktop-release`，客户端托管游戏下载使用 `/api/v1/game-hosting/assets/*`，创作者上传使用 `/api/portal/v1/game-hosting/*`。
  - **桌面版本发布语义**：GitHub Actions 与管理端上传复用同一原子发布器和发布锁。Actions 对同版本同文件返回 `already_current`，对同版本不同 SHA-256 返回 `current_retained` 并保留当前文件，两者都按幂等成功结束；管理 API 必须把 `current_retained` 映射为 `409 desktop_release_version_conflict`，不得让页面把未发生的替换提示为发布成功。
- **示例同步**：`private-build.config.example.json` 与 `relay-server/bz-games-relay.service.example` 分别对应客户端和服务端。新增或删除配置字段后必须运行 `npm run check:config`（对应 `scripts/check-config-examples.mjs`，自动校验两端配置字段一致性、`.gitignore` 敏感路径覆盖及 SERVICE 示例完整性）。`bz-games-admin/` 是被父仓库忽略的独立仓库，其环境示例与测试由该仓库自行维护；禁止在任一源码或文档写入真实公网地址、管理员 ID、令牌、数据库连接串或 OAuth Secret。

---

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
   - `game.end` API：游戏主动调用，平台回复 `{success: true}`；房间状态和平台运行实体生命周期仍由 Host 的进程树或 Web 窗口生命周期驱动。
   - `game.report` API：游戏完成一局后提交战绩报告（纯文本 / 结构化 / 自定义 HTML），以系统消息形式展示在房间聊天中，由 `GameReportCard.vue` 渲染。
   - 游戏真正结束仅由 **Host 的平台托管运行实体结束** 触发：Native 进程树为空或 Web 窗口关闭/渲染进程终止后，`handleProcessExit` → `notifyRoomGameEnd` → state 变 `"waiting"` + 清空 `reconnectPlayerIds` + 广播 `room:game:end` + `room:state:sync`。客机 `RoomClient` 收到 `room:game:end` 后调用 `onGameStop` → `stop()` 结束所有客机运行实体。
   - 前端通过 `room:state:sync` 检测 `playing→waiting` 态变化来显示"游戏已结束"聊天消息。

### 7.2 联机完整流程

#### 房主（Host）操作流程

1. **创建房间**：
   - 用户在游戏详情页点击「创建房间」。
   - 主进程 `RoomServer` 启动，优先监听 `settings.defaultRoomPort`（默认 38080），端口占用时使用系统分配端口，并向客户端返回实际端口。
   - 房主平台内部 `RoomClient` 连接本地 `RoomServer`。
2. **选择对外入口**：
   - 房主可直接分享物理局域网 IP、虚拟局域网 IP 或用户自备 frp 公网地址。
   - 若开启官方服务器模式，平台额外向 relay-server 注册一个短地址供好友使用。
3. **玩家加入**：
   - 房主等待玩家连接。
   - 玩家列表实时更新（通过 `room:player:joined` / `room:state:sync`）。
4. **开始游戏**：
   - 当所有玩家准备就绪（Host 无需准备），房主点击「开始游戏」。
   - `RoomServer` 广播 `room:game:start`。
   - 房主平台启动本地游戏进程，注入 `BZ_IS_HOST=1` 和 `BZ_ROOM_ID`。

#### 玩家（Client）操作流程

1. **加入房间**：
   - 用户点击「加入房间」，输入房主提供的短地址、局域网地址、虚拟局域网地址或公网映射地址。
   - 若从房间发现页点击卡片加入，平台会先探测该房间是否设置密码。
   - 平台 `RoomClient` 尝试建立 WebSocket 连接。
   - 官方短地址模式先发送 `relay:join` 做前置准入校验；直连模式连接成功后直接发送 `room:join` 握手消息，携带 `gameId`、`gameVersion` 与可选密码。
2. **握手与同步**：
   - relay-server 会在短地址模式下先校验房间是否存在、房主是否在线、游戏是否已开始、房间是否已满、密码是否缺失或错误。
   - `RoomServer` 对所有直连/最终加入请求统一校验密码、游戏 ID、版本、黑名单和人数。
   - 收到 `room:join:ack` 表示加入成功，同步房间状态。
   - 若收到 `room:join:refused` 或 relay 错误，则提示对应原因（如“房间已满”“版本不匹配”“密码错误”）。
   - `RoomClient` 在异常断线后会自动重连并重新发送 `room:join`（最多 5 次，递增退避），减少临时网络抖动造成的掉房。
3. **准备与等待**：
   - 在房间内点击「准备」 (`room:ready`)。
   - 等待房主开始游戏。
4. **游戏启动**：
   - 收到 `room:game:start` 信号。
   - 平台自动启动本地游戏进程，注入 `BZ_IS_HOST=0` 和 `BZ_ROOM_ID`。

#### 客机重连流程

当客机游戏进程意外崩溃退出后：

1. **触发条件**：`GameManager.handleProcessExit` → `notifyRoomReconnectNeeded()` → `RoomClient` 发送 `room:player:reconnect-needed` 消息给 `RoomServer`。
2. **服务端标记**：`RoomServer.handleReconnectNeeded()` 校验 `state === "playing"` 且非 Host → 将 `playerId` 加入 `RoomInfo.reconnectPlayerIds` 数组 → 广播 `room:state:sync` 同步状态。
3. **客户端响应**：`useRoomStore.isReconnectMode` 为 `computed` 属性，从 `room.reconnectPlayerIds.includes(playerId)` 派生，**无需手动管理**。
4. **UI 表现**：客机玩家在房间页看到"重连"按钮，位于 Ready/Unready 按钮区域。
5. **点击重连**：`handleReconnect()` → `reconnectGame()` → `room.reconnect` IPC → 检查 `reconnectPlayerIds.includes(playerId)` → `gameManager.launch(gameId, version)`。
6. **房间状态**：Host 和其他客机维持当前流程，房间 `state` 保持 `"playing"`。客机运行实体结束不广播 `room:game:end`；Host 的平台托管运行实体结束触发 `notifyRoomGameEnd` → 清空 `reconnectPlayerIds`。
7. **重新加入**：重连成功的玩家通过 `room:join` 重新加入房间时，`RoomServer.handleJoin()` 将其从 `reconnectPlayerIds` 中移除。
8. **游戏侧适配**：重连的游戏进程是全新实例（运行时状态丢失），游戏需要调用 `room.getInfo()` 判断 `state`：若 `"playing"` 则是重连；若 `"waiting"` 则是正常启动。

### 7.3 Room Server / Room Client 消息协议

Room Server 与 Room Client 之间使用 **WebSocket + JSON** 通信。

#### 消息类型 (RoomMessageType)

| 类型                           | 方向             | 说明                                                                         |
| :----------------------------- | :--------------- | :--------------------------------------------------------------------------- |
| `room:join`                    | Client → Server  | 请求加入房间，携带玩家信息与游戏版本                                         |
| `room:join:ack`                | Server → Client  | 加入成功，返回房间信息                                                       |
| `room:join:refused`            | Server → Client  | 拒绝加入（房间满、版本不匹配等）                                             |
| `room:password:probe`          | Client → Server  | 加入前探测直连房间是否设置密码                                               |
| `room:password:probe:ack`      | Server → Client  | 返回直连房间的 `hasPassword` 与 `hostId`                                     |
| `room:player:joined`           | Server → All     | 通知有新玩家加入                                                             |
| `room:player:left`             | Server → All     | 通知玩家离开                                                                 |
| `room:player:ready`            | Client → Server  | 玩家标记为已准备                                                             |
| `room:player:unready`          | Client → Server  | 玩家取消准备                                                                 |
| `room:state:sync`              | Server → All     | 房间状态全量同步                                                             |
| `room:game:start`              | Server → All     | 游戏开始信号                                                                 |
| `room:game:end`                | Server → All     | 游戏结束信号（仅 Host 方触发，`notifyRoomGameEnd` / `RoomServer` broadcast） |
| `room:disbanded`               | Server → All     | 房间已解散                                                                   |
| `room:disconnected`            | Server → Client  | 连接断开通知                                                                 |
| `room:player:reconnect-needed` | Client → Server  | 客机游戏进程退出后通知服务端标记重连需求                                     |
| `room:kicked`                  | Server → Target  | 被踢通知（仅目标玩家）                                                       |
| `room:player:kicked`           | Server → All     | 广播玩家被踢事件                                                             |
| `room:chat`                    | Bidirectional    | 聊天消息（支持文字、语音、图片，文字和图片可打包为一条消息）                 |
| `room:chat:history:sync`       | Server → ChatWin | 主进程向聊天弹窗同步历史消息                                                 |
| `game:message:relay`           | Bidirectional    | 游戏内单播消息中继                                                           |
| `game:broadcast:relay`         | Bidirectional    | 游戏内广播消息中继                                                           |
| `game:message:ack`             | Bidirectional    | 可靠游戏消息的中继确认                                                       |

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

---

## 八、平台 API 规范（面向游戏开发者）

> 游戏进程通过连接 `ws://127.0.0.1:{BZ_API_PORT}` 使用平台能力。
> 连接后必须**立刻发送** **`auth`** **请求**，否则 **60 秒**后连接将被服务端主动断开。

### 8.1 连接与认证

```javascript
// 示例：Node.js 游戏连接平台（游戏侧代码）
const WebSocket = require("ws");

const port = process.env.BZ_API_PORT;
const token = process.env.BZ_API_TOKEN;

if (!port || !token) {
  console.error("[Game] 未检测到平台环境，请通过 BZ-Games 启动");
  process.exit(1);
}

const ws = new WebSocket(`ws://127.0.0.1:${port}`);

ws.on("open", () => {
  // Step 1：认证 (必须在连接后立即发送)
  send({
    id: crypto.randomUUID(),
    type: "request",
    action: "auth",
    payload: { token },
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

| Action               | Payload (Request)                                     | Returns (Response Payload)                           | Description                                                                                             |
| :------------------- | :---------------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `auth`               | `{ token: string }`                                   | `{ success: boolean, player: { id, name, isHost } }` | **必须**。连接后首个请求，用于鉴权。                                                                    |
| `player.getInfo`     | -                                                     | `{ id, name }`                                       | 获取当前玩家信息。                                                                                      |
| `room.getInfo`       | -                                                     | `{ id, hostId, players, ... }`                       | 获取当前房间信息（若在房间中）。                                                                        |
| `game.ready`         | -                                                     | `{ acknowledged: true }`                             | 告知平台游戏已准备就绪（平台会广播给其他玩家）。                                                        |
| `game.end`           | -                                                     | `{ success: true }`                                  | 告知平台游戏结束（通常由 Host 调用）。                                                                  |
| `game.report`        | `GameReportPayload`（联合类型，见 `report.types.ts`） | `{ success: true }`                                  | 提交战绩报告。支持纯文本、结构化（计分板/对决）和自定义 HTML 三种模式，报告以系统消息展示在房间聊天中。 |
| `message.send`       | `{ to?: string, targetPlayerId?: string, ... }`       | `{ success: true }`                                  | 发送单播消息给指定玩家（必须包含 `to` 或 `targetPlayerId` 之一）。                                      |
| `message.broadcast`  | `{ ... }`                                             | `{ success: true }`                                  | 广播消息给所有玩家（平台中继）。                                                                        |
| `achievement.list`   | -                                                     | `[{ id, title, description, unlocked, unlockedAt }]` | 获取当前游戏版本的成就列表及解锁状态。                                                                  |
| `achievement.unlock` | `{ achievementId, playerId }`                         | `{ success: true, new: boolean }`                    | 解锁成就。`playerId` 必须为当前玩家 ID。                                                                |
| `stats.report`       | `Record<string, number>`                              | `{ success: true }`                                  | 上报统计数据；平台根据 Manifest 配置按增量/全量写入。                                                   |

### 8.3 v2 API 列表

v2 是增强层，适合实时同步、频道过滤和可靠确认。游戏应先读取 `auth` 响应中的 `capabilities` 再使用 v2 API。

| Action                | Payload (Request)                           | Returns (Response Payload)              | Description                                         |
| :-------------------- | :------------------------------------------ | :-------------------------------------- | :-------------------------------------------------- |
| `message.publish`     | `{ channel?, seq?, reliable?, data, ... }`  | `{ success: true }`                     | 频道化广播消息，适合实时状态/输入流。               |
| `message.batch`       | `{ channel?, messages: [] }`                | `{ success: true }`                     | 批量广播消息，平台拆分为多条 `event.message` 投递。 |
| `message.subscribe`   | `{ channel?: string, channels?: string[] }` | `{ success: true, channels: string[] }` | 订阅指定消息频道。                                  |
| `message.unsubscribe` | `{ channel?: string, channels?: string[] }` | `{ success: true, channels: string[] }` | 取消订阅指定消息频道。                              |

重连恢复或最新状态缓存由游戏自身协议实现。

### 8.4 事件列表 (Event)

平台会主动推送以下事件给游戏进程：

- `event.message`: 收到其他玩家的消息（Payload 至少包含 `{ senderId, messageId, sentAt, ... }`）
- `event.messageAck`: 可靠消息中继确认（Payload 包含 `{ messageId, senderId, to, sentAt }`）
- `event.playerJoined`: 有新玩家加入房间
- `event.playerLeft`: 有玩家离开房间
- `event.gameEnd`: 游戏被强制结束（如房间解散）
