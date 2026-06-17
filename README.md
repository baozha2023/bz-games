# BZ-Games 游戏平台

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

简体中文 | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md) | [文言文](./README.lzh.md)

**BZ-Games** 是一个**本地优先的 Windows 游戏平台**，专为 Windows 设计。它允许用户导入本地游戏，并通过内置的 P2P 联机房间系统与好友进行多人游戏。支持局域网发现、用户自备 frp 直连、官方中继短地址三种联机入口，并提供 GitHub OAuth 登录与云端数据同步服务。

## ✨ 核心特性

- **📂 开放式游戏库**：支持导入任意符合规范的本地游戏，自动管理游戏版本与文件。
- **🔌 本地优先数据**：所有数据存储在本地，配置文件加密保存，无需注册云端账户。可选 GitHub OAuth 登录实现云端同步。
- **🎮 统一联机大厅**：内置房间系统（创建/加入/准备/聊天/踢人/断线重连），游戏只需接入本地 Game API 即可获得完整联机能力。
- **🌐 多入口联机**：支持局域网自动发现、用户自备 frp 直连、官方 Relay Server 短地址中继三种入口，按场景自由切换。房间发现页按物理局域网/虚拟局域网/服务器三栏分类。
- **☁️ GitHub 登录与云同步**：通过 GitHub OAuth 授权登录，支持 `config.json` 和 `play_sessions.db` 上传至云端、下载同步回本地，含进度条与哈希校验。
- **🏪 游戏市场**：内置游戏市场，支持多来源社区游戏浏览、下载与安装，下载任务支持进度、暂停、恢复、取消与悬浮球提醒，安装自动校验和导入。
- **🏆 成就与统计系统**：每个游戏可定义成就列表与统计数据，平台自动追踪并展示。支持日历热力图与战绩报告。
- **🪙 经济系统**：签到领 BZ 币，累计游玩时长自动奖励。头像框解锁与装备、昵称颜色/字体/特效个性化。
- **🚀 进程管理**：自动启动/关闭游戏进程，处理异常退出。
- **🔄 版本管理**：支持同一游戏的多版本共存与切换。
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

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (Local JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC
- **Archive**: extract-zip (ZIP), 7zip-bin / 7za (7Z)
- **Update**: electron-updater (GitHub Releases)

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
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
├── games/                 # 游戏数据存储目录 (Portable Mode)
├── src/
│   ├── main/              # Electron 主进程 (Node.js)
│   │   ├── services/      # 核心业务逻辑 (GameManager, RoomServer, CloudSyncService 等)
│   │   └── ipc/           # IPC 通信处理器
│   ├── preload/           # Preload 脚本 (暴露安全 API)
│   ├── renderer/          # 渲染进程 (Vue 3 UI)
│   └── shared/            # 前后端共享类型定义
├── relay-server/          # 官方中继服务器（房间中继 / GitHub OAuth / 云同步）
├── resources/             # 应用图标等静态资源
└── electron.vite.config.ts
```

> 市场索引数据由独立的 [bz-games-market](https://github.com/baozha2023/bz-games-market) 仓库维护，平台通过两级市场架构拉取展示。

更多细节请参考 `CLAUDE.md` 中的开发规范。
