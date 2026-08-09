# BZ-Games 游戏平台

[![Electron](https://img.shields.io/badge/Electron-v43+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

简体中文 | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md) | [文言文](./README.lzh.md)

**BZ-Games** 是一个**本地优先的 Windows 游戏平台**，专为 Windows 设计。它允许用户导入本地游戏，并通过内置的 P2P 联机房间系统与好友进行多人游戏。支持局域网自动发现、用户自备 frp 直连、官方中继短地址三种联机入口，并提供 GitHub OAuth 登录与云端数据同步服务。

## ✨ 核心特性

- **📂 开放式游戏库**：支持导入任意符合规范的本地游戏，自动管理多版本共存与切换。
- **🔌 本地优先数据**：配置加密存储于本地，无需注册即可使用。可选 GitHub OAuth 登录实现云端同步。
- **🎮 统一联机大厅**：内置房间系统（创建/加入/准备/聊天/踢人/断线重连），游戏只需接入 Game API 即可获得完整联机能力。
- **🌐 多入口联机**：支持局域网自动发现、用户自备 frp 直连、官方 Relay Server 短地址中继。房间发现页按物理局域网 / 虚拟局域网（EasyTier）/ 服务器三栏分类。
- **☁️ GitHub 登录与云同步**：通过 GitHub OAuth 授权，支持 `config.json`、`bz_games.db` 云端上传/下载同步，含进度条与哈希校验。
- **🏪 游戏市场**：内置两级市场架构，支持多来源社区游戏浏览、下载与一键安装。下载任务支持进度追踪、暂停、恢复、取消与悬浮球提醒。
- **🏆 成就与统计系统**：游戏可自定义成就列表与统计指标，平台自动追踪解锁。支持日历热力图、单日/累计/连续游玩统计，可一键分享为图片。
- **🪙 经济系统**：签到领 BZ 币，累计游玩时长自动奖励。头像框解锁与装备、昵称颜色/字体/特效个性化装扮。
- **🚀 进程管理**：自动启动/关闭游戏进程，处理异常退出与崩溃恢复。
- **🎨 游戏 API**：提供本地 Game API 服务（V1/V2 协议），游戏可通过 HTTP 读取存档、上报统计与成就。
- **🌍 国际化**：支持简体中文、繁体中文、英文、日文、德文、文言文。

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
- **Build**: Electron-Vite, Electron-Builder
- **Database**: better-sqlite3-multiple-ciphers（ChaCha20 加密 SQLite）
- **Config**: electron-store（加密 JSON）
- **Communication**: WebSocket（ws 库）, Electron IPC
- **Archive**: 7zip-bin / 7za (7Z), adm-zip (ZIP)
- **Image**: html2canvas（热力图分享渲染）
- **Update**: electron-updater (GitHub Releases)

## 🚀 快速开始

### 环境要求

- Node.js 20+
- pnpm 9+
- Windows 10/11 x64

### 安装依赖

```bash
pnpm install
```

### 开发模式

启动开发服务器（包含主进程与渲染进程热重载）：

```bash
pnpm dev
```

### 构建生产版本

构建适用于 Windows 的安装包与免安装包：

```bash
pnpm build:win
```

构建产物将位于 `dist` 目录。

## 📁 项目结构

```
bz-launcher/
├── resources/             # 应用图标、占位图等静态资源
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
│   │   │   ├── storage/         # 加密 SQLite（游戏、版本、会话、成就、统计）
│   │   │   └── system/          # CloudSync、Update、Notification
│   │   └── utils/            # 日志、文件工具、路径处理
│   ├── preload/           # Preload 脚本（game.ts / index.ts + API 桥接）
│   ├── renderer/          # 渲染进程（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # 页面（Library / Market / Room / Statistics / Settings 等）
│   │   │   ├── components/    # 公共组件（game / room / settings / heatmap）
│   │   │   ├── stores/        # Pinia（game / room / settings）
│   │   │   ├── composables/   # 组合式函数
│   │   │   ├── locales/       # 6 语言国际化
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # 前后端共享（类型、常量、IPC 通道、协议）
├── relay-server/          # 官方中继服务器（独立部署）
├── bz-games-admin/        # 管理后台（反馈审核）
└── electron.vite.config.ts
```

> 市场索引数据由独立的 [bz-games-market](https://github.com/baozha2023/bz-games-market) 仓库维护，平台通过两级市场架构拉取展示。

更多开发规范请参考 `CLAUDE.md`，游戏开发者指南请参考 `DEVELOPER_GUIDE.md`，Game API 文档见 `docs/GAME_API_V1_V2_REFERENCE.md`，未来规划见 `docs/ROADMAP.md`。
