# BZ-Games Game Platform

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

[中文](./README.md) | English | [日本語](./README.ja.md)

**BZ-Games** is a **serverless local game platform** designed for Windows. It allows users to import local games and play multiplayer with friends through the built-in P2P room system, without relying on any third-party game servers.

## ✨ Core Features

- **📂 Open Game Library**: Supports importing any locally compliant games, with automatic version and file management.
- **🔌 Serverless Architecture**: All data is stored locally, independent of any cloud account system.
- **🎮 Unified Online Lobby**: Built-in room system (create/join/ready), so games don't need to implement complex network lobby logic themselves.
- **🌐 Flexible NAT Traversal**: Exposes rooms via standard TCP ports, compatible with any NAT traversal tools such as SakuraFrp.
- **🚀 Process Management**: Automatically launches/closes game processes and handles abnormal exits.
- **🔄 Version Management**: Supports coexistence and switching of multiple versions of the same game.

## 🛠️ Tech Stack

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (Local JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC

## 🚀 Quick Start

### Requirements

- Node.js 18+
- pnpm 8+
- Windows 10/11 x64

### Install Dependencies

```bash
pnpm install
```

### Development Mode

Start the dev server (with hot reload for main and renderer processes):

```bash
pnpm dev
```

### Build for Production

Build the Windows installer and portable package:

```bash
pnpm build:win
```

Build artifacts will be located in the `dist` directory.

## 📁 Project Structure

```
bz-launcher/
├── games/                 # Game data storage directory (Portable Mode)
├── src/
│   ├── main/              # Electron main process (Node.js)
│   │   ├── services/      # Core business logic (GameManager, RoomServer, etc.)
│   │   └── ipc/           # IPC communication handlers
│   ├── renderer/          # Renderer process (Vue 3 UI)
│   └── shared/            # Shared type definitions for main & renderer
└── electron.vite.config.ts
```

For more details, refer to the development guidelines in `CLAUDE.md`.
