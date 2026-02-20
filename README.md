# BZ-Games 游戏平台

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

**BZ-Games** 是一个**无服务器本地游戏平台**，专为 Windows 设计。它允许用户导入本地游戏，并通过内置的 P2P 联机房间系统与好友进行多人游戏，无需依赖任何第三方游戏服务器。

## ✨ 核心特性

- **📂 开放式游戏库**：支持导入任意符合规范的本地游戏，自动管理游戏版本与文件。
- **🔌 无服务器架构**：所有数据存储在本地，不依赖云端账户系统。
- **🎮 统一联机大厅**：内置房间系统（创建/加入/准备），游戏本身无需实现复杂的网络大厅逻辑。
- **🌐 灵活的内网穿透**：通过标准 TCP 端口暴露房间，支持 SakuraFrp 等任意内网穿透工具。
- **🚀 进程管理**：自动启动/关闭游戏进程，处理异常退出。
- **🔄 版本管理**：支持同一游戏的多版本共存与切换。

## 🛠️ 技术栈

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (Local JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC

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
│   │   ├── services/      # 核心业务逻辑 (GameManager, RoomServer, etc.)
│   │   └── ipc/           # IPC 通信处理器
│   ├── renderer/          # 渲染进程 (Vue 3 UI)
│   └── shared/            # 前后端共享类型定义
└── electron.vite.config.ts
```

更多细节请参考 `CLAUDE.md` 中的开发规范。
