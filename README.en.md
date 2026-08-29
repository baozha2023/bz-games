# BZ-Games Game Platform

[![Electron](https://img.shields.io/badge/Electron-v40+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

[简体中文](./README.md) | English | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md)

**BZ-Games** is a **local-first Windows game platform** designed for Windows. It allows users to import local games and play multiplayer with friends through the built-in P2P room system. It supports LAN discovery, user-provided frp direct connections, and official relay short addresses, with optional GitHub OAuth login.

## ✨ Core Features

- **📂 Open Game Library**: Import any spec-compliant local games with automatic multi-version management.
- **🔌 Local-First Data**: Configuration and SQLite data are encrypted and stored locally; no account is required.
- **🎮 Unified Online Lobby**: Built-in room system (create/join/ready/chat/kick/reconnect). Games only need to integrate with the local Game API for full multiplayer capability.
- **🌐 Multi-Entry Connectivity**: LAN auto-discovery, user-provided frp direct connection, and official Relay Server short addresses. Room discovery page organized by physical LAN / virtual LAN (EasyTier) / server.
- **👤 GitHub Account**: Optional OAuth login provides community identity, feedback, nickname synchronization, and online presence without uploading platform configuration or the local database.
- **🏪 Game Market**: Built-in two-tier market for browsing and installing community games from multiple sources. Download tasks support progress tracking, pause, resume, cancel, and floating ball notifications.
- **🏆 Achievements & Statistics**: Games define achievement lists and statistics — automatically tracked by the platform. Calendar heatmap with daily/cumulative/consecutive stats, one-click share as image.
- **🪙 Economy System**: Daily check-in for BZ Coins, automatic rewards for cumulative playtime. Avatar frame unlocks, nickname color/font/effect personalization.
- **🚀 Process Management**: Auto start/stop game processes with crash and abnormal exit handling.
- **🎨 Game API**: Local Game API service (V1/V2 protocols) for games to read saves, report stats, and unlock achievements via HTTP.
- **🌍 Internationalization**: The platform, Game Manifest V2, and Market Schema 2 support Simplified Chinese, Traditional Chinese, English, Japanese, and German, with whole-locale fallback for game metadata, tags, achievements, statistics, and release text.

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="Game Library" width="405">
  <img src="docs/screenshots/game-market.png" alt="Game Market" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="Achievements" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="Game Statistics" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="Personalization" width="405">
  <img src="docs/screenshots/settings.png" alt="Settings" width="405">
</p>

## 🛠️ Tech Stack

- **Core**: Electron 40, TypeScript 5
- **Frontend**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **Build**: Electron-Vite, Electron-Builder
- **Database**: better-sqlite3-multiple-ciphers (ChaCha20-encrypted SQLite)
- **Config**: electron-store (encrypted JSON)
- **Communication**: WebSocket (ws library), Electron IPC
- **Archive**: 7zip-bin / 7za (7Z / ZIP)
- **Image**: html2canvas (heatmap share rendering)
- **Migration**: `.bzgames` v1 (uncompressed 7z container); v3.4.2 is the final NSIS bridge release

## 🚀 Quick Start

### Requirements

- Node.js 20+
- npm 10+
- Rust stable (including the MSVC toolchain)
- .NET 10 Runtime and Velopack CLI 1.2.0
- Windows 10/11 x64

### Install Dependencies

```bash
npm install
```

### Development Mode

Start the dev server (with hot reload for main and renderer processes):

```bash
npm run dev
```

### Build for Production

Build the Windows installer and Velopack update package:

```bash
npm run build:win
```

Build artifacts will be located in the `dist` directory.

## 📁 Project Structure

```
bz-games/
├── resources/             # App icons, placeholder images, and static resources
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts          # Entry: window management, app lifecycle
│   │   ├── window.ts         # Floating ball window
│   │   ├── chat-window.ts    # Chat pop-out window
│   │   ├── ipc/              # IPC handlers (game / room / market / stats / system / storage)
│   │   ├── services/         # Core business logic
│   │   │   ├── game/            # GameManager, GameLoader, GameAPI (V1/V2)
│   │   │   ├── room/            # RoomServer, RoomClient, LAN/UDP/relay discovery
│   │   │   ├── market/          # Market download & install task management
│   │   │   ├── storage/         # Encrypted SQLite (games, versions, sessions, achievements, statistics)
│   │   │   └── system/          # Account, Update, Health, Notification
│   │   └── utils/            # Logging, file utils, path handling
│   ├── preload/           # Preload scripts (game.ts / index.ts + API bridge)
│   ├── renderer/          # Renderer process (Vue 3)
│   │   ├── src/
│   │   │   ├── views/         # Pages (Library / Market / Room / Statistics / Settings etc.)
│   │   │   ├── components/    # Shared components (game / room / settings / heatmap)
│   │   │   ├── stores/        # Pinia stores (game / room / settings)
│   │   │   ├── composables/   # Composables
│   │   │   ├── locales/       # 5-language i18n
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # Shared between main & renderer (types, constants, IPC channels, protocols)
├── relay-server/          # Official relay server (standalone deployment)
├── bz-games-admin/        # Admin panel (feedback, forum, hosting, users and operations)
└── electron.vite.config.ts
```

> Market index data is maintained in the independent [bz-games-market](https://github.com/baozha2023/bz-games-market) repository, distributed via a two-tier market architecture.

For more details: development guidelines `CLAUDE.md`, game developer guide `DEVELOPER_GUIDE.md`, Game API docs `docs/GAME_API_V1_V2_REFERENCE.md`, roadmap `docs/ROADMAP.md`.
