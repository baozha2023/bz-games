# BZ-Games 嬉游台

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [繁體中文](./README.zh-TW.md) | 文言文

**BZ-Games** 者，**以本机为本之 Windows 嬉游台**也，专为 Windows 而作。允用者汇入本机之嬉，藉内置之 P2P 联机房舍，与友朋共嬉。可通局域网自觅、用者自备 frp 直连、官府中继短址三径而入，兼有 GitHub OAuth 登入及云端同步之能。

## ✨ 精髓

- **📂 无羁嬉库**：凡嬉合式者，皆可汇入，版本文档自为理之。
- **🔌 本机为上**：诸般资料咸存本机，秘文加密而藏，不假云端账号。亦可 GitHub OAuth 登入，以成云端同步。
- **🎮 合辙联机厅**：内置房舍之制（创房／入房／备战／言语／逐客／断而复续），嬉者但接本地嬉界面，即可得全联机之能。
- **🌐 三径联机**：局域网自觅、自备 frp 直达、官府中继伺服短址中转，随境而迁。觅房之页以实体局域网／虚局域网／伺服三栏而别。
- **☁️ GitHub 登入云同步**：假 GitHub OAuth 授权而入，可将 `config.json` 及 `play_sessions.db` 上传至云、下载归本机，附进度条与杂凑校验。
- **🏪 嬉市**：内置嬉市，可览多源社群嬉作而下之、装之，下载之功可进度、可暂、可续、可废，悬浮球以警，装时自验而汇。
- **🏆 功绩统计**：每嬉可定功绩之录与统计之数，嬉游台自为追踪展示。可观日历热力图及战绩之报。
- **🪙 泉货之制**：每日签到得 BZ 币，累嬉时长自获赏赐。头像之框可解锁而佩，昵称之色、字、效皆可自定。
- **🚀 程控之术**：嬉程启闭自为之，异变退出亦为处置。
- **🔄 版辖之术**：同嬉多版可共存而切替。
- **🌍 万邦语**：通简体中文、繁体中文、英文、日文、德文、文言文。

## 📸 览图

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="嬉库" width="405">
  <img src="docs/screenshots/game-market.png" alt="嬉市" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="功绩" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="嬉统计" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="个性装扮" width="405">
  <img src="docs/screenshots/settings.png" alt="设定" width="405">
</p>

## 🛠️ 工技

- **枢机**: Electron, TypeScript
- **前台**: Vue 3, Naive UI, Pinia, Vue Router
- **构策**: Electron-Vite, Electron-Builder
- **储法**: electron-store (本机 JSON)
- **通讯**: WebSocket (房舍伺服／客端), Electron IPC
- **解囊**: extract-zip (ZIP), 7zip-bin / 7za (7Z)
- **新之**: electron-updater (GitHub Releases)

## 🚀 速启

### 境求

- Node.js 18+
- pnpm 8+
- Windows 10/11 x64

### 装诸依

```bash
pnpm install
```

### 开发态

启开发伺服（主程与渲程皆可热更）：

```bash
pnpm dev
```

### 产制构建

构 Windows 装包与免装包：

```bash
pnpm build:win
```

构物在 `dist` 录中。

## 📁 项目之构

```
bz-launcher/
├── games/                 # 嬉资存录 (携行态)
├── src/
│   ├── main/              # Electron 主程 (Node.js)
│   │   ├── services/      # 枢机商务逻辑 (GameManager, RoomServer, CloudSyncService 等)
│   │   └── ipc/           # IPC 通讯处置
│   ├── preload/           # Preload 策本 (露安全 API)
│   ├── renderer/          # 渲程 (Vue 3 UI)
│   └── shared/            # 前后共享型别之定
├── relay-server/          # 官府中继伺服（房中继／GitHub OAuth／云同步）
├── resources/             # 应用图示等静物
└── electron.vite.config.ts
```

> 市集索引之资由独立之 [bz-games-market](https://github.com/baozha2023/bz-games-market) 仓所辖，嬉游台假二级市集之构以取展之。

详参 `CLAUDE.md` 中之开发绳墨。
