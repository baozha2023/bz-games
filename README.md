# BZ-Games 游戏平台

[![Electron](https://img.shields.io/badge/Electron-v43+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

简体中文 | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md)

**BZ-Games** 是一个**本地优先的 Windows 游戏平台**，专为 Windows 设计。它允许用户导入本地游戏，并通过内置的 P2P 联机房间系统与好友进行多人游戏。支持局域网自动发现、用户自备 frp 直连、官方中继短地址三种联机入口，并提供可选的 GitHub OAuth 账号登录。

## ✨ 核心特性

- **📂 开放式游戏库**：支持导入任意符合规范的本地游戏，自动管理多版本共存与切换。
- **🔌 本地优先数据**：配置和 SQLite 数据加密存储于本地，无需注册即可使用。
- **🎮 统一联机大厅**：内置房间系统（创建/加入/准备/聊天/踢人/断线重连），游戏只需接入 Game API 即可获得完整联机能力。
- **🌐 多入口联机**：支持局域网自动发现、用户自备 frp 直连、官方 Relay Server 短地址中继。房间发现页按物理局域网 / 虚拟局域网（EasyTier）/ 服务器三栏分类。
- **👤 GitHub 账号**：可选 GitHub OAuth 登录用于社区身份、反馈、昵称同步与在线状态，不上传平台配置或本地数据库。
- **💾 长期本地备份**：设置页可导出/导入 `.bzgames` V2，并永久支持导入 v3.4.2 生成的 V1 迁移包；导入为完整替换且不会删除源备份。
- **🔄 安全增量更新**：Velopack 管理 `.runtime` 程序区，根目录 Rust 启动器负责健康检查和失败回滚，`config.json`、`games/`、`db/` 始终位于更新区之外。
- **🏪 游戏市场**：内置两级市场架构，支持多来源社区游戏浏览、下载与一键安装。下载任务支持进度追踪、暂停、恢复、取消与悬浮球提醒。
- **🏆 成就与统计系统**：游戏可自定义成就列表与统计指标，平台自动追踪解锁。支持日历热力图、单日/累计/连续游玩统计，可一键分享为图片。
- **🪙 经济系统**：签到领 BZ 币，累计游玩时长自动奖励。头像框解锁与装备、昵称颜色/字体/特效个性化装扮。
- **🚀 进程管理**：自动启动/关闭游戏进程，处理异常退出与崩溃恢复。
- **🎨 游戏 API**：提供本地 Game API 服务（V1/V2 协议），游戏可通过 HTTP 读取存档、上报统计与成就。
- **🌍 国际化**：平台、Game Manifest V2 与市场 Schema 2 支持简体中文、繁体中文、英文、日文和德文；游戏名、简介、标签、成就、统计和版本说明统一按语言完整回退。

## 📸 界面预览

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="游戏库" width="405">
  <img src="docs/screenshots/game-market.png" alt="游戏市场" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="成就系统" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="游戏统计" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="个性化装扮" width="405">
  <img src="docs/screenshots/settings.png" alt="设置页" width="405">
</p>

## 🛠️ 技术栈

- **Core**: Electron 43, TypeScript 5
- **Frontend**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **Build & Update**: Electron-Vite, Electron-Builder, Velopack 1.2.0, Rust（两页 Windows 安装向导会在所选父目录下创建 `BZ-Games`）
- **Database**: better-sqlite3-multiple-ciphers（ChaCha20 加密 SQLite）
- **Config**: electron-store（加密 JSON）
- **Communication**: WebSocket（ws 库）, Electron IPC
- **Archive**: 7zip-bin / 7za（7Z / ZIP）
- **Image**: html2canvas（热力图分享渲染）
- **Backup**: `.bzgames` V2 长期导入导出；永久支持 v3.4.2 V1 只读导入

## 🚀 快速开始

### 环境要求

- Node.js 20+
- npm 10+
- Rust stable（含 MSVC 工具链）
- .NET 10 Runtime 与 Velopack CLI 1.2.0
- Windows 10/11 x64

### 安装依赖

```bash
npm install
```

### 开发模式

启动开发服务器（包含主进程与渲染进程热重载）：

```bash
npm run dev
```

### 构建生产版本

构建适用于 Windows 的安装包与 Velopack 更新包：

```bash
npm run build:win
```

构建产物将位于 `dist` 目录。

## 📁 项目结构

```
bz-games/
├── native/bootstrap/     # Rust 根启动器与安装向导
├── resources/             # 应用图标（icon.png/icon.ico）、占位图等静态资源
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts          # 入口：窗口管理、应用生命周期
│   │   ├── window.ts         # 悬浮球窗口
│   │   ├── chat-window.ts    # 聊天弹出窗口
│   │   ├── ipc/              # IPC 处理器（game / room / market / stats / system / storage）
│   │   ├── services/         # 核心业务
│   │   │   ├── game/            # GameManager、GameLoader、GameAPI（V1/V2）
│   │   │   ├── room/            # RoomServer、RoomClient、局域网/UDP/中继发现
│   │   │   ├── market/          # 市场下载与安装任务管理
│   │   │   ├── storage/         # 严格 v4 加密 SQLite（游戏库、版本、会话、成就、统计）
│   │   │   ├── backup/          # `.bzgames` V2 与隔离的 V1 转换器
│   │   │   └── system/          # Account、Velopack Update、Health、Notification
│   │   └── utils/            # 日志、文件工具、路径处理
│   ├── preload/           # Preload 脚本（game.ts / index.ts + API 桥接）
│   ├── renderer/          # 渲染进程（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # 页面（Library / Market / Room / Statistics / Settings 等）
│   │   │   ├── components/    # 公共组件（game / room / settings / heatmap）
│   │   │   ├── stores/        # Pinia（game / room / settings）
│   │   │   ├── composables/   # 组合式函数
│   │   │   ├── locales/       # 5 语言国际化
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # 前后端共享（类型、常量、IPC 通道、协议）
├── relay-server/          # 官方中继服务器（独立部署）
└── electron.vite.config.ts
```

> 管理后台已拆分为独立仓库，不属于本仓库工作树。

> 市场索引数据由独立的 [bz-games-market](https://github.com/baozha2023/bz-games-market) 仓库维护并同步到 OSS。客户端只接受严格数值 `schemaVersion: 2`，并始终以稳定 `marketId` 访问市场。官方 `market.json` 优先从 OSS 单次读取（5 秒超时），失败后切换 GitHub（8 秒超时，仅网络错误、超时、HTTP 408/429/5xx 重试一次）；同一响应同时生成一级目录和官方二级索引。第三方市场直接读取各自 GitHub Raw 地址，并采用相同的 GitHub 有界重试策略。

更多开发规范请参考 `CLAUDE.md`，游戏开发者指南请参考 `DEVELOPER_GUIDE.md`，Game API 文档见 `docs/GAME_API_V1_V2_REFERENCE.md`，GitHub Actions 最新安装包部署见 `docs/GITHUB_ACTIONS_RELEASE_DEPLOY.md`，未来规划见 `docs/ROADMAP.md`。
