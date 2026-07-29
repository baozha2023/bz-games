# BZ-Games 遊戲平台

[![Electron](https://img.shields.io/badge/Electron-v40+-blue)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-v3.5-green)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-multiple--ciphers-orange)](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | 繁體中文 | [文言文](./README.lzh.md)

**BZ-Games** 是一個**本地優先的 Windows 遊戲平台**，專為 Windows 設計。它允許使用者匯入本地遊戲，並透過內建的 P2P 聯機房間系統與好友進行多人遊戲。支援區域網路自動發現、使用者自備 frp 直連、官方中繼短位址三種聯機入口，並提供 GitHub OAuth 登入與雲端資料同步服務。

## ✨ 核心特性

- **📂 開放式遊戲庫**：支援匯入任意符合規範的本地遊戲，自動管理多版本共存與切換。
- **🔌 本地優先資料**：設定檔加密儲存於本地，無需註冊即可使用。可選 GitHub OAuth 登入實現雲端同步。
- **🎮 統一聯機大廳**：內建房間系統（建立／加入／準備／聊天／踢人／斷線重連），遊戲只需接入 Game API 即可獲得完整聯機能力。
- **🌐 多入口聯機**：支援區域網路自動發現、使用者自備 frp 直連、官方 Relay Server 短位址中繼。房間發現頁按實體區域網路／虛擬區域網路（EasyTier）／伺服器三欄分類。
- **☁️ GitHub 登入與雲同步**：透過 GitHub OAuth 授權，支援 `config.json`、`bz_games.db` 雲端上傳／下載同步，含進度條與雜湊校驗。
- **🏪 遊戲市場**：內建兩級市場架構，支援多來源社群遊戲瀏覽、下載與一鍵安裝。下載任務支援進度追蹤、暫停、恢復、取消與懸浮球提醒。
- **🏆 成就與統計系統**：遊戲可自訂成就列表與統計指標，平台自動追蹤解鎖。支援日曆熱力圖、單日／累計／連續遊玩統計，可一鍵分享為圖片。
- **🪙 經濟系統**：簽到領 BZ 幣，累計遊玩時長自動獎勵。頭像框解鎖與裝備、暱稱顏色／字型／特效個性化裝扮。
- **🚀 程序管理**：自動啟動／關閉遊戲程序，處理異常退出與崩潰恢復。
- **🎨 遊戲 API**：提供本地 Game API 服務（V1/V2 協定），遊戲可透過 HTTP 讀取存檔、上報統計與成就。
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

- **Core**: Electron 40, TypeScript 5
- **Frontend**: Vue 3.5, Naive UI, Pinia, Vue Router, Vue I18n
- **Build**: Electron-Vite, Electron-Builder
- **Database**: better-sqlite3-multiple-ciphers（ChaCha20 加密 SQLite）
- **Config**: electron-store（加密 JSON）
- **Communication**: WebSocket（ws 庫）, Electron IPC
- **Archive**: 7zip-bin / 7za (7Z), adm-zip (ZIP)
- **Image**: html2canvas（熱力圖分享渲染）
- **Update**: electron-updater (GitHub Releases)

## 🚀 快速開始

### 環境要求

- Node.js 20+
- pnpm 9+
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
├── games/                 # 遊戲資料儲存目錄（可設定多路徑）
├── resources/             # 應用圖示、佔位圖等靜態資源
├── src/
│   ├── main/              # Electron 主程序
│   │   ├── index.ts          # 入口：視窗管理、應用生命週期
│   │   ├── window.ts         # 懸浮球視窗
│   │   ├── ipc/              # IPC 處理器（game / room / market / stats / system / storage）
│   │   ├── services/         # 核心業務
│   │   │   ├── game/            # GameManager、GameLoader、GameAPI（V1/V2）
│   │   │   ├── room/            # RoomServer、RoomClient、區域網路/UDP/中繼發現
│   │   │   ├── market/          # 市場下載與安裝任務管理
│   │   │   ├── storage/         # 加密 SQLite（遊戲、版本、會話、成就、統計）
│   │   │   └── system/          # CloudSync、Update、Notification
│   │   └── utils/            # 日誌、檔案工具、路徑處理
│   ├── preload/           # Preload 指令碼（game.ts / index.ts + API 橋接）
│   ├── renderer/          # 渲染程序（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # 頁面（Library / Market / Room / Statistics / Settings 等）
│   │   │   ├── components/    # 公共元件（game / room / settings / heatmap）
│   │   │   ├── stores/        # Pinia（game / room / settings）
│   │   │   ├── composables/   # 組合式函數
│   │   │   ├── locales/       # 6 語言國際化
│   │   │   └── router/        # Vue Router
│   │   └── index.html
│   └── shared/            # 前後端共享（型別、常數、IPC 通道、協定）
├── relay-server/          # 官方中繼伺服器（獨立部署）
├── bz-games-website/      # 官方網站
├── bz-games-github-release-market/  # GitHub Release 市場索引
└── electron.vite.config.ts
```

> 市場索引資料由獨立的 [bz-games-market](https://github.com/baozha2023/bz-games-market) 倉庫維護，平台透過兩級市場架構拉取展示。

更多開發規範請參考 `CLAUDE.md`。
