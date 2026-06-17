# BZ-Games 遊戲平台

[![Electron](https://img.shields.io/badge/Electron-v28+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | 繁體中文 | [文言文](./README.lzh.md)

**BZ-Games** 是一個**本地優先的 Windows 遊戲平台**，專為 Windows 設計。它允許使用者匯入本地遊戲，並透過內建的 P2P 聯機房間系統與好友進行多人遊戲。支援區域網路發現、使用者自備 frp 直連、官方中繼短位址三種聯機入口，並提供 GitHub OAuth 登入與雲端資料同步服務。

## ✨ 核心特性

- **📂 開放式遊戲庫**：支援匯入任意符合規範的本地遊戲，自動管理遊戲版本與檔案。
- **🔌 本地優先資料**：所有資料儲存在本地，設定檔加密儲存，無需註冊雲端帳戶。可選 GitHub OAuth 登入實現雲端同步。
- **🎮 統一聯機大廳**：內建房間系統（建立／加入／準備／聊天／踢人／斷線重連），遊戲只需接入本地 Game API 即可獲得完整聯機能力。
- **🌐 多入口聯機**：支援區域網路自動發現、使用者自備 frp 直連、官方 Relay Server 短位址中繼三種入口，按場景自由切換。房間發現頁按實體區域網路／虛擬區域網路／伺服器三欄分類。
- **☁️ GitHub 登入與雲同步**：透過 GitHub OAuth 授權登入，支援 `config.json` 和 `play_sessions.db` 上傳至雲端、下載同步回本地，含進度條與雜湊校驗。
- **🏪 遊戲市場**：內建遊戲市場，支援多來源社群遊戲瀏覽、下載與安裝，下載任務支援進度、暫停、恢復、取消與懸浮球提醒，安裝自動校驗和匯入。
- **🏆 成就與統計系統**：每個遊戲可定義成就列表與統計資料，平台自動追蹤並展示。支援日曆熱力圖與戰績報告。
- **🪙 經濟系統**：簽到領 BZ 幣，累計遊玩時長自動獎勵。頭像框解鎖與裝備、暱稱顏色／字型／特效個性化。
- **🚀 程序管理**：自動啟動／關閉遊戲程序，處理異常退出。
- **🔄 版本管理**：支援同一遊戲的多版本共存與切換。
- **🌍 國際化**：支援簡體中文、繁體中文、英文、日文、德文、文言文。

## 📸 介面預覽

<p align="center">
  <img src="docs/screenshots/game-library.png" alt="遊戲庫" width="405">
  <img src="docs/screenshots/game-market.png" alt="遊戲市場" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/achievements.png" alt="成就系統" width="405">
  <img src="docs/screenshots/game-statistics.png" alt="遊戲統計" width="405">
</p>
<p align="center">
  <img src="docs/screenshots/personalization.png" alt="個性化裝扮" width="405">
  <img src="docs/screenshots/settings.png" alt="設定頁" width="405">
</p>

## 🛠️ 技術棧

- **Core**: Electron, TypeScript
- **Frontend**: Vue 3, Naive UI, Pinia, Vue Router
- **Build**: Electron-Vite, Electron-Builder
- **Storage**: electron-store (Local JSON)
- **Communication**: WebSocket (Room Server/Client), Electron IPC
- **Archive**: extract-zip (ZIP), 7zip-bin / 7za (7Z)
- **Update**: electron-updater (GitHub Releases)

## 🚀 快速開始

### 環境要求

- Node.js 18+
- pnpm 8+
- Windows 10/11 x64

### 安裝依賴

```bash
pnpm install
```

### 開發模式

啟動開發伺服器（包含主程序與渲染程序熱重載）：

```bash
pnpm dev
```

### 構建生產版本

構建適用於 Windows 的安裝包與免安裝包：

```bash
pnpm build:win
```

構建產物將位於 `dist` 目錄。

## 📁 專案結構

```
bz-launcher/
├── games/                 # 遊戲資料儲存目錄 (Portable Mode)
├── src/
│   ├── main/              # Electron 主程序 (Node.js)
│   │   ├── services/      # 核心業務邏輯 (GameManager, RoomServer, CloudSyncService 等)
│   │   └── ipc/           # IPC 通訊處理器
│   ├── preload/           # Preload 指令碼 (暴露安全 API)
│   ├── renderer/          # 渲染程序 (Vue 3 UI)
│   └── shared/            # 前後端共享型別定義
├── relay-server/          # 官方中繼伺服器（房間中繼／GitHub OAuth／雲同步）
├── resources/             # 應用圖示等靜態資源
└── electron.vite.config.ts
```

> 市場索引資料由獨立的 [bz-games-market](https://github.com/baozha2023/bz-games-market) 倉庫維護，平台透過兩級市場架構拉取展示。

更多細節請參考 `CLAUDE.md` 中的開發規範。
